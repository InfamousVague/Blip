/**
 * GlassSurface — Liquid glass with SVG displacement refraction.
 *
 * Uses SVG feDisplacementMap for chromatic aberration on backdrop content.
 * Full refraction only works in Chromium-based browsers.
 * On WebKit (Tauri/macOS), gracefully falls back to:
 *   - backdrop-filter: blur() for frosted glass
 *   - CSS box-shadow for refraction highlight simulation
 *   - border with low opacity for the glass edge
 *
 * When CEF support stabilizes in Tauri, the full refraction will activate
 * automatically without code changes.
 *
 * Adapted from ReactBits GlassSurface (MIT license).
 */

import { useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import './glass.css';

interface GlassSurfaceProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Displacement intensity. Negative = inward refraction. Default: -180 */
  distortionScale?: number;
  /** Per-channel offsets for chromatic aberration */
  redOffset?: number;
  greenOffset?: number;
  blueOffset?: number;
  /** Which displacement map channel controls X/Y displacement */
  xChannel?: 'R' | 'G' | 'B' | 'A';
  yChannel?: 'R' | 'G' | 'B' | 'A';
  /** Border width as fraction of element size. Default: 0.07 */
  borderWidth?: number;
  /** Brightness adjustment. Default: 50 */
  brightness?: number;
  /** Background blur in px. Default: 2 */
  blur?: number;
  /** Enable/disable displacement. Default: true */
  displace?: boolean;
  /** Background saturation. Default: 1 */
  saturation?: number;
  /** Border radius in px. Default: 20 */
  borderRadius?: number;
  /** Mix blend mode for the refraction layer. Default: 'difference' */
  mixBlendMode?: string;
  /** Background opacity. Default: 0 (fully transparent) */
  backgroundOpacity?: number;
  /** Overall element opacity. Default: 0.93 */
  opacity?: number;
  /** Width in px */
  width?: number;
  /** Height in px */
  height?: number;
}

/** Check if SVG filters in backdrop-filter are supported (Chromium only) */
function supportsSVGFilters(): boolean {
  if (typeof document === 'undefined') return false;
  const ua = navigator.userAgent;
  const isWebkit = /Safari/.test(ua) && !/Chrome/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  if (isWebkit || isFirefox) return false;

  // Test if the browser accepts backdrop-filter with url()
  const el = document.createElement('div');
  el.style.cssText = 'backdrop-filter: url(#test)';
  return el.style.backdropFilter !== '';
}

const hasSVGFilterSupport = supportsSVGFilters();

/** Generate the SVG displacement map as a data URI */
function generateDisplacementMap(borderWidth: number): string {
  const bw = Math.max(0, Math.min(1, borderWidth));
  const innerStart = bw;
  const innerEnd = 1 - bw;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect x="0" y="0" width="100" height="100" fill="rgb(128,128,128)"/>
    <rect x="${innerStart * 100}" y="0" width="${(innerEnd - innerStart) * 100}" height="100" fill="rgb(128,0,128)"/>
    <rect x="0" y="${innerStart * 100}" width="100" height="${(innerEnd - innerStart) * 100}" fill="rgb(0,128,0)"/>
    <rect x="${innerStart * 100}" y="${innerStart * 100}" width="${(innerEnd - innerStart) * 100}" height="${(innerEnd - innerStart) * 100}" fill="rgb(128,128,128)"/>
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function GlassSurface({
  children,
  className = '',
  style,
  distortionScale = -180,
  redOffset = 0,
  greenOffset = 10,
  blueOffset = 20,
  xChannel = 'R',
  yChannel = 'G',
  borderWidth = 0.07,
  brightness = 50,
  blur = 2,
  displace = true,
  saturation = 1,
  borderRadius = 20,
  mixBlendMode = 'difference',
  backgroundOpacity = 0,
  opacity = 0.93,
  width,
  height,
}: GlassSurfaceProps) {
  const id = useId().replace(/:/g, '');
  const filterId = `glass-refract-${id}`;

  const displacementMapUri = useMemo(
    () => generateDisplacementMap(borderWidth),
    [borderWidth]
  );

  const useRefraction = hasSVGFilterSupport && displace;

  // Split style into structural (container) and layout (content wrapper) properties
  const {
    display: _display, flexDirection: _fd, flexWrap: _fw, gap: _gap,
    padding: _pad, paddingTop: _pt, paddingRight: _pr, paddingBottom: _pb, paddingLeft: _pl,
    flex: _flex, alignItems: _ai, justifyContent: _jc,
    ...structuralStyle
  } = style || {};

  const containerStyle: CSSProperties = {
    position: 'relative',
    borderRadius,
    overflow: 'hidden',
    opacity,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...structuralStyle,
  };

  // The refraction layer uses backdrop-filter with the SVG filter
  const refractionStyle: CSSProperties = useRefraction
    ? {
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        backdropFilter: `url(#${filterId}) blur(${blur}px) saturate(${saturation})`,
        WebkitBackdropFilter: `url(#${filterId}) blur(${blur}px) saturate(${saturation})`,
        mixBlendMode: mixBlendMode as CSSProperties['mixBlendMode'],
        pointerEvents: 'none' as const,
        zIndex: 0,
      }
    : {
        // Fallback: just blur, no SVG refraction
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        backdropFilter: `blur(${blur}px) saturate(${saturation})`,
        WebkitBackdropFilter: `blur(${blur}px) saturate(${saturation})`,
        pointerEvents: 'none' as const,
        zIndex: 0,
      };

  // Background tint layer
  const bgStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    background: `rgba(${brightness}, ${brightness}, ${brightness}, ${backgroundOpacity})`,
    pointerEvents: 'none' as const,
    zIndex: 1,
  };

  // Inner shadow refraction highlights
  const highlightStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    boxShadow: 'inset 6px 6px 3px -6px rgba(179, 179, 179, 0.5), inset -6px -6px 3px -6px rgba(179, 179, 179, 0.5)',
    border: '1px solid rgba(227, 227, 227, 0.1)',
    pointerEvents: 'none' as const,
    zIndex: 2,
  };

  return (
    <>
      {/* SVG filter definition (only rendered when supported) */}
      {useRefraction && (
        <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
          <filter
            id={filterId}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={displacementMapUri}
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result="map"
            />
            {/* Red channel displacement */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={distortionScale + redOffset}
              xChannelSelector={xChannel}
              yChannelSelector={yChannel}
              result="dispR"
            />
            <feColorMatrix
              in="dispR"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="red"
            />
            {/* Green channel displacement */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={distortionScale + greenOffset}
              xChannelSelector={xChannel}
              yChannelSelector={yChannel}
              result="dispG"
            />
            <feColorMatrix
              in="dispG"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="green"
            />
            {/* Blue channel displacement */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={distortionScale + blueOffset}
              xChannelSelector={xChannel}
              yChannelSelector={yChannel}
              result="dispB"
            />
            <feColorMatrix
              in="dispB"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="blue"
            />
            {/* Recombine channels */}
            <feBlend in="red" in2="green" mode="screen" result="rg" />
            <feBlend in="rg" in2="blue" mode="screen" />
          </filter>
        </svg>
      )}

      <div className={`glass-surface ${className}`} style={containerStyle}>
        {/* Refraction/blur layer */}
        <div style={refractionStyle} />
        {/* Background tint */}
        <div style={bgStyle} />
        {/* Inner shadow highlights */}
        <div style={highlightStyle} />
        {/* Content — carries layout styles so flex/grid works through the glass layers */}
        <div style={{
          position: 'relative',
          zIndex: 3,
          display: _display,
          flexDirection: _fd as CSSProperties['flexDirection'],
          flexWrap: _fw as CSSProperties['flexWrap'],
          gap: _gap,
          padding: _pad,
          paddingTop: _pt,
          paddingRight: _pr,
          paddingBottom: _pb,
          paddingLeft: _pl,
          flex: _flex,
          alignItems: _ai as CSSProperties['alignItems'],
          justifyContent: _jc as CSSProperties['justifyContent'],
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
        }}>{children}</div>
      </div>
    </>
  );
}
