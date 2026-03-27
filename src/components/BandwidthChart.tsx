import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import { arrowUp } from "@mattmattmattmatt/base/primitives/icon/icons/arrow-up";
import { arrowDown } from "@mattmattmattmatt/base/primitives/icon/icons/arrow-down";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
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
}

/** Standalone upload/download header — always visible regardless of chart mode */
export function BandwidthHeader({ samples, totalIn, totalOut }: HeaderProps) {
  const currentIn = samples.length > 0 ? samples[samples.length - 1].bytesIn : 0;
  const currentOut = samples.length > 0 ? samples[samples.length - 1].bytesOut : 0;

  return (
    <Stack direction="horizontal" gap="3" align="stretch" justify="between">
      <Stack direction="vertical" gap="1" align="start" style={{ flex: 1 }}>
        <Stack direction="horizontal" gap="1" align="center">
          <span style={{ color: "#ec4899" }}><Icon icon={arrowUp} size="sm" /></span>
          <Text size="xs" color="tertiary" weight="medium">UPLOAD</Text>
        </Stack>
        <Stack direction="horizontal" gap="1" align="baseline">
          <Text size="xs" color="tertiary" style={{ minWidth: "3.2em" }}>Active</Text>
          <AnimatedBytes bytes={currentOut} suffix="/s" size="sm" minDigits={2} />
        </Stack>
        <Stack direction="horizontal" gap="1" align="baseline">
          <Text size="xs" color="tertiary" style={{ minWidth: "3.2em" }}>Total</Text>
          <AnimatedBytes bytes={totalOut} size="xs" minDigits={2} />
        </Stack>
      </Stack>
      <div style={{ width: 1, background: "var(--color-border-default)", alignSelf: "stretch" }} />
      <Stack direction="vertical" gap="1" align="start" style={{ flex: 1, marginLeft: "auto" }}>
        <Stack direction="horizontal" gap="1" align="center">
          <span style={{ color: "#6366f1" }}><Icon icon={arrowDown} size="sm" /></span>
          <Text size="xs" color="tertiary" weight="medium">DOWNLOAD</Text>
        </Stack>
        <Stack direction="horizontal" gap="1" align="baseline">
          <Text size="xs" color="tertiary" style={{ minWidth: "3.2em" }}>Active</Text>
          <AnimatedBytes bytes={currentIn} suffix="/s" size="sm" minDigits={2} />
        </Stack>
        <Stack direction="horizontal" gap="1" align="baseline">
          <Text size="xs" color="tertiary" style={{ minWidth: "3.2em" }}>Total</Text>
          <AnimatedBytes bytes={totalIn} size="xs" minDigits={2} />
        </Stack>
      </Stack>
    </Stack>
  );
}

interface Props {
  samples: BandwidthSample[];
  totalIn: number;
  totalOut: number;
}

export function BandwidthChart({ samples }: Props) {
  return (
    <Stack direction="vertical" gap="3" align="stretch">
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

    </Stack>
  );
}
