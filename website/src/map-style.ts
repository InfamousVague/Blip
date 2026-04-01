/**
 * Website map style — uses online tile sources instead of the app's
 * offline blip-tiles:// protocol which only works inside Tauri.
 */
import { buildAtlasStyle } from "@blip/map-themes";

export function buildWebsiteMapStyle() {
  const style = buildAtlasStyle();

  // Override offline tile sources with online ones
  style.sources = {
    ...style.sources,
    openmaptiles: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    },
  };

  // Override offline font source
  style.glyphs = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

  return style;
}
