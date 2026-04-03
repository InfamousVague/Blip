import { useCallback, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { getLocation } from "./useUserLocation";
import type { Location } from "./useUserLocation";

export function useMapViewState(setLocation: (loc: Location) => void) {
  const mapRef = useRef<MapRef>(null);
  const [viewState, setViewState] = useState({
    longitude: 0,
    latitude: 20,
    zoom: 2,
    pitch: 50,
    bearing: -8,
  });

  const onMove = useCallback(
    (evt: { viewState: typeof viewState }) => setViewState(evt.viewState),
    [],
  );

  const goHome = useCallback(() => {
    getLocation()
      .then((loc) => {
        setLocation(loc);
        mapRef.current?.flyTo({
          center: [loc.longitude, loc.latitude],
          zoom: 4.5,
          pitch: 50,
          bearing: -8,
          duration: 1500,
        });
      })
      .catch((err) => console.error("Could not get location:", err));
  }, [setLocation]);

  const zoomIn = useCallback(() => mapRef.current?.zoomIn({ duration: 200 }), []);
  const zoomOut = useCallback(() => mapRef.current?.zoomOut({ duration: 200 }), []);

  return { mapRef, viewState, setViewState, onMove, goHome, zoomIn, zoomOut };
}
