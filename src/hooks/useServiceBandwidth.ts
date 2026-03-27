import { useMemo, useRef } from "react";
import type { ResolvedConnection } from "../types/connection";
import type { BandwidthSample } from "./useBandwidth";
import { classifyEndpoint } from "../utils/endpoint-type";

const SERVICE_COLORS = ["#6366f1", "#06b6d4", "#8b5cf6", "#f59e0b", "#ec4899"];
const OTHER_COLOR = "#6b7280";
const MAX_SAMPLES = 60;

export interface ServiceSamplePoint {
  time: number;
  [serviceName: string]: number;
}

export interface ServiceBreakdownEntry {
  name: string;
  bytes: number;
  color: string;
}

interface ServiceBandwidthResult {
  serviceSamples: ServiceSamplePoint[];
  serviceBreakdown: ServiceBreakdownEntry[];
  serviceColors: Record<string, string>;
}

export function useServiceBandwidth(
  connections: ResolvedConnection[],
  bandwidth: { samples: BandwidthSample[]; totalIn: number; totalOut: number },
): ServiceBandwidthResult {
  const samplesRef = useRef<ServiceSamplePoint[]>([]);

  return useMemo(() => {
    // Group connections by service name
    const serviceCounts = new Map<string, number>();
    for (const c of connections) {
      const { serviceName } = classifyEndpoint(c.domain, c.process_name, c.dest_ip);
      const name = serviceName || "Other";
      serviceCounts.set(name, (serviceCounts.get(name) || 0) + 1);
    }

    const totalConnections = connections.length || 1;

    // Sort by count descending, take top 5
    const sorted = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]);
    const top5 = sorted.slice(0, 5);
    const otherCount = sorted.slice(5).reduce((sum, [, count]) => sum + count, 0);

    // Build color map
    const serviceColors: Record<string, string> = {};
    for (let i = 0; i < top5.length; i++) {
      serviceColors[top5[i][0]] = SERVICE_COLORS[i];
    }
    if (otherCount > 0) {
      serviceColors["Other"] = OTHER_COLOR;
    }

    // Build service breakdown for treemap
    const serviceBreakdown: ServiceBreakdownEntry[] = [];
    const totalBytes = bandwidth.totalIn + bandwidth.totalOut;

    for (const [name, count] of top5) {
      const proportion = count / totalConnections;
      serviceBreakdown.push({
        name,
        bytes: Math.round(totalBytes * proportion),
        color: serviceColors[name],
      });
    }
    if (otherCount > 0) {
      const proportion = otherCount / totalConnections;
      serviceBreakdown.push({
        name: "Other",
        bytes: Math.round(totalBytes * proportion),
        color: OTHER_COLOR,
      });
    }

    // Build service samples for stream chart from the latest bandwidth sample
    const latestSample = bandwidth.samples.length > 0
      ? bandwidth.samples[bandwidth.samples.length - 1]
      : null;

    if (latestSample) {
      const point: ServiceSamplePoint = { time: latestSample.time };
      const totalRate = latestSample.bytesIn + latestSample.bytesOut;

      for (const [name, count] of top5) {
        const proportion = count / totalConnections;
        point[name] = Math.round(totalRate * proportion);
      }
      if (otherCount > 0) {
        const proportion = otherCount / totalConnections;
        point["Other"] = Math.round(totalRate * proportion);
      }

      const prev = samplesRef.current;
      const next = [...prev, point];
      samplesRef.current = next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next;
    }

    return {
      serviceSamples: samplesRef.current,
      serviceBreakdown,
      serviceColors,
    };
  }, [connections, bandwidth]);
}
