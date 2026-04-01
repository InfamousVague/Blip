import { useState } from "react";
import "./AppPreview.css";

export function AppPreview() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Hide the entire section if the screenshot doesn't exist
  if (error) return null;

  return (
    <section className="site-section app-preview-section" style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.4s" }}>
      <h2 className="site-section__title">See It In Action</h2>
      <p className="site-section__subtitle">
        A full network command center, right on your desktop.
      </p>
      <div className="app-preview__frame">
        <div className="app-preview__glow" />
        <img
          src="./app-screenshot.png"
          alt="Blip application showing the network map, sidebar with services, and connection arcs"
          className="app-preview__img"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      </div>
    </section>
  );
}
