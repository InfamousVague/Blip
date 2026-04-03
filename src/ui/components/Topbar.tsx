/**
 * Topbar — Glass bar with frosted ISP info pill (center) + frosted mode switcher (right).
 * macOS traffic lights sit on the left (handled by Tauri window config).
 */

import { SegmentedControl } from './SegmentedControl';
import type { CSSProperties } from 'react';
import './Topbar.css';

interface TopbarProps {
  isp?: string;
  networkType?: string;
  ip?: string;
  coordinates?: string;
  mode: string;
  onModeChange: (mode: string) => void;
  modeOptions?: { value: string; label: string }[];
  /** Optional element rendered to the right of the mode switcher */
  trailing?: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  onMouseDown?: () => void;
}

const DEFAULT_MODES = [
  { value: 'network', label: 'Network' },
  { value: 'guard', label: 'Guard' },
  { value: 'firewall', label: 'Firewall' },
  { value: 'ports', label: 'Ports' },
];

export function Topbar({
  isp = 'Unknown ISP',
  networkType,
  ip,
  coordinates,
  mode,
  onModeChange,
  modeOptions = DEFAULT_MODES,
  trailing,
  className = '',
  style,
  onMouseDown,
}: TopbarProps) {
  return (
    <div className={`blip-topbar ${className}`} style={style} onMouseDown={onMouseDown}>
      {/* Left spacer for traffic lights */}
      <div className="blip-topbar__spacer" />

      {/* Center: Frosted ISP info pill */}
      <div className="blip-topbar__info">
        <span className="blip-topbar__isp">{isp}</span>
        {networkType && <span className="blip-topbar__badge">{networkType}</span>}
        {ip && (
          <>
            <span className="blip-topbar__sep">·</span>
            <span className="blip-topbar__meta">{ip}</span>
          </>
        )}
        {coordinates && (
          <>
            <span className="blip-topbar__sep">·</span>
            <span className="blip-topbar__coord">{coordinates}</span>
          </>
        )}
      </div>

      {/* Right: Mode switcher + optional trailing action */}
      <div className="blip-topbar__right">
        <div className="blip-topbar__switcher">
          <SegmentedControl
            options={modeOptions}
            value={mode}
            onChange={onModeChange}
            size="sm"
          />
        </div>
        {trailing}
      </div>
    </div>
  );
}
