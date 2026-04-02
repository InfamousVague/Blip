import type { PrivacyGrade } from "../types/firewall";

interface PrivacyScoreCardProps {
  score: PrivacyGrade;
  trackerDomains: number;
  totalDomains: number;
  className?: string;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "#22c55e",
  A: "#4ade80",
  B: "#86efac",
  C: "#facc15",
  D: "#fb923c",
  F: "#ef4444",
};

export function PrivacyScoreCard({ score, trackerDomains, totalDomains, className = "" }: PrivacyScoreCardProps) {
  const color = GRADE_COLORS[score] || "#6b7280";
  const pct = totalDomains > 0 ? ((totalDomains - trackerDomains) / totalDomains * 100).toFixed(0) : "100";

  return (
    <div className={`privacy-score-card ${className}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: `2px solid ${color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          fontWeight: 700,
          color,
          flexShrink: 0,
        }}
      >
        {score}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--blip-text-secondary)" }}>
          {pct}% clean connections
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--blip-text-tertiary)" }}>
          {trackerDomains} tracker / {totalDomains} total
        </span>
      </div>
    </div>
  );
}

/** Inline privacy badge for compact display (e.g., in firewall app row). */
export function PrivacyBadge({ score }: { score: PrivacyGrade | null }) {
  if (!score) return null;
  const color = GRADE_COLORS[score] || "#6b7280";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: "50%",
        border: `1.5px solid ${color}`,
        fontFamily: "var(--font-sans)",
        fontSize: 9,
        fontWeight: 700,
        color,
        flexShrink: 0,
      }}
    >
      {score}
    </span>
  );
}
