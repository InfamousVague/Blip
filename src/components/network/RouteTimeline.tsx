/**
 * RouteTimeline — Vertical timeline showing each hop in a traced route.
 * Color-coded by latency: green (fast) → yellow → red (slow).
 */

import type { TracerouteHop, TracedRoute } from "../../types/connection";
import "./RouteTimeline.css";

interface Props {
  route: TracedRoute;
  /** Destination info from the connection (GeoIP-resolved) */
  destination?: {
    city?: string | null;
    country?: string | null;
    ip?: string;
    domain?: string | null;
  };
}

function rttColor(rttMs: number | null): string {
  if (rttMs == null) return "var(--blip-text-tertiary)";
  if (rttMs < 30) return "var(--blip-success)";
  if (rttMs < 100) return "var(--blip-warning)";
  if (rttMs < 200) return "#f97316"; // orange
  return "var(--blip-error)";
}

function rttLabel(rttMs: number | null): string {
  if (rttMs == null) return "—";
  if (rttMs < 1) return "<1ms";
  return `${Math.round(rttMs)}ms`;
}

export function RouteTimeline({ route, destination }: Props) {
  const hops = route.hops.filter((h) => h.ip != null);
  if (hops.length === 0) return <span className="rt-empty">No hops traced</span>;

  // Calculate total latency (last hop RTT)
  const lastRtt = hops[hops.length - 1]?.rtt_ms;

  return (
    <div className="rt">
      <div className="rt__header">
        <span className="rt__stat">{hops.length} hops</span>
        {lastRtt != null && (
          <span className="rt__stat" style={{ color: rttColor(lastRtt) }}>
            {rttLabel(lastRtt)} total
          </span>
        )}
      </div>

      <div className="rt__track">
        {hops.map((hop, i) => (
          <HopRow key={`${hop.hop_number}-${hop.ip}`} hop={hop} isLast={!destination && i === hops.length - 1} />
        ))}

        {/* Destination — the actual server the data reaches */}
        {destination && (
          <div className="rt__hop">
            <div className="rt__rail">
              <div className="rt__dot rt__dot--dest" style={{ borderColor: "var(--blip-accent)", background: "rgba(147, 130, 255, 0.2)" }} />
            </div>
            <div className="rt__info">
              <div className="rt__info-top">
                <span className="rt__location" style={{ color: "var(--blip-accent)" }}>
                  {[destination.city, destination.country].filter(Boolean).join(", ") || "Destination"}
                </span>
              </div>
              <div className="rt__info-bottom">
                {destination.domain && <span className="rt__asn">{destination.domain}</span>}
                {destination.ip && <span className="rt__ip">{destination.ip}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HopRow({ hop, isLast }: { hop: TracerouteHop; isLast: boolean }) {
  const color = rttColor(hop.rtt_ms);
  const location = [hop.city, hop.country].filter(Boolean).join(", ") || "Unknown";

  return (
    <div className="rt__hop">
      {/* Dot + connecting line */}
      <div className="rt__rail">
        <div className="rt__dot" style={{ borderColor: color, background: `${color}33` }} />
        {!isLast && <div className="rt__line" />}
      </div>

      {/* Hop info */}
      <div className="rt__info">
        <div className="rt__info-top">
          <span className="rt__location">{location}</span>
          <span className="rt__rtt" style={{ color }}>{rttLabel(hop.rtt_ms)}</span>
        </div>
        <div className="rt__info-bottom">
          {hop.asn_org && <span className="rt__asn">{hop.asn_org}</span>}
          {hop.ip && <span className="rt__ip">{hop.ip}</span>}
        </div>
      </div>
    </div>
  );
}
