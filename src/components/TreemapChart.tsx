import { Treemap, ResponsiveContainer } from "recharts";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import type { ServiceBreakdownEntry } from "../hooks/useServiceBandwidth";
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
}

function CustomContent({ x, y, width, height, name, size, fill }: TreemapContentProps) {
  const isSmall = width < 60 || height < 30;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke="rgba(0,0,0,0.3)"
        strokeWidth={1}
        rx={4}
      />
      {width > 30 && height > 20 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - (isSmall ? 0 : 6)}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize={isSmall ? 9 : 11}
            fontWeight={500}
            opacity={isSmall ? 0.7 : 0.9}
          >
            {name}
          </text>
          {!isSmall && (
            <text
              x={x + width / 2}
              y={y + height / 2 + 10}
              textAnchor="middle"
              dominantBaseline="central"
              fill="white"
              fontSize={9}
              opacity={0.6}
            >
              {formatBytes(size)}
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

  if (data.length === 0) {
    return (
      <Stack direction="vertical" gap="2" align="center" justify="center" style={{ height: 120 }}>
        <Text size="sm" color="tertiary">No bandwidth data yet</Text>
      </Stack>
    );
  }

  return (
    <div className="treemap-chart">
      <ResponsiveContainer width="100%" height={96}>
        <Treemap
          data={data}
          dataKey="size"
          aspectRatio={4 / 3}
          content={<CustomContent x={0} y={0} width={0} height={0} name="" size={0} fill="" />}
          isAnimationActive={false}
        />
      </ResponsiveContainer>
    </div>
  );
}
