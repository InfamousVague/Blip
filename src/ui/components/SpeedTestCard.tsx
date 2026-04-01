/**
 * SpeedTestCard — Frosted card showing internet speed test results.
 * Displays upload/download speeds with live rolling numbers during tests.
 */

import { FrostedCard } from '../glass';
import { NumberRoll } from '@mattmattmattmatt/base/primitives/number-roll/NumberRoll';
import '@mattmattmattmatt/base/primitives/number-roll/number-roll.css';
import type { CSSProperties } from 'react';
import './SpeedTestCard.css';

interface SpeedTestCardProps {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  testing: boolean;
  lastTestTime: number;
  onRunTest: () => void;
  stage: 'idle' | 'ping' | 'download' | 'upload';
  liveDownloadMbps: number;
  liveUploadMbps: number;
  percent: number;
  className?: string;
  style?: CSSProperties;
}

function splitSpeed(mbps: number): { whole: number; decimal: number; unit: string } {
  if (mbps <= 0) return { whole: 0, decimal: 0, unit: 'Mbps' };
  if (mbps >= 1000) {
    const val = mbps / 1000;
    return { whole: Math.floor(val), decimal: Math.floor((val % 1) * 100), unit: 'Gbps' };
  }
  return { whole: Math.floor(mbps), decimal: Math.floor((mbps % 1) * 100), unit: 'Mbps' };
}

function timeAgo(timestampMs: number): string {
  if (timestampMs <= 0) return '';
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function SpeedValue({ mbps, active }: { mbps: number; active: boolean }) {
  const { whole, decimal, unit } = splitSpeed(mbps);

  if (mbps <= 0 && !active) {
    return <div className="blip-speed__value">—</div>;
  }

  return (
    <div className="blip-speed__value">
      <NumberRoll value={whole} minDigits={3} duration={400} commas dimLeadingZeros />
      <span className="blip-speed__decimal">.</span>
      <NumberRoll value={decimal} minDigits={2} duration={400} dimLeadingZeros />
      <span className="blip-speed__unit">{unit}</span>
    </div>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case 'ping': return 'Measuring Ping...';
    case 'download': return 'Testing Download...';
    case 'upload': return 'Testing Upload...';
    default: return 'Speed Test';
  }
}

export function SpeedTestCard({
  downloadMbps,
  uploadMbps,
  pingMs,
  testing,
  lastTestTime,
  onRunTest,
  stage,
  liveDownloadMbps,
  liveUploadMbps,
  percent,
  className = '',
  style,
}: SpeedTestCardProps) {
  // During testing, always prefer live values (they persist across phases)
  // liveDownloadMbps is set during download phase and locked in at download_done
  // liveUploadMbps is set during upload phase
  const showDownload = testing && liveDownloadMbps > 0 ? liveDownloadMbps : downloadMbps;
  const showUpload = testing && liveUploadMbps > 0 ? liveUploadMbps : uploadMbps;

  return (
    <FrostedCard className={`blip-speed ${className}`} gap={8} padding={14} style={style}>
      <div className="blip-speed__header">
        <span className="blip-speed__title">
          {testing ? stageLabel(stage) : 'Speed Test'}
        </span>
        <button
          className={`blip-speed__btn ${testing ? 'blip-speed__btn--testing' : ''}`}
          onClick={onRunTest}
        >
          {testing ? `${percent}%` : 'Run Test'}
        </button>
      </div>

      {testing && (
        <div className="blip-speed__progress-track">
          <div className="blip-speed__progress-fill" style={{ width: `${percent}%` }} />
        </div>
      )}

      <div className="blip-speed__columns">
        <div className={`blip-speed__col ${stage === 'download' ? 'blip-speed__col--active' : ''}`}>
          <div className="blip-speed__direction">
            <span className="blip-speed__arrow" style={{ color: 'var(--blip-download)' }}>↓</span>
            <span className="blip-speed__dir-label">DOWNLOAD</span>
          </div>
          <SpeedValue mbps={showDownload} active={testing} />
        </div>

        <div className="blip-speed__divider" />

        <div className={`blip-speed__col ${stage === 'upload' ? 'blip-speed__col--active' : ''}`}>
          <div className="blip-speed__direction">
            <span className="blip-speed__arrow" style={{ color: 'var(--blip-upload)' }}>↑</span>
            <span className="blip-speed__dir-label">UPLOAD</span>
          </div>
          <SpeedValue mbps={showUpload} active={testing} />
        </div>
      </div>

      <div className="blip-speed__ping">
        <span className="blip-speed__ping-label">Ping</span>
        <span className="blip-speed__ping-value">
          {pingMs > 0 ? `${Math.round(pingMs)} ms` : '—'}
        </span>
        {lastTestTime > 0 && !testing && (
          <span className="blip-speed__time">{timeAgo(lastTestTime)}</span>
        )}
      </div>
    </FrostedCard>
  );
}
