import { useState, useCallback } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { EndpointData } from "../hooks/useArcAnimation";
import type { EndpointType } from "../utils/endpoint-type";
import { getBrandIcon } from "../utils/brand-icons";
import { Tag } from "@mattmattmattmatt/base/primitives/tag/Tag";
import "@mattmattmattmatt/base/primitives/tag/tag.css";
import { Chip } from "@mattmattmattmatt/base/primitives/chip/Chip";
import "@mattmattmattmatt/base/primitives/chip/chip.css";

import containerIcon from "../assets/icons/container.png";
import serverIcon from "../assets/icons/server.png";
import chatIcon from "../assets/icons/chat.png";
import streamingIcon from "../assets/icons/streaming.png";
import shieldIcon from "../assets/icons/shield.png";

const ICON_MAP: Record<EndpointType, string> = {
  server: serverIcon,
  chat: chatIcon,
  streaming: streamingIcon,
  shield: shieldIcon,
};

const ISO_TRANSFORM = "perspective(800px) rotateX(36deg) rotateZ(-42deg) skewX(6.5deg) skewY(4.5deg) scaleX(1.28) scaleY(0.78)";

// Brands with very dark hex colors that need to be inverted to white on glass
const DARK_BRANDS = new Set(["apple", "x", "github", "anthropic"]);

interface Props {
  endpoints: EndpointData[];
  zoom: number;
  selectedId?: string | null;
  onSelect?: (endpoint: EndpointData) => void;
}

export function EndpointLayer({ endpoints, zoom, selectedId, onSelect }: Props) {
  // Original sizing
  const size = Math.max(16, Math.round(22 + (zoom - 1.5) * (44 / 8.5)));
  const [hovered, setHovered] = useState<{ ep: EndpointData; x: number; y: number } | null>(null);

  const onMouseEnter = useCallback((ep: EndpointData, e: React.MouseEvent) => {
    setHovered({ ep, x: e.clientX, y: e.clientY });
  }, []);

  const onMouseMove = useCallback((ep: EndpointData, e: React.MouseEvent) => {
    setHovered({ ep, x: e.clientX, y: e.clientY });
  }, []);

  const onMouseLeave = useCallback(() => {
    setHovered(null);
  }, []);

  return (
    <>
      {endpoints.map((ep) => {
        const brand = getBrandIcon(ep.domain, ep.serviceName);
        const isSelected = selectedId === ep.id;

        return (
          <Marker
            key={ep.id}
            longitude={ep.position[0]}
            latitude={ep.position[1]}
            anchor="center"
            style={{ zIndex: 10 }}
          >
            <div className="endpoint-marker" style={{ position: "relative" }}>
              {brand ? (
                // Brand icon composited on glass container
                <div
                  className={`endpoint-glass${isSelected ? " endpoint-icon--selected" : ""}`}
                  style={{ width: size, height: size, cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); onSelect?.(ep); }}
                  onMouseEnter={(e) => onMouseEnter(ep, e)}
                  onMouseMove={(e) => onMouseMove(ep, e)}
                  onMouseLeave={onMouseLeave}
                >
                  {/* Glass container */}
                  <img
                    src={containerIcon}
                    alt=""
                    className="endpoint-glass__container"
                    style={{ width: size, height: size }}
                  />
                  {/* Brand glow (blurred duplicate behind) */}
                  <img
                    src={brand.url}
                    alt=""
                    className="endpoint-glass__glow"
                    style={{
                      width: size * 0.38,
                      height: size * 0.38,
                      top: `calc(50% - ${size * 0.38 / 2}px - ${size * 0.06}px)`,
                      left: `calc(50% - ${size * 0.38 / 2}px)`,
                      filter: DARK_BRANDS.has(brand.brandName) ? "blur(8px) brightness(1.4) invert(1)" : "blur(8px) brightness(1.4)",
                      opacity: 1,
                      transform: ISO_TRANSFORM,
                    }}
                  />
                  {/* Brand icon (main) */}
                  <img
                    src={brand.url}
                    alt={brand.brandName}
                    className="endpoint-glass__brand"
                    style={{
                      width: size * 0.38,
                      height: size * 0.38,
                      top: `calc(50% - ${size * 0.38 / 2}px - ${size * 0.06}px)`,
                      left: `calc(50% - ${size * 0.38 / 2}px)`,
                      transform: ISO_TRANSFORM,
                      ...(DARK_BRANDS.has(brand.brandName) ? { filter: "invert(1)" } : {}),
                    }}
                  />
                </div>
              ) : (
                // Fallback: glassmorphism type icons (already have the glass look baked in)
                <img
                  src={ICON_MAP[ep.type]}
                  alt={ep.type}
                  className={`endpoint-icon${isSelected ? " endpoint-icon--selected" : ""}`}
                  style={{ width: size, height: size, display: "block" }}
                  onClick={(e) => { e.stopPropagation(); onSelect?.(ep); }}
                  onMouseEnter={(e) => onMouseEnter(ep, e)}
                  onMouseMove={(e) => onMouseMove(ep, e)}
                  onMouseLeave={onMouseLeave}
                />
              )}
              {(ep.datacenter || ep.city || ep.country) && zoom >= 3 && (
                <div className="endpoint-label">
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
