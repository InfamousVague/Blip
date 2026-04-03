import "./FeatureShowcase.css";

interface FeatureSection {
  badge: string;
  title: string;
  description: string;
  bullets: string[];
  image?: string; // path to screenshot — placeholder if missing
  imageAlt: string;
  imageMaxHeight?: string; // optional CSS max-height for the image
}

const FEATURES: FeatureSection[] = [
  {
    badge: "Network Map",
    title: "See every connection on a 3D map",
    description:
      "Watch data flow in real time across an interactive map. Every connection your Mac makes is visualized as an arc — with animated particles showing upload and download traffic.",
    bullets: [
      "Connections route through real submarine cables across oceans",
      "Service-colored arcs identify Google, Discord, Apple, and hundreds more",
      "Animated marching dashes show data flowing along each connection",
      "Hop-by-hop traceroute visualization shows the actual network path",
    ],
    image: "screenshots/map.png",
    imageAlt: "Blip 3D network map showing connection arcs across the globe",
  },
  {
    badge: "Firewall",
    title: "Control which apps can connect",
    description:
      "A smart firewall that lets you approve or deny network access per-app. Three preset profiles — Strict, Balanced, and Open — adapt to your security needs.",
    bullets: [
      "Strict mode blocks all unknown apps until you approve them",
      "Per-app bandwidth bars show which apps use the most data",
      "Scoped rules: allow an app on port 443 but block everything else",
      "Kill switch instantly cuts all network traffic in emergencies",
    ],
    image: "screenshots/firewall.png",
    imageAlt: "Blip firewall showing app-level network access controls",
    imageMaxHeight: "550px",
  },
  {
    badge: "Guard",
    title: "Block trackers and ads at the DNS level",
    description:
      "Blip's Guard combines tracker detection with DNS-level blocking. See which domains are being blocked, which apps are phoning home, and take control of your privacy.",
    bullets: [
      "DNS blocklists block 200k+ known tracker and ad domains",
      "Real-time query log shows every DNS lookup your Mac makes",
      "Tracker stats show which blocked domains are most active",
      "Works alongside the firewall for layered protection",
    ],
    image: "screenshots/guard.png",
    imageAlt: "Blip Guard showing DNS blocking and tracker detection",
    imageMaxHeight: "550px",
  },
  {
    badge: "Visualization",
    title: "Your internet's hidden infrastructure",
    description:
      "Blip reveals what's invisible — submarine cables carrying your data across oceans, animated particles showing real-time traffic flow, and service-colored arcs that make your network activity tangible.",
    bullets: [
      "Real submarine cable routes from TeleGeography — 700+ cables worldwide",
      "Active cables glow when your data flows through them",
      "Marching dash particles show upload and download direction",
      "Ping-based animation speed — low latency connections flow faster",
    ],
    image: "screenshots/map.png",
    imageAlt: "Blip visualization showing submarine cables and animated data flow",
  },
  {
    badge: "Traceroute",
    title: "See the actual path your data takes",
    description:
      "Blip traces the real network route to every destination — hop by hop. See which routers, cities, and undersea cables your packets cross before reaching their endpoint.",
    bullets: [
      "Hop-by-hop visualization overlaid directly on the 3D map",
      "Latency-colored markers: green (<30ms), amber (<100ms), red (>100ms)",
      "Routes through real submarine cables across ocean crossings",
      "Automatic traceroute for every active connection",
    ],
    image: "screenshots/hops.png",
    imageAlt: "Blip traceroute showing hop-by-hop network path on the 3D map",
  },
];

function FeatureHero({ feature, index }: { feature: FeatureSection; index: number }) {
  const isReversed = index % 2 === 1;

  return (
    <div className={`feature-hero ${isReversed ? "feature-hero--reverse" : ""}`}>
      <div className="feature-hero__text">
        <span className="feature-hero__badge">{feature.badge}</span>
        <h2 className="feature-hero__title">{feature.title}</h2>
        <p className="feature-hero__desc">{feature.description}</p>
        <div className="feature-hero__bullets">
          {feature.bullets.map((bullet, i) => (
            <div key={i} className="feature-hero__bullet">
              <span className="feature-hero__bullet-dot" />
              <span>{bullet}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="feature-hero__visual">
        <div className="feature-hero__glow" />
        {feature.image ? (
          <div className="feature-hero__frame">
            <img
              src={feature.image}
              alt={feature.imageAlt}
              loading="lazy"
              style={feature.imageMaxHeight ? { maxHeight: feature.imageMaxHeight, width: "auto", margin: "0 auto", display: "block" } : undefined}
              onError={(e) => {
                // Replace with placeholder on error
                const target = e.currentTarget;
                target.style.display = "none";
                target.parentElement?.classList.add("feature-hero__placeholder");
                target.parentElement!.textContent = "Screenshot coming soon";
              }}
            />
          </div>
        ) : (
          <div className="feature-hero__placeholder">Screenshot coming soon</div>
        )}
      </div>
    </div>
  );
}

export function FeatureShowcase() {
  return (
    <section className="feature-showcase" id="features">
      {FEATURES.map((feature, i) => (
        <div key={feature.badge}>
          {i > 0 && <div className="feature-divider" />}
          <FeatureHero feature={feature} index={i} />
        </div>
      ))}
    </section>
  );
}
