/**
 * Blip Design Tokens — Glass
 * Two glass types: clear liquid glass (map overlays) + frosted glass (sidebar panels).
 * Refraction via SVG feDisplacementMap (Chromium only, CSS fallback elsewhere).
 */

// === Clear Liquid Glass (topbar, controls, radar) ===
// Near-transparent with LG refraction border + inner shadows. No blur.
export const clearGlass = {
  fill: 'rgba(0, 0, 0, 0.004)',
  border: 'rgba(227, 227, 227, 0.1)',
  borderWidth: '1px',
  cornerRadius: '14px',
  // Opposing inner shadows create the refraction highlight effect
  innerShadow: 'inset 6px 6px 3px -6px rgba(179, 179, 179, 0.5), inset -6px -6px 3px -6px rgba(179, 179, 179, 0.5)',
} as const;

// === Frosted Glass (sidebar panels, cards) ===
// Semi-transparent with backdrop blur. Content is readable.
export const frostedGlass = {
  fill: 'rgba(255, 255, 255, 0.12)',
  border: 'rgba(255, 255, 255, 0.12)',
  borderWidth: '1px',
  cornerRadius: '20px',
  blur: '20px',
  saturate: '1.8',
} as const;

// === Frosted Card (inner cards within sidebar) ===
export const frostedCard = {
  fill: 'rgba(255, 255, 255, 0.1)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderWidth: '1px',
  cornerRadius: '14px',
  blur: '12px',
} as const;

// === GlassSurface Refraction Parameters (SVG displacement filter) ===
// These control the SVG feDisplacementMap for chromatic aberration.
// Only active in Chromium-based browsers.
export const refraction = {
  distortionScale: -180,
  redOffset: 0,
  greenOffset: 10,
  blueOffset: 20,
  xChannel: 'R' as const,
  yChannel: 'G' as const,
} as const;
