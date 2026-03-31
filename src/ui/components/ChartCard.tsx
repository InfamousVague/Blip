/**
 * ChartCard — Frosted card with chart area + mode switcher tabs.
 */

import { FrostedCard } from '../glass';
import type { CSSProperties, ReactNode } from 'react';
import './ChartCard.css';

interface ChartMode {
  value: string;
  label: string;
}

interface ChartCardProps {
  /** The chart content (Recharts, canvas, or placeholder) */
  children?: ReactNode;
  /** Available chart modes */
  modes?: ChartMode[];
  /** Currently active mode */
  activeMode?: string;
  /** Mode change handler */
  onModeChange?: (mode: string) => void;
  /** Chart height. Default: 120 */
  chartHeight?: number;
  className?: string;
  style?: CSSProperties;
}

export function ChartCard({
  children,
  modes,
  activeMode,
  onModeChange,
  chartHeight = 120,
  className = '',
  style,
}: ChartCardProps) {
  return (
    <FrostedCard className={`blip-chart-card ${className}`} gap={8} style={style}>
      <div className="blip-chart-card__area" style={{ height: chartHeight }}>
        {children || <span className="blip-chart-card__placeholder">Chart</span>}
      </div>
      {modes && modes.length > 0 && (
        <div className="blip-chart-card__modes">
          {modes.map((mode) => (
            <button
              key={mode.value}
              className={`blip-chart-card__mode ${activeMode === mode.value ? 'blip-chart-card__mode--active' : ''}`}
              onClick={() => onModeChange?.(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}
    </FrostedCard>
  );
}
