import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FrostedCard } from "../ui/glass";
import { Button } from "../ui/components/Button";
import type { FirewallMode } from "../types/firewall";
import "./SetupWizard.css";

interface SetupWizardProps {
  onComplete: () => void;
}

const STEPS = ["Welcome", "Profile", "Blocklist", "Done"] as const;

type ProfilePreset = "strict" | "balanced" | "relaxed";

interface ProfileOption {
  id: ProfilePreset;
  label: string;
  mode: FirewallMode;
  desc: string;
  badge?: string;
}

const PROFILE_OPTIONS: ProfileOption[] = [
  {
    id: "strict",
    label: "Strict",
    mode: "deny_all",
    desc: "Block all unknown apps by default. Only approved apps can connect. Best for maximum security.",
  },
  {
    id: "balanced",
    label: "Balanced",
    mode: "ask",
    desc: "Ask you when a new app tries to connect. You decide to allow or deny each app.",
    badge: "Recommended",
  },
  {
    id: "relaxed",
    label: "Relaxed",
    mode: "allow_all",
    desc: "Allow all connections by default. You can create deny rules for specific apps later.",
  },
];

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [selectedProfile, setSelectedProfile] = useState<ProfilePreset>("balanced");
  const [enableBlocklist, setEnableBlocklist] = useState(true);

  const selectedOption = PROFILE_OPTIONS.find((p) => p.id === selectedProfile)!;

  const handleFinish = async () => {
    try {
      await invoke("set_preference", { key: "firewall_mode", value: selectedOption.mode });
      if (enableBlocklist) {
        // Enable default tracker blocklist if not already
        try {
          await invoke("add_blocklist_url", {
            name: "OISD Big",
            url: "https://big.oisd.nl/domainswild2",
          });
        } catch {
          // May already be added
        }
      }
      await invoke("complete_setup_wizard");
      onComplete();
    } catch (e) {
      console.error("Wizard finish error:", e);
      onComplete();
    }
  };

  return (
    <div className="setup-wizard-overlay">
      <FrostedCard className="setup-wizard" padding={32} gap={24}>
        {/* Progress */}
        <div className="setup-wizard__progress">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`setup-wizard__dot ${i === step ? "setup-wizard__dot--active" : ""} ${i < step ? "setup-wizard__dot--done" : ""}`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="setup-wizard__step">
            <h2 className="setup-wizard__title">Welcome to Blip</h2>
            <p className="setup-wizard__desc">
              Blip monitors your network connections and lets you control which apps can access the
              internet. Let's configure your firewall in a few quick steps.
            </p>
            <Button variant="primary" size="md" onClick={() => setStep(1)}>
              Get Started
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="setup-wizard__step">
            <h2 className="setup-wizard__title">Firewall Profile</h2>
            <p className="setup-wizard__desc">
              Choose how strictly Blip should control network access. You can change this anytime in settings.
            </p>
            <div className="setup-wizard__modes">
              {PROFILE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  className={`setup-wizard__mode-card ${selectedProfile === opt.id ? "setup-wizard__mode-card--selected" : ""}`}
                  onClick={() => setSelectedProfile(opt.id)}
                >
                  <span className="setup-wizard__mode-label">{opt.label}</span>
                  <span className="setup-wizard__mode-desc">{opt.desc}</span>
                  {opt.badge && (
                    <span className="setup-wizard__mode-badge">{opt.badge}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="setup-wizard__nav">
              <Button variant="secondary" size="sm" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button variant="primary" size="sm" onClick={() => setStep(2)}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="setup-wizard__step">
            <h2 className="setup-wizard__title">Tracker Blocking</h2>
            <p className="setup-wizard__desc">
              Blip can block known advertising and tracking domains at the DNS level. This works
              alongside the firewall and protects all apps automatically.
            </p>
            <label className="setup-wizard__checkbox">
              <input
                type="checkbox"
                checked={enableBlocklist}
                onChange={(e) => setEnableBlocklist(e.target.checked)}
              />
              <span>Enable tracker blocklist (OISD Big — ~200k domains)</span>
            </label>
            <div className="setup-wizard__nav">
              <Button variant="secondary" size="sm" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button variant="primary" size="sm" onClick={() => setStep(3)}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="setup-wizard__step">
            <h2 className="setup-wizard__title">All Set!</h2>
            <p className="setup-wizard__desc">
              Your firewall is configured. Apple system services are automatically whitelisted and
              won't trigger any prompts.
            </p>
            <div className="setup-wizard__summary">
              <div className="setup-wizard__summary-row">
                <span>Profile:</span>
                <strong>{selectedOption.label}</strong>
              </div>
              <div className="setup-wizard__summary-row">
                <span>Firewall mode:</span>
                <strong>{selectedOption.mode === "ask" ? "Ask" : selectedOption.mode === "deny_all" ? "Deny All" : "Allow All"}</strong>
              </div>
              <div className="setup-wizard__summary-row">
                <span>Tracker blocking:</span>
                <strong>{enableBlocklist ? "Enabled" : "Disabled"}</strong>
              </div>
            </div>
            <Button variant="primary" size="md" onClick={handleFinish}>
              Start Using Blip
            </Button>
          </div>
        )}
      </FrostedCard>
    </div>
  );
}
