import { useState } from "react";
import { Button } from "../../ui/components/Button";
import { TriStateToggle } from "../../ui/components/TriStateToggle";
import { SegmentedControl } from "../../ui/components/SegmentedControl";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { plus } from "@mattmattmattmatt/base/primitives/icon/icons/plus";
import "@mattmattmattmatt/base/primitives/icon/icon.css";

const PROTOCOL_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

const LIFETIME_OPTIONS = [
  { value: "permanent", label: "Permanent" },
  { value: "session", label: "Session" },
  { value: "timed", label: "1 Hour" },
];

interface Props {
  onAddScopedRule: (
    action: "allow" | "deny",
    opts: { domain?: string; port?: number; protocol?: string; lifetime?: string; durationMins?: number },
  ) => void;
}

export function ScopedRuleCreator({ onAddScopedRule }: Props) {
  const [showAddRule, setShowAddRule] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newPort, setNewPort] = useState("");
  const [newProtocol, setNewProtocol] = useState("any");
  const [newLifetime, setNewLifetime] = useState("permanent");
  const [newAction, setNewAction] = useState<"allow" | "deny">("deny");

  const handleAddRule = () => {
    const opts: { domain?: string; port?: number; protocol?: string; lifetime?: string; durationMins?: number } = {};
    if (newDomain.trim()) opts.domain = newDomain.trim();
    if (newPort.trim()) opts.port = parseInt(newPort, 10);
    if (newProtocol !== "any") opts.protocol = newProtocol;
    opts.lifetime = newLifetime;
    if (newLifetime === "timed") opts.durationMins = 60;
    onAddScopedRule(newAction, opts);
    setShowAddRule(false);
    setNewDomain("");
    setNewPort("");
    setNewProtocol("any");
    setNewLifetime("permanent");
    setNewAction("deny");
  };

  if (!showAddRule) {
    return (
      <button
        className="fw-row__add-rule-btn"
        onClick={() => setShowAddRule(true)}
      >
        <Icon icon={plus} size="xs" />
        <span className="blip-text-label" style={{ color: "var(--blip-text-secondary)" }}>Add rule</span>
      </button>
    );
  }

  return (
    <div className="fw-row__add-rule-form">
      <input
        placeholder="Domain (optional)"
        value={newDomain}
        onChange={(e) => setNewDomain(e.target.value)}
        className="fw-row__input"
      />
      <input
        placeholder="Port (optional)"
        value={newPort}
        onChange={(e) => setNewPort(e.target.value.replace(/\D/g, ""))}
        className="fw-row__input"
      />
      <SegmentedControl
        options={PROTOCOL_OPTIONS}
        value={newProtocol}
        onChange={setNewProtocol}
        size="sm"
      />
      <SegmentedControl
        options={LIFETIME_OPTIONS}
        value={newLifetime}
        onChange={setNewLifetime}
        size="sm"
      />
      <div className="fw-row__add-rule-actions">
        <TriStateToggle
          value={newAction}
          onChange={(v) => { if (v === "allow" || v === "deny") setNewAction(v); }}
          size="sm"
        />
        <Button variant="secondary" size="sm" onClick={handleAddRule}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowAddRule(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
