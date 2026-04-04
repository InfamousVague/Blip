import { useState, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { FrostedCard } from "../ui/glass";
import { SegmentedControl } from "../ui/components/SegmentedControl";
import { CollapsibleSection } from "../ui/components/CollapsibleSection";
import { StatCard } from "../ui/components/StatCard";
import type { WifiNetwork, ChannelRecommendation } from "../types/wifi";
import "./WifiSidebar.css";

const PALETTE = ["#8b5cf6", "#06b6d4", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#14b8a6", "#f97316", "#6366f1"];

interface Props {
  networks: WifiNetwork[];
  recommendation: ChannelRecommendation | null;
  currentNetwork: WifiNetwork | null;
  scanning: boolean;
  onRescan: () => void;
}

function signalColor(dbm: number): string {
  if (dbm >= -50) return "var(--blip-success)";
  if (dbm >= -60) return "#22c55e";
  if (dbm >= -70) return "var(--blip-warning)";
  if (dbm >= -80) return "#f97316";
  return "var(--blip-error)";
}

function signalLevel(dbm: number): number {
  if (dbm >= -50) return 4;
  if (dbm >= -60) return 3;
  if (dbm >= -70) return 2;
  if (dbm >= -80) return 1;
  return 0;
}

function WifiBarsIcon({ dbm, size = 20 }: { dbm: number; size?: number }) {
  const level = signalLevel(dbm);
  const color = signalColor(dbm);
  const dim = "rgba(255,255,255,0.08)";
  // WiFi wave arcs radiating from bottom-center dot
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Dot at bottom */}
      <circle cx="12" cy="19" r="1.5" fill={level >= 1 ? color : dim} />
      {/* Inner arc */}
      <path d="M8.5 15.5a5 5 0 0 1 7 0" stroke={level >= 2 ? color : dim} strokeWidth="2" fill="none" />
      {/* Middle arc */}
      <path d="M5.5 12.5a9 9 0 0 1 13 0" stroke={level >= 3 ? color : dim} strokeWidth="2" fill="none" />
      {/* Outer arc */}
      <path d="M2.5 9.5a13 13 0 0 1 19 0" stroke={level >= 4 ? color : dim} strokeWidth="2" fill="none" />
    </svg>
  );
}

function congestionLabel(score: number): { text: string; color: string } {
  if (score < 0.001) return { text: "Clear", color: "var(--blip-success)" };
  if (score < 0.01) return { text: "Low", color: "#22c55e" };
  if (score < 0.1) return { text: "Moderate", color: "var(--blip-warning)" };
  return { text: "High", color: "var(--blip-error)" };
}

function SpectrumMini({ networks, band }: { networks: WifiNetwork[]; band: string }) {
  const filtered = networks.filter((n) => n.band === band);
  const channels = band === "5GHz"
    ? [36, 40, 44, 48, 149, 153, 157, 161, 165]
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

  const data = useMemo(() => {
    const chartData = channels.map((ch) => ({ channel: ch } as Record<string, number>));
    filtered.forEach((net, i) => {
      const key = net.ssid || net.bssid || `net-${i}`;
      const sigma = band === "5GHz" ? (net.channel_width / 20) * 2 : (net.channel_width / 20) * 1.2;
      for (const row of chartData) {
        const dist = Math.abs(row.channel - net.channel);
        const value = Math.abs(net.signal_dbm) * Math.exp(-0.5 * (dist / Math.max(sigma, 0.5)) ** 2);
        row[key] = -value;
      }
    });
    return { chartData, keys: filtered.map((n, i) => n.ssid || n.bssid || `net-${i}`) };
  }, [filtered, band]);

  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={data.chartData} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
        <XAxis dataKey="channel" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} />
        <YAxis hide domain={[-100, -20]} />
        {data.keys.map((key, i) => (
          <Area key={key} type="monotone" dataKey={key} stroke={PALETTE[i % PALETTE.length]}
            fill={PALETTE[i % PALETTE.length]} fillOpacity={0.12} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function WifiSidebar({ networks, recommendation, currentNetwork, scanning, onRescan }: Props) {
  const [band, setBand] = useState<"2.4GHz" | "5GHz">("2.4GHz");
  const [selectedBssid, setSelectedBssid] = useState<string | null>(null);

  const filtered = networks.filter((n) => n.band === band);
  const sorted = [...filtered].sort((a, b) => b.signal_dbm - a.signal_dbm);
  const selectedNetwork = networks.find((n) => n.bssid === selectedBssid);

  const count2g = networks.filter((n) => n.band === "2.4GHz").length;
  const count5g = networks.filter((n) => n.band === "5GHz").length;

  const rec = band === "2.4GHz" ? recommendation?.band_2g : recommendation?.band_5g;

  return (
    <>
      {/* Stats */}
      <StatCard stats={[
        { label: "NETWORKS", value: networks.length, minDigits: 3 },
        { label: "2.4 GHZ", value: count2g, minDigits: 2 },
        { label: "5 GHZ", value: count5g, minDigits: 2 },
      ]} />

      {/* Current connection */}
      {currentNetwork && (
        <FrostedCard gap={4} padding={12}>
          <div className="wifi-current">
            <span className="wifi-current__dot" />
            <span className="wifi-current__ssid">{currentNetwork.ssid || "(Hidden)"}</span>
            <span className="wifi-current__detail">Ch {currentNetwork.channel} · {currentNetwork.signal_dbm} dBm · {currentNetwork.band}</span>
          </div>
        </FrostedCard>
      )}

      {/* Band toggle */}
      <SegmentedControl
        options={[
          { value: "2.4GHz", label: `2.4 GHz (${count2g})` },
          { value: "5GHz", label: `5 GHz (${count5g})` },
        ]}
        value={band}
        onChange={(v) => setBand(v as "2.4GHz" | "5GHz")}
        size="md"
        style={{ width: "100%" }}
      />

      {/* Recommendation — top 3 best channels */}
      {recommendation && (() => {
        const allScores = band === "2.4GHz" ? recommendation.all_channels_2g : recommendation.all_channels_5g;
        const top3 = [...allScores].sort((a, b) => a.score - b.score).slice(0, 3);
        const currentCh = currentNetwork?.band === band ? currentNetwork.channel : null;
        return (
          <FrostedCard gap={8} padding={14}>
            <span className="wifi-rec__label">Best Channels</span>
            {top3.map((ch, i) => {
              const isCurrentCh = currentCh === ch.channel;
              const cong = congestionLabel(ch.score);
              return (
                <div key={ch.channel} className={`wifi-rec__entry ${isCurrentCh ? "wifi-rec__entry--current" : ""}`}>
                  <div className="wifi-rec__rank">{i + 1}</div>
                  <div className="wifi-rec__entry-info">
                    <span className="wifi-rec__entry-channel">Ch {ch.channel}</span>
                    {isCurrentCh && <span className="wifi-rec__current-badge">Current</span>}
                  </div>
                  <span className="wifi-rec__entry-score" style={{ color: cong.color }}>{cong.text}</span>
                </div>
              );
            })}
            {currentCh && !top3.some((c) => c.channel === currentCh) && (
              <span className="wifi-rec__hint">You're on Ch {currentCh} — consider switching to Ch {top3[0]?.channel}</span>
            )}
            {currentCh && top3[0]?.channel === currentCh && (
              <span className="wifi-rec__hint wifi-rec__hint--good">You're on the best channel</span>
            )}
          </FrostedCard>
        );
      })()}

      {/* Spectrum chart */}
      <CollapsibleSection title="Channel Spectrum" count={filtered.length}>
        <SpectrumMini networks={networks} band={band} />
      </CollapsibleSection>

      {/* Network list */}
      <CollapsibleSection title="Networks" count={filtered.length}>
        {sorted.map((net) => (
          <div
            key={net.bssid}
            className={`wifi-net-row ${net.bssid === selectedBssid ? "wifi-net-row--selected" : ""} ${net.is_current ? "wifi-net-row--current" : ""}`}
            onClick={() => setSelectedBssid(net.bssid === selectedBssid ? null : net.bssid)}
          >
            <div className="wifi-net-row__main">
              <WifiBarsIcon dbm={net.signal_dbm} />
              <div className="wifi-net-row__info">
                <span className="wifi-net-row__ssid">{net.ssid || "(Hidden)"}</span>
                <span className="wifi-net-row__meta">
                  Ch {net.channel} · {net.signal_dbm} dBm · {net.security}
                </span>
              </div>
            </div>
            {selectedBssid === net.bssid && (
              <div className="wifi-net-row__detail">
                <span>BSSID: {net.bssid || "N/A"}</span>
                <span>Frequency: {net.frequency_mhz} MHz</span>
                <span>Width: {net.channel_width} MHz</span>
                {net.noise_dbm != null && <span>Noise: {net.noise_dbm} dBm</span>}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--blip-text-tertiary)" }}>
            {scanning ? "Scanning..." : "No networks found on this band"}
          </span>
        )}
      </CollapsibleSection>
    </>
  );
}
