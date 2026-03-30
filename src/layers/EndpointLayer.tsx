import { useState, useCallback, useEffect, useRef } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { EndpointData } from "../hooks/useArcAnimation";
import { calculateBearing } from "../utils/arc-geometry";
import { Tag } from "@mattmattmattmatt/base/primitives/tag/Tag";
import "@mattmattmattmatt/base/primitives/tag/tag.css";
import { Chip } from "@mattmattmattmatt/base/primitives/chip/Chip";
import "@mattmattmattmatt/base/primitives/chip/chip.css";

const ROTATION_MS = 8000; // must match RadarMinimap
const TWO_PI = Math.PI * 2;

interface Props {
  endpoints: EndpointData[];
  zoom: number;
  selectedId?: string | null;
  onSelect?: (endpoint: EndpointData) => void;
  userLocation?: [number, number] | null;
}

export function EndpointLayer({ endpoints, zoom, selectedId, onSelect, userLocation }: Props) {
  const [hovered, setHovered] = useState<{ ep: EndpointData; x: number; y: number } | null>(null);
  // Track which endpoints are currently rippling (keyed by ep.id → ripple progress 0-1)
  const [ripples, setRipples] = useState<Map<string, number>>(new Map());
  const rafRef = useRef(0);
  const lastSweptRef = useRef(new Set<string>());

  const onMouseEnter = useCallback((ep: EndpointData, e: React.MouseEvent) => {
    setHovered({ ep, x: e.clientX, y: e.clientY });
  }, []);

  const onMouseMove = useCallback((ep: EndpointData, e: React.MouseEvent) => {
    setHovered({ ep, x: e.clientX, y: e.clientY });
  }, []);

  const onMouseLeave = useCallback(() => {
    setHovered(null);
  }, []);

  // Sync ripples with radar sweep
  useEffect(() => {
    if (!userLocation || endpoints.length === 0) return;

    const [userLon, userLat] = userLocation;

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const sweepAngle = ((now / ROTATION_MS) * TWO_PI) % TWO_PI;

      const newRipples = new Map<string, number>();
      const currentlySwept = new Set<string>();

      for (const ep of endpoints) {
        const [epLon, epLat] = ep.position;
        const bearing = calculateBearing(userLat, userLon, epLat, epLon);
        // Normalize bearing to 0..2π
        const normBearing = ((bearing % TWO_PI) + TWO_PI) % TWO_PI;

        // Check if sweep just passed this endpoint (within ~15°)
        let trail = ((sweepAngle - normBearing) % TWO_PI + TWO_PI) % TWO_PI;
        if (trail < 0.25) {
          currentlySwept.add(ep.id);
          if (!lastSweptRef.current.has(ep.id)) {
            // Just got swept — start a ripple
            newRipples.set(ep.id, 0);
          }
        }
      }

      lastSweptRef.current = currentlySwept;

      // Update existing ripples
      setRipples(prev => {
        const updated = new Map(prev);
        // Add new ripples
        for (const [id, t] of newRipples) {
          if (!updated.has(id)) updated.set(id, t);
        }
        // Advance all ripples
        for (const [id, t] of updated) {
          const next = t + 0.02; // ~60fps, completes in ~50 frames (~0.8s)
          if (next >= 1) {
            updated.delete(id);
          } else {
            updated.set(id, next);
          }
        }
        return updated;
      });
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [endpoints, userLocation]);

  return (
    <>
      {endpoints.map((ep) => {
        const isSelected = selectedId === ep.id;
        const color = ep.connectionDetails[0]?.color || "#6366f1";
        const rippleT = ripples.get(ep.id);
        const dotSize = 6 + Math.min(ep.connectionCount, 5) * 1;

        return (
          <Marker
            key={ep.id}
            longitude={ep.position[0]}
            latitude={ep.position[1]}
            anchor="center"
            style={{ zIndex: isSelected ? 12 : 10 }}
          >
            <div
              className="endpoint-dot-wrapper"
              style={{ position: "relative", width: dotSize + 40, height: dotSize + 40 }}
              onClick={(e) => { e.stopPropagation(); onSelect?.(ep); }}
              onMouseEnter={(e) => onMouseEnter(ep, e)}
              onMouseMove={(e) => onMouseMove(ep, e)}
              onMouseLeave={onMouseLeave}
            >
              {/* Ripple ring */}
              {rippleT !== undefined && (
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width: dotSize + rippleT * 36,
                    height: dotSize + rippleT * 36,
                    borderRadius: "50%",
                    border: `1.5px solid ${color}`,
                    opacity: (1 - rippleT) * 0.6,
                    transform: "translate(-50%, -50%)",
                    pointerEvents: "none",
                  }}
                />
              )}
              {/* Glow */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  width: dotSize + 8,
                  height: dotSize + 8,
                  borderRadius: "50%",
                  background: color,
                  opacity: 0.15,
                  filter: "blur(6px)",
                  transform: "translate(-50%, -50%)",
                  pointerEvents: "none",
                }}
              />
              {/* Dot */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  width: dotSize,
                  height: dotSize,
                  borderRadius: "50%",
                  background: color,
                  border: isSelected ? "2px solid white" : `1.5px solid rgba(255,255,255,0.3)`,
                  transform: "translate(-50%, -50%)",
                  cursor: "pointer",
                  transition: "border 0.15s ease",
                }}
              />
              {/* Label */}
              {(ep.datacenter || ep.city || ep.country) && zoom >= 3 && (
                <div style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: `translate(-50%, ${dotSize / 2 + 6}px)`,
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                }}>
                  <Tag size="sm" style={{ background: "rgba(0, 0, 0, 0.75)", color: "rgba(255, 255, 255, 0.9)" }}>
                    {ep.datacenter || ep.city || ep.country}
                  </Tag>
                </div>
              )}
            </div>
          </Marker>
        );
      })}

      {hovered && (
        <div
          className="endpoint-tooltip"
          style={{ left: hovered.x + 14, top: hovered.y - 14 }}
        >
          <div className="endpoint-tooltip__domain">
            {hovered.ep.datacenter || hovered.ep.domain || hovered.ep.city || "Unknown"}
          </div>
          <div className="endpoint-tooltip__location">
            {hovered.ep.datacenter
              ? [hovered.ep.city, hovered.ep.country].filter(Boolean).join(", ")
              : [hovered.ep.city, hovered.ep.country].filter(Boolean).join(", ")
            }
            {hovered.ep.asnOrg && !hovered.ep.datacenter && (
              <> · {hovered.ep.asnOrg}</>
            )}
          </div>
          {hovered.ep.networkType && (
            <div className="endpoint-tooltip__location">
              {hovered.ep.isCdn ? "CDN" : hovered.ep.networkType}
              {hovered.ep.cloudProvider && ` · ${hovered.ep.cloudProvider}`}
              {hovered.ep.cloudRegion && ` · ${hovered.ep.cloudRegion}`}
            </div>
          )}
          <div className="endpoint-tooltip__stats">
            {hovered.ep.connectionCount} connection{hovered.ep.connectionCount !== 1 ? "s" : ""}
          </div>
          {hovered.ep.connectionDetails && hovered.ep.connectionDetails.length > 0 && (
            <div className="endpoint-tooltip__connections">
              {hovered.ep.connectionDetails.slice(0, 8).map((cd, i) => (
                <div key={i} className="endpoint-tooltip__conn-row">
                  <Chip size="sm" dot={cd.color}>{cd.service}</Chip>
                  <span className="endpoint-tooltip__process">{cd.process}</span>
                  <span className="endpoint-tooltip__port">:{cd.port}</span>
                </div>
              ))}
              {hovered.ep.connectionDetails.length > 8 && (
                <div className="endpoint-tooltip__more">
                  +{hovered.ep.connectionDetails.length - 8} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
