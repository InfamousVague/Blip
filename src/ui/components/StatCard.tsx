/**
 * StatCard — Frosted card displaying stat numbers with leading zeros.
 * Used for ACTIVE / TOTAL / EVER connection counts.
 */

import { FrostedCard } from '../glass';
import { NumberRoll } from '@mattmattmattmatt/base/primitives/number-roll/NumberRoll';
import '@mattmattmattmatt/base/primitives/number-roll/number-roll.css';
import type { CSSProperties } from 'react';
import './StatCard.css';

interface StatItem {
  label: string;
  value: number;
  /** Total digits to show (pads with dimmed leading zeros). Default: 4 */
  minDigits?: number;
}

interface StatCardProps {
  stats: StatItem[];
  className?: string;
  style?: CSSProperties;
}

export function StatCard({ stats, className = '', style }: StatCardProps) {
  return (
    <FrostedCard className={`blip-stat-card ${className}`} style={style}>
      <div className="blip-stat-card__row">
        {stats.map((stat) => (
          <div key={stat.label} className="blip-stat-card__item">
            <span className="blip-stat-card__label">{stat.label}</span>
            <div className="blip-stat-card__value">
              <NumberRoll
                value={stat.value}
                minDigits={stat.minDigits ?? 4}
                fontSize="32px"
                commas
                dimLeadingZeros
              />
            </div>
          </div>
        ))}
      </div>
    </FrostedCard>
  );
}
