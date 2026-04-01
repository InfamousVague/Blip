/**
 * UpdateBanner — Purple gradient bar for OTA update notifications.
 */

import type { CSSProperties } from 'react';
import './UpdateBanner.css';

interface UpdateBannerProps {
  version: string;
  onUpdate: () => void;
  onLater: () => void;
  downloading?: boolean;
  progress?: number;
  className?: string;
  style?: CSSProperties;
}

export function UpdateBanner({
  version,
  onUpdate,
  onLater,
  downloading = false,
  progress,
  className = '',
  style,
}: UpdateBannerProps) {
  return (
    <div className={`blip-update-banner ${className}`} style={style}>
      <span className="blip-update-banner__text">
        {downloading
          ? `Downloading ${version}... ${progress != null ? `${Math.round(progress)}%` : ''}`
          : `Blip ${version} is available`}
      </span>
      <div className="blip-update-banner__actions">
        {!downloading && (
          <>
            <button className="blip-update-banner__btn blip-update-banner__btn--update" onClick={onUpdate}>
              Update
            </button>
            <button className="blip-update-banner__btn blip-update-banner__btn--later" onClick={onLater}>
              Later
            </button>
          </>
        )}
      </div>
    </div>
  );
}
