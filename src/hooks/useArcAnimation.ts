import { useRef, useEffect, useState, useMemo } from "react";
import type { ResolvedConnection, BlockedAttempt } from "../types/connection";
import { greatCircleDistance, arcHeight, pointOnArc, interpolateArc } from "../utils/arc-geometry";
import { classifyEndpoint, type EndpointType } from "../utils/endpoint-type";
import { getServiceColor, hexToRgba } from "../utils/service-colors";
import type { TracedRoute } from "../types/connection";
import { getCachedRoute, buildRoutedPath, pointAlongPath, type CableRoute } from "../utils/cable-routing";

const FADE_DURATION_MS = 15_000;
const BLOCK_FLASH_MS = 2_000;
const BLOCKED_ARC_FADE_MS = 120_000; // blocked arcs stay visible for 2 minutes then fade
/** Minimum distance (km) between consecutive waypoints to be considered a distinct hop.
 *  Filters out hops that geolocate to the same generic location (e.g. "United States" center). */
const MIN_HOP_DISTANCE_KM = 150; // Minimum distance between hops to be a distinct waypoint

// Known country centroid coordinates that GeoLite2 returns for ambiguous IPs.
// Hops at these locations are filtered out as they're not real geographic locations.
const CENTROID_BLACKLIST: [number, number][] = [
  [-97.82, 37.75],   // United States center (Kansas)
  [-2.0, 54.0],      // United Kingdom center
  [2.0, 47.0],       // France center
  [10.0, 51.0],      // Germany center
  [12.5, 42.5],      // Italy center
  [138.0, 36.0],     // Japan center
  [134.0, -25.0],    // Australia center
  [-106.0, 56.0],    // Canada center
  [105.0, 35.0],     // China center
  [78.0, 22.0],      // India center
];
const CENTROID_RADIUS_KM = 200; // How close to a centroid to be considered ambiguous

/** Build a 3D path from traced route hops.
 *  Each hop-to-hop segment is a smooth arc.
 *  Ocean crossings (>4000km) use submarine cable routing when available. */
function buildTracedPath(
  source: [number, number],
  target: [number, number],
  traced: TracedRoute,
): { path: [number, number, number][]; usesCable: boolean } {
  // Collect candidate waypoints with valid coordinates
  const candidates: [number, number][] = [];
  for (const hop of traced.hops) {
    if (hop.lat != null && hop.lon != null) {
      candidates.push([hop.lon, hop.lat]);
    }
  }

  // Minimal hop filtering — only remove centroids and exact duplicates.
  // Every valid hop becomes a waypoint the arc passes through.
  const waypoints: [number, number][] = [[source[0], source[1]]];

  for (const pt of candidates) {
    const prev = waypoints[waypoints.length - 1];
    const distFromPrev = greatCircleDistance(prev[1], prev[0], pt[1], pt[0]);
    // Skip exact duplicates (within 30km of previous waypoint)
    if (distFromPrev < 30) continue;
    // Skip known country centroids (GeoIP mislocations)
    const isCentroid = CENTROID_BLACKLIST.some(
      ([cLon, cLat]) => greatCircleDistance(cLat, cLon, pt[1], pt[0]) < CENTROID_RADIUS_KM
    );
    if (isCentroid) continue;

    waypoints.push(pt);
  }

  // Always end the arc at the GeoIP target so it connects to the endpoint dot.
  // If the last traced hop is far from the target, the final segment will be a
  // low flat line (data already arrived, this is just GeoIP disagreement).
  waypoints.push([target[0], target[1]]);

  // Need at least one intermediate hop to be worth rendering as traced
  if (waypoints.length <= 2) return { path: [], usesCable: false };

  // Build path: arc per segment, cable routing for ocean crossings
  const path: [number, number, number][] = [];
  let usesCable = false;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const dist = greatCircleDistance(from[1], from[0], to[1], to[0]);

    let segPoints: [number, number, number][];

    // Final segment from last traced hop to GeoIP endpoint — keep it flat/low
    // when there's a big discrepancy (GeoIP disagrees with traceroute)
    if (dist > 2000) {
      // Ocean crossing: try cable routing for transcontinental segments
      const cableRoute = getCachedRoute(from, to) || (dist > 5000 ? getCachedRoute(from, to, true) : null);
      if (cableRoute) {
        segPoints = buildRoutedPath(from, to, cableRoute);
        usesCable = true;
      } else {
        const numPoints = Math.max(20, Math.round(dist / 50));
        const h = arcHeight(dist) * 0.15;
        segPoints = interpolateArc(from, to, h, numPoints);
      }
    } else {
      // Normal land arc
      const numPoints = Math.max(20, Math.round(dist / 50));
      const h = arcHeight(dist) * 0.4;
      segPoints = interpolateArc(from, to, h, numPoints);
    }

    // Append, skip first point on subsequent segments to avoid duplicates
    for (let j = i === 0 ? 0 : 1; j < segPoints.length; j++) {
      path.push(segPoints[j]);
    }
  }

  return { path, usesCable };
}

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
  /** True if this arc uses a submarine cable route (render dashed) */
  cableRouted?: boolean;
}

export interface BlockedMarkerData {
  position: [number, number, number];
  opacity: number;
}

export interface BlockedFlashData {
  id: string;
  timestamp: number;
  domain: string;
}


export interface ParticleData {
  position: [number, number, number];
  color: [number, number, number, number];
  width: number;
  /** 0 = upload (user→endpoint), 1 = download (endpoint→user), 2 = neutral */
  direction?: number;
}

export interface HopMarkerData {
  position: [number, number, number];
  color: [number, number, number, number];
  radius: number;
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
  }>({
    arcs: [],
    endpoints: [],
    particles: [],
    blockedMarkers: [],
    activeCableIds: [],
    hopMarkers: [],
    blockedFlashes: [],
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
        setOutput({ arcs: [], endpoints, particles: [], blockedMarkers: [], activeCableIds: [], hopMarkers: [], blockedFlashes: [] });
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

        // No particles — data flow is shown via the pulsing glow on the arc itself
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

      setOutput({ arcs, endpoints, particles, blockedMarkers, activeCableIds, hopMarkers, blockedFlashes });
    };

    rafId.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId.current);
  }, [arcMetas, blockedArcMetas, endpoints, userLocation]);

  return output;
}
