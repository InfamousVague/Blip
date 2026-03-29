import { useMemo, useState } from "react";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Separator } from "@mattmattmattmatt/base/primitives/separator/Separator";
import { Badge } from "@mattmattmattmatt/base/primitives/badge/Badge";
import { Chip } from "@mattmattmattmatt/base/primitives/chip/Chip";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import { Collapsible } from "@mattmattmattmatt/base/primitives/collapsible/Collapsible";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import { arrowLeft } from "@mattmattmattmatt/base/primitives/icon/icons/arrow-left";
import { Pagination } from "@mattmattmattmatt/base/primitives/pagination/Pagination";
import { BandwidthChart, BandwidthHeader } from "./BandwidthChart";
import type { BandwidthSample } from "../hooks/useBandwidth";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/separator/separator.css";
import "@mattmattmattmatt/base/primitives/badge/badge.css";
import "@mattmattmattmatt/base/primitives/chip/chip.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import "@mattmattmattmatt/base/primitives/button/button.css";
import "@mattmattmattmatt/base/primitives/collapsible/collapsible.css";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
import "@mattmattmattmatt/base/primitives/pagination/pagination.css";
import type { ResolvedConnection } from "../types/connection";
import type { EndpointData } from "../hooks/useArcAnimation";
import type { EndpointType } from "../utils/endpoint-type";
import { ScrollText } from "./ScrollText";
import { getBrandIcon, getRawBrandColor, getLuminance } from "../utils/brand-icons";

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
  if (bytes === 0) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface BandwidthData {
  samples: BandwidthSample[];
  totalIn: number;
  totalOut: number;
}

interface Props {
  endpoint: EndpointData;
  connections: ResolvedConnection[];
  bandwidth: BandwidthData;
  onBack: () => void;
}

const BLOCKED_PAGE_SIZE = 10;

export function EndpointDetail({ endpoint, connections, bandwidth, onBack }: Props) {
  const [blockedPage, setBlockedPage] = useState(1);

  // Filter connections matching this endpoint's location
  const matching = useMemo(() => {
    const latKey = endpoint.position[1].toFixed(2);
    const lonKey = endpoint.position[0].toFixed(2);
    return connections.filter(
      (c) => c.dest_lat.toFixed(2) === latKey && c.dest_lon.toFixed(2) === lonKey
    );
  }, [endpoint, connections]);

  const activeCount = matching.filter((c) => c.active).length;

  // Blocked connections (trackers/blocklisted)
  const blockedConns = useMemo(
    () => matching.filter((c) => c.is_tracker).sort((a, b) => b.last_seen_ms - a.last_seen_ms),
    [matching]
  );
  const blockedPageCount = Math.max(1, Math.ceil(blockedConns.length / BLOCKED_PAGE_SIZE));
  const safeBlockedPage = Math.min(blockedPage, blockedPageCount);
  const visibleBlocked = useMemo(() => {
    const start = (safeBlockedPage - 1) * BLOCKED_PAGE_SIZE;
    return blockedConns.slice(start, start + BLOCKED_PAGE_SIZE);
  }, [blockedConns, safeBlockedPage]);

  // Aggregate data stats
  const totalBytesSent = matching.reduce((s, c) => s + c.bytes_sent, 0);
  const totalBytesRecv = matching.reduce((s, c) => s + c.bytes_received, 0);

  // Unique processes
  const processes = [...new Set(matching.map((c) => c.process_name).filter(Boolean))] as string[];

  // Unique IPs
  const uniqueIps = [...new Set(matching.map((c) => c.dest_ip))];

  // Unique ports
  const uniquePorts = [...new Set(matching.map((c) => c.dest_port))].sort((a, b) => a - b);

  // Unique protocols
  const protocols = [...new Set(matching.map((c) => c.protocol))];

  // Brand icon + color for header card
  const brand = useMemo(() => getBrandIcon(endpoint.domain, endpoint.serviceName), [endpoint.domain, endpoint.serviceName]);
  const rawColor = useMemo(() => getRawBrandColor(endpoint.domain, endpoint.serviceName), [endpoint.domain, endpoint.serviceName]);
  const headerBg = rawColor || "var(--glass-bg-elevated)";
  const isLight = rawColor ? getLuminance(rawColor) > 0.55 : false;
  const headerText = isLight ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.95)";
  const headerTextSecondary = isLight ? "rgba(0, 0, 0, 0.55)" : "rgba(255, 255, 255, 0.6)";

  const displayName = endpoint.serviceName
    || endpoint.domain
    || uniqueIps[0]
    || "Unknown";
  const subtitle = endpoint.datacenter
    || [endpoint.city, endpoint.country].filter(Boolean).join(", ")
    || uniqueIps[0];

  return (
    <Stack direction="vertical" gap="4" align="stretch">
      {/* Header card */}
      <div className="endpoint-detail-header" style={{ background: headerBg }}>
        <Button
          variant="ghost"
          size="sm"
          icon={arrowLeft}
          iconOnly
          onClick={onBack}
          aria-label="Back"
          className="endpoint-detail-header__back"
          style={{ color: headerText }}
        />
        <div className="endpoint-detail-header__icon">
          {brand ? (
            <img
              src={brand.url}
              alt={brand.brandName}
              className="endpoint-detail-header__brand-flat"
              style={{ filter: isLight ? "brightness(0)" : "brightness(0) invert(1)" }}
            />
          ) : (
            <img src={ICON_MAP[endpoint.type]} alt={endpoint.type} className="endpoint-detail-header__fallback" />
          )}
        </div>
        <div className="endpoint-detail-header__info">
          <span className="endpoint-detail-header__name" style={{ color: headerText }}>
            {displayName}
          </span>
          {subtitle && subtitle !== displayName && (
            <span className="endpoint-detail-header__subtitle" style={{ color: headerTextSecondary }}>
              {subtitle}
            </span>
          )}
          <div className="endpoint-detail-header__badges">
            <Chip variant="filled" size="sm" style={{
              background: isLight ? "rgba(0, 0, 0, 0.1)" : "rgba(255, 255, 255, 0.15)",
              color: headerText,
            }}>
              {TYPE_LABELS[endpoint.type]}
            </Chip>
            <Badge variant={activeCount > 0 ? "solid" : "subtle"} color={activeCount > 0 ? "success" : "neutral"} size="sm">
              <NumberRoll value={activeCount} minDigits={1} fontSize="var(--text-xs-size)" duration={300} /> active
            </Badge>
          </div>
        </div>
      </div>

      <BandwidthHeader
        samples={bandwidth.samples}
        totalIn={bandwidth.totalIn}
        totalOut={bandwidth.totalOut}
      />
      <BandwidthChart
        samples={bandwidth.samples}
        totalIn={bandwidth.totalIn}
        totalOut={bandwidth.totalOut}
      />

      <Separator />

      {processes.length > 0 && (
        <Collapsible
          trigger={<Text size="sm" weight="medium" color="secondary">Processes (<NumberRoll value={processes.length} minDigits={1} fontSize="var(--text-sm-size)" duration={300} />)</Text>}
          defaultOpen
        >
          <Stack direction="vertical" gap="2" style={{ paddingTop: "var(--sp-2)" }}>
            {processes.map((proc) => (
              <Text key={proc} size="sm" font="mono">{proc}</Text>
            ))}
          </Stack>
        </Collapsible>
      )}

      <Collapsible
        trigger={<Text size="sm" weight="medium" color="secondary">Hostnames</Text>}
        defaultOpen
      >
        <Stack direction="vertical" gap="1" style={{ paddingTop: "var(--sp-2)" }}>
          {endpoint.domain ? (
            <Text size="sm" font="mono">{endpoint.domain}</Text>
          ) : (
            <Text size="sm" color="tertiary">No reverse DNS</Text>
          )}
        </Stack>
      </Collapsible>

      <Collapsible
        trigger={<Text size="sm" weight="medium" color="secondary">IP Addresses (<NumberRoll value={uniqueIps.length} minDigits={1} fontSize="var(--text-sm-size)" duration={300} />)</Text>}
        defaultOpen
      >
        <Stack direction="vertical" gap="1" style={{ paddingTop: "var(--sp-2)" }}>
          {uniqueIps.map((ip) => (
            <Text key={ip} size="sm" font="mono">{ip}</Text>
          ))}
        </Stack>
      </Collapsible>

      <Collapsible
        trigger={<Text size="sm" weight="medium" color="secondary">Connection Summary</Text>}
        defaultOpen
      >
        <Stack direction="vertical" gap="1" style={{ paddingTop: "var(--sp-2)" }}>
          <Stack direction="horizontal" gap="2" align="center" justify="between">
            <Text size="xs" color="tertiary">Total connections</Text>
            <Text size="sm" font="mono"><NumberRoll value={matching.length} minDigits={1} fontSize="var(--text-sm-size)" duration={300} /></Text>
          </Stack>
          <Stack direction="horizontal" gap="2" align="center" justify="between">
            <Text size="xs" color="tertiary">Active</Text>
            <Badge variant={activeCount > 0 ? "solid" : "subtle"} color={activeCount > 0 ? "success" : "neutral"} size="sm">
              <NumberRoll value={activeCount} minDigits={1} fontSize="var(--text-xs-size)" duration={300} />
            </Badge>
          </Stack>
          <Stack direction="horizontal" gap="2" align="center" justify="between">
            <Text size="xs" color="tertiary">Blocked</Text>
            <Badge variant={blockedConns.length > 0 ? "solid" : "subtle"} color={blockedConns.length > 0 ? "error" : "neutral"} size="sm">
              <NumberRoll value={blockedConns.length} minDigits={1} fontSize="var(--text-xs-size)" duration={300} />
            </Badge>
          </Stack>
          <Separator />
          <Stack direction="horizontal" gap="2" align="center" justify="between">
            <Text size="xs" color="tertiary">Data sent</Text>
            <Text size="sm" font="mono">{formatBytes(totalBytesSent)}</Text>
          </Stack>
          <Stack direction="horizontal" gap="2" align="center" justify="between">
            <Text size="xs" color="tertiary">Data received</Text>
            <Text size="sm" font="mono">{formatBytes(totalBytesRecv)}</Text>
          </Stack>
          <Stack direction="horizontal" gap="2" align="center" justify="between">
            <Text size="xs" color="tertiary">Total data</Text>
            <Text size="sm" font="mono" weight="medium">{formatBytes(totalBytesSent + totalBytesRecv)}</Text>
          </Stack>
        </Stack>
      </Collapsible>

      <Collapsible
        trigger={<Text size="sm" weight="medium" color="secondary">Connection Details</Text>}
        defaultOpen
      >
        <Stack direction="vertical" gap="1" style={{ paddingTop: "var(--sp-2)" }}>
          <Stack direction="horizontal" gap="2" align="center">
            <Text size="xs" color="tertiary">Ports:</Text>
            <Text size="sm" font="mono">{uniquePorts.join(", ")}</Text>
          </Stack>
          <Stack direction="horizontal" gap="2" align="center">
            <Text size="xs" color="tertiary">Protocols:</Text>
            {protocols.map((p) => (
              <Chip key={p} variant="outlined" size="sm">{p}</Chip>
            ))}
          </Stack>
        </Stack>
      </Collapsible>

      {blockedConns.length > 0 && (
        <>
          <Separator />
          <Collapsible
            trigger={
              <Stack direction="horizontal" gap="2" align="center">
                <Text size="sm" weight="medium" color="secondary">
                  Blocked Connections (<NumberRoll value={blockedConns.length} minDigits={1} fontSize="var(--text-sm-size)" duration={300} />)
                </Text>
              </Stack>
            }
            defaultOpen
          >
            <Stack direction="vertical" gap="2" style={{ paddingTop: "var(--sp-2)" }}>
              {visibleBlocked.map((c) => (
                <Stack key={c.id} direction="vertical" gap="1" style={{
                  padding: "var(--sp-2)",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(255, 50, 50, 0.06)",
                  borderLeft: "2px solid rgba(255, 50, 50, 0.4)",
                }}>
                  <Stack direction="horizontal" gap="2" align="center" justify="between">
                    <Text size="sm" font="mono" truncate={1} style={{ flex: 1 }}>
                      {c.domain || c.dest_ip}
                    </Text>
                    <Badge variant="solid" color="error" size="sm">blocked</Badge>
                  </Stack>
                  <Stack direction="horizontal" gap="2" align="center" justify="between">
                    <Text size="xs" color="tertiary">
                      {c.process_name || "unknown"} · {c.dest_ip}:{c.dest_port}
                    </Text>
                    <Text size="xs" color="tertiary" font="mono">
                      {formatBytes(c.bytes_sent + c.bytes_received)}
                    </Text>
                  </Stack>
                  <Text size="xs" color="tertiary">
                    {formatTime(c.first_seen_ms)} — {c.active ? "now" : formatTime(c.last_seen_ms)}
                    {c.tracker_category ? ` · ${c.tracker_category}` : ""}
                  </Text>
                </Stack>
              ))}
            </Stack>
            {blockedPageCount > 1 && (
              <Pagination
                page={safeBlockedPage}
                totalPages={blockedPageCount}
                totalItems={blockedConns.length}
                onPageChange={setBlockedPage}
                size="sm"
              />
            )}
          </Collapsible>
        </>
      )}

      <Separator />

      <Collapsible
        trigger={<Text size="sm" weight="medium" color="secondary">All Connections (<NumberRoll value={matching.length} minDigits={1} fontSize="var(--text-sm-size)" duration={300} />)</Text>}
      >
        <Stack direction="vertical" gap="2" style={{ paddingTop: "var(--sp-2)" }}>
          {matching.map((c) => (
            <Stack key={c.id} direction="vertical" gap="1" style={{
              padding: "var(--sp-2)",
              borderRadius: "var(--radius-sm)",
              background: c.is_tracker ? "rgba(255, 50, 50, 0.06)" : "var(--glass-bg-subtle)",
            }}>
              <Stack direction="horizontal" gap="2" align="center" justify="between">
                <Text size="sm" font="mono" truncate={1} style={{ flex: 1 }}>
                  {c.dest_ip}:{c.dest_port}
                </Text>
                {c.is_tracker ? (
                  <Badge variant="solid" color="error" size="sm">blocked</Badge>
                ) : (
                  <Badge dot color={c.active ? "success" : "neutral"} />
                )}
              </Stack>
              <Stack direction="horizontal" gap="2" align="center">
                <Text size="xs" color="tertiary">
                  {formatTime(c.first_seen_ms)} — {c.active ? "now" : formatTime(c.last_seen_ms)}
                </Text>
              </Stack>
            </Stack>
          ))}
        </Stack>
      </Collapsible>
    </Stack>
  );
}
