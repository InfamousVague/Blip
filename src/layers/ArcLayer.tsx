import { useRef } from "react";
import { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer as DeckArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { ArcData, ParticleData, BlockedMarkerData } from "../hooks/useArcAnimation";

interface Props {
  arcs: ArcData[];
  particles?: ParticleData[];
  blockedMarkers?: BlockedMarkerData[];
  showParticles?: boolean;
}

function DeckGLOverlay({ layers }: { layers: any[] }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  overlay.setProps({ layers });
  return null;
}

export function NetworkArcLayer({ arcs, particles = [], blockedMarkers = [], showParticles = false }: Props) {
  const frameCounter = useRef(0);
  frameCounter.current += 1;

  const arcLayer = new DeckArcLayer<ArcData>({
    id: "network-arcs",
    data: arcs,
    getSourcePosition: (d) => d.sourcePosition,
    getTargetPosition: (d) => d.targetPosition,
    getSourceColor: (d) => d.sourceColor,
    getTargetColor: (d) => d.targetColor,
    getHeight: (d) => d.height,
    getWidth: (d) => d.width,
    greatCircle: true,
    numSegments: 50,
    widthMinPixels: 1,
    widthMaxPixels: 4,
    updateTriggers: {
      getSourceColor: [arcs.length, frameCounter.current],
      getTargetColor: [arcs.length, frameCounter.current],
      getWidth: [arcs.length, frameCounter.current],
    },
  });

  const layers: unknown[] = [arcLayer];

  if (showParticles && particles.length > 0) {
    const particleLayer = new ScatterplotLayer<ParticleData>({
      id: "network-particles",
      data: particles,
      getPosition: (d) => d.path[Math.floor(d.path.length / 2)],
      getFillColor: (d) => [d.color[0], d.color[1], d.color[2], 255] as [number, number, number, number],
      getRadius: (d) => d.width * 200,
      radiusMinPixels: 1,
      radiusMaxPixels: 3,
      opacity: 1,
      parameters: { depthTest: false } as any,
      updateTriggers: {
        getPosition: [frameCounter.current],
        getFillColor: [particles.length],
      },
    });

    layers.push(particleLayer);
  }

  // Red X markers at midpoints of blocked/flashing arcs
  if (blockedMarkers.length > 0) {
    const blockedLayer = new TextLayer<BlockedMarkerData>({
      id: "blocked-markers",
      data: blockedMarkers,
      getPosition: (d) => d.position,
      getText: () => "\u2715",
      getColor: (d) => [255, 50, 50, Math.round(d.opacity * 255)],
      getSize: 18,
      getAngle: 0,
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontWeight: "bold",
      billboard: true,
      parameters: { depthTest: false } as any,
      updateTriggers: {
        getColor: [frameCounter.current],
      },
    });
    layers.push(blockedLayer);
  }

  return <DeckGLOverlay layers={layers} />;
}
