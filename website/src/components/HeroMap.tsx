/**
 * HeroMap — Animated MapLibre map with demo connection arcs for the landing page hero.
 * Non-interactive, auto-pans slowly, shows particles traveling along arcs.
 * Includes the floating waypoint gem marker at the user location.
 */

import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import Map, { Marker } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { useControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildWebsiteMapStyle } from "../map-style";
import { interpolateArc, pointOnArc, greatCircleDistance, arcHeight } from "@blip/utils/arc-geometry";
import { USER_LOCATION, DEMO_ENDPOINTS, type DemoEndpoint } from "../data/demo-connections";

function DeckOverlay({ layers }: { layers: unknown[] }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: true }));
  overlay.setProps({ layers });
  return null;
}

function EndpointDot({ color }: { color: [number, number, number] }) {
  const [r, g, b] = color;
  const hex = `rgb(${r},${g},${b})`;
  return (
    <div style={{ position: "relative", width: 22, height: 22, pointerEvents: "none" }}>
      {/* Outer ring */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: `rgba(${r},${g},${b},0.1)`,
        border: `1.5px solid rgba(${r},${g},${b},0.25)`,
      }} />
      {/* Inner dot */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        width: 8, height: 8, borderRadius: "50%",
        background: hex,
        boxShadow: `0 0 8px rgba(${r},${g},${b},0.4)`,
        transform: "translate(-50%, -50%)",
      }} />
    </div>
  );
}

interface ArcMeta {
  target: [number, number];
  height: number;
  path: [number, number, number][];
  color: [number, number, number];
}

export function HeroMap() {
  const mapRef = useRef<MapRef>(null);
  const rafId = useRef(0);
  const [frameCount, setFrameCount] = useState(0);
  const mapStyle = useMemo(() => buildWebsiteMapStyle(), []);

  // Pre-compute arc paths
  const arcMetas = useMemo<ArcMeta[]>(() => {
    return DEMO_ENDPOINTS.map((ep) => {
      const distKm = greatCircleDistance(USER_LOCATION[1], USER_LOCATION[0], ep.position[1], ep.position[0]);
      const h = arcHeight(distKm);
      return {
        target: ep.position,
        height: h,
        path: interpolateArc(USER_LOCATION, ep.position, h, 40),
        color: ep.color,
      };
    });
  }, []);

  // Particle state ref (updated by rAF, read by render)
  const particlesRef = useRef<{ position: [number, number, number]; color: [number, number, number, number]; radius: number }[]>([]);

  // Animation loop
  useEffect(() => {
    let lastFrame = 0;
    const animate = () => {
      rafId.current = requestAnimationFrame(animate);
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastFrame < 33) return; // ~30fps
      lastFrame = now;

      const particles: typeof particlesRef.current = [];

      for (let i = 0; i < arcMetas.length; i++) {
        const meta = arcMetas[i];
        const cycleSec = 3 + (i % 3);
        const phase = (i * 0.17) % 1;

        // 2 particles per arc (upload + download)
        for (let p = 0; p < 2; p++) {
          const pPhase = (phase + p * 0.5) % 1;
          const t = ((now * 0.001 / cycleSec + pPhase) % 1);
          const actualT = p === 0 ? t : 1 - t;
          const pt = pointOnArc(USER_LOCATION, meta.target, meta.height, actualT);

          const [r, g, b] = meta.color;
          const pr = p === 0 ? Math.round(r * 0.4 + 236 * 0.6) : Math.round(r * 0.4 + 99 * 0.6);
          const pg = p === 0 ? Math.round(g * 0.4 + 72 * 0.6) : Math.round(g * 0.4 + 102 * 0.6);
          const pb = p === 0 ? Math.round(b * 0.4 + 153 * 0.6) : Math.round(b * 0.4 + 241 * 0.6);

          particles.push({
            position: pt,
            color: [pr, pg, pb, 200],
            radius: 3000 + (i % 3) * 1000,
          });
        }
      }

      particlesRef.current = particles;
      setFrameCount((c) => c + 1);
    };

    rafId.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId.current);
  }, [arcMetas]);

  // Auto-pan: slow drift
  const startAutoPan = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const drift = () => {
      const center = map.getCenter();
      map.easeTo({
        center: [center.lng + 8, center.lat + 1],
        duration: 40000,
        easing: (t: number) => t,
      });
    };

    drift();
    const interval = setInterval(drift, 40000);
    return () => clearInterval(interval);
  }, []);

  // Build deck.gl layers
  const layers = useMemo(() => {
    const result: unknown[] = [];

    // Arc paths — white with subtle opacity, matching the app
    const arcData = arcMetas.map((m) => ({
      path: m.path,
    }));
    result.push(
      new PathLayer({
        id: "demo-arcs",
        data: arcData,
        getPath: (d: (typeof arcData)[0]) => d.path,
        getColor: [255, 255, 255, 35],
        getWidth: 2,
        widthUnits: "pixels" as const,
        widthMinPixels: 1,
        widthMaxPixels: 3,
        capRounded: true,
        jointRounded: true,
      })
    );

    // Particles
    result.push(
      new ScatterplotLayer({
        id: "demo-particles",
        data: particlesRef.current,
        getPosition: (d: (typeof particlesRef.current)[0]) => d.position,
        getFillColor: (d: (typeof particlesRef.current)[0]) => d.color,
        getRadius: (d: (typeof particlesRef.current)[0]) => d.radius,
        radiusMinPixels: 2,
        radiusMaxPixels: 5,
        parameters: { depthTest: false } as never,
        updateTriggers: {
          getPosition: [frameCount],
          getFillColor: [frameCount],
        },
      })
    );

    return result;
  }, [arcMetas, frameCount]);

  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: -40,
        latitude: 30,
        zoom: 2.2,
        pitch: 50,
        bearing: -15,
      }}
      mapStyle={mapStyle}
      style={{ width: "100%", height: "100%" }}
      interactive={false}
      attributionControl={false}
      onLoad={startAutoPan}
      minPitch={50}
      maxPitch={50}
    >
      {/* Endpoint dots as HTML Markers (no flickering) */}
      {DEMO_ENDPOINTS.map((ep) => (
        <Marker key={ep.label} longitude={ep.position[0]} latitude={ep.position[1]} anchor="center">
          <EndpointDot color={ep.color} />
        </Marker>
      ))}

      {/* Floating waypoint gem at user location */}
      <Marker longitude={USER_LOCATION[0]} latitude={USER_LOCATION[1]} anchor="center">
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
            </defs>
            <polygon points="20,56 6,18 20,22" fill="url(#gem-fill)" opacity="0.5" />
            <polygon points="20,56 34,18 20,22" fill="url(#gem-fill)" opacity="0.35" />
            <polygon points="20,0 6,18 20,22" fill="url(#gem-fill)" opacity="0.8" />
            <polygon points="20,0 34,18 20,22" fill="url(#gem-fill)" opacity="0.65" />
            <polygon points="20,0 6,18 20,56" fill="none" stroke="url(#gem-edge)" strokeWidth="0.8" strokeLinejoin="round" />
            <polygon points="20,0 34,18 20,56" fill="none" stroke="url(#gem-edge)" strokeWidth="0.8" strokeLinejoin="round" />
            <line x1="20" y1="0" x2="20" y2="56" stroke="white" strokeWidth="0.4" opacity="0.3" />
            <line x1="6" y1="18" x2="34" y2="18" stroke="white" strokeWidth="0.6" opacity="0.5" />
          </svg>
        </div>
      </Marker>

      <DeckOverlay layers={layers} />
    </Map>
  );
}
