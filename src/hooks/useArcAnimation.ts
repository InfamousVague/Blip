import { useRef, useEffect, useState, useMemo } from "react";
import type { ResolvedConnection, BlockedAttempt } from "../types/connection";
import { greatCircleDistance, arcHeight, pointOnArc } from "../utils/arc-geometry";
import { classifyEndpoint, type EndpointType } from "../utils/endpoint-type";
import { getServiceColor, hexToRgba } from "../utils/service-colors";

const FADE_DURATION_MS = 15_000;
const BLOCK_FLASH_MS = 2_000;
const BLOCKED_ARC_FADE_MS = 30_000; // blocked arcs stay visible for 30s then fade

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

export interface BlockedMarkerData {
  position: [number, number, number];
  opacity: number;
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
  services: string[];
  connectionDetails: { process: string; domain: string | null; port: number; service: string; color: string }[];
  datacenter: string | null;
  cloudProvider: string | null;
  cloudRegion: string | null;
  asnOrg: string | null;
  networkType: string | null;
  isCdn: boolean;
}

// Pre-computed arc info that doesn't change between frames
interface ArcMeta {
  conn: ResolvedConnection;
  target: [number, number];
  height: number;
  svcName: string;
  svcColor: string;
  classified: ReturnType<typeof classifyEndpoint>;
}

export function useArcAnimation(
  connections: ResolvedConnection[],
  userLocation: [number, number] | null,
  dnsBlockedCount = 0,
  blockedAttempts: BlockedAttempt[] = []
) {
  const [output, setOutput] = useState<{
    arcs: ArcData[];
    endpoints: EndpointData[];
    particles: ParticleData[];
    blockedMarkers: BlockedMarkerData[];
  }>({
    arcs: [],
    endpoints: [],
    particles: [],
    blockedMarkers: [],
  });
  const rafId = useRef(0);

  // Flash tracking for blocked connections
  const seenTrackers = useRef(new Set<string>());
  const flashes = useRef(new Map<string, number>());
  const prevBlockedCount = useRef(0);
  const dnsBlockedRef = useRef(dnsBlockedCount);
  dnsBlockedRef.current = dnsBlockedCount;

  // Compute arc metadata only when connections change (not every frame)
  const arcMetas = useMemo<ArcMeta[]>(() => {
    if (!userLocation) return [];
    return connections.map((conn) => {
      const target: [number, number] = [conn.dest_lon, conn.dest_lat];
      const distKm = greatCircleDistance(userLocation[1], userLocation[0], conn.dest_lat, conn.dest_lon);
      const classified = classifyEndpoint(conn.domain, conn.process_name, conn.dest_ip);
      const svcName = classified.serviceName || classified.type;
      return {
        conn,
        target,
        height: arcHeight(distKm),
        svcName,
        svcColor: getServiceColor(svcName),
        classified,
      };
    });
  }, [connections, userLocation]);

  // Pre-compute metadata for blocked DNS attempts (these have no ResolvedConnection)
  const blockedArcMetas = useMemo(() => {
    if (!userLocation) return [];
    return blockedAttempts.map((attempt) => {
      const target: [number, number] = [attempt.dest_lon, attempt.dest_lat];
      const distKm = greatCircleDistance(userLocation[1], userLocation[0], attempt.dest_lat, attempt.dest_lon);
      return {
        attempt,
        target,
        height: arcHeight(distKm),
      };
    });
  }, [blockedAttempts, userLocation]);

  // Compute endpoints only when connections change
  const endpoints = useMemo<EndpointData[]>(() => {
    const endpointMap = new Map<string, EndpointData>();
    for (const meta of arcMetas) {
      const conn = meta.conn;
      const epKey = `${conn.dest_lat.toFixed(2)},${conn.dest_lon.toFixed(2)}`;
      const detail = {
        process: conn.process_name || "Unknown",
        domain: conn.domain,
        port: conn.dest_port,
        service: meta.svcName,
        color: meta.svcColor,
      };
      const existing = endpointMap.get(epKey);
      if (existing) {
        existing.connectionCount += 1;
        if (conn.domain && !existing.domain) existing.domain = conn.domain;
        if (!existing.services.includes(meta.svcName)) existing.services.push(meta.svcName);
        existing.connectionDetails.push(detail);
      } else {
        endpointMap.set(epKey, {
          id: epKey,
          position: meta.target,
          domain: conn.domain,
          ip: conn.dest_ip,
          city: conn.city,
          country: conn.country,
          connectionCount: 1,
          type: meta.classified.type,
          serviceName: meta.classified.serviceName,
          services: [meta.svcName],
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
    return [...endpointMap.values()];
  }, [arcMetas]);

  useEffect(() => {
    let lastFrame = 0;

    const animate = () => {
      rafId.current = requestAnimationFrame(animate);

      // Pause when window is hidden
      if (document.hidden) return;

      const now = Date.now();
      // Throttle to ~30fps
      if (now - lastFrame < 33) return;
      lastFrame = now;

      const loc = userLocation;
      if (!loc || arcMetas.length === 0) {
        setOutput({ arcs: [], endpoints, particles: [], blockedMarkers: [] });
        return;
      }

      const arcs: ArcData[] = [];
      const particles: ParticleData[] = [];
      const blockedMarkers: BlockedMarkerData[] = [];

      // Detect new tracker connections → trigger flash
      for (const meta of arcMetas) {
        if (meta.conn.is_tracker && !seenTrackers.current.has(meta.conn.id)) {
          seenTrackers.current.add(meta.conn.id);
          flashes.current.set(meta.conn.id, now);
        }
      }

      // Detect DNS blocked count increase → re-flash all tracker arcs
      if (dnsBlockedRef.current > prevBlockedCount.current) {
        for (const meta of arcMetas) {
          if (meta.conn.is_tracker) {
            flashes.current.set(meta.conn.id, now);
          }
        }
        prevBlockedCount.current = dnsBlockedRef.current;
      }

      for (let i = 0; i < arcMetas.length; i++) {
        const meta = arcMetas[i];
        const conn = meta.conn;

        let opacity = 1;
        if (!conn.active) {
          const fadeElapsed = now - conn.last_seen_ms;
          opacity = Math.max(1 - fadeElapsed / FADE_DURATION_MS, 0);
          if (opacity <= 0) continue;
        }

        if (conn.active) {
          const phase = conn.first_seen_ms * 0.001;
          opacity *= 0.85 + 0.15 * Math.sin(now * 0.005 + phase);
        }

        const lineAlpha = Math.round(opacity * 0.15 * 255);

        // Check for active blocked flash
        const flashStart = flashes.current.get(conn.id);
        let sourceColor: [number, number, number, number];
        let targetColor: [number, number, number, number];
        let width = 2;

        if (flashStart !== undefined && now - flashStart < BLOCK_FLASH_MS) {
          const elapsed = now - flashStart;
          const t = elapsed / BLOCK_FLASH_MS;
          // Ease-out for smooth fade
          const flashIntensity = 1 - t * t;
          // Blend from red to normal white
          const g = Math.round((1 - flashIntensity) * 255);
          const b = g;
          const srcAlpha = Math.round(flashIntensity * 0.4 * 255);
          const tgtAlpha = Math.max(lineAlpha, Math.round(flashIntensity * 0.6 * 255));

          sourceColor = [255, g, b, srcAlpha];
          targetColor = [255, g, b, tgtAlpha];
          // Slightly wider during flash
          width = 2 + flashIntensity;
        } else {
          if (flashStart !== undefined) flashes.current.delete(conn.id);
          sourceColor = [255, 255, 255, 0];
          targetColor = [255, 255, 255, lineAlpha];
        }

        const midpoint = pointOnArc(loc, meta.target, meta.height, 0.5);

        // Add blocked marker at midpoint if flashing
        if (flashStart !== undefined && now - flashStart < BLOCK_FLASH_MS) {
          const t = (now - flashStart) / BLOCK_FLASH_MS;
          blockedMarkers.push({
            position: midpoint,
            opacity: 1 - t * t,
          });
        }

        arcs.push({
          id: conn.id,
          sourcePosition: loc,
          targetPosition: meta.target,
          sourceColor,
          targetColor,
          height: meta.height,
          width,
          pingMs: conn.ping_ms,
          midpoint,
        });

        // Particle for active connections only
        if (conn.active) {
          const segLen = 0.06;
          const numPts = 5;
          const pingVal = conn.ping_ms ?? 100;
          const cycleSec = Math.max(0.8, Math.min(5, pingVal / 50));
          const phase = (conn.first_seen_ms * 0.001 + i * 0.37) % 1;
          const t0 = ((now * 0.001 / cycleSec + phase) % 1);
          const path: [number, number][] = [];
          for (let j = 0; j <= numPts; j++) {
            const t = Math.max(0, Math.min(1, t0 + (j / numPts) * segLen));
            const pt = pointOnArc(loc, meta.target, meta.height, t);
            path.push([pt[0], pt[1]]);
          }
          const totalBytes = conn.bytes_sent + conn.bytes_received;
          const logBytes = totalBytes > 0 ? Math.log10(Math.max(totalBytes, 1)) : 0;
          const particleWidth = Math.max(1, Math.min(8, 1 + logBytes * 1.1));

          particles.push({
            path,
            color: hexToRgba(meta.svcColor, 0.85),
            width: particleWidth,
          });
        }
      }

      // Render blocked DNS attempts as persistent red arcs
      for (const bm of blockedArcMetas) {
        const age = now - bm.attempt.timestamp_ms;
        if (age > BLOCKED_ARC_FADE_MS) continue;

        const fadeT = age / BLOCKED_ARC_FADE_MS;
        const opacity = 1 - fadeT * fadeT; // ease-out fade

        const redAlpha = Math.round(opacity * 0.5 * 255);
        const midpoint = pointOnArc(loc, bm.target, bm.height, 0.5);

        arcs.push({
          id: `blocked-${bm.attempt.domain}`,
          sourcePosition: loc,
          targetPosition: bm.target,
          sourceColor: [255, 40, 40, Math.round(opacity * 0.2 * 255)],
          targetColor: [255, 40, 40, redAlpha],
          height: bm.height,
          width: 2,
          pingMs: null,
          midpoint,
        });

        blockedMarkers.push({
          position: midpoint,
          opacity,
        });
      }

      setOutput({ arcs, endpoints, particles, blockedMarkers });
    };

    rafId.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId.current);
  }, [arcMetas, blockedArcMetas, endpoints, userLocation]);

  return output;
}
