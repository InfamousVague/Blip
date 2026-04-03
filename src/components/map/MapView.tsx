import { type RefObject, useCallback, useEffect, useRef } from "react";
import Map, { Marker } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import { SubmarineCableLayer } from "../../layers/SubmarineCableLayer";
import { NetworkArcLayer } from "../../layers/ArcLayer";
import { EndpointLayer } from "../../layers/EndpointLayer";
import type { EndpointData } from "../../hooks/useArcAnimation";
import type { ArcData, BlockedMarkerData, BlockedFlashData, ParticleData, HopMarkerData, DashSegment } from "../../types/arcAnimation";
import type { HeatmapPoint } from "../../layers/ArcLayer";
import type { Location } from "../../hooks/useUserLocation";
import type { StyleSpecification } from "maplibre-gl";

interface MapViewProps {
  mapRef: RefObject<MapRef | null>;
  viewState: { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number };
  onMove: (evt: { viewState: MapViewProps["viewState"] }) => void;
  onMoveStart: (evt: { originalEvent?: unknown }) => void;
  onMapClick: () => void;
  mapStyle: StyleSpecification;
  location: Location | null;
  userPos: [number, number] | null;
  // Layer data
  arcs: ArcData[];
  endpoints: EndpointData[];
  filteredEndpoints: EndpointData[];
  particles: ParticleData[];
  blockedMarkers: BlockedMarkerData[];
  blockedFlashes: BlockedFlashData[];
  activeCableIds: string[];
  hopMarkers: HopMarkerData[];
  dashSegments: DashSegment[];
  heatmapData: HeatmapPoint[];
  // Toggle states
  showParticles: boolean;
  showHeatmap: boolean;
  showHops: boolean;
  // Selection
  selectedId: string | null;
  onEndpointSelect: (ep: EndpointData) => void;
  // Sidebar width for padding
  sidebarWidth: number;
}

export function MapView({
  mapRef,
  viewState,
  onMove,
  onMoveStart,
  onMapClick,
  mapStyle,
  location,
  userPos,
  arcs,
  endpoints,
  filteredEndpoints,
  particles,
  blockedMarkers,
  blockedFlashes,
  activeCableIds,
  hopMarkers,
  dashSegments,
  heatmapData,
  showParticles,
  showHeatmap,
  showHops,
  selectedId,
  onEndpointSelect,
  sidebarWidth,
}: MapViewProps) {
  // Offset map center to account for topbar + sidebar
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map) {
      map.setPadding({ top: 48, right: sidebarWidth + 16, bottom: 0, left: 0 });
    }
  }, [sidebarWidth, mapRef]);

  // Auto-zoom out when endpoints appear outside the current viewport
  const seenEndpointIds = useRef(new Set<string>());
  const userInteractedAt = useRef(0);
  const autoZoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track manual user interaction (pan/zoom) to pause auto-zoom
  const handleMoveStart = useCallback((evt: { originalEvent?: unknown }) => {
    if (evt.originalEvent) {
      userInteractedAt.current = Date.now();
    }
    onMoveStart(evt);
  }, [onMoveStart]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !location || endpoints.length === 0) return;

    // Don't auto-zoom if user interacted in the last 8 seconds
    if (Date.now() - userInteractedAt.current < 8000) return;

    // Find endpoints we haven't seen yet
    const newEndpoints = endpoints.filter((ep) => !seenEndpointIds.current.has(ep.id));
    if (newEndpoints.length === 0) return;

    // Mark them as seen
    for (const ep of newEndpoints) {
      seenEndpointIds.current.add(ep.id);
    }

    // Check if any new endpoints are outside the current viewport bounds
    const bounds = map.getBounds();
    const outOfView = newEndpoints.filter((ep) => {
      const [lon, lat] = ep.position;
      return !bounds.contains([lon, lat]);
    });

    if (outOfView.length === 0) return;

    // Debounce: batch endpoints that arrive within 1.5s
    if (autoZoomTimer.current) clearTimeout(autoZoomTimer.current);
    autoZoomTimer.current = setTimeout(() => {
      const map = mapRef.current?.getMap();
      if (!map || !location) return;

      // Don't auto-zoom if user interacted while we were debouncing
      if (Date.now() - userInteractedAt.current < 8000) return;

      // Build bounding box: user location + all known endpoints
      let minLon = location.longitude;
      let maxLon = location.longitude;
      let minLat = location.latitude;
      let maxLat = location.latitude;

      for (const ep of endpoints) {
        const [lon, lat] = ep.position;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }

      // Add padding to the bounds (10% on each side)
      const lonPad = Math.max((maxLon - minLon) * 0.1, 2);
      const latPad = Math.max((maxLat - minLat) * 0.1, 1);

      // Only zoom out, never in -- compare against current zoom
      const currentZoom = map.getZoom();

      map.fitBounds(
        [[minLon - lonPad, minLat - latPad], [maxLon + lonPad, maxLat + latPad]],
        {
          maxZoom: currentZoom,
          duration: 2000,
          padding: { top: 56, right: sidebarWidth + 24, bottom: 24, left: 24 },
        },
      );
    }, 1500);

    return () => {
      if (autoZoomTimer.current) clearTimeout(autoZoomTimer.current);
    };
  }, [endpoints, location, sidebarWidth, mapRef]);

  return (
    <Map
      ref={mapRef}
      {...viewState}
      onMove={onMove}
      onMoveStart={handleMoveStart}
      onClick={onMapClick}
      mapStyle={mapStyle}
      style={{ width: "100%", height: "100%" }}
      minZoom={1.5}
      maxZoom={8}
      minPitch={50}
      maxPitch={50}
      attributionControl={false}
    >
      {location && (
        <Marker longitude={location.longitude} latitude={location.latitude} anchor="center">
          <div className="waypoint-marker">
            <svg viewBox="0 0 40 56" className="waypoint-marker__gem">
              <defs>
                <linearGradient id="gem-fill" x1="20" y1="0" x2="20" y2="56" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                  <stop offset="40%" stopColor="#e0e0ff" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#a0a0cc" stopOpacity="0.4" />
                </linearGradient>
                <linearGradient id="gem-edge" x1="20" y1="0" x2="20" y2="56" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                  <stop offset="100%" stopColor="#ccccee" stopOpacity="0.6" />
                </linearGradient>
                <filter id="gem-glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {/* Bottom spike (long) */}
              <polygon points="20,56 6,18 20,22" fill="url(#gem-fill)" opacity="0.5" />
              <polygon points="20,56 34,18 20,22" fill="url(#gem-fill)" opacity="0.35" />
              {/* Top crown (short) */}
              <polygon points="20,0 6,18 20,22" fill="url(#gem-fill)" opacity="0.8" />
              <polygon points="20,0 34,18 20,22" fill="url(#gem-fill)" opacity="0.65" />
              {/* Left face highlight */}
              <polygon points="20,0 6,18 20,56" fill="none" stroke="url(#gem-edge)" strokeWidth="0.8" strokeLinejoin="round" />
              {/* Right face */}
              <polygon points="20,0 34,18 20,56" fill="none" stroke="url(#gem-edge)" strokeWidth="0.8" strokeLinejoin="round" />
              {/* Center seam */}
              <line x1="20" y1="0" x2="20" y2="56" stroke="white" strokeWidth="0.4" opacity="0.3" />
              {/* Equator line */}
              <line x1="6" y1="18" x2="34" y2="18" stroke="white" strokeWidth="0.6" opacity="0.5" />
            </svg>
            <div className="waypoint-marker__ring" />
          </div>
        </Marker>
      )}

      {/* Blocked DNS flash markers -- red X polygons that float up and fade */}
      {location && blockedFlashes.map((flash, fi) => {
        const age = Date.now() - flash.timestamp;
        const t = Math.min(age / 3000, 1);
        const opacity = 1 - t * t; // ease-out fade
        const yOffset = -30 - t * 50; // float upward
        const xOffset = ((fi % 5) - 2) * 12; // spread horizontally
        if (opacity <= 0) return null;
        return (
          <Marker key={flash.id} longitude={location.longitude} latitude={location.latitude} anchor="center">
            <div className="blocked-flash" style={{ opacity, transform: `translate(${xOffset}px, ${yOffset}px)` }}>
              <svg viewBox="0 0 20 28" className="blocked-flash__pin">
                <defs>
                  <linearGradient id="blocked-pin-grad" x1="10" y1="0" x2="10" y2="28" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#ff4444" stopOpacity="0.9" />
                    <stop offset="50%" stopColor="#cc2222" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#991111" stopOpacity="0.3" />
                  </linearGradient>
                </defs>
                <polygon points="10,0 3,4 10,6" fill="url(#blocked-pin-grad)" opacity="0.9" />
                <polygon points="10,0 17,4 10,6" fill="url(#blocked-pin-grad)" opacity="0.7" />
                <polygon points="3,4 10,6 10,28" fill="url(#blocked-pin-grad)" opacity="0.6" />
                <polygon points="17,4 10,6 10,28" fill="url(#blocked-pin-grad)" opacity="0.4" />
                <path d="M10,0 L3,4 L10,28 L17,4 Z" fill="none" stroke="rgba(255,68,68,0.5)" strokeWidth="0.6" strokeLinejoin="round" />
              </svg>
              <span className="blocked-flash__x">{"\u2715"}</span>
            </div>
          </Marker>
        );
      })}

      {/* User location ground dot */}
      {location && (
        <Marker longitude={location.longitude} latitude={location.latitude} anchor="center">
          <div className="user-ground-dot" />
        </Marker>
      )}

      {/* Hop waypoint markers -- small downward-pointing pins with glowing rabbit SVG */}
      {showHops && hopMarkers.map((hop, i) => (
        <Marker key={`hop-${i}`} longitude={hop.position[0]} latitude={hop.position[1]} anchor="bottom">
          <div className="hop-marker">
            <svg viewBox="0 0 24 24" fill="none" className="hop-marker__rabbit">
              <path d="M13 16a3 3 0 0 1 2.24 5" stroke="url(#rabbit-glow)" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M18 12h.01" stroke="url(#rabbit-glow)" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1 1 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1a3 3 0 0 0-3 3" stroke="url(#rabbit-glow)" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M20 8.54V4a2 2 0 1 0-4 0v3" stroke="url(#rabbit-glow)" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M7.612 12.524a3 3 0 1 0-1.6 4.3" stroke="url(#rabbit-glow)" strokeWidth="1.5" strokeLinecap="round" />
              <defs>
                <linearGradient id="rabbit-glow" x1="4" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#e0d0ff" />
                  <stop offset="1" stopColor="#a78bfa" />
                </linearGradient>
              </defs>
            </svg>
            <svg viewBox="0 0 20 28" className="hop-marker__pin">
              <defs>
                <linearGradient id="hop-pin-grad" x1="10" y1="0" x2="10" y2="28" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#e0d0ff" stopOpacity="0.5" />
                  <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.15" />
                </linearGradient>
                <linearGradient id="hop-pin-edge" x1="10" y1="0" x2="10" y2="28" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#e0d0ff" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.3" />
                </linearGradient>
              </defs>
              {/* Left face */}
              <polygon points="10,0 3,4 10,6" fill="url(#hop-pin-grad)" opacity="0.95" />
              {/* Right face */}
              <polygon points="10,0 17,4 10,6" fill="url(#hop-pin-grad)" opacity="0.75" />
              {/* Bottom left */}
              <polygon points="3,4 10,6 10,28" fill="url(#hop-pin-grad)" opacity="0.65" />
              {/* Bottom right */}
              <polygon points="17,4 10,6 10,28" fill="url(#hop-pin-grad)" opacity="0.45" />
              {/* Edge wireframe */}
              <path d="M10,0 L3,4 L10,28 L17,4 Z" fill="none" stroke="url(#hop-pin-edge)" strokeWidth="0.6" strokeLinejoin="round" />
              <line x1="10" y1="0" x2="10" y2="28" stroke="rgba(167,139,250,0.2)" strokeWidth="0.4" />
              <line x1="3" y1="4" x2="17" y2="4" stroke="rgba(224,208,255,0.4)" strokeWidth="0.5" />
            </svg>
          </div>
        </Marker>
      ))}

      <SubmarineCableLayer activeCableIds={activeCableIds} />
      <NetworkArcLayer
        arcs={arcs}
        particles={particles}
        blockedMarkers={blockedMarkers}
        showParticles={showParticles}
        heatmapData={heatmapData}
        showHeatmap={showHeatmap}
        endpoints={filteredEndpoints}
        hopMarkers={hopMarkers}
        showHops={showHops}
        dashSegments={dashSegments}
      />
      <EndpointLayer
        endpoints={filteredEndpoints}
        zoom={viewState.zoom}
        selectedId={selectedId}
        onSelect={onEndpointSelect}
        userLocation={userPos}
      />
    </Map>
  );
}
