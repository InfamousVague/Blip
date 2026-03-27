import { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer as DeckArcLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { ArcData, ParticleData } from "../hooks/useArcAnimation";

interface Props {
  arcs: ArcData[];
  particles?: ParticleData[];
  showParticles?: boolean;
}

function DeckGLOverlay({ layers }: { layers: any[] }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  overlay.setProps({ layers });
  return null;
}

export function NetworkArcLayer({ arcs, particles = [], showParticles = false }: Props) {
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
      getSourceColor: [arcs.length, Date.now()],
      getTargetColor: [arcs.length, Date.now()],
      getWidth: [arcs.length],
    },
  });

  const layers: unknown[] = [arcLayer];

  if (showParticles && particles.length > 0) {
    // Core dot — fully opaque, no glow, depthTest disabled to render on top of 3D arcs
    const particleLayer = new ScatterplotLayer<ParticleData>({
      id: "network-particles",
      data: particles,
      getPosition: (d) => d.path[Math.floor(d.path.length / 2)],
      getFillColor: (d) => [d.color[0], d.color[1], d.color[2], 255] as [number, number, number, number],
      getRadius: (d) => d.width * 600,
      radiusMinPixels: 3,
      radiusMaxPixels: 6,
      opacity: 1,
      parameters: { depthTest: false } as any,
      updateTriggers: {
        getPosition: [Date.now()],
        getFillColor: [particles.length],
      },
    });

    layers.push(particleLayer);
  }

  return <DeckGLOverlay layers={layers} />;
}
