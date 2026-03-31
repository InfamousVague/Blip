import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
import { BandwidthCard } from "../ui/components/BandwidthCard";
import type { BandwidthSample } from "../hooks/useBandwidth";
import "./BandwidthChart.css";

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

/** Split bytes into { whole, decimal, unit } for animated rendering */
function splitBytes(bytes: number): { whole: number; decimal: number; unit: string } {
  if (bytes === 0) return { whole: 0, decimal: 0, unit: "B" };
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  const val = bytes / k ** i;
  const unit = sizes[Math.min(i, sizes.length - 1)];
  return { whole: Math.floor(val), decimal: Math.floor((val % 1) * 10), unit };
}

/** Animated byte display: "0,234.5 MB" with rolling digits */
function AnimatedBytes({ bytes, suffix, size, minDigits = 3 }: { bytes: number; suffix?: string; size: "sm" | "xs"; minDigits?: number }) {
  const { whole, decimal, unit } = splitBytes(bytes);
  const fontSize = size === "sm" ? "var(--text-sm-size)" : "var(--text-xs-size)";
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.1em", fontFamily: "var(--font-mono)", fontWeight: "var(--weight-medium)", fontSize: fontSize }}>
      <NumberRoll value={whole} minDigits={minDigits} duration={300} commas dimLeadingZeros />
      <span style={{ opacity: 0.5 }}>.</span>
      <NumberRoll value={decimal} minDigits={1} duration={300} dimLeadingZeros={false} />
      <span style={{ marginLeft: "0.25em", display: "inline-block", minWidth: "2.5em" }}>{unit}{suffix}</span>
    </span>
  );
}

interface HeaderProps {
  samples: BandwidthSample[];
  totalIn: number;
  totalOut: number;
  uploadMbps?: number;
  downloadMbps?: number;
}

function formatSpeedMbps(mbps: number): string {
  if (mbps <= 0) return "—";
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  if (mbps >= 100) return `${Math.round(mbps)} Mbps`;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  return `${(mbps * 1000).toFixed(0)} Kbps`;
}

/** Standalone upload/download header — always visible regardless of chart mode */
export function BandwidthHeader({ samples, totalIn, totalOut, uploadMbps = 0, downloadMbps = 0 }: HeaderProps) {
  const currentIn = samples.length > 0 ? samples[samples.length - 1].bytesIn : 0;
  const currentOut = samples.length > 0 ? samples[samples.length - 1].bytesOut : 0;

  return (
    <BandwidthCard
      upload={{ activeRate: currentOut, total: totalOut, speedMbps: uploadMbps }}
      download={{ activeRate: currentIn, total: totalIn, speedMbps: downloadMbps }}
    />
  );
}

interface Props {
  samples: BandwidthSample[];
  totalIn: number;
  totalOut: number;
}

export function BandwidthChart({ samples }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="bandwidth-chart">
        <ResponsiveContainer width="100%" height={96}>
          <AreaChart
            data={samples}
            margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ec4899" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#ec4899" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" hide />
            <YAxis hide />
            <Area
              type="monotone"
              dataKey="bytesIn"
              stroke="#6366f1"
              strokeWidth={1.5}
              fill="url(#gradIn)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="bytesOut"
              stroke="#ec4899"
              strokeWidth={1.5}
              fill="url(#gradOut)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
