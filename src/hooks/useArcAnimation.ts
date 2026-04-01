import { useRef, useEffect, useState, useMemo } from "react";
import type { ResolvedConnection, BlockedAttempt } from "../types/connection";
import { greatCircleDistance, arcHeight, pointOnArc, interpolateArc } from "../utils/arc-geometry";
import { classifyEndpoint, type EndpointType } from "../utils/endpoint-type";
import { getServiceColor, hexToRgba } from "../utils/service-colors";
import { getCachedRoute, buildRoutedPath, pointAlongPath, type CableRoute } from "../utils/cable-routing";

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
  /** Pre-computed 3D path points for PathLayer rendering */
  path: [number, number, number][];
}

export interface BlockedMarkerData {
  position: [number, number, number];
  opacity: number;
}

/** A colored line segment along a submarine cable, one per service using that cable */
export interface CableServiceLine {
  id: string;
  path: [number, number, number][];
  color: [number, number, number, number];
  width: number;
}

export interface ParticleData {
  position: [number, number, number];
  color: [number, number, number, number];
  width: number;
  /** 0 = upload (user→endpoint), 1 = download (endpoint→user), 2 = neutral */
  direction?: number;
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
  path: [number, number, number][];
  svcName: string;
  svcColor: string;
  classified: ReturnType<typeof classifyEndpoint>;
  /** If routed through a submarine cable, the cable ID and route info */
  cableRoute: CableRoute | null;
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
    activeCableIds: string[];
    cableServiceLines: CableServiceLine[];
  }>({
    arcs: [],
    endpoints: [],
    particles: [],
    blockedMarkers: [],
    activeCableIds: [],
    cableServiceLines: [],
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
    return connections
    .filter((conn) => conn.dest_lat !== 0 || conn.dest_lon !== 0) // skip ungeolocated
    .map((conn) => {
      const target: [number, number] = [conn.dest_lon, conn.dest_lat];
      const distKm = greatCircleDistance(userLocation[1], userLocation[0], conn.dest_lat, conn.dest_lon);
      const classified = classifyEndpoint(conn.domain, conn.process_name, conn.dest_ip);
      const svcName = classified.serviceName || classified.type;
      const h = arcHeight(distKm);
      // Check if this connection should route through a submarine cable
      const cableRoute = getCachedRoute(userLocation, target);
      const path = cableRoute
        ? buildRoutedPath(userLocation, target, cableRoute)
        : interpolateArc(userLocation, target, h, 40);
      return {
        conn,
        target,
        height: h,
        path,
        svcName,
        svcColor: getServiceColor(svcName),
        classified,
        cableRoute,
      };
    });
  }, [connections, userLocation]);

  // Pre-compute metadata for blocked DNS attempts (these have no ResolvedConnection)
  const blockedArcMetas = useMemo(() => {
    if (!userLocation) return [];
    return blockedAttempts.map((attempt) => {
      const target: [number, number] = [attempt.dest_lon, attempt.dest_lat];
      const distKm = greatCircleDistance(userLocation[1], userLocation[0], attempt.dest_lat, attempt.dest_lon);
      const h = arcHeight(distKm);
      return {
        attempt,
        target,
        height: h,
        path: interpolateArc(userLocation, target, h, 40),
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
        setOutput({ arcs: [], endpoints, particles: [], blockedMarkers: [], activeCableIds: [], cableServiceLines: [] });
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

        const midpoint = meta.cableRoute
          ? pointAlongPath(meta.path, 0.5)
          : pointOnArc(loc, meta.target, meta.height, 0.5);

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
          path: meta.path,
        });

        // Bidirectional particles for active connections — particle count scales with throughput
        if (conn.active) {
          const pingVal = conn.ping_ms ?? 100;
          const cycleSec = Math.max(0.8, Math.min(5, pingVal / 50));
          const phase = (conn.first_seen_ms * 0.001 + i * 0.37) % 1;
          const hasByteData = conn.bytes_sent > 0 || conn.bytes_received > 0;

          if (hasByteData) {
            const totalBytes = conn.bytes_sent + conn.bytes_received;

            // Scale particle count by throughput: 1 particle for < 1KB, up to 5 for > 10MB
            const logTotal = Math.log10(Math.max(totalBytes, 1));
            const particleCount = Math.max(1, Math.min(5, Math.floor(logTotal / 1.5)));

            // Service-tinted colors: blend service color with upload/download indicator
            const svcRgba = hexToRgba(meta.svcColor, 0.9);

            // Helper: get particle position — use path interpolation for routed, pointOnArc for direct
            const getParticlePos = (t: number): [number, number, number] =>
              meta.cableRoute
                ? pointAlongPath(meta.path, t)
                : pointOnArc(loc, meta.target, meta.height, t);

            // Upload particles: user → endpoint (service color tinted pink)
            if (conn.bytes_sent > 0) {
              const logBytes = Math.log10(Math.max(conn.bytes_sent, 1));
              const particleWidth = Math.max(2, Math.min(8, 1.5 + logBytes * 0.9));
              const upCount = Math.max(1, Math.ceil(particleCount * (conn.bytes_sent / totalBytes)));

              for (let p = 0; p < upCount; p++) {
                const pPhase = (phase + p * (1 / upCount)) % 1;
                const t0 = ((now * 0.001 / cycleSec + pPhase) % 1);
                const pt = getParticlePos(t0);
                // Blend service color with pink for upload
                const r = Math.round(svcRgba[0] * 0.4 + 236 * 0.6);
                const g = Math.round(svcRgba[1] * 0.4 + 72 * 0.6);
                const b = Math.round(svcRgba[2] * 0.4 + 153 * 0.6);
                particles.push({
                  position: pt,
                  color: [r, g, b, 217],
                  width: particleWidth - p * 0.3, // trailing particles slightly smaller
                  direction: 0,
                });
              }
            }

            // Download particles: endpoint → user (service color tinted indigo)
            if (conn.bytes_received > 0) {
              const logBytes = Math.log10(Math.max(conn.bytes_received, 1));
              const particleWidth = Math.max(2, Math.min(8, 1.5 + logBytes * 0.9));
              const downCount = Math.max(1, Math.ceil(particleCount * (conn.bytes_received / totalBytes)));

              for (let p = 0; p < downCount; p++) {
                const pPhase = (phase + 0.5 + p * (1 / downCount)) % 1;
                const tDown = ((now * 0.001 / cycleSec + pPhase) % 1);
                const pt = getParticlePos(1 - tDown);
                // Blend service color with indigo for download
                const r = Math.round(svcRgba[0] * 0.4 + 99 * 0.6);
                const g = Math.round(svcRgba[1] * 0.4 + 102 * 0.6);
                const b = Math.round(svcRgba[2] * 0.4 + 241 * 0.6);
                particles.push({
                  position: pt,
                  color: [r, g, b, 217],
                  width: particleWidth - p * 0.3,
                  direction: 1,
                });
              }
            }
          } else {
            // No byte data yet — show a single service-colored particle
            const t0 = ((now * 0.001 / cycleSec + phase) % 1);
            const pt = meta.cableRoute
              ? pointAlongPath(meta.path, t0)
              : pointOnArc(loc, meta.target, meta.height, t0);
            particles.push({
              position: pt,
              color: hexToRgba(meta.svcColor, 0.85),
              width: 2,
              direction: 2,
            });
          }
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
          path: bm.path,
        });

        blockedMarkers.push({
          position: midpoint,
          opacity,
        });
      }

      // Collect active cable service lines — grouped by cable, one colored line per service
      const cableIdSet = new Set<string>();
      const cableServiceMap = new Map<string, { svcColor: string; svcName: string; segment: [number, number][] }[]>();
      for (const meta of arcMetas) {
        if (meta.cableRoute && meta.conn.active) {
          cableIdSet.add(meta.cableRoute.cableId);
          const key = meta.cableRoute.cableId;
          if (!cableServiceMap.has(key)) cableServiceMap.set(key, []);
          const entries = cableServiceMap.get(key)!;
          // Deduplicate by service name
          if (!entries.some((e) => e.svcName === meta.svcName)) {
            entries.push({
              svcColor: meta.svcColor,
              svcName: meta.svcName,
              segment: meta.cableRoute.cableSegment,
            });
          }
        }
      }
      const activeCableIds = [...cableIdSet];

      // Build cable service lines with perpendicular offsets for stacking
      const cableServiceLines: CableServiceLine[] = [];
      for (const [cableId, services] of cableServiceMap) {
        const count = services.length;
        for (let si = 0; si < count; si++) {
          const { svcColor, svcName, segment } = services[si];
          const offsetMag = count > 1 ? (si - (count - 1) / 2) * 0.12 : 0;
          const rgb = hexToRgba(svcColor, 0.85);
          const path: [number, number, number][] = segment.map((coord, idx) => {
            if (offsetMag === 0) return [coord[0], coord[1], 60_000] as [number, number, number];
            // Compute perpendicular offset from cable direction
            const prev = segment[Math.max(0, idx - 1)];
            const next = segment[Math.min(segment.length - 1, idx + 1)];
            const dx = next[0] - prev[0];
            const dy = next[1] - prev[1];
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            // Perpendicular: rotate 90° (-dy, dx) normalized
            return [
              coord[0] + (-dy / len) * offsetMag,
              coord[1] + (dx / len) * offsetMag,
              60_000,
            ] as [number, number, number];
          });
          cableServiceLines.push({
            id: `${cableId}-${svcName}`,
            path,
            color: [rgb[0], rgb[1], rgb[2], 200],
            width: count > 3 ? 2 : 3,
          });
        }
      }

      setOutput({ arcs, endpoints, particles, blockedMarkers, activeCableIds, cableServiceLines });
    };

    rafId.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId.current);
  }, [arcMetas, blockedArcMetas, endpoints, userLocation]);

  return output;
}
