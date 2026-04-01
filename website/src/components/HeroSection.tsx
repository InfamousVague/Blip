import { useEffect, useState } from "react";
import { HeroMap } from "./HeroMap";
import { getLatestDmgUrl } from "../data/download-url";
import "./HeroSection.css";

export function HeroSection() {
  const [downloadUrl, setDownloadUrl] = useState("https://github.com/InfamousVague/Blip/releases/latest");

  useEffect(() => {
    getLatestDmgUrl().then(setDownloadUrl);
  }, []);

  return (
    <section className="hero">
      <div className="hero__map">
        <HeroMap />
      </div>

      <div className="hero__overlay">
        <div className="hero__content">
          <img src="./app-icon.png" alt="Blip" className="hero__icon" />
          <h1 className="hero__title">Blip</h1>
          <p className="hero__subtitle">See where your Mac talks.</p>
          <p className="hero__desc">
            Real-time network monitoring with 3D connection mapping,
            smart firewall, and bandwidth analytics.
          </p>
          <a href={downloadUrl} className="hero__cta">
            Download for macOS
          </a>
          <span className="hero__req">Requires macOS 14+ &middot; Free &amp; Open Source</span>
        </div>
      </div>

      <div className="hero__fade" />
    </section>
  );
}
