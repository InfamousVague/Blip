import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/mapMarkers.css";
import "./styles/mapControls.css";
import "./styles/animations.css";
import "./styles/banners.css";
import "./styles/brandIcons.css";
import { Button } from "./ui/components/Button";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import { panelRightClose } from "@mattmattmattmatt/base/primitives/icon/icons/panel-right-close";
import { panelRightOpen } from "@mattmattmattmatt/base/primitives/icon/icons/panel-right-open";
import { buildAtlasStyle } from "./map/map-themes";
import { registerOfflineProtocols } from "./utils/offline-tiles";

// Initialize tile protocols before any Map renders.
// This is a module-level promise — resolves once the local tile server is detected.
const tilesReady = registerOfflineProtocols();
import { useNetworkCapture } from "./hooks/useNetworkEvents";
import { useArcAnimation } from "./hooks/useArcAnimation";
import type { EndpointData } from "./hooks/useArcAnimation";
import { useRouteTracing } from "./hooks/useRouteTracing";
import { useHeatmapData } from "./layers/HeatmapLayer";
import { RadarMinimap } from "./components/map/RadarMinimap";
import { useSpeedTest } from "./hooks/useSpeedTest";
import { Sidebar } from "./components/Sidebar";
import { GlobalStats } from "./components/stats/GlobalStats";
import { NetworkTreemapModal } from "./components/network/NetworkTreemapModal";
import { EndpointDetail } from "./components/network/EndpointDetail";
import { useBandwidth } from "./hooks/useBandwidth";
import { Settings } from "./components/settings";
import { SetupPrompt } from "./components/setup/SetupPrompt";
import { TrackerStats } from "./components/stats/TrackerStats";
import { DnsLog } from "./components/network/DnsLog";
import { FirewallContent } from "./components/firewall/FirewallSidebar";
import { PortsSidebar } from "./components/network/PortsSidebar";
import { WifiSidebar } from "./components/WifiSidebar";
import { useWifiScan } from "./hooks/useWifiScan";
import { useDnsCapture } from "./hooks/useDnsCapture";
import { useServiceBandwidth } from "./hooks/useServiceBandwidth";
import { useFirewallRules } from "./hooks/useFirewallRules";
import { useFirewallAlerts } from "./hooks/useFirewallAlerts";
import { SetupWizard } from "./components/setup/SetupWizard";
import { useListeningPorts } from "./hooks/useListeningPorts";
import { FirewallAlertOverlay } from "./components/firewall/FirewallAlertToast";
import { AlertModal } from "./components/modals/AlertModal";
import { GuideModal } from "./components/modals/GuideModal";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { Topbar } from "./ui/components/Topbar";
import { SegmentedControl } from "./ui/components/SegmentedControl";
import { UpdateBanner } from "./ui/components/UpdateBanner";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { HistoricalEndpoint, TracedRoute } from "./types/connection";
import { useUserLocation } from "./hooks/useUserLocation";
import { useMapViewState } from "./hooks/useMapViewState";
import { ControlBar } from "./components/ControlBar";
import { MapView } from "./components/map/MapView";
import "./App.css";

// Register offline tile protocols before any Map component renders
registerOfflineProtocols();

const helpCircle = `
  <circle cx="12" cy="12" r="9"></circle>
  <path d="M9.1 9.2a2.95 2.95 0 1 1 5.06 2.08c-.48.52-1.12.88-1.58 1.4-.45.5-.57.98-.57 1.82"></path>
  <circle cx="12" cy="17.2" r=".7" fill="currentColor" stroke="none"></circle>
`;

function App() {
  const { location, setLocation, selfInfo, elevationBanner, setElevationBanner } = useUserLocation();
  const { mapRef, viewState, setViewState, onMove, goHome, zoomIn, zoomOut } = useMapViewState(setLocation);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointData | null>(null);
  const [, startTransition] = useTransition();
  const [sidebarWidth, setSidebarWidth] = useState(460);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showParticles, setShowParticles] = useState(false);
  const [showHops, setShowHops] = useState(false);
  const [activeServiceFilter, setActiveServiceFilter] = useState<string | null>(null);
  const [latencyHeatmap, setLatencyHeatmap] = useState(false);
  const [showInactive, setShowInactive] = useState(true);

  // Load preferences
  useEffect(() => {
    invoke<string | null>("get_preference", { key: "route_latency_heatmap" })
      .then((v) => { if (v === "true") setLatencyHeatmap(true); })
      .catch(() => {});
    invoke<string | null>("get_preference", { key: "show_inactive" })
      .then((v) => { if (v === "false") setShowInactive(false); })
      .catch(() => {});
  }, []);
  const [mode, setMode] = useState<"network" | "guard" | "firewall" | "wifi" | "ports">("network");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [historicalEndpoints, setHistoricalEndpoints] = useState<HistoricalEndpoint[]>([]);
  const [errorModal, setErrorModal] = useState<{ title: string; description: string; detail?: string } | null>(null);
  const [treemapOpen, setTreemapOpen] = useState(false);
  const [tilesInitialized, setTilesInitialized] = useState(false);
  useEffect(() => { tilesReady.then(() => setTilesInitialized(true)); }, []);
  const mapStyle = useMemo(() => buildAtlasStyle(), [tilesInitialized]);
  const setupTriggered = useRef(false);
  const [showWizard, setShowWizard] = useState(false);
  const [neUpdateNeeded, setNeUpdateNeeded] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  // Check if first-time setup wizard needs to be shown
  useEffect(() => {
    invoke<string | null>("get_preference", { key: "firewall_wizard_completed" })
      .then((v) => {
        if (v !== "true") setShowWizard(true);
      })
      .catch(() => {});
  }, []);

  // Listen for NE version mismatch — prompt user to reinstall (unless dismissed)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("ne-version-mismatch", async () => {
        try {
          const dismissed = await invoke<string | null>("get_preference", { key: "ne_update_dismissed" });
          if (dismissed !== "true") setNeUpdateNeeded(true);
        } catch {
          setNeUpdateNeeded(true);
        }
      }).then((fn) => { unlisten = fn; });
    });
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Set initial viewState when location loads
  useEffect(() => {
    if (location) {
      setViewState((v) => ({ ...v, longitude: location.longitude, latitude: location.latitude, zoom: 4.5, pitch: 50, bearing: -8 }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location === null]); // Only fire when location goes from null to non-null

  // Load historical endpoints for heatmap (all-time data from DB)
  useEffect(() => {
    invoke<HistoricalEndpoint[]>("get_historical_endpoints")
      .then((eps) => {
        if (eps.length > 0) {
          setHistoricalEndpoints(eps);
          console.log(`Loaded ${eps.length} historical endpoints for heatmap`);
        }
      })
      .catch((err) => console.warn("Failed to load historical endpoints:", err));
  }, []);

  const { connections, totalEver, capturing, startCapture, stopCapture } = useNetworkCapture(mode);

  const userPos: [number, number] | null = location
    ? [location.longitude, location.latitude]
    : null;

  const { log: dnsLog, stats: dnsStats, blockedAttempts } = useDnsCapture(mode === "guard");
  const { tracedRoutes } = useRouteTracing();
  const [emptyRoutes] = useState<globalThis.Map<string, TracedRoute>>(() => new globalThis.Map());
  const { arcs, endpoints, particles, blockedMarkers, activeCableIds, hopMarkers, blockedFlashes, dashSegments } = useArcAnimation(connections, userPos, dnsStats.blocked_count, blockedAttempts, showHops ? tracedRoutes : emptyRoutes, activeServiceFilter, latencyHeatmap, selectedEndpoint?.id ?? null);
  const speedTest = useSpeedTest();
  const bandwidth = useBandwidth(capturing, speedTest.testing);
  const { apps: firewallApps, setRule: setFirewallRule, mode: firewallMode, setMode: setFirewallMode, deleteRuleById } = useFirewallRules();
  const { serviceSamples, serviceBreakdown, serviceColors } = useServiceBandwidth(connections, bandwidth);
  const { alerts: firewallAlerts, dismissAlert: dismissFirewallAlert } = useFirewallAlerts(firewallMode);
  const heatmapData = useHeatmapData({ initialEndpoints: historicalEndpoints, liveConnections: connections, visible: showHeatmap });
  const appUpdate = useAppUpdate();
  const { ports: listeningPorts, killProcess } = useListeningPorts(mode === "ports");
  const wifiScan = useWifiScan(mode === "wifi");

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

  // Track manual user interaction (pan/zoom) to pause auto-zoom — forwarded to MapView
  const onMoveStart = useCallback((_evt: { originalEvent?: unknown }) => {
    // User interaction tracking is handled inside MapView
  }, []);

  const handleEndpointSelect = useCallback((ep: EndpointData) => {
    setSelectedId(ep.id);
    startTransition(() => setSelectedEndpoint(ep));
  }, []);

  const handleMapClick = useCallback(() => {
    setSelectedId(null);
    startTransition(() => setSelectedEndpoint(null));
    setActiveServiceFilter(null);
  }, []);

  const filteredEndpoints = selectedEndpoint
    ? endpoints.filter((ep) => ep.id === selectedEndpoint.id)
    : activeServiceFilter
      ? endpoints.filter((ep) => ep.services.includes(activeServiceFilter))
      : endpoints;

  return (
    <div className="app" style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
      {/* Liquid glass topbar */}
      <Topbar
        isp={selfInfo?.isp}
        networkType={selfInfo?.network_type || undefined}
        ip={location?.ip}
        coordinates={location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : undefined}
        mode={mode}
        onModeChange={(v) => setMode(v as "network" | "guard" | "firewall" | "wifi" | "ports")}
        trailing={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Button
              variant="ghost"
              size="md"
              icon={sidebarCollapsed ? panelRightOpen : panelRightClose}
              iconOnly
              aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
              onClick={() => setSidebarCollapsed((v) => !v)}
            />
            <Button
              variant="ghost"
              size="md"
              icon={helpCircle}
              iconOnly
              aria-label="Open guide"
              onClick={() => setGuideOpen(true)}
            />
          </div>
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

      {neUpdateNeeded && (
        <div className="elevation-banner" style={{ background: "rgba(147, 130, 255, 0.15)", borderColor: "rgba(147, 130, 255, 0.4)" }}>
          <span>Network Extension needs updating — click Update, then approve in System Settings if prompted</span>
          <Button variant="primary" size="sm" onClick={async () => {
            try {
              try { await invoke("deactivate_network_extension"); } catch {}
              await new Promise((r) => setTimeout(r, 3000));
              await invoke("activate_network_extension");
              setNeUpdateNeeded(false);
            } catch (e) {
              console.error("NE update failed:", e);
            }
          }}>Update</Button>
          <Button variant="ghost" size="sm" onClick={() => {
            setNeUpdateNeeded(false);
            invoke("set_preference", { key: "ne_update_dismissed", value: "true" }).catch(() => {});
          }}>Dismiss</Button>
        </div>
      )}

      <MapView
        mapRef={mapRef}
        viewState={viewState}
        onMove={onMove}
        onMoveStart={onMoveStart}
        onMapClick={handleMapClick}
        mapStyle={mapStyle}
        location={location}
        userPos={userPos}
        arcs={arcs}
        endpoints={endpoints}
        filteredEndpoints={filteredEndpoints}
        particles={particles}
        blockedMarkers={blockedMarkers}
        blockedFlashes={blockedFlashes}
        activeCableIds={activeCableIds}
        hopMarkers={hopMarkers}
        dashSegments={showParticles ? dashSegments : []}
        heatmapData={heatmapData}
        showParticles={showParticles}
        showHeatmap={showHeatmap}
        showHops={showHops}
        selectedId={selectedId}
        onEndpointSelect={handleEndpointSelect}
        sidebarWidth={sidebarWidth}
      />

      <RadarMinimap endpoints={endpoints} userLocation={userPos} />

      <ControlBar
        goHome={goHome}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        showHeatmap={showHeatmap}
        setShowHeatmap={setShowHeatmap}
        showParticles={showParticles}
        setShowParticles={setShowParticles}
        showHops={showHops}
        setShowHops={setShowHops}
        latencyHeatmap={latencyHeatmap}
        setLatencyHeatmap={setLatencyHeatmap}
        onSettingsOpen={() => setSettingsOpen(true)}
      />

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
              tracedRoutes={tracedRoutes}
            />
          ) : (
            <GlobalStats connections={showInactive ? connections : connections.filter((c) => c.active)} totalEver={totalEver} bandwidth={bandwidth} serviceSamples={serviceSamples} serviceBreakdown={serviceBreakdown} serviceColors={serviceColors} downloadMbps={speedTest.downloadMbps} uploadMbps={speedTest.uploadMbps} pingMs={speedTest.pingMs} speedTesting={speedTest.testing} lastSpeedTestTime={speedTest.lastTestTime} onRunSpeedTest={speedTest.runTest} speedStage={speedTest.stage} liveDownloadMbps={speedTest.liveDownloadMbps} liveUploadMbps={speedTest.liveUploadMbps} speedPercent={speedTest.percent} activeServiceFilter={activeServiceFilter} onServiceClick={setActiveServiceFilter} onOpenTreemap={() => setTreemapOpen(true)} />
          )
        }
        guardContent={
          <>
            <TrackerStats visible={mode === "guard"} />
            <DnsLog log={dnsLog} stats={dnsStats} />
          </>
        }
        firewallContent={
          <FirewallContent apps={firewallApps} onSetRule={setFirewallRule} onDeleteRuleById={deleteRuleById} connections={connections} />
        }
        wifiContent={
          <WifiSidebar
            networks={wifiScan.networks}
            recommendation={wifiScan.recommendation}
            currentNetwork={wifiScan.currentNetwork}
            scanning={wifiScan.scanning}
            onRescan={wifiScan.rescan}
          />
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

      {neUpdateNeeded && (
        <div className="elevation-banner" style={{ background: "rgba(147, 130, 255, 0.15)", borderColor: "rgba(147, 130, 255, 0.4)" }}>
          <span>Network Extension needs updating — click Update, then approve in System Settings if prompted</span>
          <Button variant="primary" size="sm" onClick={async () => {
            try {
              // Deactivate old NE first
              try { await invoke("deactivate_network_extension"); } catch {}
              // Wait for macOS to fully unload the old extension
              await new Promise((r) => setTimeout(r, 3000));
              // Reactivate — loads new binary from current app bundle
              // This may prompt for user approval in System Settings
              await invoke("activate_network_extension");
              setNeUpdateNeeded(false);
            } catch (e) {
              console.error("NE update failed:", e);
            }
          }}>Update</Button>
          <Button variant="ghost" size="sm" onClick={() => {
            setNeUpdateNeeded(false);
            invoke("set_preference", { key: "ne_update_dismissed", value: "true" }).catch(() => {});
          }}>Dismiss</Button>
        </div>
      )}

      <ControlBar
        goHome={goHome}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        showHeatmap={showHeatmap}
        setShowHeatmap={setShowHeatmap}
        showParticles={showParticles}
        setShowParticles={setShowParticles}
        showHops={showHops}
        setShowHops={setShowHops}
        latencyHeatmap={latencyHeatmap}
        setLatencyHeatmap={setLatencyHeatmap}
        onSettingsOpen={() => setSettingsOpen(true)}
      />

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} firewallMode={firewallMode} onFirewallModeChange={setFirewallMode} />

      <NetworkTreemapModal
        open={treemapOpen}
        onClose={() => setTreemapOpen(false)}
        connections={connections}
      />

      <FirewallAlertOverlay
        alerts={firewallAlerts}
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

      {showWizard && (
        <SetupWizard onComplete={() => setShowWizard(false)} />
      )}

      <GuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />

    </div>
  );
}

export default App;
