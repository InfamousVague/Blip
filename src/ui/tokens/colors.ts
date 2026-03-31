/**
 * Blip Design Tokens — Colors
 * Monochrome purple palette with functional data colors.
 * From Figma design system.
 */

// === Surface Colors ===
export const surfaces = {
  dark: {
    bgPrimary: '#0c0a12',
    bgSecondary: '#13111a',
    bgElevated: '#1a1725',
  },
  light: {
    bgPrimary: '#ffffff',
    bgSecondary: '#f5f5f7',
    bgElevated: '#ffffff',
  },
} as const;

// === Text Colors ===
export const text = {
  dark: {
    primary: 'rgba(255, 255, 255, 0.95)',
    secondary: 'rgba(255, 255, 255, 0.65)',
    tertiary: 'rgba(255, 255, 255, 0.4)',
  },
  light: {
    primary: 'rgba(0, 0, 0, 0.9)',
    secondary: 'rgba(0, 0, 0, 0.6)',
    tertiary: 'rgba(0, 0, 0, 0.4)',
  },
} as const;

// === Border Colors ===
export const borders = {
  dark: {
    default: 'rgba(255, 255, 255, 0.08)',
    subtle: 'rgba(255, 255, 255, 0.04)',
  },
  light: {
    default: 'rgba(0, 0, 0, 0.08)',
    subtle: 'rgba(0, 0, 0, 0.04)',
  },
} as const;

// === Purple Accent Palette (UI chrome — no functional meaning) ===
export const purple = {
  solid: '#8b5cf6',
  muted: 'rgba(139, 92, 246, 0.25)',
  subtle: 'rgba(139, 92, 246, 0.12)',
  text: '#a78bfa',
} as const;

// === Functional Colors (data only — same in both themes) ===
export const functional = {
  download: '#6366f1',
  upload: '#ec4899',
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#06b6d4',
} as const;

// === Functional with opacity variants ===
export const functionalBg = {
  download: 'rgba(99, 102, 241, 0.32)',
  upload: 'rgba(236, 72, 153, 0.32)',
  success: 'rgba(34, 197, 94, 0.15)',
  error: 'rgba(239, 68, 68, 0.15)',
  warning: 'rgba(245, 158, 11, 0.15)',
  info: 'rgba(6, 182, 212, 0.15)',
} as const;
