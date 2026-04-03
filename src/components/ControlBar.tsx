import { Button } from "../ui/components/Button";
import { plus } from "@mattmattmattmatt/base/primitives/icon/icons/plus";
import { minus } from "@mattmattmattmatt/base/primitives/icon/icons/minus";
import { locateFixed } from "@mattmattmattmatt/base/primitives/icon/icons/locate-fixed";
import { settings } from "@mattmattmattmatt/base/primitives/icon/icons/settings";
import { flame } from "@mattmattmattmatt/base/primitives/icon/icons/flame";
import { sparkles } from "@mattmattmattmatt/base/primitives/icon/icons/sparkles";
import { rabbit } from "@mattmattmattmatt/base/primitives/icon/icons/rabbit";
import { thermometer } from "@mattmattmattmatt/base/primitives/icon/icons/thermometer";
import { invoke } from "@tauri-apps/api/core";

interface ControlBarProps {
  goHome: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  showHeatmap: boolean;
  setShowHeatmap: (v: boolean) => void;
  showParticles: boolean;
  setShowParticles: (v: boolean) => void;
  showHops: boolean;
  setShowHops: (v: boolean) => void;
  latencyHeatmap: boolean;
  setLatencyHeatmap: (v: boolean) => void;
  onSettingsOpen: () => void;
}

export function ControlBar({
  goHome,
  zoomIn,
  zoomOut,
  showHeatmap,
  setShowHeatmap,
  showParticles,
  setShowParticles,
  showHops,
  setShowHops,
  latencyHeatmap,
  setLatencyHeatmap,
  onSettingsOpen,
}: ControlBarProps) {
  return (
    <>
      {/* Upper controls -- navigation */}
      <div className="map-controls-upper">
        <span className="map-btn-tooltip" data-tooltip="My location">
          <Button variant="secondary" size="md" icon={locateFixed} iconOnly aria-label="Go to my location" onClick={goHome} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Zoom in">
          <Button variant="secondary" size="md" icon={plus} iconOnly aria-label="Zoom in" onClick={zoomIn} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Zoom out">
          <Button variant="secondary" size="md" icon={minus} iconOnly aria-label="Zoom out" onClick={zoomOut} />
        </span>
      </div>

      {/* Lower controls -- visualization toggles */}
      <div className="zoom-controls">
        <span className="map-btn-tooltip" data-tooltip="Heat map">
          <Button variant={showHeatmap ? "primary" : "secondary"} size="md" icon={flame} iconOnly aria-label="Toggle heat map" onClick={() => setShowHeatmap(!showHeatmap)} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Particles">
          <Button variant={showParticles ? "primary" : "secondary"} size="md" icon={sparkles} iconOnly aria-label="Toggle particles" onClick={() => setShowParticles(!showParticles)} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Route hops">
          <Button variant={showHops ? "primary" : "secondary"} size="md" icon={rabbit} iconOnly aria-label="Toggle route hops" onClick={() => setShowHops(!showHops)} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Latency heatmap">
          <Button variant={latencyHeatmap ? "primary" : "secondary"} size="md" icon={thermometer} iconOnly aria-label="Toggle latency heatmap" onClick={() => { setLatencyHeatmap(!latencyHeatmap); invoke("set_preference", { key: "route_latency_heatmap", value: String(!latencyHeatmap) }).catch(() => {}); }} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Settings">
          <Button variant="secondary" size="md" icon={settings} iconOnly aria-label="Settings" onClick={onSettingsOpen} />
        </span>
      </div>
    </>
  );
}
