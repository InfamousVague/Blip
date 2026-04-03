import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FrostedCard } from "../../ui/glass";
import { Button } from "../../ui/components/Button";
import type { FirewallMode } from "../../types/firewall";
import "./SetupWizard.css";

interface SetupWizardProps {
  onComplete: () => void;
}

// --- Types ---

type ProfilePreset = "strict" | "balanced" | "open";

interface ProfileOption {
  id: ProfilePreset;
  label: string;
  mode: FirewallMode;
  desc: string;
  badge?: string;
}

interface WizardQuestion {
  id: string;
  question: string;
  options: { label: string; value: string }[];
  prefKey?: string; // preference key to store the answer
}

// --- Constants ---

const PROFILE_OPTIONS: ProfileOption[] = [
  {
    id: "strict",
    label: "Strict",
    mode: "deny_all",
    desc: "Block all unknown apps by default. You approve every connection. Maximum security, like Little Snitch.",
  },
  {
    id: "balanced",
    label: "Balanced",
    mode: "ask",
    desc: "You get prompted when a new app tries to connect. Smart defaults for known apps.",
    badge: "Recommended",
  },
  {
    id: "open",
    label: "Open",
    mode: "allow_all",
    desc: "Allow everything by default. Blip monitors and logs all connections. Create deny rules when needed.",
  },
];

const QUESTIONS: WizardQuestion[] = [
  {
    id: "trackers",
    question: "Block advertising and tracking domains?",
    options: [
      { label: "Yes, block trackers", value: "yes" },
      { label: "No, allow everything", value: "no" },
    ],
  },
  {
    id: "tracker_strictness",
    question: "How strict should tracker blocking be?",
    options: [
      { label: "Aggressive — block ~200k domains", value: "aggressive" },
      { label: "Moderate — block known trackers only", value: "moderate" },
      { label: "Light — block major ad networks only", value: "light" },
    ],
  },
  {
    id: "unknown_apps",
    question: "When an unknown app tries to connect, what should happen?",
    options: [
      { label: "Ask me every time", value: "ask" },
      { label: "Allow and notify me", value: "allow_notify" },
      { label: "Block and notify me", value: "deny_notify" },
    ],
  },
  {
    id: "bandwidth_alerts",
    question: "Alert me about unusual bandwidth spikes?",
    options: [
      { label: "High sensitivity — alert on small spikes", value: "high" },
      { label: "Medium — alert on notable spikes", value: "medium" },
      { label: "Low — only alert on major spikes", value: "low" },
    ],
    prefKey: "bandwidth_alert_level",
  },
  {
    id: "auto_start",
    question: "Start Blip automatically when you log in?",
    options: [
      { label: "Yes, start on login", value: "yes" },
      { label: "No, I'll open it manually", value: "no" },
    ],
    prefKey: "auto_start",
  },
  {
    id: "particles",
    question: "Show animated particles on network connections?",
    options: [
      { label: "Yes, show particles", value: "yes" },
      { label: "No, keep it clean", value: "no" },
    ],
    prefKey: "show_particles",
  },
  {
    id: "notifications",
    question: "How should Blip notify you?",
    options: [
      { label: "System notifications + in-app", value: "both" },
      { label: "In-app banners only", value: "inapp" },
      { label: "Silent — log only", value: "silent" },
    ],
    prefKey: "notification_style",
  },
  {
    id: "logging",
    question: "How detailed should connection logging be?",
    options: [
      { label: "Detailed — log everything", value: "detailed" },
      { label: "Standard — log active connections", value: "standard" },
      { label: "Minimal — log blocks only", value: "minimal" },
    ],
    prefKey: "logging_detail",
  },
  {
    id: "dns_cache",
    question: "Cache DNS lookups to reduce latency?",
    options: [
      { label: "Yes, enable DNS cache", value: "yes" },
      { label: "No, always resolve fresh", value: "no" },
    ],
    prefKey: "dns_cache_enabled",
  },
  {
    id: "data_retention",
    question: "How long should Blip keep connection history?",
    options: [
      { label: "7 days", value: "7" },
      { label: "30 days", value: "30" },
      { label: "90 days", value: "90" },
    ],
    prefKey: "data_retention_days",
  },
];

// --- Wizard steps ---

// welcome(0) + profile(1) + questions(2..11) + NE step(12) + done(13)
const NE_STEP = 2 + QUESTIONS.length; // step index for NE activation
const TOTAL_STEPS = 2 + QUESTIONS.length + 2; // welcome + profile + questions + NE + done

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [selectedProfile, setSelectedProfile] = useState<ProfilePreset>("balanced");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [neLoading, setNeLoading] = useState(false);
  const [neError, setNeError] = useState<string | null>(null);
  const [neActivated, setNeActivated] = useState(false);

  const selectedOption = PROFILE_OPTIONS.find((p) => p.id === selectedProfile)!;
  const questionIndex = step - 2; // questions start at step 2
  const currentQuestion = questionIndex >= 0 && questionIndex < QUESTIONS.length ? QUESTIONS[questionIndex] : null;
  const isLastStep = step === TOTAL_STEPS - 1;
  const progress = step / (TOTAL_STEPS - 1);

  const handleAnswer = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    // Auto-advance on answer
    setStep((s) => s + 1);
  }, []);

  const handleFinish = async () => {
    try {
      // Apply firewall profile
      await invoke("set_preference", { key: "firewall_mode", value: selectedOption.mode });

      // Apply tracker blocking
      const trackerAnswer = answers.trackers;
      if (trackerAnswer === "yes") {
        const strictness = answers.tracker_strictness || "aggressive";
        const blocklists: Record<string, { name: string; url: string }> = {
          aggressive: { name: "OISD Big", url: "https://big.oisd.nl/domainswild2" },
          moderate: { name: "OISD Small", url: "https://small.oisd.nl/domainswild2" },
          light: { name: "AdGuard DNS", url: "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt" },
        };
        const list = blocklists[strictness] || blocklists.aggressive;
        try {
          await invoke("add_blocklist_url", { name: list.name, url: list.url });
        } catch {
          // May already be added
        }
      }

      // Store all preference answers
      for (const q of QUESTIONS) {
        if (q.prefKey && answers[q.id]) {
          await invoke("set_preference", { key: q.prefKey, value: answers[q.id] });
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
      <FrostedCard className="setup-wizard" padding={32} gap={20}>
        {/* Progress bar */}
        <div className="setup-wizard__progress-bar">
          <div className="setup-wizard__progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="setup-wizard__step">
            <div className="setup-wizard__logo">
              <svg viewBox="0 0 40 40" width="48" height="48" fill="none">
                <circle cx="20" cy="20" r="18" stroke="rgba(139,92,246,0.4)" strokeWidth="1.5" />
                <circle cx="20" cy="20" r="6" fill="rgba(139,92,246,0.8)" />
                <circle cx="20" cy="20" r="12" stroke="rgba(139,92,246,0.2)" strokeWidth="1" />
              </svg>
            </div>
            <h2 className="setup-wizard__title">Welcome to Blip</h2>
            <p className="setup-wizard__desc">
              See where your Mac talks. Let's set things up in under a minute.
            </p>
            <Button variant="primary" size="md" onClick={() => setStep(1)}>
              Get Started
            </Button>
          </div>
        )}

        {/* Step 1: Profile selection */}
        {step === 1 && (
          <div className="setup-wizard__step">
            <h2 className="setup-wizard__title">Firewall Profile</h2>
            <p className="setup-wizard__desc">
              How strictly should Blip control network access?
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
                  {opt.badge && <span className="setup-wizard__mode-badge">{opt.badge}</span>}
                </button>
              ))}
              <button className="setup-wizard__mode-card setup-wizard__mode-card--disabled" disabled>
                <span className="setup-wizard__mode-label">Custom</span>
                <span className="setup-wizard__mode-desc">Create your own profile with custom rules and thresholds.</span>
                <span className="setup-wizard__mode-badge setup-wizard__mode-badge--muted">Coming Soon</span>
              </button>
            </div>
            <div className="setup-wizard__nav">
              <Button variant="secondary" size="sm" onClick={() => setStep(0)}>Back</Button>
              <Button variant="primary" size="sm" onClick={() => setStep(2)}>Next</Button>
            </div>
          </div>
        )}

        {/* Steps 2-11: Questions */}
        {currentQuestion && (
          <div className="setup-wizard__step">
            <span className="setup-wizard__q-count">Question {questionIndex + 1} of {QUESTIONS.length}</span>
            <h2 className="setup-wizard__title setup-wizard__title--sm">{currentQuestion.question}</h2>
            <div className="setup-wizard__options">
              {currentQuestion.options.map((opt) => (
                <button
                  key={opt.value}
                  className={`setup-wizard__option ${answers[currentQuestion.id] === opt.value ? "setup-wizard__option--selected" : ""}`}
                  onClick={() => handleAnswer(currentQuestion.id, opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="setup-wizard__nav">
              <Button variant="secondary" size="sm" onClick={() => setStep(step - 1)}>Back</Button>
              {answers[currentQuestion.id] && (
                <Button variant="ghost" size="sm" onClick={() => setStep(step + 1)}>Skip</Button>
              )}
            </div>
          </div>
        )}

        {/* Network Extension activation step */}
        {step === NE_STEP && (
          <div className="setup-wizard__step">
            <h2 className="setup-wizard__title">Enable Network Monitoring</h2>
            <p className="setup-wizard__desc">
              Blip uses a Network Extension to see your connections in real time.
              macOS will ask you to allow it in System Settings.
            </p>
            {neError && (
              <div style={{
                padding: "8px 12px", borderRadius: 8,
                background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.3)",
                fontSize: 12, color: "var(--blip-error)", fontWeight: 500, textAlign: "center",
              }}>
                {neError}
              </div>
            )}
            {neActivated ? (
              <>
                <div style={{
                  padding: "8px 12px", borderRadius: 8,
                  background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.3)",
                  fontSize: 13, color: "var(--blip-success)", fontWeight: 500, textAlign: "center",
                }}>
                  Network Extension activated successfully
                </div>
                <Button variant="primary" size="md" onClick={() => setStep(NE_STEP + 1)}>
                  Continue
                </Button>
              </>
            ) : (
              <div className="setup-wizard__nav" style={{ flexDirection: "column", gap: 8 }}>
                <Button variant="primary" size="md" onClick={async () => {
                  setNeLoading(true);
                  setNeError(null);
                  try {
                    const result = await invoke<string>("activate_network_extension");
                    try {
                      const parsed = JSON.parse(result);
                      if (parsed.status === "error" && parsed.error) {
                        setNeError(parsed.error);
                        setNeLoading(false);
                        return;
                      }
                    } catch { /* ignore parse errors */ }
                    setNeActivated(true);
                    localStorage.setItem("blip-setup-dismissed", "permanent");
                  } catch (e) {
                    setNeError("Failed to activate. You can try again later in Settings.");
                    console.error("NE activation error:", e);
                  }
                  setNeLoading(false);
                }} disabled={neLoading}>
                  {neLoading ? "Activating..." : "Enable Network Extension"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStep(NE_STEP + 1)}>
                  Skip for now
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Final step: Done */}
        {isLastStep && (
          <div className="setup-wizard__step">
            <h2 className="setup-wizard__title">All Set!</h2>
            <p className="setup-wizard__desc">
              Your settings are ready. You can change anything later in Settings.
            </p>
            <div className="setup-wizard__summary">
              <div className="setup-wizard__summary-row">
                <span>Profile</span>
                <strong>{selectedOption.label}</strong>
              </div>
              <div className="setup-wizard__summary-row">
                <span>Tracker blocking</span>
                <strong>{answers.trackers === "yes" ? (answers.tracker_strictness || "Aggressive") : "Off"}</strong>
              </div>
              <div className="setup-wizard__summary-row">
                <span>Unknown apps</span>
                <strong>{answers.unknown_apps === "ask" ? "Ask" : answers.unknown_apps === "deny_notify" ? "Block" : "Allow"}</strong>
              </div>
              <div className="setup-wizard__summary-row">
                <span>Bandwidth alerts</span>
                <strong>{answers.bandwidth_alerts || "Medium"}</strong>
              </div>
              <div className="setup-wizard__summary-row">
                <span>Network Extension</span>
                <strong>{neActivated ? "Enabled" : "Skipped"}</strong>
              </div>
              <div className="setup-wizard__summary-row">
                <span>Notifications</span>
                <strong>{answers.notifications === "both" ? "System + In-app" : answers.notifications === "silent" ? "Silent" : "In-app"}</strong>
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
