/**
 * BandwidthCard — Frosted card with upload/download two-column display.
 * Shows active rate (large), total, and speed test result per direction.
 */

import { FrostedCard } from '../glass';
import type { CSSProperties } from 'react';
import './BandwidthCard.css';

interface BandwidthColumnData {
  /** Current rate in bytes/sec */
  activeRate: number;
  /** Cumulative total in bytes */
  total: number;
  /** Speed test result in Mbps (0 = not tested) */
  speedMbps?: number;
}

interface BandwidthCardProps {
  upload: BandwidthColumnData;
  download: BandwidthColumnData;
  className?: string;
  style?: CSSProperties;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatSpeed(mbps: number): string {
  if (mbps <= 0) return '—';
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  if (mbps >= 100) return `${Math.round(mbps)} Mbps`;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  return `${(mbps * 1000).toFixed(0)} Kbps`;
}

function BandwidthColumn({
  direction,
  data,
}: {
  direction: 'upload' | 'download';
  data: BandwidthColumnData;
}) {
  const isUpload = direction === 'upload';
  const arrow = isUpload ? '↑' : '↓';
  const label = isUpload ? 'UPLOAD' : 'DOWNLOAD';
  const colorVar = isUpload ? 'var(--blip-upload)' : 'var(--blip-download)';

  return (
    <div className="blip-bw__col">
      <div className="blip-bw__header">
        <span className="blip-bw__arrow" style={{ color: colorVar }}>{arrow}</span>
        <span className="blip-bw__label">{label}</span>
      </div>
      <div className="blip-bw__rate">
        {formatRate(data.activeRate)}
      </div>
      <div className="blip-bw__row">
        <span className="blip-bw__sublabel">Total</span>
        <span className="blip-bw__subvalue">{formatBytes(data.total)}</span>
      </div>
      {data.speedMbps !== undefined && data.speedMbps > 0 && (
        <div className="blip-bw__row">
          <span className="blip-bw__sublabel">Speed</span>
          <span className="blip-bw__subvalue">{formatSpeed(data.speedMbps)}</span>
        </div>
      )}
    </div>
  );
}

export function BandwidthCard({ upload, download, className = '', style }: BandwidthCardProps) {
  return (
    <FrostedCard className={`blip-bw ${className}`} gap={4} style={style}>
      <div className="blip-bw__columns">
        <BandwidthColumn direction="upload" data={upload} />
        <div className="blip-bw__divider" />
        <BandwidthColumn direction="download" data={download} />
      </div>
    </FrostedCard>
  );
}
