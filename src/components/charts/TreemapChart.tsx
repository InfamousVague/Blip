import { Treemap, ResponsiveContainer } from "recharts";
import type { ServiceBreakdownEntry } from "../../hooks/useServiceBandwidth";
import "./TreemapChart.css";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

interface TreemapContentProps {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  size: number;
  fill: string;
  totalBytes: number;
}

function GlassContent({ x, y, width, height, name, size, fill, totalBytes }: TreemapContentProps) {
  const isSmall = width < 60 || height < 30;
  const isTiny = width < 30 || height < 18;
  const percentage = totalBytes > 0 ? ((size / totalBytes) * 100).toFixed(0) : "0";

  return (
    <g>
      {/* Semi-transparent colored fill */}
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        fill={fill}
        opacity={0.22}
        rx={5}
      />
      {/* Glass gradient overlay */}
      <defs>
        <linearGradient id={`tm-glass-${name}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity={0.12} />
          <stop offset="60%" stopColor="white" stopOpacity={0.02} />
          <stop offset="100%" stopColor={fill} stopOpacity={0.15} />
        </linearGradient>
      </defs>
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        fill={`url(#tm-glass-${name})`}
        rx={5}
      />
      {/* Border */}
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        fill="none"
        stroke={fill}
        strokeOpacity={0.35}
        strokeWidth={1}
        rx={5}
      />
      {/* Top highlight */}
      {width > 24 && height > 16 && (
        <line
          x1={x + 6}
          y1={y + 2}
          x2={x + width - 6}
          y2={y + 2}
          stroke="white"
          strokeOpacity={0.1}
          strokeWidth={0.5}
          strokeLinecap="round"
        />
      )}
      {/* Labels */}
      {!isTiny && width > 24 && height > 16 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - (isSmall ? 0 : 5)}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize={isSmall ? 9 : 11}
            fontWeight={600}
            opacity={0.9}
            fontFamily="var(--font-sans)"
          >
            {name}
          </text>
          {!isSmall && (
            <text
              x={x + width / 2}
              y={y + height / 2 + 9}
              textAnchor="middle"
              dominantBaseline="central"
              fill={fill}
              fontSize={9}
              fontWeight={600}
              opacity={0.85}
              fontFamily="var(--font-mono)"
            >
              {formatBytes(size)} · {percentage}%
            </text>
          )}
        </>
      )}
    </g>
  );
}

interface Props {
  serviceBreakdown: ServiceBreakdownEntry[];
}

export function TreemapChart({ serviceBreakdown }: Props) {
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
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", justifyContent: "center", height: 120 }}>
        <span style={{ fontSize: 13, fontFamily: "var(--font-sans)", color: "var(--blip-text-tertiary)" }}>No bandwidth data yet</span>
      </div>
    );
  }

  return (
    <div className="treemap-chart">
      <ResponsiveContainer width="100%" height={96}>
        <Treemap
          data={data}
          dataKey="size"
          aspectRatio={4 / 3}
          content={<GlassContent x={0} y={0} width={0} height={0} name="" size={0} fill="" totalBytes={totalBytes} />}
          isAnimationActive={false}
        />
      </ResponsiveContainer>
    </div>
  );
}
