import { useState } from "react";
import { GlassPanel } from "../../ui/glass/GlassPanel";
import { FrostedCard } from "../../ui/glass/FrostedCard";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { settings as settingsIcon } from "@mattmattmattmatt/base/primitives/icon/icons/settings";
import { shieldAlert } from "@mattmattmattmatt/base/primitives/icon/icons/shield-alert";
import { shield } from "@mattmattmattmatt/base/primitives/icon/icons/shield";
import { bell } from "@mattmattmattmatt/base/primitives/icon/icons/bell";
import { globe } from "@mattmattmattmatt/base/primitives/icon/icons/globe";
import { info } from "@mattmattmattmatt/base/primitives/icon/icons/info";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import { GeneralTab } from "./GeneralTab";
import { FirewallTab } from "./FirewallTab";
import { BlocklistsTab } from "./BlocklistsTab";
import { AlertsTab } from "./AlertsTab";
import { NetworkTab } from "./NetworkTab";
import { AboutTab } from "./AboutTab";
import "./Settings.css";

type SettingsTab = "general" | "firewall" | "blocklists" | "alerts" | "network" | "about";

const NAV_ITEMS: { value: SettingsTab; label: string; icon: string }[] = [
  { value: "general", label: "General", icon: settingsIcon },
  { value: "firewall", label: "Firewall", icon: shieldAlert },
  { value: "blocklists", label: "Blocklists", icon: shield },
  { value: "alerts", label: "Alerts", icon: bell },
  { value: "network", label: "Network", icon: globe },
  { value: "about", label: "About", icon: info },
];

interface Props {
  open: boolean;
  onClose: () => void;
  firewallMode: string;
  onFirewallModeChange: (mode: string) => void;
}

export function Settings({ open, onClose, firewallMode, onFirewallModeChange }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={(e) => e.stopPropagation()}>
        <GlassPanel
          className="settings-shell"
          style={{ flexDirection: "row" }}
          padding={12}
          gap={10}
          borderRadius={20}
        >
          <FrostedCard
            className="settings-nav-card"
            gap={2}
            padding={12}
            style={{ flexShrink: 0 }}
          >
            <span className="settings-nav__title">Settings</span>
            <div style={{ height: 4 }} />
            {NAV_ITEMS.map((item) => (
              <button
                key={item.value}
                className={`settings-nav__item${activeTab === item.value ? " settings-nav__item--active" : ""}`}
                onClick={() => setActiveTab(item.value)}
              >
                <Icon icon={item.icon} size="sm" />
                {item.label}
              </button>
            ))}
          </FrostedCard>

          <FrostedCard
            className="settings-content-card"
            gap={12}
            padding={16}
            style={{ flex: 1 }}
          >
            {activeTab === "general" && (
              <GeneralTab firewallMode={firewallMode} onFirewallModeChange={onFirewallModeChange} />
            )}
            {activeTab === "firewall" && (
              <FirewallTab firewallMode={firewallMode} onFirewallModeChange={onFirewallModeChange} />
            )}
            {activeTab === "blocklists" && <BlocklistsTab />}
            {activeTab === "alerts" && <AlertsTab />}
            {activeTab === "network" && <NetworkTab />}
            {activeTab === "about" && <AboutTab />}
          </FrostedCard>
        </GlassPanel>
      </div>
    </div>
  );
}
