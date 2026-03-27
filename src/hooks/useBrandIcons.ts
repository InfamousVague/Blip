import { useEffect, useRef, useState } from "react";
import { getBrandIcon, type BrandIconResult } from "../utils/brand-icons";
import type { EndpointData } from "./useArcAnimation";

type IconMap = Map<string, BrandIconResult | null>;

/**
 * Resolves brand icons for all endpoints.
 * Returns a map of endpoint ID → BrandIconResult.
 * Caches results and only resolves new endpoints.
 */
export function useBrandIcons(endpoints: EndpointData[]): IconMap {
  const [iconMap, setIconMap] = useState<IconMap>(new Map());
  const resolvedIds = useRef(new Set<string>());

  useEffect(() => {
    const newEndpoints = endpoints.filter((ep) => !resolvedIds.current.has(ep.id));
    if (newEndpoints.length === 0) return;

    // Mark as resolving immediately to prevent duplicate calls
    for (const ep of newEndpoints) {
      resolvedIds.current.add(ep.id);
    }

    Promise.allSettled(
      newEndpoints.map(async (ep) => {
        const result = getBrandIcon(ep.domain, ep.ip);
        return { id: ep.id, result };
      })
    ).then((results) => {
      setIconMap((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.status === "fulfilled") {
            next.set(r.value.id, r.value.result);
          }
        }
        return next;
      });
    });
  }, [endpoints]);

  return iconMap;
}
