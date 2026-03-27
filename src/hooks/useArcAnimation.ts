import { useRef, useEffect, useState } from "react";
import type { ResolvedConnection } from "../types/connection";
import { greatCircleDistance, arcHeight, pointOnArc } from "../utils/arc-geometry";
import { classifyEndpoint, type EndpointType } from "../utils/endpoint-type";
import { getServiceColor, hexToRgba } from "../utils/service-colors";

const FADE_DURATION_MS = 15_000;

export interface ArcData {
  id: string;
  sourcePosition: [number, number];
  targetPosition: [number, number];
  sourceColor: [number, number, number, number];
  targetColor: [number, number, number, number];
  height: number;
  width: number;
  pingMs: number | null;
  midpoint: [number, number, number];
}

export interface ParticleData {
  path: [number, number][];
  color: [number, number, number, number];
  width: number;
}

export interface EndpointData {
  id: string;
  position: [number, number];
  domain: string | null;
  ip: string | null;
  city: string | null;
  country: string | null;
  connectionCount: number;
  type: EndpointType;
  serviceName: string | null;
  /** All service names for connections at this endpoint */
  services: string[];
  /** Individual connection details for tooltip */
  connectionDetails: { process: string; domain: string | null; port: number; service: string; color: string }[];
  /** Enrichment data */
  datacenter: string | null;
  cloudProvider: string | null;
  cloudRegion: string | null;
  asnOrg: string | null;
  networkType: string | null;
  isCdn: boolean;
}

export function useArcAnimation(
  connections: ResolvedConnection[],
  userLocation: [number, number] | null
) {
  const [output, setOutput] = useState<{
    arcs: ArcData[];
    endpoints: EndpointData[];
    particles: ParticleData[];
  }>({
    arcs: [],
    endpoints: [],
    particles: [],
  });
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const locationRef = useRef(userLocation);
  locationRef.current = userLocation;
  const rafId = useRef(0);

  useEffect(() => {
    let lastFrame = 0;

    const animate = () => {
      rafId.current = requestAnimationFrame(animate);

      const now = Date.now();
      // Throttle to ~30fps
      if (now - lastFrame < 33) return;
      lastFrame = now;

      const loc = locationRef.current;
      const conns = connectionsRef.current;
      if (!loc || conns.length === 0) {
        setOutput({ arcs: [], endpoints: [], particles: [] });
        return;
      }

      const arcs: ArcData[] = [];
      const particles: ParticleData[] = [];
      const endpointMap = new Map<string, EndpointData>();

      for (const conn of conns) {
        const target: [number, number] = [conn.dest_lon, conn.dest_lat];
        const distKm = greatCircleDistance(loc[1], loc[0], conn.dest_lat, conn.dest_lon);
        const height = arcHeight(distKm);

        let opacity = 1;
        if (!conn.active) {
          const fadeElapsed = now - conn.last_seen_ms;
          opacity = Math.max(1 - fadeElapsed / FADE_DURATION_MS, 0);
          if (opacity <= 0) continue;
        }

        // Subtle breathing for active connections
        if (conn.active) {
          const phase = conn.first_seen_ms * 0.001;
          opacity *= 0.85 + 0.15 * Math.sin(now * 0.005 + phase);
        }

        // Determine service for this connection
        const classified = classifyEndpoint(conn.domain, conn.process_name, conn.dest_ip);
        const svcName = classified.serviceName || classified.type;
        const svcColor = getServiceColor(svcName);

        // Faint base line — just enough to see the connection path
        const lineAlpha = Math.round(opacity * 0.15 * 255);
        const sourceColor: [number, number, number, number] = [255, 255, 255, 0];
        const targetColor: [number, number, number, number] = [255, 255, 255, lineAlpha];

        const midpoint = pointOnArc(loc, target, height, 0.5);
        const arcIndex = arcs.length;
        arcs.push({
          id: conn.id,
          sourcePosition: loc,
          targetPosition: target,
          sourceColor,
          targetColor,
          height,
          width: 2,
          pingMs: conn.ping_ms,
          midpoint,
        });

        // Compute 1 particle (short glowing segment) travelling along this arc
        // Speed inversely proportional to ping: low ping = fast particle
        if (conn.active) {
          const segLen = 0.06;
          const numPts = 5;
          // Ping-based speed: 10ms → cycle in ~1s, 200ms → cycle in ~4s, no ping → ~2s
          const pingVal = conn.ping_ms ?? 100;
          const cycleSec = Math.max(0.8, Math.min(5, pingVal / 50));
          // Use a stable per-arc phase offset so particles don't all start at the same spot
          const phase = (conn.first_seen_ms * 0.001 + arcIndex * 0.37) % 1;
          const t0 = ((now * 0.001 / cycleSec + phase) % 1);
          const path: [number, number][] = [];
          for (let i = 0; i <= numPts; i++) {
            const t = Math.max(0, Math.min(1, t0 + (i / numPts) * segLen));
            const pt = pointOnArc(loc, target, height, t);
            // Use only lon/lat — PathLayer works best in 2D
            path.push([pt[0], pt[1]]);
          }
          // Width proportional to bytes: 1px at 0B, up to 8px at 1MB+
          const totalBytes = conn.bytes_sent + conn.bytes_received;
          const logBytes = totalBytes > 0 ? Math.log10(Math.max(totalBytes, 1)) : 0;
          // 0B→1, 1KB(3)→2.5, 100KB(5)→4.5, 1MB(6)→6, 10MB(7)→8
          const particleWidth = Math.max(1, Math.min(8, 1 + logBytes * 1.1));

          particles.push({
            path,
            color: hexToRgba(svcColor, 0.85),
            width: particleWidth,
          });
        }

        const epKey = `${conn.dest_lat.toFixed(2)},${conn.dest_lon.toFixed(2)}`;
        const existing = endpointMap.get(epKey);
        const detail = {
          process: conn.process_name || "Unknown",
          domain: conn.domain,
          port: conn.dest_port,
          service: svcName,
          color: svcColor,
        };
        if (existing) {
          existing.connectionCount += 1;
          if (conn.domain && !existing.domain) {
            existing.domain = conn.domain;
          }
          if (svcName && !existing.services.includes(svcName)) {
            existing.services.push(svcName);
          }
          existing.connectionDetails.push(detail);
        } else {
          endpointMap.set(epKey, {
            id: epKey,
            position: target,
            domain: conn.domain,
            ip: conn.dest_ip,
            city: conn.city,
            country: conn.country,
            connectionCount: 1,
            type: classified.type,
            serviceName: classified.serviceName,
            services: [svcName],
            connectionDetails: [detail],
            datacenter: conn.datacenter ?? null,
            cloudProvider: conn.cloud_provider ?? null,
            cloudRegion: conn.cloud_region ?? null,
            asnOrg: conn.asn_org ?? null,
            networkType: conn.network_type ?? null,
            isCdn: conn.is_cdn ?? false,
          });
        }
      }

      setOutput({ arcs, endpoints: [...endpointMap.values()], particles });
    };

    rafId.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  return output;
}
