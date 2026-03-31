import { BarChart as RechartsBarChart, Bar, ResponsiveContainer, XAxis, YAxis, ReferenceLine } from "recharts";
import type { BandwidthSample } from "../hooks/useBandwidth";
import "./BarChart.css";

interface Props {
  samples: BandwidthSample[];
  totalIn: number;
  totalOut: number;
}

export function BandwidthBarChart({ samples }: Props) {

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
