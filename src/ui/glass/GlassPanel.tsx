/**
 * GlassPanel — Clear liquid glass outer container.
 * Used as the outermost shell for sidebar, topbar, etc.
 * Contains frosted cards inside for the layered glass effect.
 *
 * On Chromium (CEF): Uses GlassSurface with real SVG refraction.
 * On WebKit: Falls back to subtle border + inner shadow highlights.
 */

import type { CSSProperties, ReactNode } from 'react';
import { GlassSurface } from './GlassSurface';
import './glass.css';

interface GlassPanelProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Corner radius. Default: 20 */
  borderRadius?: number;
  /** Internal padding. Default: 10 */
  padding?: number;
  /** Gap between children. Default: 8 */
  gap?: number;
  /** Width */
  width?: number;
  /** Height */
  height?: number;
  /** Whether to use GlassSurface refraction. Default: true */
  refraction?: boolean;
}

export function GlassPanel({
  children,
  className = '',
  style,
  borderRadius = 20,
  padding = 10,
  gap = 8,
  width,
  height,
  refraction = true,
}: GlassPanelProps) {
  if (refraction) {
    return (
      <GlassSurface
        className={`glass-panel ${className}`}
        borderRadius={borderRadius}
        blur={4}
        distortionScale={-120}
        opacity={1}
        backgroundOpacity={0}
        width={width}
        height={height}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap,
          padding,
          overflow: 'hidden',
          ...style,
        }}
      >
        {children}
      </GlassSurface>
    );
  }

  // Non-refraction fallback — still has the glass look via CSS
  return (
    <div
      className={`glass-panel ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        padding,
        borderRadius,
        background: 'var(--glass-clear-fill)',
        border: '1px solid var(--glass-clear-border)',
        boxShadow: 'var(--glass-clear-shadow)',
        overflow: 'hidden',
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
