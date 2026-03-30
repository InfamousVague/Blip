import { useRef } from "react";
import { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer as DeckArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { HeatmapLayer as DeckHeatmapLayer } from "@deck.gl/aggregation-layers";
import type { ArcData, ParticleData, BlockedMarkerData } from "../hooks/useArcAnimation";

export interface HeatmapPoint {
  position: [number, number]; // [lon, lat]
  weight: number;
}

interface Props {
  arcs: ArcData[];
  particles?: ParticleData[];
  blockedMarkers?: BlockedMarkerData[];
  showParticles?: boolean;
  heatmapData?: HeatmapPoint[];
  showHeatmap?: boolean;
}

function DeckGLOverlay({ layers }: { layers: any[] }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  overlay.setProps({ layers });
  return null;
}

export function NetworkArcLayer({ arcs, particles = [], blockedMarkers = [], showParticles = false, heatmapData = [], showHeatmap = false }: Props) {
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

  const layers: unknown[] = [];

  // Heatmap layer (rendered first = underneath arcs)
  if (showHeatmap && heatmapData.length > 0) {
    const heatmap = new DeckHeatmapLayer<HeatmapPoint>({
      id: "network-heatmap-deck",
      data: heatmapData,
      getPosition: (d) => d.position,
      getWeight: (d) => d.weight,
      radiusPixels: 60,
      intensity: 1.5,
      threshold: 0.05,
      colorRange: [
        [99, 102, 241, 40],   // indigo - low density
        [99, 102, 241, 100],
        [139, 92, 246, 155],  // purple - medium
        [236, 72, 153, 180],  // pink - high
        [245, 158, 11, 205],  // amber - very high
        [255, 255, 255, 230], // white - peak
      ],
      opacity: 0.8,
      updateTriggers: {
        getPosition: [heatmapData.length],
        getWeight: [heatmapData.length],
      },
    });
    layers.push(heatmap);
  }

  layers.push(arcLayer);

  if (showParticles && particles.length > 0) {
    const particleLayer = new ScatterplotLayer<ParticleData>({
      id: "network-particles",
      data: particles,
      getPosition: (d) => d.position,
      getFillColor: (d) => d.color as [number, number, number, number],
      getRadius: (d) => d.width * 300,
      radiusMinPixels: 2,
      radiusMaxPixels: 5,
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
