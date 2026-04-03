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
    icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    title: "Speed Test",
    desc: "Cloudflare-powered with live rolling numbers. Runs hourly in the background. Alerts you when something's hogging bandwidth.",
  },
  {
    icon: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z",
    title: "Service Detection",
    desc: "Knows the difference between Netflix and a crypto miner. Auto-identifies hundreds of services with brand colors.",
  },
  {
    icon: "M5 12h14M12 5l7 7-7 7",
    title: "Port Scanner",
    desc: "See what's listening on your machine. Find the rogue process, kill it with one click. Done.",
  },
  {
    icon: "M4 6h16M4 12h16M4 18h7",
    title: "Bandwidth Analytics",
    desc: "Treemaps, stream charts, bar charts. Drill down from service to domain to individual connection. Actual bytes, not estimates.",
  },
  {
    icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
    title: "Offline Map Tiles",
    desc: "The 3D map works without internet. Bundled vector tiles mean you can snoop on your network even when your network is down.",
  },
  {
    icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
    title: "Setup Wizard",
    desc: "Ten questions, one minute, fully configured. Pick a firewall profile, set your privacy preferences, and you're protected.",
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
      <h2 className="site-section__title">And More</h2>
      <p className="site-section__subtitle">
        Plus all the tools you need to understand and control your Mac's network.
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
