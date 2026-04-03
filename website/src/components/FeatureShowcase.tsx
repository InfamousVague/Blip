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
    title: "200 connections. Zero of them asked permission.",
    description:
      "Every app on your computer is quietly phoning home. Blip puts them all on a 3D map so you can watch the chaos unfold in real time.",
    bullets: [
      "Connections route through actual submarine cables across oceans",
      "Service-colored arcs — instantly spot Google, Discord, Apple, and hundreds more",
      "Animated particles show data flowing in both directions",
      "Hop-by-hop traceroute shows the actual path your packets take",
    ],
    image: "screenshots/map.png",
    imageAlt: "Blip 3D network map showing connection arcs",
  },
  {
    badge: "Firewall",
    title: "Bouncer for your bandwidth",
    description:
      "Every app needs permission. No exceptions, no excuses. Strict mode blocks everything until you say otherwise. Because your apps have been way too comfortable.",
    bullets: [
      "Strict mode: guilty until proven innocent",
      "Per-app bandwidth bars expose the data hogs",
      "Scoped rules — allow port 443 but block everything else",
      "Kill switch: one click, zero internet, instant silence",
    ],
    image: "screenshots/firewall.png",
    imageAlt: "Blip firewall showing app-level network access controls",
    imageMaxHeight: "550px",
  },
  {
    badge: "Guard",
    title: "200,000 trackers blocked before they even connect",
    description:
      "Your DNS is a snitch. Every app, every ad SDK, every analytics ping — Guard catches them at the door. See who's trying to phone home and shut them down.",
    bullets: [
      "DNS blocklists nuke 200k+ tracker and ad domains on sight",
      "Real-time query log — watch every lookup happen live",
      "Tracker leaderboard shows the most persistent offenders",
      "Layered with the firewall — two walls, zero mercy",
    ],
    image: "screenshots/guard.png",
    imageAlt: "Blip Guard showing DNS blocking and tracker detection",
    imageMaxHeight: "550px",
  },
  {
    badge: "Visualization",
    title: "The internet is just wet cables",
    description:
      "Your YouTube video crossed three oceans on a cable thinner than a garden hose. Blip shows you exactly which one — 700+ real submarine cable routes, glowing when your data flows through them.",
    bullets: [
      "Real submarine cable routes from TeleGeography mapped on the ocean floor",
      "Active cables light up when your traffic flows through them",
      "Marching dash particles show upload vs download direction",
      "Ping-based speed — fast connections flow fast, laggy ones crawl",
    ],
    image: "screenshots/map.png",
    imageAlt: "Blip visualization showing submarine cables and data flow",
  },
  {
    badge: "Traceroute",
    title: "14 hops through 6 cities to load one webpage",
    description:
      "Every packet bounces through a dozen routers before it arrives. Blip traces the route — hop by hop, city by city, cable by cable — and paints it on the map.",
    bullets: [
      "Hop-by-hop markers overlaid directly on the 3D map",
      "Latency colored: green is fast, amber is okay, red is pain",
      "Routes through real submarine cables across ocean crossings",
      "Automatic traceroute for every active connection",
    ],
    image: "screenshots/hops.png",
    imageAlt: "Blip traceroute showing hop-by-hop network path",
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
