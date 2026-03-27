import { useState, useCallback } from "react";
import { BarChart as RechartsBarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import type { TooltipProps } from "recharts";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import type { BandwidthSample } from "../hooks/useBandwidth";
import "./BarChart.css";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

interface Props {
  samples: BandwidthSample[];
  totalIn: number;
  totalOut: number;
}

export function BandwidthBarChart({ samples, totalIn, totalOut }: Props) {
  const [hovered, setHovered] = useState<{ bytesIn: number; bytesOut: number } | null>(null);

  const displayIn = hovered ? hovered.bytesIn : (samples.length > 0 ? samples[samples.length - 1].bytesIn : 0);
  const displayOut = hovered ? hovered.bytesOut : (samples.length > 0 ? samples[samples.length - 1].bytesOut : 0);

  const CustomTooltip = useCallback(({ active, payload }: TooltipProps<number, string> & { payload?: any[] }) => {
    if (active && payload && payload.length >= 2) {
      const bytesIn = (payload[0]?.value as number) ?? 0;
      const bytesOut = (payload[1]?.value as number) ?? 0;
      queueMicrotask(() => setHovered({ bytesIn, bytesOut }));
    }
    return null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHovered(null);
  }, []);

  return (
    <div className="bar-chart">
      <ResponsiveContainer width="100%" height={96}>
        <RechartsBarChart
          data={samples}
          margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
          barGap={0}
          barCategoryGap="15%"
        >
          <XAxis dataKey="time" hide />
          <YAxis hide />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.05)" />
          <Bar
            dataKey="bytesIn"
            fill="#6366f1"
            radius={[1, 1, 0, 0]}
            isAnimationActive={false}
            opacity={0.85}
          />
          <Bar
            dataKey="bytesOut"
            fill="#ec4899"
            radius={[1, 1, 0, 0]}
            isAnimationActive={false}
            opacity={0.85}
          />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
