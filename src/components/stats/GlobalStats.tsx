import { useMemo } from "react";
import { maximize2 } from "@mattmattmattmatt/base/primitives/icon/icons/maximize-2";
import { SegmentedControl } from "../../ui/components/SegmentedControl";
import { StatCard } from "../../ui/components/StatCard";
import { CollapsibleSection } from "../../ui/components/CollapsibleSection";
import { DestinationRow } from "../../ui/components/DestinationRow";
import { Button } from "../../ui/components/Button";
import { FrostedCard } from "../../ui/glass";
import { BandwidthChart, BandwidthHeader } from "../charts/BandwidthChart";
import { BandwidthBarChart } from "../charts/BarChart";
import { StreamChart } from "../charts/StreamChart";
import { TreemapChart } from "../charts/TreemapChart";
import { SpeedTestCard } from "../../ui/components/SpeedTestCard";
import { TopProcesses } from "./TopProcesses";
import { TopServices } from "./TopServices";
import type { ServiceSamplePoint, ServiceBreakdownEntry } from "../../hooks/useServiceBandwidth";
import type { BandwidthSample } from "../../hooks/useBandwidth";
import { classifyEndpoint, type EndpointType } from "../../utils/endpoint-type";
import type { ResolvedConnection } from "../../types/connection";
import { useState } from "react";

const TYPE_LABELS: Record<EndpointType, string> = {
  server: "Server",
  chat: "Messaging",
  streaming: "Streaming",
  shield: "Security",
};

interface BandwidthData {
  samples: BandwidthSample[];
  totalIn: number;
  totalOut: number;
}

interface ServiceStat {
  type: EndpointType;
  label: string;
  count: number;
  domains: string[];
  bytesSent: number;
  bytesReceived: number;
  lastSeenMs: number;
}

interface Props {
  connections: ResolvedConnection[];
  totalEver: number;
  bandwidth: BandwidthData;
  serviceSamples: ServiceSamplePoint[];
  serviceBreakdown: ServiceBreakdownEntry[];
  serviceColors: Record<string, string>;
  downloadMbps?: number;
  uploadMbps?: number;
  pingMs?: number;
  speedTesting?: boolean;
  lastSpeedTestTime?: number;
  onRunSpeedTest?: () => void;
  speedStage?: 'idle' | 'ping' | 'download' | 'upload';
  liveDownloadMbps?: number;
  liveUploadMbps?: number;
  speedPercent?: number;
  activeServiceFilter?: string | null;
  onServiceClick?: (serviceName: string | null) => void;
  onOpenTreemap?: () => void;
}

const CHART_MODES = [
  { value: "bandwidth", label: "Bandwidth" },
  { value: "bars", label: "Bars" },
  { value: "stream", label: "Stream" },
  { value: "treemap", label: "Treemap" },
];

export function GlobalStats({ connections, totalEver, bandwidth, serviceSamples, serviceBreakdown, serviceColors, downloadMbps = 0, uploadMbps = 0, pingMs = 0, speedTesting = false, lastSpeedTestTime = 0, onRunSpeedTest, speedStage = 'idle', liveDownloadMbps = 0, liveUploadMbps = 0, speedPercent = 0, activeServiceFilter = null, onServiceClick, onOpenTreemap }: Props) {
  const [chartMode, setChartMode] = useState("bandwidth");

  const stats = useMemo(() => {
    const active = connections.filter((c) => c.active);

    // Group by process
    const byProcess = new Map<string, { count: number }>();
    for (const c of connections) {
      const name = c.process_name || "Unknown";
      const existing = byProcess.get(name) || { count: 0 };
      existing.count += 1;
      byProcess.set(name, existing);
    }
    const topProcesses = [...byProcess.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);

    // Group by country
    const byCountry = new Map<string, number>();
    for (const c of connections) {
      const country = c.country || "Unknown";
      byCountry.set(country, (byCountry.get(country) || 0) + 1);
    }
    const topCountries = [...byCountry.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Group by service (using IP + domain + process classification)
    const byService = new Map<string, ServiceStat>();
    for (const c of connections) {
      const { type, serviceName } = classifyEndpoint(c.domain, c.process_name, c.dest_ip);
      const key = serviceName || type;
      const existing = byService.get(key) || { type, label: serviceName || TYPE_LABELS[type], count: 0, domains: [], bytesSent: 0, bytesReceived: 0, lastSeenMs: 0 };
      existing.count += 1;
      existing.bytesSent += c.bytes_sent;
      existing.bytesReceived += c.bytes_received;
      if (c.last_seen_ms > existing.lastSeenMs) {
        existing.lastSeenMs = c.last_seen_ms;
      }
      if (c.domain && !existing.domains.includes(c.domain)) {
        existing.domains.push(c.domain);
      }
      byService.set(key, existing);
    }
    // Sort by most recent traffic first
    const services = [...byService.values()].sort((a, b) => b.lastSeenMs - a.lastSeenMs);

    return { active: active.length, total: connections.length, totalEver, topProcesses, topCountries, services };
  }, [connections, totalEver]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "stretch" }}>
      <StatCard
        stats={[
          { label: "ACTIVE", value: stats.active, minDigits: 4 },
          { label: "TOTAL", value: stats.total, minDigits: 5 },
          { label: "EVER", value: stats.totalEver, minDigits: 6 },
        ]}
      />

      <BandwidthHeader
        samples={bandwidth.samples}
        totalIn={bandwidth.totalIn}
        totalOut={bandwidth.totalOut}
        uploadMbps={uploadMbps}
        downloadMbps={downloadMbps}
      />

      <FrostedCard gap={8}>
        <div style={{ position: "relative" }}>
          {chartMode === "bandwidth" && (
            <BandwidthChart
              samples={bandwidth.samples}
              totalIn={bandwidth.totalIn}
              totalOut={bandwidth.totalOut}
            />
          )}
          {chartMode === "bars" && (
            <BandwidthBarChart
              samples={bandwidth.samples}
              totalIn={bandwidth.totalIn}
              totalOut={bandwidth.totalOut}
            />
          )}
          {chartMode === "stream" && (
            <StreamChart serviceSamples={serviceSamples} serviceColors={serviceColors} />
          )}
          {chartMode === "treemap" && (
            <div style={{ position: "relative" }}>
              <TreemapChart serviceBreakdown={serviceBreakdown} />
              <Button
                variant="ghost"
                size="sm"
                icon={maximize2}
                iconOnly
                aria-label="Expand treemap"
                onClick={() => onOpenTreemap?.()}
                style={{ position: "absolute", top: 2, right: 2, opacity: 0.6 }}
              />
            </div>
          )}
        </div>

        <SegmentedControl
          options={CHART_MODES}
          value={chartMode}
          onChange={setChartMode}
          size="sm"
          style={{ width: "100%" }}
        />
      </FrostedCard>

      <SpeedTestCard
        downloadMbps={downloadMbps}
        uploadMbps={uploadMbps}
        pingMs={pingMs}
        testing={speedTesting}
        lastTestTime={lastSpeedTestTime}
        onRunTest={onRunSpeedTest ?? (() => {})}
        stage={speedStage}
        liveDownloadMbps={liveDownloadMbps}
        liveUploadMbps={liveUploadMbps}
        percent={speedPercent}
      />

      <TopServices
        services={stats.services}
        activeServiceFilter={activeServiceFilter}
        onServiceClick={onServiceClick}
      />

      <TopProcesses topProcesses={stats.topProcesses} />

      <CollapsibleSection title="Top Destinations" count={stats.topCountries.length}>
        {stats.topCountries.map(([country, count]) => (
          <DestinationRow key={country} country={country} count={count} />
        ))}
      </CollapsibleSection>

    </div>
  );
}
