import { FrostedCard } from "@blip/ui/glass/FrostedCard";
import "@blip/ui/glass/glass.css";
import "./FeatureGrid.css";

interface Feature {
  icon: string;
  title: string;
  desc: string;
}

const FEATURES: Feature[] = [
  {
    icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zM17.9 17.39A9.822 9.822 0 0018 12c0-4.97-3.58-9.09-8.3-9.89",
    title: "Live Network Map",
    desc: "Watch every connection arc across a 3D map in real-time. See where your data goes, geographically.",
  },
  {
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    title: "Smart Firewall",
    desc: "Approve or deny network access per-app. Get notified when a new app connects for the first time.",
  },
  {
    icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    title: "Speed Test",
    desc: "Built-in Cloudflare-powered speed test with live rolling numbers. Download, upload, and ping.",
  },
  {
    icon: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9",
    title: "DNS Monitor",
    desc: "See every DNS query your Mac makes. Block trackers and ads with curated blocklists.",
  },
  {
    icon: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z",
    title: "Service Detection",
    desc: "Auto-identifies AWS, Google, Discord, Apple, and hundreds more. Track bandwidth per service.",
  },
  {
    icon: "M5 12h14M12 5l7 7-7 7",
    title: "Port Scanner",
    desc: "See what's listening on your machine. Identify processes, kill rogue listeners with one click.",
  },
];

function FeatureIcon({ path }: { path: string }) {
  return (
    <div className="feature-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </div>
  );
}

export function FeatureGrid() {
  return (
    <section className="site-section" id="features">
      <h2 className="site-section__title">What Blip Does</h2>
      <p className="site-section__subtitle">
        Everything you need to understand and control your Mac's network activity.
      </p>
      <div className="feature-grid">
        {FEATURES.map((f) => (
          <FrostedCard key={f.title} padding={20} gap={12}>
            <FeatureIcon path={f.icon} />
            <span className="feature-title">{f.title}</span>
            <span className="feature-desc">{f.desc}</span>
          </FrostedCard>
        ))}
      </div>
    </section>
  );
}
