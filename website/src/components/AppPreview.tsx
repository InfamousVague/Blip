import "./AppPreview.css";

export function AppPreview() {
  return (
    <section className="site-section app-preview-section">
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
        />
      </div>
    </section>
  );
}
