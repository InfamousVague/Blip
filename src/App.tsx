import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Map, { Marker } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import "@mattmattmattmatt/base/primitives/button/button.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import { plus } from "@mattmattmattmatt/base/primitives/icon/icons/plus";
import { minus } from "@mattmattmattmatt/base/primitives/icon/icons/minus";
import { locateFixed } from "@mattmattmattmatt/base/primitives/icon/icons/locate-fixed";
import { play } from "@mattmattmattmatt/base/primitives/icon/icons/play";
import { pause } from "@mattmattmattmatt/base/primitives/icon/icons/pause";
import { settings } from "@mattmattmattmatt/base/primitives/icon/icons/settings";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
import { themes, getThemeStyle } from "./map-themes";
import laptopIcon from "./assets/icons/laptop.png";
import { useNetworkCapture } from "./hooks/useNetworkEvents";
import { useArcAnimation } from "./hooks/useArcAnimation";
import type { EndpointData } from "./hooks/useArcAnimation";
import { NetworkArcLayer } from "./layers/ArcLayer";
import { EndpointLayer } from "./layers/EndpointLayer";
import { HeatmapLayer } from "./layers/HeatmapLayer";
import { Sidebar } from "./components/Sidebar";
import { GlobalStats } from "./components/GlobalStats";
import { EndpointDetail } from "./components/EndpointDetail";
import { useBandwidth } from "./hooks/useBandwidth";
import { Settings } from "./components/Settings";
import { SetupPrompt } from "./components/SetupPrompt";
import { TrackerStats } from "./components/TrackerStats";
import { DnsLog } from "./components/DnsLog";
import { FirewallContent } from "./components/FirewallSidebar";
import { useDnsCapture } from "./hooks/useDnsCapture";
import { useFirewallRules } from "./hooks/useFirewallRules";
import { SegmentedControl } from "@mattmattmattmatt/base/primitives/segmented-control/SegmentedControl";
import "@mattmattmattmatt/base/primitives/segmented-control/segmented-control.css";
import { flame } from "@mattmattmattmatt/base/primitives/icon/icons/flame";
import { activity } from "@mattmattmattmatt/base/primitives/icon/icons/activity";
import { shieldCheck } from "@mattmattmattmatt/base/primitives/icon/icons/shield-check";
import { globe } from "@mattmattmattmatt/base/primitives/icon/icons/globe";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { sparkles } from "@mattmattmattmatt/base/primitives/icon/icons/sparkles";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { HistoricalEndpoint, SelfIpInfo } from "./types/connection";
import "./App.css";

type Location = { longitude: number; latitude: number; source: string; ip?: string };

let cachedLocation: Location | null = null;

async function getLocation(forceRefresh = false): Promise<Location> {
  if (cachedLocation && !forceRefresh) return cachedLocation;

  // Try native bridge first (non-blocking, single attempt)
  try {
    const loc = await invoke<{ latitude: number; longitude: number }>("get_user_location");
    if (loc.latitude && loc.longitude) {
      cachedLocation = { ...loc, source: "native" };
      return cachedLocation;
    }
  } catch {
    // Native location not available yet
  }

  // Try browser geolocation
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error("No geolocation")); return; }
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 3000 });
    });
    cachedLocation = { longitude: pos.coords.longitude, latitude: pos.coords.latitude, source: "browser" };
    return cachedLocation;
  } catch {
    // Browser geolocation failed
  }

  // Fallback: center of US (the map still works, just not centered on user)
  return { longitude: -98.5, latitude: 39.8, source: "fallback" };
}

function App() {
  const mapRef = useRef<MapRef>(null);
  const [viewState, setViewState] = useState({ longitude: 0, latitude: 20, zoom: 2 });
  const [location, setLocation] = useState<Location | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointData | null>(null);
  const [, startTransition] = useTransition();
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showParticles, setShowParticles] = useState(true);
  const [mode, setMode] = useState<"network" | "firewall">("network");
  const [sidebarTab, setSidebarTab] = useState<"network" | "trackers" | "dns">("network");
  const [historicalEndpoints, setHistoricalEndpoints] = useState<HistoricalEndpoint[]>([]);
  const [selfInfo, setSelfInfo] = useState<SelfIpInfo | null>(null);
  const [elevationBanner, setElevationBanner] = useState(false);
  const [themeIndex, setThemeIndex] = useState(() => {
    const saved = localStorage.getItem("blip-map-theme");
    return saved ? parseInt(saved, 10) : themes.findIndex((t) => t.name === "Soft Light");
  });
  const setupTriggered = useRef(false);

  const { connections, totalEver, capturing, startCapture, stopCapture } = useNetworkCapture(sidebarTab);

  const userPos: [number, number] | null = location
    ? [location.longitude, location.latitude]
    : null;

  const { log: dnsLog, stats: dnsStats, blockedAttempts } = useDnsCapture(sidebarTab === "dns");
  const { arcs, endpoints, particles, blockedMarkers } = useArcAnimation(connections, userPos, dnsStats.blocked_count, blockedAttempts);
  const bandwidth = useBandwidth(capturing);
  const { apps: firewallApps, setRule: setFirewallRule } = useFirewallRules();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    getLocation()
      .then((loc) => {
        setLocation(loc);
        setViewState((v) => ({ ...v, longitude: loc.longitude, latitude: loc.latitude, zoom: 4.5 }));
      })
      .catch((err) => console.warn("Location unavailable:", err));

    // Fetch self IP info (ISP, ASN, network type)
    invoke<SelfIpInfo>("get_self_info")
      .then((info) => setSelfInfo(info))
      .catch((err) => console.warn("Failed to load self info:", err));

    // Load historical endpoints for heatmap (all-time data from DB)
    invoke<HistoricalEndpoint[]>("get_historical_endpoints")
      .then((eps) => {
        if (eps.length > 0) {
          setHistoricalEndpoints(eps);
          console.log(`Loaded ${eps.length} historical endpoints for heatmap`);
        }
      })
      .catch((err) => console.warn("Failed to load historical endpoints:", err));

    // Check if elevation was previously enabled
    invoke<string | null>("get_preference", { key: "elevation_enabled" })
      .then((pref) => {
        if (pref === "true") {
          invoke<boolean>("check_elevation").then((active) => {
            if (!active) {
              setElevationBanner(true);
            }
          });
        }
      })
      .catch(() => {});
  }, []); // Run once on mount — do NOT depend on startCapture

  // Show setup prompt once, 3s after first connections appear
  useEffect(() => {
    if (setupTriggered.current) return;
    if (connections.length === 0) return;
    const dismissed = localStorage.getItem("blip-setup-dismissed");
    if (dismissed === "permanent") { setupTriggered.current = true; return; }
    if (dismissed) {
      const ts = parseInt(dismissed, 10);
      if (Date.now() - ts < 7 * 24 * 60 * 60 * 1000) { setupTriggered.current = true; return; }
    }
    setupTriggered.current = true;
    const timer = setTimeout(() => setShowSetup(true), 3000);
    return () => clearTimeout(timer);
  }, [connections.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = useCallback(
    (evt: { viewState: typeof viewState }) => setViewState(evt.viewState),
    []
  );

  const markerSize = Math.round(48 + (viewState.zoom - 1.5) * (112 / 8.5));
  const zoomIn = () => mapRef.current?.zoomIn({ duration: 200 });
  const zoomOut = () => mapRef.current?.zoomOut({ duration: 200 });

  const goHome = () => {
    getLocation()
      .then((loc) => {
        setLocation(loc);
        mapRef.current?.flyTo({ center: [loc.longitude, loc.latitude], zoom: 4.5, duration: 1500 });
      })
      .catch((err) => console.error("Could not get location:", err));
  };

  const toggleCapture = async () => {
    if (capturing) { await stopCapture(); } else { await startCapture(); }
  };

  const handleEndpointSelect = useCallback((ep: EndpointData) => {
    setSelectedId(ep.id);
    startTransition(() => setSelectedEndpoint(ep));
  }, []);

  // Offset map center to account for topbar + sidebar
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map) {
      map.setPadding({ top: 48, right: sidebarWidth + 16, bottom: 0, left: 0 });
    }
  }, [sidebarWidth]);

  const handleMapClick = useCallback(() => {
    setSelectedId(null);
    startTransition(() => setSelectedEndpoint(null));
  }, []);


  return (
    <div className="app" style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
      {/* Dark glassmorphism topbar */}
      <div className="topbar" onMouseDown={() => getCurrentWindow().startDragging()}>
        <div className="topbar__left">
          <span className="topbar__isp">{selfInfo?.isp ?? "Unknown ISP"}</span>
          {selfInfo?.network_type && (
            <span className="topbar__badge">{selfInfo.network_type}</span>
          )}
          <span className="topbar__sep" />
          <span className="topbar__meta">{location?.ip ?? "—"}</span>
          <span className="topbar__sep" />
          <span className="topbar__meta">
            {location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : "Locating..."}
          </span>
        </div>
        <div className="topbar__right">
          <SegmentedControl
            options={[
              { value: "network", label: "Network" },
              { value: "firewall", label: "Firewall" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as "network" | "firewall")}
            size="md"
          />
        </div>
      </div>

      <Map
        ref={mapRef}
        {...viewState}
        onMove={onMove}
        onClick={handleMapClick}
        mapStyle={getThemeStyle(themeIndex)}
        style={{ width: "100%", height: "100%" }}
        minZoom={1.5}
        maxZoom={18}
        attributionControl={false}
      >
        {location && (
          <Marker longitude={location.longitude} latitude={location.latitude} anchor="center">
            <img src={laptopIcon} alt="My location" className="laptop-marker" style={{ width: markerSize, height: markerSize }} />
          </Marker>
        )}

        <NetworkArcLayer arcs={arcs} particles={particles} blockedMarkers={blockedMarkers} showParticles={showParticles} />
        <HeatmapLayer initialEndpoints={historicalEndpoints} visible={showHeatmap} />
        <EndpointLayer
          endpoints={endpoints}
          zoom={viewState.zoom}
          selectedId={selectedId}
          onSelect={handleEndpointSelect}
        />
      </Map>

      <Sidebar
        mode={mode}
        onWidthChange={setSidebarWidth}
        networkContent={
          selectedEndpoint ? (
            <EndpointDetail
              endpoint={selectedEndpoint}
              connections={connections}
              bandwidth={bandwidth}
              onBack={() => { setSelectedId(null); startTransition(() => setSelectedEndpoint(null)); }}
            />
          ) : (
            <>
              <div className="sidebar-tabs">
                <button className={`sidebar-tab${sidebarTab === "network" ? " sidebar-tab--active" : ""}`} onClick={() => setSidebarTab("network")}>
                  <Icon icon={activity} size="xs" />
                  Network
                </button>
                <button className={`sidebar-tab${sidebarTab === "trackers" ? " sidebar-tab--active" : ""}`} onClick={() => setSidebarTab("trackers")}>
                  <Icon icon={shieldCheck} size="xs" />
                  Trackers
                </button>
                <button className={`sidebar-tab${sidebarTab === "dns" ? " sidebar-tab--active" : ""}`} onClick={() => setSidebarTab("dns")}>
                  <Icon icon={globe} size="xs" />
                  DNS
                </button>
              </div>
              {sidebarTab === "network" ? (
                <GlobalStats connections={connections} totalEver={totalEver} bandwidth={bandwidth} />
              ) : sidebarTab === "trackers" ? (
                <TrackerStats visible={sidebarTab === "trackers"} />
              ) : (
                <DnsLog log={dnsLog} stats={dnsStats} />
              )}
            </>
          )
        }
        firewallContent={
          <FirewallContent apps={firewallApps} onSetRule={setFirewallRule} connections={connections} />
        }
      />


      {elevationBanner && (
        <div className="elevation-banner">
          <span>Elevated access expired — re-enable for full system visibility</span>
          <Button variant="primary" size="sm" onClick={async () => {
            const ok = await invoke<boolean>("request_elevation");
            if (ok) {
              setElevationBanner(false);
              await stopCapture();
              await startCapture();
            }
          }}>Enable</Button>
          <Button variant="ghost" size="sm" onClick={() => setElevationBanner(false)}>Dismiss</Button>
        </div>
      )}

      <div className="zoom-controls">
        <span className="map-btn-tooltip" data-tooltip={capturing ? "Pause" : "Start"}>
          <Button variant={capturing ? "primary" : "secondary"} size="md" icon={capturing ? pause : play} iconOnly aria-label={capturing ? "Stop capture" : "Start capture"} onClick={toggleCapture} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Heat map">
          <Button variant={showHeatmap ? "primary" : "secondary"} size="md" icon={flame} iconOnly aria-label="Toggle heat map" onClick={() => setShowHeatmap(!showHeatmap)} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Particles">
          <Button variant={showParticles ? "primary" : "secondary"} size="md" icon={sparkles} iconOnly aria-label="Toggle particles" onClick={() => setShowParticles(!showParticles)} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="My location">
          <Button variant="secondary" size="md" icon={locateFixed} iconOnly aria-label="Go to my location" onClick={goHome} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Zoom in">
          <Button variant="secondary" size="md" icon={plus} iconOnly aria-label="Zoom in" onClick={zoomIn} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Zoom out">
          <Button variant="secondary" size="md" icon={minus} iconOnly aria-label="Zoom out" onClick={zoomOut} />
        </span>
        <span className="map-btn-tooltip" data-tooltip="Settings">
          <Button variant="secondary" size="md" icon={settings} iconOnly aria-label="Settings" onClick={() => setSettingsOpen(true)} />
        </span>
      </div>

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} themeIndex={themeIndex} onThemeChange={(i) => { setThemeIndex(i); localStorage.setItem("blip-map-theme", String(i)); }} />

      {showSetup && (
        <SetupPrompt onComplete={() => {
          setShowSetup(false);
        }} />
      )}
    </div>
  );
}

export default App;
