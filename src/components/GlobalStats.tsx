import { useMemo, useState } from "react";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Separator } from "@mattmattmattmatt/base/primitives/separator/Separator";
import { Tag } from "@mattmattmattmatt/base/primitives/tag/Tag";
import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { Collapsible } from "@mattmattmattmatt/base/primitives/collapsible/Collapsible";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import { SegmentedControl } from "@mattmattmattmatt/base/primitives/segmented-control/SegmentedControl";
import { activity } from "@mattmattmattmatt/base/primitives/icon/icons/activity";
import { chevronDown } from "@mattmattmattmatt/base/primitives/icon/icons/chevron-down";
import { chevronUp } from "@mattmattmattmatt/base/primitives/icon/icons/chevron-up";
import { BandwidthChart, BandwidthHeader } from "./BandwidthChart";
import { BandwidthBarChart } from "./BarChart";
import { StreamChart } from "./StreamChart";
import { TreemapChart } from "./TreemapChart";
import { useServiceBandwidth } from "../hooks/useServiceBandwidth";
import type { BandwidthSample } from "../hooks/useBandwidth";
import "@mattmattmattmatt/base/primitives/segmented-control/segmented-control.css";
import { classifyEndpoint, type EndpointType } from "../utils/endpoint-type";
import { getServiceColor } from "../utils/service-colors";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/separator/separator.css";
import "@mattmattmattmatt/base/primitives/tag/tag.css";
import "@mattmattmattmatt/base/primitives/button/button.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import "@mattmattmattmatt/base/primitives/collapsible/collapsible.css";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
import type { ResolvedConnection } from "../types/connection";
import { getBrandIcon } from "../utils/brand-icons";

import serverIcon from "../assets/icons/server.png";
import chatIcon from "../assets/icons/chat.png";
import streamingIcon from "../assets/icons/streaming.png";
import shieldIcon from "../assets/icons/shield.png";

const ICON_MAP: Record<EndpointType, string> = {
  server: serverIcon,
  chat: chatIcon,
  streaming: streamingIcon,
  shield: shieldIcon,
};

const TYPE_LABELS: Record<EndpointType, string> = {
  server: "Server",
  chat: "Messaging",
  streaming: "Streaming",
  shield: "Security",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

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
}

interface Props {
  connections: ResolvedConnection[];
  totalEver: number;
  bandwidth: BandwidthData;
}

const PAGE_SIZE = 5;

const CHART_MODES = [
  { value: "bandwidth", label: "Bandwidth" },
  { value: "bars", label: "Bars" },
  { value: "stream", label: "Stream" },
  { value: "treemap", label: "Treemap" },
];

export function GlobalStats({ connections, totalEver, bandwidth }: Props) {
  const [showAllServices, setShowAllServices] = useState(false);
  const [chartMode, setChartMode] = useState("bandwidth");
  const { serviceSamples, serviceBreakdown, serviceColors } = useServiceBandwidth(connections, bandwidth);

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
      const existing = byService.get(key) || { type, label: serviceName || TYPE_LABELS[type], count: 0, domains: [] };
      existing.count += 1;
      if (c.domain && !existing.domains.includes(c.domain)) {
        existing.domains.push(c.domain);
      }
      byService.set(key, existing);
    }
    const services = [...byService.values()].sort((a, b) => b.count - a.count);

    return { active: active.length, total: connections.length, totalEver, topProcesses, topCountries, services };
  }, [connections, totalEver]);

  const visibleServices = showAllServices ? stats.services : stats.services.slice(0, PAGE_SIZE);

  return (
    <Stack direction="vertical" gap="4" align="stretch">
      <Stack direction="horizontal" gap="4" align="center">
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">ACTIVE</Text>
          <NumberRoll value={stats.active} minDigits={3} fontSize="var(--text-2xl-size)" commas />
        </Stack>
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">TOTAL</Text>
          <NumberRoll value={stats.total} minDigits={3} fontSize="var(--text-2xl-size)" commas />
        </Stack>
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">EVER</Text>
          <NumberRoll value={stats.totalEver} minDigits={4} fontSize="var(--text-2xl-size)" commas />
        </Stack>
      </Stack>

      <Separator />

      <BandwidthHeader
        samples={bandwidth.samples}
        totalIn={bandwidth.totalIn}
        totalOut={bandwidth.totalOut}
      />

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
        <TreemapChart serviceBreakdown={serviceBreakdown} />
      )}

      <SegmentedControl
        options={CHART_MODES}
        value={chartMode}
        onChange={setChartMode}
        size="sm"
        style={{ width: "100%" }}
      />

      <Separator />

      <Collapsible
        trigger={
          <Text size="sm" weight="medium" color="secondary">
            Services (<NumberRoll value={stats.services.length} minDigits={1} fontSize="var(--text-sm-size)" duration={300} />)
          </Text>
        }
        defaultOpen
      >
        <Stack direction="vertical" gap="2" style={{ paddingTop: "var(--sp-2)" }}>
          {visibleServices.map((svc, i) => (
            <Stack key={`${svc.label}-${i}`} direction="horizontal" gap="2" align="center" justify="between">
              <Stack direction="horizontal" gap="2" align="center" style={{ flex: 1, overflow: "hidden" }}>
                <img
                  src={(() => {
                    // Try service label first
                    const byLabel = getBrandIcon(null, svc.label);
                    if (byLabel) return byLabel.url;
                    // Then try each domain
                    for (const d of svc.domains) {
                      const brand = getBrandIcon(d, svc.label);
                      if (brand) return brand.url;
                    }
                    return ICON_MAP[svc.type];
                  })()}
                  alt={svc.type}
                  style={{ width: 32, height: 32, flexShrink: 0, borderRadius: "var(--radius-sm)", objectFit: "contain" }}
                />
                <Stack direction="vertical" gap="1" style={{ overflow: "hidden" }}>
                  <Stack direction="horizontal" gap="1" align="center">
                    <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: getServiceColor(svc.label) }} />
                    <Text size="sm" weight="medium">{svc.label}</Text>
                  </Stack>
                  {svc.domains.length > 0 && (
                    <Text size="xs" color="tertiary" truncate={1}>
                      {svc.domains.slice(0, 3).join(", ")}
                    </Text>
                  )}
                </Stack>
              </Stack>
              <Tag color="neutral" size="sm">
                <NumberRoll value={svc.count} minDigits={1} fontSize="var(--text-xs-size)" duration={300} />
              </Tag>
            </Stack>
          ))}
          {stats.services.length > PAGE_SIZE && (
            <Button
              variant="ghost"
              size="sm"
              icon={showAllServices ? chevronUp : chevronDown}
              onClick={() => setShowAllServices(!showAllServices)}
            >
              {showAllServices ? "Show less" : `Show all (${stats.services.length})`}
            </Button>
          )}
          {stats.services.length === 0 && (
            <Text size="sm" color="tertiary">No services detected yet</Text>
          )}
        </Stack>
      </Collapsible>

      <Separator />

      <Collapsible
        trigger={
          <Text size="sm" weight="medium" color="secondary">
            Top Processes (<NumberRoll value={stats.topProcesses.length} minDigits={1} fontSize="var(--text-sm-size)" duration={300} />)
          </Text>
        }
        defaultOpen
      >
        <Stack direction="vertical" gap="2" style={{ paddingTop: "var(--sp-2)" }}>
          {stats.topProcesses.map(([name, data]) => (
            <Stack key={name} direction="horizontal" gap="2" align="center" justify="between">
              <Text size="sm" font="mono" truncate={1} style={{ flex: 1 }}>
                {name}
              </Text>
              <Tag color="neutral" size="sm">
                <NumberRoll value={data.count} minDigits={1} fontSize="var(--text-xs-size)" duration={300} />
              </Tag>
            </Stack>
          ))}
          {stats.topProcesses.length === 0 && (
            <Text size="sm" color="tertiary">No processes detected yet</Text>
          )}
        </Stack>
      </Collapsible>

      <Separator />

      <Collapsible
        trigger={
          <Text size="sm" weight="medium" color="secondary">
            Top Destinations (<NumberRoll value={stats.topCountries.length} minDigits={1} fontSize="var(--text-sm-size)" duration={300} />)
          </Text>
        }
        defaultOpen
      >
        <Stack direction="vertical" gap="2" style={{ paddingTop: "var(--sp-2)" }}>
          {stats.topCountries.map(([country, count]) => (
            <Stack key={country} direction="horizontal" gap="2" align="center" justify="between">
              <Text size="sm" truncate={1} style={{ flex: 1 }}>
                {country}
              </Text>
              <Tag color="neutral" size="sm">
                <NumberRoll value={count} minDigits={1} fontSize="var(--text-xs-size)" duration={300} />
              </Tag>
            </Stack>
          ))}
        </Stack>
      </Collapsible>
    </Stack>
  );
}
