import { useEffect, useState } from "react";
import { getLatestDmgUrl, GITHUB_URL } from "../data/download-url";
import "./Footer.css";

export function Footer() {
  const [downloadUrl, setDownloadUrl] = useState("https://github.com/InfamousVague/Blip/releases/latest");

  useEffect(() => {
    getLatestDmgUrl().then(setDownloadUrl);
  }, []);

  return (
    <section className="site-section footer-section">
      <h2 className="footer__heading">Ready to see your network?</h2>
      <div className="footer__buttons">
        <a href={downloadUrl} className="footer__btn footer__btn--primary">
          Download for macOS
        </a>
        <a href={GITHUB_URL} className="footer__btn footer__btn--ghost" target="_blank" rel="noopener noreferrer">
          View on GitHub
        </a>
      </div>
      <span className="footer__req">Requires macOS 14+ &middot; Free &amp; Open Source</span>

      <div className="footer__bottom">
        <span className="footer__credit">Built with Tauri, React, and Rust</span>
      </div>
    </section>
  );
}
