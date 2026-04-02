import { useMemo, useState } from "react";
import { Badge } from "../ui/components/Badge";
import { Chip } from "../ui/components/Chip";
import { Button } from "../ui/components/Button";
import { DetailRow } from "../ui/components/DetailRow";
import { Pagination } from "../ui/components/Pagination";
import { Separator } from "../ui/components/Separator";
import { CollapsibleSection } from "../ui/components/CollapsibleSection";
import { FrostedCard } from "../ui/glass";
import { chevronLeft } from "@mattmattmattmatt/base/primitives/icon/icons/chevron-left";
import { BandwidthChart, BandwidthHeader } from "./BandwidthChart";
import type { BandwidthSample } from "../hooks/useBandwidth";
import type { ResolvedConnection, TracedRoute } from "../types/connection";
import type { EndpointData } from "../hooks/useArcAnimation";
import { RouteTimeline } from "./RouteTimeline";
import type { EndpointType } from "../utils/endpoint-type";
import { getBrandIcon, getRawBrandColor, getLuminance } from "../utils/brand-icons";

import serverIcon from "../assets/icons/server.png";
import chatIcon from "../assets/icons/chat.png";
import streamingIcon from "../assets/icons/streaming.png";
import shieldIcon from "../assets/icons/shield.png";

const ICON_MAP: Record<EndpointType, string> = {
  server: serverIcon, chat: chatIcon, streaming: streamingIcon, shield: shieldIcon,
};
const TYPE_LABELS: Record<EndpointType, string> = {
  server: "Server", chat: "Messaging", streaming: "Streaming", shield: "Security",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "\u2014";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

interface BandwidthData { samples: BandwidthSample[]; totalIn: number; totalOut: number; }
interface Props {
  endpoint: EndpointData;
  connections: ResolvedConnection[];
  bandwidth: BandwidthData;
  onBack: () => void;
  tracedRoutes?: globalThis.Map<string, TracedRoute>;
}

const BLOCKED_PAGE_SIZE = 10;

export function EndpointDetail({ endpoint, connections, bandwidth, onBack, tracedRoutes }: Props) {
  const [blockedPage, setBlockedPage] = useState(1);

  const matching = useMemo(() => {
    const latKey = endpoint.position[1].toFixed(2);
    const lonKey = endpoint.position[0].toFixed(2);
    return connections.filter((c) => c.dest_lat.toFixed(2) === latKey && c.dest_lon.toFixed(2) === lonKey);
  }, [endpoint, connections]);

  const activeCount = matching.filter((c) => c.active).length;
  const blockedConns = useMemo(() => matching.filter((c) => c.is_tracker).sort((a, b) => b.last_seen_ms - a.last_seen_ms), [matching]);
  const blockedPageCount = Math.max(1, Math.ceil(blockedConns.length / BLOCKED_PAGE_SIZE));
  const safeBlockedPage = Math.min(blockedPage, blockedPageCount);
  const visibleBlocked = useMemo(() => {
    const start = (safeBlockedPage - 1) * BLOCKED_PAGE_SIZE;
    return blockedConns.slice(start, start + BLOCKED_PAGE_SIZE);
  }, [blockedConns, safeBlockedPage]);

  const totalBytesSent = matching.reduce((s, c) => s + c.bytes_sent, 0);
  const totalBytesRecv = matching.reduce((s, c) => s + c.bytes_received, 0);
  const processes = [...new Set(matching.map((c) => c.process_name).filter((p): p is string => p != null))]
    .map((p) => p.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
  const uniqueIps = [...new Set(matching.map((c) => c.dest_ip))];
  const uniquePorts = [...new Set(matching.map((c) => c.dest_port))].sort((a, b) => a - b);
  const protocols = [...new Set(matching.map((c) => c.protocol))];

  const brand = useMemo(() => getBrandIcon(endpoint.domain, endpoint.serviceName), [endpoint.domain, endpoint.serviceName]);
  const rawColor = useMemo(() => getRawBrandColor(endpoint.domain, endpoint.serviceName), [endpoint.domain, endpoint.serviceName]);
  const isLight = rawColor ? getLuminance(rawColor) > 0.55 : false;
  const headerText = isLight ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.95)";
  const headerTextSecondary = isLight ? "rgba(0, 0, 0, 0.55)" : "rgba(255, 255, 255, 0.6)";

  const displayName = endpoint.serviceName || endpoint.domain || uniqueIps[0] || "Unknown";
  const subtitle = endpoint.datacenter || [endpoint.city, endpoint.country].filter(Boolean).join(", ") || uniqueIps[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Header card — brand colored, inset from sidebar edges */}
      <FrostedCard style={{ background: rawColor || "rgba(40, 40, 50, 1)", backdropFilter: "none", WebkitBackdropFilter: "none", border: "none", padding: "16px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button variant="ghost" size="lg" icon={chevronLeft} iconOnly onClick={onBack} aria-label="Back" style={{ color: headerText, flexShrink: 0 }} />
          <div style={{ width: 40, height: 40, borderRadius: 10, overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isLight ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.18)" }}>
            {brand ? (
              <img src={brand.url} alt={brand.brandName} style={{ width: 28, height: 28, objectFit: "contain" }} />
            ) : (
              <img src={ICON_MAP[endpoint.type]} alt={endpoint.type} style={{ width: 24, height: 24, objectFit: "contain" }} />
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-sans)", color: headerText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</span>
            {subtitle && subtitle !== displayName && (
              <span style={{ fontSize: 12, fontFamily: "var(--font-sans)", color: headerTextSecondary }}>{subtitle}</span>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Chip variant="filled" size="sm" style={{ background: isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.15)", color: headerText }}>{TYPE_LABELS[endpoint.type]}</Chip>
              <Badge variant={activeCount > 0 ? "solid" : "subtle"} color={activeCount > 0 ? "success" : "neutral"} size="sm" dot>{activeCount} active</Badge>
            </div>
          </div>
        </div>
      </FrostedCard>

      {/* Bandwidth */}
      <BandwidthHeader samples={bandwidth.samples} totalIn={bandwidth.totalIn} totalOut={bandwidth.totalOut} />

      {/* Chart */}
      <FrostedCard gap={0}>
        <BandwidthChart samples={bandwidth.samples} totalIn={bandwidth.totalIn} totalOut={bandwidth.totalOut} />
      </FrostedCard>

      {/* Route Timeline — show traced hops if available */}
      {(() => {
        if (!tracedRoutes) return null;
        // Find a traced route for any connection to this endpoint
        const route = matching.map((c) => tracedRoutes.get(c.dest_ip)).find(Boolean);
        if (!route || route.hops.length === 0) return null;
        return (
          <CollapsibleSection title="Route" count={route.hops.length} gap={0}>
            <RouteTimeline
              route={route}
              destination={{
                city: endpoint.city,
                country: endpoint.country,
                ip: endpoint.ip ?? undefined,
                domain: endpoint.domain,
              }}
            />
          </CollapsibleSection>
        );
      })()}

      {/* Processes */}
      {processes.length > 0 && (
        <CollapsibleSection title="Processes" count={processes.length} gap={4}>
          {processes.map((proc) => (
            <span key={proc} className="blip-text-mono">{proc}</span>
          ))}
        </CollapsibleSection>
      )}

      {/* Hostnames */}
      <CollapsibleSection title="Hostnames" gap={4}>
        {endpoint.domain ? (
          <span className="blip-text-mono">{endpoint.domain}</span>
        ) : (
          <span className="blip-text-empty">No reverse DNS</span>
        )}
      </CollapsibleSection>

      {/* IPs */}
      <CollapsibleSection title="IP Addresses" count={uniqueIps.length} gap={4}>
        {uniqueIps.map((ip) => (
          <span key={ip} className="blip-text-mono">{ip}</span>
        ))}
      </CollapsibleSection>

      {/* Connection Summary */}
      <CollapsibleSection title="Connection Summary" gap={4}>
        <DetailRow label="Total connections" value={String(matching.length)} mono />
        <DetailRow label="Active" value={String(activeCount)} mono />
        <DetailRow label="Blocked" value={String(blockedConns.length)} mono />
        <Separator />
        <DetailRow label="Data sent" value={formatBytes(totalBytesSent)} mono />
        <DetailRow label="Data received" value={formatBytes(totalBytesRecv)} mono />
        <DetailRow label="Total data" value={formatBytes(totalBytesSent + totalBytesRecv)} mono />
        <Separator />
        <DetailRow label="Ports" value={uniquePorts.join(", ")} mono />
        <div style={{ display: "flex", gap: 6, alignItems: "center", paddingTop: 2 }}>
          <span className="blip-text-label">Protocols:</span>
          {protocols.map((p) => <Chip key={p} variant="outlined" size="sm">{p}</Chip>)}
        </div>
      </CollapsibleSection>

      {/* Blocked Connections */}
      {blockedConns.length > 0 && (
        <CollapsibleSection title="Blocked" count={blockedConns.length} triggerColor="var(--blip-error)" gap={6}>
          {visibleBlocked.map((c) => (
            <div key={c.id} className="blip-blocked-item">
              <div className="blip-blocked-item__header">
                <span className="blip-blocked-item__domain">{c.domain || c.dest_ip}</span>
                <Badge variant="solid" color="error" size="sm">blocked</Badge>
              </div>
              <span className="blip-blocked-item__meta">{c.process_name || "unknown"} · {c.dest_ip}:{c.dest_port} · {formatBytes(c.bytes_sent + c.bytes_received)}</span>
            </div>
          ))}
          {blockedPageCount > 1 && (
            <Pagination page={safeBlockedPage} totalPages={blockedPageCount} totalItems={blockedConns.length} onPageChange={setBlockedPage} size="sm" />
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}
