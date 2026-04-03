import { Button } from "../../ui/components/Button";

interface Props {
  whitelist: string[];
  show: boolean;
  onToggle: () => void;
}

export function SystemWhitelist({ whitelist, show, onToggle }: Props) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="settings-group-title">System Whitelist</span>
        <Button variant="secondary" size="sm" onClick={onToggle}>
          {show ? "Hide" : "Show"} ({whitelist.length})
        </Button>
      </div>
      <span className="blip-text-row-desc" style={{ marginTop: -4 }}>
        Apple system processes that always bypass firewall rules.
      </span>

      {show && (
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(255, 255, 255, 0.02)",
          maxHeight: 200,
          overflowY: "auto",
        }}>
          {whitelist.map((bid) => (
            <span key={bid} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--blip-text-tertiary)" }}>
              {bid}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
