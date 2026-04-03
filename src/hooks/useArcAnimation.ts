import { useRef, useEffect, useState, useMemo } from "react";
import type { ResolvedConnection, BlockedAttempt } from "../types/connection";
import { greatCircleDistance, arcHeight, pointOnArc, interpolateArc, extractSubPath } from "../utils/arc-geometry";
import { classifyEndpoint } from "../utils/endpoint-type";
import { getServiceColor } from "../utils/service-colors";
import type { TracedRoute } from "../types/connection";
import { getCachedRoute, buildRoutedPath, pointAlongPath, type CableRoute } from "../utils/cable-routing";
import { buildTracedPath } from "../utils/tracedPathBuilder";
import type {
  ArcData,
  EndpointData,
  BlockedMarkerData,
  BlockedFlashData,
  ParticleData,
  HopMarkerData,
  DashSegment,
} from "../types/arcAnimation";
import { hexToRgba } from "../utils/service-colors";

export type { ArcData, EndpointData, BlockedMarkerData, BlockedFlashData, ParticleData, HopMarkerData, DashSegment };

const FADE_DURATION_MS = 15_000;
const BLOCK_FLASH_MS = 2_000;
const BLOCKED_ARC_FADE_MS = 120_000; // blocked arcs stay visible for 2 minutes then fade

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
  /** Whether this connection's path uses submarine cables (for dashed rendering) */
  isCableRouted: boolean;
}

export function useArcAnimation(
  connections: ResolvedConnection[],
  userLocation: [number, number] | null,
  dnsBlockedCount = 0,
  blockedAttempts: BlockedAttempt[] = [],
  tracedRoutes: Map<string, TracedRoute> = new Map(),
  activeServiceFilter: string | null = null,
  latencyHeatmap = false,
  focusedEndpointId: string | null = null,
) {
  const [output, setOutput] = useState<{
    arcs: ArcData[];
    endpoints: EndpointData[];
    particles: ParticleData[];
    blockedMarkers: BlockedMarkerData[];
    activeCableIds: string[];
    hopMarkers: HopMarkerData[];
    blockedFlashes: BlockedFlashData[];
    dashSegments: DashSegment[];
  }>({
    arcs: [],
    endpoints: [],
    particles: [],
    blockedMarkers: [],
    activeCableIds: [],
    hopMarkers: [],
    blockedFlashes: [],
    dashSegments: [],
  });
  const rafId = useRef(0);

  // Flash tracking for blocked connections
  const seenTrackers = useRef(new Set<string>());
  const flashes = useRef(new Map<string, number>());
  const prevBlockedCount = useRef(0);
  // Blocked DNS flash events — accumulate and fade
  const blockedFlashList = useRef<BlockedFlashData[]>([]);
  const seenBlockedDomains = useRef(new Set<string>());
  // Draw-on animation: track when each connection was first rendered
  // drawOnTimes removed — draw-in animation disabled
  const DRAW_ON_DURATION = 1500; // 1.5 seconds to fully draw the arc
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

      // Priority: traced route (if meaningful hops) > submarine cable > simple arc
      const traced = tracedRoutes.get(conn.dest_ip);
      const tracedResult = traced ? buildTracedPath(userLocation, target, traced) : { path: [], usesCable: false };
      // Try cable routing for ocean crossings when no traced route path exists
      const cableRoute = tracedResult.path.length > 0 ? null
        : (getCachedRoute(userLocation, target) || (distKm > 5000 ? getCachedRoute(userLocation, target, true) : null));

      let path: [number, number, number][];
      let isCableRouted = false;
      if (tracedResult.path.length > 0) {
        path = tracedResult.path;
        isCableRouted = tracedResult.usesCable;
      } else if (cableRoute) {
        path = buildRoutedPath(userLocation, target, cableRoute);
        isCableRouted = true;
      } else {
        path = interpolateArc(userLocation, target, h, 40);
      }
      return {
        conn,
        target,
        height: h,
        path,
        svcName,
        svcColor: getServiceColor(svcName),
        classified,
        cableRoute,
        isCableRouted,
      };
    });
  }, [connections, userLocation, tracedRoutes]);

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
        setOutput({ arcs: [], endpoints, particles: [], blockedMarkers: [], activeCableIds: [], hopMarkers: [], blockedFlashes: [], dashSegments: [] });
        return;
      }

      const arcs: ArcData[] = [];
      const particles: ParticleData[] = [];
      const blockedMarkers: BlockedMarkerData[] = [];
      const dashSegments: DashSegment[] = [];

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
          // Throughput-based pulse: faster and stronger glow for more data
          const totalBytes = conn.bytes_sent + conn.bytes_received;
          const throughputScale = totalBytes > 0 ? Math.min(1, Math.log10(totalBytes) / 7) : 0.1;
          const pulseSpeed = 0.003 + throughputScale * 0.008; // 0.003 (idle) → 0.011 (heavy)
          const pulseStrength = 0.1 + throughputScale * 0.3; // 0.1 (idle) → 0.4 (heavy)
          opacity *= (1 - pulseStrength) + pulseStrength * Math.sin(now * pulseSpeed + phase);
        }

        // Completely hide connections not matching the active service filter
        if (activeServiceFilter && meta.svcName !== activeServiceFilter) {
          continue;
        }

        // Hide connections not going to the focused endpoint
        if (focusedEndpointId) {
          const epKey = `${conn.dest_lat.toFixed(2)},${conn.dest_lon.toFixed(2)}`;
          if (epKey !== focusedEndpointId) continue;
        }

        const lineAlpha = Math.round(opacity * 0.15 * 255);

        // Blocked connections: just show a red X beacon at midpoint (no arc color change)
        const flashStart = flashes.current.get(conn.id);
        let sourceColor: [number, number, number, number];
        let targetColor: [number, number, number, number];
        const width = 2;

        if (flashStart !== undefined && now - flashStart >= BLOCK_FLASH_MS) {
          flashes.current.delete(conn.id);
        }

        {

          // Latency heatmap: color by RTT (green → yellow → red)
          // Prefer traceroute RTT (more accurate) over TCP SYN RTT
          const traced = tracedRoutes.get(conn.dest_ip);
          const traceRtt = traced?.hops?.length
            ? traced.hops.filter(h => h.rtt_ms != null).pop()?.rtt_ms ?? null
            : null;
          const effectiveRtt = traceRtt ?? conn.ping_ms;
          if (latencyHeatmap && effectiveRtt != null) {
            const rtt = Math.min(effectiveRtt, 300);
            const t = rtt / 300;
            let r: number, g: number, b: number;
            if (t < 0.33) { // green → yellow
              r = Math.round(255 * t / 0.33); g = 200; b = 50;
            } else if (t < 0.67) { // yellow → orange
              r = 255; g = Math.round(200 * (1 - (t - 0.33) / 0.34)); b = 30;
            } else { // orange → red
              r = 255; g = Math.round(80 * (1 - (t - 0.67) / 0.33)); b = 30;
            }
            sourceColor = [r, g, b, Math.round(lineAlpha * 0.5)];
            targetColor = [r, g, b, Math.round(lineAlpha * 2.5)];
          } else {
            sourceColor = [255, 255, 255, 0];
            targetColor = [255, 255, 255, lineAlpha];
          }
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
          cableRouted: meta.isCableRouted,
        });

        // Marching dashes — short segments flowing along the arc
        if (conn.active && conn.bytes_sent + conn.bytes_received > 0) {
          const pingVal = conn.ping_ms ?? 100;
          const cycleSec = Math.max(0.8, Math.min(5, pingVal / 50));
          const phase = (conn.first_seen_ms * 0.001 + i * 0.37) % 1;
          const svcRgba = hexToRgba(meta.svcColor, 0.9);
          const DASH_LEN = 0.04; // 4% of path length per dash
          const TRAIL_LEN = 0.025; // 2.5% trail behind each dash

          // Upload dashes: flow outward (0 → 1), pink-tinted
          if (conn.bytes_sent > 0) {
            const r = Math.round(svcRgba[0] * 0.4 + 236 * 0.6);
            const g = Math.round(svcRgba[1] * 0.4 + 72 * 0.6);
            const b = Math.round(svcRgba[2] * 0.4 + 153 * 0.6);
            for (let p = 0; p < 2; p++) {
              const pPhase = (phase + p * 0.5) % 1;
              const headT = (now * 0.001 / cycleSec + pPhase) % 1;
              const tailT = Math.max(0, headT - DASH_LEN);
              const trailT = Math.max(0, tailT - TRAIL_LEN);
              const dashPath = extractSubPath(meta.path, tailT, headT, 4);
              const trailPath = extractSubPath(meta.path, trailT, tailT, 3);
              if (dashPath.length >= 2) {
                dashSegments.push({
                  id: `${conn.id}-up-${p}`,
                  path: dashPath,
                  color: [r, g, b, 200],
                  trailColor: [r, g, b, 60],
                  trailPath,
                  width: 3,
                });
              }
            }
          }

          // Download dashes: flow inward (1 → 0), indigo-tinted
          if (conn.bytes_received > 0) {
            const r = Math.round(svcRgba[0] * 0.4 + 99 * 0.6);
            const g = Math.round(svcRgba[1] * 0.4 + 102 * 0.6);
            const b = Math.round(svcRgba[2] * 0.4 + 241 * 0.6);
            for (let p = 0; p < 2; p++) {
              const pPhase = (phase + 0.25 + p * 0.5) % 1;
              const headT = 1 - ((now * 0.001 / cycleSec + pPhase) % 1);
              const tailT = Math.min(1, headT + DASH_LEN);
              const trailT = Math.min(1, tailT + TRAIL_LEN);
              const dashPath = extractSubPath(meta.path, headT, tailT, 4);
              const trailPath = extractSubPath(meta.path, tailT, trailT, 3);
              if (dashPath.length >= 2) {
                dashSegments.push({
                  id: `${conn.id}-dn-${p}`,
                  path: dashPath,
                  color: [r, g, b, 200],
                  trailColor: [r, g, b, 60],
                  trailPath,
                  width: 3,
                });
              }
            }
          }
        }
      }

      // Blocked DNS attempts — show only the red X marker at the destination, no arc
      for (const bm of blockedArcMetas) {
        const age = now - bm.attempt.timestamp_ms;
        if (age > BLOCKED_ARC_FADE_MS) continue;

        const fadeT = age / BLOCKED_ARC_FADE_MS;
        const opacity = 1 - fadeT * fadeT;

        blockedMarkers.push({
          position: [bm.target[0], bm.target[1], 50000], // at the destination, slightly elevated
          opacity,
        });
      }

      // Collect active cable IDs from routed connections
      const cableIdSet = new Set<string>();
      for (const meta of arcMetas) {
        if (meta.cableRoute && meta.conn.active) {
          cableIdSet.add(meta.cableRoute.cableId);
        }
      }
      const activeCableIds = [...cableIdSet];

      // Build hop markers from traced routes
      // When an endpoint is focused or a service is filtered, only show hops for matching connections.
      const hopMarkers: HopMarkerData[] = [];
      const seenHopKeys = new Set<string>();
      // Track which dest_ips we've already processed to avoid duplicate hops from
      // multiple connections to the same server
      const processedDestIps = new Set<string>();
      for (const meta of arcMetas) {
        // Filter by active service
        if (activeServiceFilter && meta.svcName !== activeServiceFilter) continue;
        // Filter by focused endpoint
        if (focusedEndpointId) {
          const epKey = `${meta.conn.dest_lat.toFixed(2)},${meta.conn.dest_lon.toFixed(2)}`;
          if (epKey !== focusedEndpointId) continue;
        }
        // Only process each dest_ip once (multiple connections may share the same traceroute)
        if (processedDestIps.has(meta.conn.dest_ip)) continue;
        processedDestIps.add(meta.conn.dest_ip);
        const traced = tracedRoutes.get(meta.conn.dest_ip);
        if (!traced) continue;
        // Find the last geolocated hop
        let lastGeoIdx = -1;
        for (let hi = traced.hops.length - 1; hi >= 0; hi--) {
          if (traced.hops[hi].lat != null && traced.hops[hi].lon != null) { lastGeoIdx = hi; break; }
        }

        for (let hi = 0; hi < traced.hops.length; hi++) {
          const hop = traced.hops[hi];
          if (hop.lat == null || hop.lon == null) continue;
          // Skip the last hop ONLY if it's very close to the endpoint dot (within 50km)
          // Otherwise show it — the endpoint dot is at the GeoIP location which may differ
          if (hi === lastGeoIdx) {
            const distToEndpoint = greatCircleDistance(
              hop.lat, hop.lon, meta.conn.dest_lat, meta.conn.dest_lon
            );
            if (distToEndpoint < 50) continue; // close enough, endpoint dot covers it
          }
          // Dedup by rounded location across all connections
          const hopKey = `${(hop.lon * 10 | 0)},${(hop.lat * 10 | 0)}`;
          if (seenHopKeys.has(hopKey)) continue;
          seenHopKeys.add(hopKey);
          const color = hop.rtt_ms == null ? [255, 255, 255, 120]
            : hop.rtt_ms < 30 ? [34, 197, 94, 160]   // green
            : hop.rtt_ms < 100 ? [245, 158, 11, 160]  // amber
            : [239, 68, 68, 160];                      // red
          hopMarkers.push({
            position: [hop.lon, hop.lat, 15000],
            color: color as [number, number, number, number],
            radius: 8000,
          });
        }
      }

      // Detect new blocked DNS events by watching the blocked count increase
      const FLASH_DURATION = 3000;
      const currentBlockedCount = dnsBlockedRef.current;
      if (currentBlockedCount > prevBlockedCount.current) {
        const newBlocks = currentBlockedCount - prevBlockedCount.current;
        // Create flash events for new blocks (cap at 5 per frame to avoid spam)
        for (let b = 0; b < Math.min(newBlocks, 5); b++) {
          blockedFlashList.current.push({
            id: `block-${now}-${b}`,
            timestamp: now,
            domain: "",
          });
        }
        prevBlockedCount.current = currentBlockedCount;
      }
      // Prune expired flashes
      blockedFlashList.current = blockedFlashList.current.filter(
        (f) => now - f.timestamp < FLASH_DURATION
      );

      const blockedFlashes = [...blockedFlashList.current];

      setOutput({ arcs, endpoints, particles, blockedMarkers, activeCableIds, hopMarkers, blockedFlashes, dashSegments });
    };

    rafId.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId.current);
  }, [arcMetas, blockedArcMetas, endpoints, userLocation]);

  return output;
}
