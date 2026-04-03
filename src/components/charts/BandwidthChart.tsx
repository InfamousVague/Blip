import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { BandwidthCard } from "../../ui/components/BandwidthCard";
import type { BandwidthSample } from "../../hooks/useBandwidth";
import "./BandwidthChart.css";


interface HeaderProps {
  samples: BandwidthSample[];
  totalIn: number;
  totalOut: number;
  uploadMbps?: number;
  downloadMbps?: number;
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
