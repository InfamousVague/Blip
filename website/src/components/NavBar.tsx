import { useEffect, useRef, useState } from "react";
import { getLatestDmgUrl } from "../data/download-url";
import "./NavBar.css";

export function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("https://github.com/InfamousVague/Blip/releases/latest");
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getLatestDmgUrl().then(setDownloadUrl);
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} className="nav-sentinel" />
      <nav className={`navbar ${scrolled ? "navbar--scrolled" : ""}`}>
        <div className="navbar__inner">
          <div className="navbar__brand">
            <img src="./app-icon.png" alt="" className="navbar__logo" />
            <span className="navbar__name">Blip</span>
          </div>
          <a href={downloadUrl} className="navbar__download">
            Download
          </a>
        </div>
      </nav>
    </>
  );
}
