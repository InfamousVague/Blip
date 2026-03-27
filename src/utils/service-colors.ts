/**
 * Stable color assignment for services.
 * Uses official brand colors from Simple Icons when available,
 * falls back to a palette for unknown services.
 */

import { getBrandColor } from "./brand-icons";

const PALETTE = [
  "#6366f1", // indigo
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#ec4899", // pink
  "#10b981", // emerald
  "#f97316", // orange
  "#3b82f6", // blue
  "#ef4444", // red
  "#14b8a6", // teal
];

const FALLBACK_COLOR = "#6b7280"; // gray

const colorMap = new Map<string, string>();
let nextIndex = 0;

/** Get a stable color for a service name — prefers official brand colors */
export function getServiceColor(serviceName: string): string {
  if (!serviceName) return FALLBACK_COLOR;
  const existing = colorMap.get(serviceName);
  if (existing) return existing;

  // Try to get the official brand color first
  const brandColor = getBrandColor(null, serviceName);
  if (brandColor) {
    colorMap.set(serviceName, brandColor);
    return brandColor;
  }

  // Fall back to palette
  const color = nextIndex < PALETTE.length ? PALETTE[nextIndex] : FALLBACK_COLOR;
  colorMap.set(serviceName, color);
  nextIndex++;
  return color;
}

/** Get the full color map (for charts that need all colors at once) */
export function getAllServiceColors(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, color] of colorMap) {
    result[name] = color;
  }
  return result;
}

/** Parse hex color to RGBA array */
export function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, Math.round(alpha * 255)];
}
