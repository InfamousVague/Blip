import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Map, { Marker } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { Button } from "./ui/components/Button";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import { plus } from "@mattmattmattmatt/base/primitives/icon/icons/plus";
import { minus } from "@mattmattmattmatt/base/primitives/icon/icons/minus";
import { locateFixed } from "@mattmattmattmatt/base/primitives/icon/icons/locate-fixed";
import { settings } from "@mattmattmattmatt/base/primitives/icon/icons/settings";
import { buildAtlasStyle } from "./map-themes";
import { registerOfflineProtocols } from "./utils/offline-tiles";
import { useNetworkCapture } from "./hooks/useNetworkEvents";
import { useArcAnimation } from "./hooks/useArcAnimation";
import type { EndpointData } from "./hooks/useArcAnimation";
import { NetworkArcLayer } from "./layers/ArcLayer";
import { EndpointLayer } from "./layers/EndpointLayer";
import { SubmarineCableLayer } from "./layers/SubmarineCableLayer";
import { useHeatmapData } from "./layers/HeatmapLayer";
import { RadarMinimap } from "./components/RadarMinimap";
import { useSpeedTest } from "./hooks/useSpeedTest";
import { Sidebar } from "./components/Sidebar";
import { GlobalStats } from "./components/GlobalStats";
import { EndpointDetail } from "./components/EndpointDetail";
import { useBandwidth } from "./hooks/useBandwidth";
import { Settings } from "./components/settings";
import { SetupPrompt } from "./components/SetupPrompt";
import { TrackerStats } from "./components/TrackerStats";
import { DnsLog } from "./components/DnsLog";
import { FirewallContent } from "./components/FirewallSidebar";
import { PortsSidebar } from "./components/PortsSidebar";
import { useDnsCapture } from "./hooks/useDnsCapture";
import { useServiceBandwidth } from "./hooks/useServiceBandwidth";
import { useFirewallRules } from "./hooks/useFirewallRules";
import { useFirewallAlerts } from "./hooks/useFirewallAlerts";
import { useListeningPorts } from "./hooks/useListeningPorts";
import { FirewallAlertOverlay } from "./components/FirewallAlertToast";
import { ConnectionRequestModal } from "./components/modals/ConnectionRequestModal";
import { AlertModal } from "./components/modals/AlertModal";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { Topbar } from "./ui/components/Topbar";
import { SegmentedControl } from "./ui/components/SegmentedControl";
import { UpdateBanner } from "./ui/components/UpdateBanner";
import { flame } from "@mattmattmattmatt/base/primitives/icon/icons/flame";
import { sparkles } from "@mattmattmattmatt/base/primitives/icon/icons/sparkles";
import { panelRightClose } from "@mattmattmattmatt/base/primitives/icon/icons/panel-right-close";
import { panelRightOpen } from "@mattmattmattmatt/base/primitives/icon/icons/panel-right-open";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { HistoricalEndpoint, SelfIpInfo } from "./types/connection";
import "./App.css";

type Location = { longitude: number; latitude: number; source: string; ip?: string };

// Register offline tile protocols before any Map component renders
registerOfflineProtocols();

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
  const [viewState, setViewState] = useState({ longitude: 0, latitude: 20, zoom: 2, pitch: 50, bearing: -8 });
  const [location, setLocation] = useState<Location | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointData | null>(null);
  const [, startTransition] = useTransition();
  const [sidebarWidth, setSidebarWidth] = useState(460);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showParticles, setShowParticles] = useState(true);
  const [mode, setMode] = useState<"network" | "firewall" | "ports">("network");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"network" | "trackers" | "dns">("network");
  const [historicalEndpoints, setHistoricalEndpoints] = useState<HistoricalEndpoint[]>([]);
  const [selfInfo, setSelfInfo] = useState<SelfIpInfo | null>(null);
  const [elevationBanner, setElevationBanner] = useState(false);
  const [errorModal, setErrorModal] = useState<{ title: string; description: string; detail?: string } | null>(null);
  const mapStyle = useMemo(() => buildAtlasStyle(), []);
  const setupTriggered = useRef(false);

  const { connections, totalEver, capturing, startCapture, stopCapture } = useNetworkCapture(sidebarTab);

  const userPos: [number, number] | null = location
    ? [location.longitude, location.latitude]
    : null;

  const { log: dnsLog, stats: dnsStats, blockedAttempts } = useDnsCapture(sidebarTab === "dns");
  const { arcs, endpoints, particles, blockedMarkers, activeCableIds } = useArcAnimation(connections, userPos, dnsStats.blocked_count, blockedAttempts);
  const bandwidth = useBandwidth(capturing);
  const { apps: firewallApps, setRule: setFirewallRule, mode: firewallMode, setMode: setFirewallMode, deleteRuleById } = useFirewallRules();
  const { serviceSamples, serviceBreakdown, serviceColors } = useServiceBandwidth(connections, bandwidth);
  const { alerts: firewallAlerts, dismissAlert: dismissFirewallAlert } = useFirewallAlerts(firewallMode);
  const speedTest = useSpeedTest();
  const heatmapData = useHeatmapData({ initialEndpoints: historicalEndpoints, liveConnections: connections, visible: showHeatmap });
  const appUpdate = useAppUpdate();
  const { ports: listeningPorts, killProcess } = useListeningPorts(mode === "ports");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    getLocation()
      .then((loc) => {
        setLocation(loc);
        setViewState((v) => ({ ...v, longitude: loc.longitude, latitude: loc.latitude, zoom: 4.5, pitch: 50, bearing: -8 }));
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

  // The first alert in the queue is the active one — no separate state needed
  const activeAlert = firewallAlerts.length > 0 ? firewallAlerts[0] : null;

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

  const zoomIn = () => mapRef.current?.zoomIn({ duration: 200 });
  const zoomOut = () => mapRef.current?.zoomOut({ duration: 200 });

  const goHome = () => {
    getLocation()
      .then((loc) => {
        setLocation(loc);
        mapRef.current?.flyTo({ center: [loc.longitude, loc.latitude], zoom: 4.5, pitch: 50, bearing: -8, duration: 1500 });
      })
      .catch((err) => console.error("Could not get location:", err));
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

  // Auto-zoom out when endpoints appear outside the current viewport
  const seenEndpointIds = useRef(new Set<string>());
  const userInteractedAt = useRef(0);
  const autoZoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track manual user interaction (pan/zoom) to pause auto-zoom
  const onMoveStart = useCallback((evt: any) => {
    // Only count as user interaction if it originated from user input (not flyTo)
    if (evt.originalEvent) {
      userInteractedAt.current = Date.now();
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !location || endpoints.length === 0) return;

    // Don't auto-zoom if user interacted in the last 8 seconds
    if (Date.now() - userInteractedAt.current < 8000) return;

    // Find endpoints we haven't seen yet
    const newEndpoints = endpoints.filter((ep) => !seenEndpointIds.current.has(ep.id));
    if (newEndpoints.length === 0) return;

    // Mark them as seen
    for (const ep of newEndpoints) {
      seenEndpointIds.current.add(ep.id);
    }

    // Check if any new endpoints are outside the current viewport bounds
    const bounds = map.getBounds();
    const outOfView = newEndpoints.filter((ep) => {
      const [lon, lat] = ep.position;
      return !bounds.contains([lon, lat]);
    });

    if (outOfView.length === 0) return;

    // Debounce: batch endpoints that arrive within 1.5s
    if (autoZoomTimer.current) clearTimeout(autoZoomTimer.current);
    autoZoomTimer.current = setTimeout(() => {
      const map = mapRef.current?.getMap();
      if (!map || !location) return;

      // Don't auto-zoom if user interacted while we were debouncing
      if (Date.now() - userInteractedAt.current < 8000) return;

      // Build bounding box: user location + all known endpoints
      let minLon = location.longitude;
      let maxLon = location.longitude;
      let minLat = location.latitude;
      let maxLat = location.latitude;

      for (const ep of endpoints) {
        const [lon, lat] = ep.position;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }

      // Add padding to the bounds (10% on each side)
      const lonPad = Math.max((maxLon - minLon) * 0.1, 2);
      const latPad = Math.max((maxLat - minLat) * 0.1, 1);

      // Only zoom out, never in — compare against current zoom
      const currentZoom = map.getZoom();

      map.fitBounds(
        [[minLon - lonPad, minLat - latPad], [maxLon + lonPad, maxLat + latPad]],
        {
          maxZoom: currentZoom, // never zoom in past current level
          duration: 2000,
          padding: { top: 56, right: sidebarWidth + 24, bottom: 24, left: 24 },
        },
      );
    }, 1500);

    return () => {
      if (autoZoomTimer.current) clearTimeout(autoZoomTimer.current);
    };
  }, [endpoints, location, sidebarWidth]);

  const handleMapClick = useCallback(() => {
    setSelectedId(null);
    startTransition(() => setSelectedEndpoint(null));
  }, []);


  return (
    <div className="app" style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
      {/* Liquid glass topbar */}
      <Topbar
        isp={selfInfo?.isp}
        networkType={selfInfo?.network_type || undefined}
        ip={location?.ip}
        coordinates={location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : undefined}
        mode={mode}
        onModeChange={(v) => setMode(v as "network" | "firewall" | "ports")}
        trailing={
          <Button
            variant="ghost"
            size="md"
            icon={sidebarCollapsed ? panelRightOpen : panelRightClose}
            iconOnly
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            onClick={() => setSidebarCollapsed((v) => !v)}
          />
        }
        onMouseDown={() => getCurrentWindow().startDragging()}
      />

      {/* Update banner */}
      {appUpdate.available && appUpdate.updateInfo && (
        <UpdateBanner
          version={`v${appUpdate.updateInfo.version}`}
          onUpdate={appUpdate.installUpdate}
          onLater={appUpdate.dismiss}
          downloading={appUpdate.downloading}
          progress={appUpdate.progress ?? undefined}
        />
      )}

      <Map
        ref={mapRef}
        {...viewState}
        onMove={onMove}
        onMoveStart={onMoveStart}
        onClick={handleMapClick}
        mapStyle={mapStyle}
        style={{ width: "100%", height: "100%" }}
        minZoom={1.5}
        maxZoom={8}
        minPitch={50}
        maxPitch={50}
        attributionControl={false}
      >
        {location && (
          <Marker longitude={location.longitude} latitude={location.latitude} anchor="center">
            <div className="waypoint-marker">
              <svg viewBox="0 0 40 56" className="waypoint-marker__gem">
                <defs>
                  <linearGradient id="gem-fill" x1="20" y1="0" x2="20" y2="56" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                    <stop offset="40%" stopColor="#e0e0ff" stopOpacity="0.7" />
                    <stop offset="100%" stopColor="#a0a0cc" stopOpacity="0.4" />
                  </linearGradient>
                  <linearGradient id="gem-edge" x1="20" y1="0" x2="20" y2="56" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                    <stop offset="100%" stopColor="#ccccee" stopOpacity="0.6" />
                  </linearGradient>
                  <filter id="gem-glow">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {/* Bottom spike (long) */}
                <polygon points="20,56 6,18 20,22" fill="url(#gem-fill)" opacity="0.5" />
                <polygon points="20,56 34,18 20,22" fill="url(#gem-fill)" opacity="0.35" />
                {/* Top crown (short) */}
                <polygon points="20,0 6,18 20,22" fill="url(#gem-fill)" opacity="0.8" />
                <polygon points="20,0 34,18 20,22" fill="url(#gem-fill)" opacity="0.65" />
                {/* Left face highlight */}
                <polygon points="20,0 6,18 20,56" fill="none" stroke="url(#gem-edge)" strokeWidth="0.8" strokeLinejoin="round" />
                {/* Right face */}
                <polygon points="20,0 34,18 20,56" fill="none" stroke="url(#gem-edge)" strokeWidth="0.8" strokeLinejoin="round" />
                {/* Center seam */}
                <line x1="20" y1="0" x2="20" y2="56" stroke="white" strokeWidth="0.4" opacity="0.3" />
                {/* Equator line */}
                <line x1="6" y1="18" x2="34" y2="18" stroke="white" strokeWidth="0.6" opacity="0.5" />
              </svg>
              <div className="waypoint-marker__ring" />
            </div>
          </Marker>
        )}

        <SubmarineCableLayer activeCableIds={activeCableIds} />
        <NetworkArcLayer arcs={arcs} particles={particles} blockedMarkers={blockedMarkers} showParticles={showParticles} heatmapData={heatmapData} showHeatmap={showHeatmap} endpoints={endpoints} userLocation={userPos} />
        <EndpointLayer
          endpoints={endpoints}
          zoom={viewState.zoom}
          selectedId={selectedId}
          onSelect={handleEndpointSelect}
          userLocation={userPos}
        />
      </Map>

      <RadarMinimap endpoints={endpoints} userLocation={userPos} />

      <Sidebar
        mode={mode}
        collapsed={sidebarCollapsed}
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
              <SegmentedControl
                options={[
                  { value: "network", label: "Network" },
                  { value: "trackers", label: "Trackers" },
                  { value: "dns", label: "DNS" },
                ]}
                value={sidebarTab}
                onChange={(v) => setSidebarTab(v as "network" | "trackers" | "dns")}
                size="md"
              />
              {sidebarTab === "network" ? (
                <GlobalStats connections={connections} totalEver={totalEver} bandwidth={bandwidth} serviceSamples={serviceSamples} serviceBreakdown={serviceBreakdown} serviceColors={serviceColors} downloadMbps={speedTest.downloadMbps} uploadMbps={speedTest.uploadMbps} pingMs={speedTest.pingMs} speedTesting={speedTest.testing} lastSpeedTestTime={speedTest.lastTestTime} onRunSpeedTest={speedTest.runTest} speedStage={speedTest.stage} liveDownloadMbps={speedTest.liveDownloadMbps} liveUploadMbps={speedTest.liveUploadMbps} speedPercent={speedTest.percent} />
              ) : sidebarTab === "trackers" ? (
                <TrackerStats visible={sidebarTab === "trackers"} />
              ) : (
                <DnsLog log={dnsLog} stats={dnsStats} />
              )}
            </>
          )
        }
        firewallContent={
          <FirewallContent apps={firewallApps} onSetRule={setFirewallRule} onDeleteRuleById={deleteRuleById} connections={connections} />
        }
        portsContent={
          <PortsSidebar ports={listeningPorts} onKill={killProcess} />
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

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} firewallMode={firewallMode} onFirewallModeChange={setFirewallMode} />

      <FirewallAlertOverlay
        alerts={firewallAlerts.filter((a) => !activeAlert || a.id !== activeAlert.id)}
        onAllow={(alert) => {
          setFirewallRule(alert.appId, alert.appId, "allow");
          dismissFirewallAlert(alert.id);
        }}
        onDeny={(alert) => {
          setFirewallRule(alert.appId, alert.appId, "deny");
          dismissFirewallAlert(alert.id);
        }}
        onDismiss={dismissFirewallAlert}
      />

      <ConnectionRequestModal
        alert={activeAlert}
        queueLength={firewallAlerts.length}
        onAllow={(alert, remember) => {
          setFirewallRule(alert.appId, alert.appId, "allow", remember ? { lifetime: "permanent" } : undefined);
          dismissFirewallAlert(alert.id);
        }}
        onDeny={(alert, remember) => {
          setFirewallRule(alert.appId, alert.appId, "deny", remember ? { lifetime: "permanent" } : undefined);
          dismissFirewallAlert(alert.id);
        }}
        onDismiss={() => {
          if (activeAlert) dismissFirewallAlert(activeAlert.id);
        }}
      />

      {errorModal && (
        <AlertModal
          open
          onClose={() => setErrorModal(null)}
          variant="error"
          title={errorModal.title}
          description={errorModal.description}
          detail={errorModal.detail}
        />
      )}

      {showSetup && (
        <SetupPrompt onComplete={() => {
          setShowSetup(false);
        }} />
      )}

    </div>
  );
}

export default App;
