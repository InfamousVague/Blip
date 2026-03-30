import { useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EndpointData } from "../hooks/useArcAnimation";
import radarWorld from "../assets/radar-world.json";
import "./RadarMinimap.css";

const SIZE = 180;
const DPR = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
const PX = SIZE * DPR;
const CENTER = PX / 2;
const RADIUS = CENTER - 8 * DPR;
const ROTATION_MS = 8000;
const SWEEP_TRAIL_RAD = 0.52;
const TWO_PI = Math.PI * 2;
const PAD = 1.3;

interface Props {
  endpoints: EndpointData[];
  userLocation: [number, number] | null;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const worldPolygons = radarWorld as number[][][][];

export function RadarMinimap({ endpoints, userLocation }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  // Compute bounds centered on user, sized to fit all endpoints
  const bounds = useMemo(() => {
    if (!userLocation) return { cLon: 0, cLat: 0, halfSpan: 90 };
    const [uLon, uLat] = userLocation;
    let maxDist = 10; // minimum half-span in degrees
    for (const ep of endpoints) {
      const [lon, lat] = ep.position;
      if (lon === 0 && lat === 0) continue;
      const dLon = Math.abs(lon - uLon);
      const dLat = Math.abs(lat - uLat);
      const dist = Math.max(dLon, dLat);
      if (dist > maxDist) maxDist = dist;
    }
    // Cap at 90° so the map never zooms out past showing the full continents
    return { cLon: uLon, cLat: uLat, halfSpan: Math.min(maxDist * PAD, 90) };
  }, [endpoints, userLocation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mapSize = RADIUS * 1.7;

    // Project lon/lat to canvas — user is always at center
    const project = (lon: number, lat: number): [number, number] => {
      const x = ((lon - bounds.cLon) / (bounds.halfSpan * 2)) * mapSize + CENTER;
      const y = ((bounds.cLat - lat) / (bounds.halfSpan * 2)) * mapSize + CENTER;
      return [x, y];
    };

    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      if (document.hidden) return;

      const now = performance.now();
      const sweepAngle = ((now / ROTATION_MS) * TWO_PI) % TWO_PI;
      const sweepCanvasAngle = sweepAngle - Math.PI / 2;

      ctx.clearRect(0, 0, PX, PX);

      // Clip to circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, RADIUS + 4 * DPR, 0, TWO_PI);
      ctx.clip();

      // Background
      ctx.fillStyle = "rgba(10, 10, 14, 0.55)";
      ctx.fillRect(0, 0, PX, PX);

      // Draw continent fills
      ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 0.5 * DPR;
      for (const polygon of worldPolygons) {
        if (!polygon[0] || polygon[0].length < 3) continue;
        ctx.beginPath();
        const outer = polygon[0];
        const [sx, sy] = project(outer[0][0], outer[0][1]);
        ctx.moveTo(sx, sy);
        for (let i = 1; i < outer.length; i++) {
          const [px, py] = project(outer[i][0], outer[i][1]);
          ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Range rings
      for (const frac of [0.33, 0.66, 1.0]) {
        ctx.beginPath();
        ctx.arc(CENTER, CENTER, RADIUS * frac, 0, TWO_PI);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
        ctx.lineWidth = DPR;
        ctx.stroke();
      }

      // Crosshairs
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      ctx.lineWidth = DPR;
      ctx.beginPath();
      ctx.moveTo(CENTER, CENTER - RADIUS);
      ctx.lineTo(CENTER, CENTER + RADIUS);
      ctx.moveTo(CENTER - RADIUS, CENTER);
      ctx.lineTo(CENTER + RADIUS, CENTER);
      ctx.stroke();

      // Sweep trail wedge
      const trailStart = sweepCanvasAngle - SWEEP_TRAIL_RAD;
      const trailEnd = sweepCanvasAngle;
      const grad = ctx.createConicGradient(trailStart, CENTER, CENTER);
      const span = SWEEP_TRAIL_RAD / TWO_PI;
      grad.addColorStop(0, "rgba(255, 255, 255, 0)");
      grad.addColorStop(span * 0.5, "rgba(255, 255, 255, 0.03)");
      grad.addColorStop(span, "rgba(255, 255, 255, 0.08)");
      grad.addColorStop(span + 0.001, "rgba(255, 255, 255, 0)");
      ctx.beginPath();
      ctx.moveTo(CENTER, CENTER);
      ctx.arc(CENTER, CENTER, RADIUS, trailStart, trailEnd);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Sweep line
      const lineX = CENTER + Math.cos(sweepCanvasAngle) * RADIUS;
      const lineY = CENTER + Math.sin(sweepCanvasAngle) * RADIUS;
      ctx.beginPath();
      ctx.moveTo(CENTER, CENTER);
      ctx.lineTo(lineX, lineY);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1.5 * DPR;
      ctx.stroke();

      // Endpoint dots
      if (userLocation) {
        const [userLon, userLat] = userLocation;

        for (const ep of endpoints) {
          const [epLon, epLat] = ep.position;
          const [dotX, dotY] = project(epLon, epLat);

          // Check if inside the circle
          const dx = dotX - CENTER;
          const dy = dotY - CENTER;
          if (dx * dx + dy * dy > RADIUS * RADIUS) continue;

          // How far (in radians) the sweep has traveled PAST this dot
          const dotAngle = Math.atan2(dotY - CENTER, dotX - CENTER);
          let trail = ((sweepCanvasAngle - dotAngle) % TWO_PI + TWO_PI) % TWO_PI;

          // Fade: bright at 0 (just swept), fades to 0 at ~95% of full revolution
          const fadeProgress = trail / (TWO_PI * 0.95);
          const alpha = Math.max(0, 1 - fadeProgress);

          const color = ep.connectionDetails[0]?.color || "#8b8b9a";
          const [cr, cg, cb] = hexToRgb(color);

          // Glow ring when freshly swept (first ~15°)
          if (trail < 0.25) {
            const glowFade = 1 - trail / 0.25;
            const glowRadius = (4 + glowFade * 6) * DPR;
            ctx.beginPath();
            ctx.arc(dotX, dotY, glowRadius, 0, TWO_PI);
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.25 * glowFade})`;
            ctx.fill();
          }

          // Dot — size pulses on sweep, fades over full rotation
          const freshness = trail < 0.25 ? 1 - trail / 0.25 : 0;
          const dotRadius = (2 + freshness * 2) * DPR;
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotRadius, 0, TWO_PI);
          ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
          ctx.fill();
        }

        // User location dot (always bright)
        const [ux, uy] = project(userLon, userLat);
        ctx.beginPath();
        ctx.arc(ux, uy, 2.5 * DPR, 0, TWO_PI);
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fill();
      }

      // Border ring
      ctx.restore();
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, RADIUS + 4 * DPR, 0, TWO_PI);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 1.5 * DPR;
      ctx.stroke();

    };

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [endpoints, userLocation, bounds]);

  // Dock icon: render a separate offscreen canvas at 128x128, send PNG to native dock
  const dockRafRef = useRef(0);
  useEffect(() => {
    const ICON = 256; // 2x for retina dock
    const IC = ICON / 2;
    const IR = IC - 6;
    const offscreen = document.createElement("canvas");
    offscreen.width = ICON;
    offscreen.height = ICON;
    const dctx = offscreen.getContext("2d");
    if (!dctx) return;

    let sending = false;
    let lastSend = 0;

    const renderDock = () => {
      dockRafRef.current = requestAnimationFrame(renderDock);

      const now = performance.now();
      // Throttle to ~8fps
      if (now - lastSend < 125) return;
      if (sending) return;

      const sweepAngle = ((now / ROTATION_MS) * TWO_PI) % TWO_PI;
      const sweepCA = sweepAngle - Math.PI / 2;

      dctx.clearRect(0, 0, ICON, ICON);

      // Background circle
      dctx.beginPath();
      dctx.arc(IC, IC, IR, 0, TWO_PI);
      dctx.fillStyle = "rgba(8, 8, 12, 1)";
      dctx.fill();

      // Continent fills — zoomed in more, higher contrast
      if (userLocation) {
        const dockMapSize = IR * 2.2;
        const dockProject = (lon: number, lat: number): [number, number] => {
          const span = bounds.halfSpan * 2;
          return [
            ((lon - bounds.cLon) / span) * dockMapSize + IC,
            ((bounds.cLat - lat) / span) * dockMapSize + IC,
          ];
        };

        // Save + clip to circle
        dctx.save();
        dctx.beginPath();
        dctx.arc(IC, IC, IR, 0, TWO_PI);
        dctx.clip();

        dctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        dctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        dctx.lineWidth = 1;
        for (const polygon of worldPolygons) {
          if (!polygon[0] || polygon[0].length < 3) continue;
          dctx.beginPath();
          const outer = polygon[0];
          const [sx, sy] = dockProject(outer[0][0], outer[0][1]);
          dctx.moveTo(sx, sy);
          for (let i = 1; i < outer.length; i++) {
            const [px, py] = dockProject(outer[i][0], outer[i][1]);
            dctx.lineTo(px, py);
          }
          dctx.closePath();
          dctx.fill();
          dctx.stroke();
        }

        // Sweep trail
        const trailStart = sweepCA - SWEEP_TRAIL_RAD;
        dctx.beginPath();
        dctx.moveTo(IC, IC);
        dctx.arc(IC, IC, IR, trailStart, sweepCA);
        dctx.closePath();
        dctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        dctx.fill();

        // Sweep line
        dctx.beginPath();
        dctx.moveTo(IC, IC);
        dctx.lineTo(IC + Math.cos(sweepCA) * IR, IC + Math.sin(sweepCA) * IR);
        dctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        dctx.lineWidth = 2;
        dctx.stroke();

        // Endpoint dots — bigger for dock visibility
        for (const ep of endpoints) {
          const [epLon, epLat] = ep.position;
          const [dotX, dotY] = dockProject(epLon, epLat);
          const dx = dotX - IC;
          const dy = dotY - IC;
          if (dx * dx + dy * dy > IR * IR) continue;

          const dotAngle = Math.atan2(dotY - IC, dotX - IC);
          let trail = ((sweepCA - dotAngle) % TWO_PI + TWO_PI) % TWO_PI;
          const alpha = Math.max(0, 1 - trail / (TWO_PI * 0.95));
          const color = ep.connectionDetails[0]?.color || "#8b8b9a";
          const [cr, cg, cb] = hexToRgb(color);

          // Bigger dots for dock icon
          const dotR = trail < 0.25 ? 5 : 3;
          dctx.beginPath();
          dctx.arc(dotX, dotY, dotR, 0, TWO_PI);
          dctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${Math.max(alpha, 0.15)})`;
          dctx.fill();
        }

        // User dot
        const [ux, uy] = dockProject(userLocation[0], userLocation[1]);
        dctx.beginPath();
        dctx.arc(ux, uy, 4, 0, TWO_PI);
        dctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        dctx.fill();

        dctx.restore();
      }

      // Border
      dctx.beginPath();
      dctx.arc(IC, IC, IR, 0, TWO_PI);
      dctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      dctx.lineWidth = 2;
      dctx.stroke();

      // Send to dock
      lastSend = now;
      sending = true;
      offscreen.toBlob((blob) => {
        if (!blob) { sending = false; return; }
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          if (base64) {
            invoke("update_dock_icon", { pngBase64: base64 }).catch(() => {}).finally(() => { sending = false; });
          } else {
            sending = false;
          }
        };
        reader.readAsDataURL(blob);
      }, "image/png");
    };

    dockRafRef.current = requestAnimationFrame(renderDock);
    return () => cancelAnimationFrame(dockRafRef.current);
  }, [endpoints, userLocation, bounds]);

  return (
    <div className="radar-minimap">
      <canvas
        ref={canvasRef}
        width={PX}
        height={PX}
        style={{ width: SIZE, height: SIZE, display: "block" }}
      />
    </div>
  );
}
