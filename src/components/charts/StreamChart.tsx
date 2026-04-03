import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { ServiceSamplePoint } from "../../hooks/useServiceBandwidth";
import "./StreamChart.css";

interface Props {
  serviceSamples: ServiceSamplePoint[];
  serviceColors: Record<string, string>;
}

export function StreamChart({ serviceSamples, serviceColors }: Props) {
  const serviceNames = Object.keys(serviceColors);

  return (
    <div className="stream-chart">
      <ResponsiveContainer width="100%" height={96}>
        <AreaChart
          data={serviceSamples}
          margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            {serviceNames.map((name) => (
              <linearGradient key={name} id={`grad-stream-${name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={serviceColors[name]} stopOpacity={0.4} />
                <stop offset="100%" stopColor={serviceColors[name]} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <XAxis dataKey="time" hide />
          <YAxis hide />
          {serviceNames.map((name) => (
            <Area
              key={name}
              type="monotone"
              dataKey={name}
              stackId="1"
              stroke={serviceColors[name]}
              strokeWidth={1.5}
              fill={`url(#grad-stream-${name})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
