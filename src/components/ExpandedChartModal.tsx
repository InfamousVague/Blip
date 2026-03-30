import { useCallback } from "react";
import {
  AreaChart,
  Area,
  BarChart as RechartsBarChart,
  Bar,
  Treemap,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { minimize2 } from "@mattmattmattmatt/base/primitives/icon/icons/minimize-2";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/button/button.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import type { BandwidthSample } from "../hooks/useBandwidth";
import type { ServiceBreakdownEntry, ServiceSamplePoint } from "../hooks/useServiceBandwidth";
import "./ExpandedChartModal.css";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

const CHART_HEIGHT = 320;

const CHART_TITLES: Record<string, string> = {
  bandwidth: "Bandwidth",
  bars: "Bandwidth Bars",
  stream: "Service Stream",
  treemap: "Service Treemap",
};

// --- Glassmorphism treemap content for expanded view ---
interface GlassTreemapContentProps {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  size: number;
  fill: string;
  totalBytes: number;
}

function GlassTreemapContent({ x, y, width, height, name, size, fill, totalBytes }: GlassTreemapContentProps) {
  const isSmall = width < 80 || height < 50;
  const isTiny = width < 45 || height < 25;
  const percentage = totalBytes > 0 ? ((size / totalBytes) * 100).toFixed(1) : "0";

  // Parse the fill color to create glassmorphism variants
  const baseColor = fill;

  return (
    <g>
      {/* Background fill — semi-transparent for glass effect */}
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        fill={baseColor}
        opacity={0.25}
        rx={6}
      />
      {/* Gradient overlay for depth */}
      <defs>
        <linearGradient id={`glass-grad-${name}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity={0.15} />
          <stop offset="50%" stopColor="white" stopOpacity={0.03} />
          <stop offset="100%" stopColor={baseColor} stopOpacity={0.2} />
        </linearGradient>
      </defs>
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        fill={`url(#glass-grad-${name})`}
        rx={6}
      />
      {/* Border glow */}
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        fill="none"
        stroke={baseColor}
        strokeOpacity={0.4}
        strokeWidth={1}
        rx={6}
      />
      {/* Inner highlight line (top edge) */}
      {width > 30 && height > 20 && (
        <line
          x1={x + 8}
          y1={y + 2}
          x2={x + width - 8}
          y2={y + 2}
          stroke="white"
          strokeOpacity={0.12}
          strokeWidth={1}
          strokeLinecap="round"
        />
      )}
      {/* Text content */}
      {!isTiny && (
        <>
          <text
            x={x + width / 2}
            y={y + (isSmall ? height / 2 : height / 2 - 14)}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize={isSmall ? 11 : 14}
            fontWeight={600}
            opacity={0.95}
            fontFamily="var(--font-sans)"
          >
            {name}
          </text>
          {!isSmall && (
            <>
              <text
                x={x + width / 2}
                y={y + height / 2 + 4}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={12}
                fontWeight={500}
                opacity={0.7}
                fontFamily="var(--font-mono)"
              >
                {formatBytes(size)}
              </text>
              <text
                x={x + width / 2}
                y={y + height / 2 + 20}
                textAnchor="middle"
                dominantBaseline="central"
                fill={baseColor}
                fontSize={11}
                fontWeight={600}
                opacity={0.9}
                fontFamily="var(--font-mono)"
              >
                {percentage}%
              </text>
            </>
          )}
        </>
      )}
    </g>
  );
}

// --- Custom Tooltip ---
function CustomTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="expanded-chart-tooltip">
      <Text size="xs" color="tertiary" font="mono" style={{ marginBottom: 4 }}>
        {typeof label === "number" ? `${label}s ago` : label}
      </Text>
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: entry.color, flexShrink: 0 }} />
          <Text size="xs" font="mono" color="secondary">
            {entry.name}: {formatRate(entry.value)}
          </Text>
        </div>
      ))}
    </div>
  );
}

function BytesTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="expanded-chart-tooltip">
      <Text size="xs" color="tertiary" font="mono" style={{ marginBottom: 4 }}>
        {typeof label === "number" ? `${label}s ago` : label}
      </Text>
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: entry.color, flexShrink: 0 }} />
          <Text size="xs" font="mono" color="secondary">
            {entry.name}: {formatBytes(entry.value)}
          </Text>
        </div>
      ))}
    </div>
  );
}

// --- Expanded Charts ---

function ExpandedBandwidthChart({ samples }: { samples: BandwidthSample[] }) {
  return (
    <>
      <div className="expanded-chart-container">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <AreaChart data={samples} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
            <defs>
              <linearGradient id="gradInExp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gradOutExp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ec4899" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#ec4899" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="time"
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              tickLine={false}
              tickFormatter={(v) => `${v}s`}
            />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatBytes(v)}
              width={54}
            />
            <Tooltip content={<CustomTooltipContent />} />
            <Area
              type="monotone"
              dataKey="bytesIn"
              name="Download"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#gradInExp)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="bytesOut"
              name="Upload"
              stroke="#ec4899"
              strokeWidth={2}
              fill="url(#gradOutExp)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="expanded-chart-legend">
        <div className="expanded-chart-legend-item">
          <div className="expanded-chart-legend-dot" style={{ background: "#6366f1" }} />
          <Text size="xs" color="secondary">Download</Text>
        </div>
        <div className="expanded-chart-legend-item">
          <div className="expanded-chart-legend-dot" style={{ background: "#ec4899" }} />
          <Text size="xs" color="secondary">Upload</Text>
        </div>
      </div>
    </>
  );
}

function ExpandedBarChart({ samples }: { samples: BandwidthSample[] }) {
  return (
    <>
      <div className="expanded-chart-container">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <RechartsBarChart data={samples} margin={{ top: 8, right: 16, bottom: 8, left: 16 }} barGap={0} barCategoryGap="15%">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="time"
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              tickLine={false}
              tickFormatter={(v) => `${v}s`}
            />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatBytes(v)}
              width={54}
            />
            <Tooltip content={<CustomTooltipContent />} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.05)" />
            <Bar dataKey="bytesIn" name="Download" fill="#6366f1" radius={[2, 2, 0, 0]} isAnimationActive={false} opacity={0.85} />
            <Bar dataKey="bytesOut" name="Upload" fill="#ec4899" radius={[2, 2, 0, 0]} isAnimationActive={false} opacity={0.85} />
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
      <div className="expanded-chart-legend">
        <div className="expanded-chart-legend-item">
          <div className="expanded-chart-legend-dot" style={{ background: "#6366f1" }} />
          <Text size="xs" color="secondary">Download</Text>
        </div>
        <div className="expanded-chart-legend-item">
          <div className="expanded-chart-legend-dot" style={{ background: "#ec4899" }} />
          <Text size="xs" color="secondary">Upload</Text>
        </div>
      </div>
    </>
  );
}

function ExpandedStreamChart({
  serviceSamples,
  serviceColors,
}: {
  serviceSamples: ServiceSamplePoint[];
  serviceColors: Record<string, string>;
}) {
  const serviceNames = Object.keys(serviceColors);

  return (
    <>
      <div className="expanded-chart-container">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <AreaChart data={serviceSamples} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
            <defs>
              {serviceNames.map((name) => (
                <linearGradient key={name} id={`grad-stream-exp-${name}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={serviceColors[name]} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={serviceColors[name]} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="time"
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              tickLine={false}
              tickFormatter={(v) => `${v}s`}
            />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatBytes(v)}
              width={54}
            />
            <Tooltip content={<CustomTooltipContent />} />
            {serviceNames.map((name) => (
              <Area
                key={name}
                type="monotone"
                dataKey={name}
                stackId="1"
                stroke={serviceColors[name]}
                strokeWidth={1.5}
                fill={`url(#grad-stream-exp-${name})`}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="expanded-chart-legend">
        {serviceNames.map((name) => (
          <div key={name} className="expanded-chart-legend-item">
            <div className="expanded-chart-legend-dot" style={{ background: serviceColors[name] }} />
            <Text size="xs" color="secondary">{name}</Text>
          </div>
        ))}
      </div>
    </>
  );
}

function ExpandedTreemap({ serviceBreakdown }: { serviceBreakdown: ServiceBreakdownEntry[] }) {
  const data = serviceBreakdown
    .filter((s) => s.bytes > 0)
    .map((s) => ({
      name: s.name,
      size: s.bytes,
      fill: s.color,
    }));

  const totalBytes = data.reduce((sum, d) => sum + d.size, 0);

  if (data.length === 0) {
    return (
      <Stack direction="vertical" gap="2" align="center" justify="center" style={{ height: CHART_HEIGHT }}>
        <Text size="sm" color="tertiary">No bandwidth data yet</Text>
      </Stack>
    );
  }

  return (
    <>
      <div className="expanded-chart-container">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <Treemap
            data={data}
            dataKey="size"
            aspectRatio={4 / 3}
            content={<GlassTreemapContent x={0} y={0} width={0} height={0} name="" size={0} fill="" totalBytes={totalBytes} />}
            isAnimationActive={false}
          />
        </ResponsiveContainer>
      </div>
      {/* Summary table */}
      <Stack direction="vertical" gap="1">
        {serviceBreakdown
          .filter((s) => s.bytes > 0)
          .sort((a, b) => b.bytes - a.bytes)
          .map((s) => (
            <Stack
              key={s.name}
              direction="horizontal"
              gap="2"
              align="center"
              justify="between"
              style={{ padding: "var(--sp-1) 0" }}
            >
              <Stack direction="horizontal" gap="2" align="center">
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                <Text size="sm" weight="medium">{s.name}</Text>
              </Stack>
              <Stack direction="horizontal" gap="3" align="center">
                <Text size="xs" font="mono" color="tertiary">
                  {totalBytes > 0 ? ((s.bytes / totalBytes) * 100).toFixed(1) : 0}%
                </Text>
                <Text size="xs" font="mono" color="secondary">
                  {formatBytes(s.bytes)}
                </Text>
              </Stack>
            </Stack>
          ))}
      </Stack>
    </>
  );
}

// --- Main Modal ---

interface Props {
  chartMode: string;
  onClose: () => void;
  samples: BandwidthSample[];
  totalIn: number;
  totalOut: number;
  serviceSamples: ServiceSamplePoint[];
  serviceBreakdown: ServiceBreakdownEntry[];
  serviceColors: Record<string, string>;
}

export function ExpandedChartModal({
  chartMode,
  onClose,
  samples,
  totalIn,
  totalOut,
  serviceSamples,
  serviceBreakdown,
  serviceColors,
}: Props) {
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <div className="expanded-chart-backdrop" onClick={handleBackdropClick}>
      <div className="expanded-chart-panel" onClick={(e) => e.stopPropagation()}>
        <div className="expanded-chart-header">
          <Text size="sm" weight="semibold">
            {CHART_TITLES[chartMode] || "Chart"}
          </Text>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <Icon icon={minimize2} size="sm" />
          </Button>
        </div>
        <div className="expanded-chart-body">
          {chartMode === "bandwidth" && <ExpandedBandwidthChart samples={samples} />}
          {chartMode === "bars" && <ExpandedBarChart samples={samples} />}
          {chartMode === "stream" && (
            <ExpandedStreamChart serviceSamples={serviceSamples} serviceColors={serviceColors} />
          )}
          {chartMode === "treemap" && <ExpandedTreemap serviceBreakdown={serviceBreakdown} />}
        </div>
      </div>
    </div>
  );
}
