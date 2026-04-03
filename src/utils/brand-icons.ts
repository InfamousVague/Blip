/**
 * Brand icon resolver — Static Simple Icons SVGs -> glassmorphism fallback
 *
 * Uses pre-generated SVG data URLs from simple-icons package.
 * No async loading, no dynamic imports — everything is static and instant.
 */

import { BRAND_SVGS } from "./brand-svgs";
import { DOMAIN_TO_BRAND } from "./domainBrandMap";

/**
 * Check if a hex color is too dark to be visible on a dark background.
 * Uses perceived brightness formula: (0.299*R + 0.587*G + 0.114*B) / 255
 * Returns true if luminance < 0.3
 */
function isDarkColor(hex: string): boolean {
  // Strip leading # if present
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.3;
}

/**
 * If the SVG data URL has a dark fill color, replace it with white
 * so the icon is visible on the dark sidebar background.
 */
function ensureVisibleFill(dataUrl: string): string {
  // The fill color is URL-encoded as fill%3D%22%23RRGGBB%22
  // which decodes to fill="#RRGGBB"
  const fillPattern = /fill%3D%22%23([0-9A-Fa-f]{6})%22/;
  const match = dataUrl.match(fillPattern);
  if (!match) return dataUrl;
  const hexColor = match[1];
  if (isDarkColor(hexColor)) {
    return dataUrl.replace(fillPattern, "fill%3D%22%23ffffff%22");
  }
  return dataUrl;
}

/**
 * Extract a brand keyword from a domain name.
 * Checks each domain part against our mapping.
 */
function extractBrandKey(domain: string): string | null {
  const clean = domain.replace(/^www\./, "").toLowerCase();
  const parts = clean.split(".");

  // Check each part against our mapping (right to left, skip TLD)
  for (let i = parts.length - 2; i >= 0; i--) {
    const part = parts[i];
    if (DOMAIN_TO_BRAND[part]) return DOMAIN_TO_BRAND[part];
  }

  // Also try the full second-level domain
  if (parts.length >= 2) {
    const sld = parts[parts.length - 2];
    if (DOMAIN_TO_BRAND[sld]) return DOMAIN_TO_BRAND[sld];
  }

  return null;
}

export interface BrandIconResult {
  url: string;
  brandName: string;
  color: string | null;
}

/**
 * Extract the brand's hex color from its SVG data URL.
 * The fill is URL-encoded as fill%3D%22%23RRGGBB%22
 */
function extractBrandColor(dataUrl: string): string | null {
  const match = dataUrl.match(/fill%3D%22%23([0-9A-Fa-f]{6})%22/);
  if (!match) return null;
  const hex = `#${match[1]}`;
  // Lighten very dark colors for visibility on dark backgrounds
  if (isDarkColor(match[1])) return "#AAAAAA";
  return hex;
}

/**
 * Extract the brand's true original hex color (no lightening).
 * Used for backgrounds where we control text color separately.
 */
function extractRawBrandColor(dataUrl: string): string | null {
  const match = dataUrl.match(/fill%3D%22%23([0-9A-Fa-f]{6})%22/);
  return match ? `#${match[1]}` : null;
}

/**
 * Get the raw (unmodified) brand color for a domain or service name.
 * Returns the true brand color even for dark brands like Apple/GitHub.
 */
export function getRawBrandColor(
  domain: string | undefined | null,
  serviceName?: string | null
): string | null {
  if (serviceName) {
    const key = serviceName.toLowerCase();
    if (BRAND_SVGS[key]) return extractRawBrandColor(BRAND_SVGS[key]);
    if (DOMAIN_TO_BRAND[key]) {
      const brandKey = DOMAIN_TO_BRAND[key];
      if (BRAND_SVGS[brandKey]) return extractRawBrandColor(BRAND_SVGS[brandKey]);
    }
  }
  if (!domain) return null;
  const brandKey = extractBrandKey(domain);
  if (!brandKey || !BRAND_SVGS[brandKey]) return null;
  return extractRawBrandColor(BRAND_SVGS[brandKey]);
}

/**
 * Returns perceived luminance 0-1 for a hex color.
 * Use to decide if text on this background should be light or dark.
 */
export function getLuminance(hex: string): number {
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Get the brand color for a domain or service name.
 * Returns the official brand color, lightened if too dark.
 */
export function getBrandColor(
  domain: string | undefined | null,
  serviceName?: string | null
): string | null {
  // Try service name first
  if (serviceName) {
    const key = serviceName.toLowerCase();
    if (BRAND_SVGS[key]) return extractBrandColor(BRAND_SVGS[key]);
    if (DOMAIN_TO_BRAND[key]) {
      const brandKey = DOMAIN_TO_BRAND[key];
      if (BRAND_SVGS[brandKey]) return extractBrandColor(BRAND_SVGS[brandKey]);
    }
  }
  if (!domain) return null;
  const brandKey = extractBrandKey(domain);
  if (!brandKey || !BRAND_SVGS[brandKey]) return null;
  return extractBrandColor(BRAND_SVGS[brandKey]);
}

/**
 * Get a brand icon for a domain — synchronous, instant.
 * Optionally pass a serviceName (from endpoint classification) to override domain matching.
 * Returns the SVG data URL or null (use glassmorphism fallback).
 */
export function getBrandIcon(
  domain: string | undefined | null,
  serviceName?: string | null
): BrandIconResult | null {
  // Try service name first (e.g., "discord", "Apple", "Anthropic")
  if (serviceName) {
    const key = serviceName.toLowerCase();
    if (BRAND_SVGS[key]) return { url: ensureVisibleFill(BRAND_SVGS[key]), brandName: key, color: extractBrandColor(BRAND_SVGS[key]) };
    // Also check if service name maps via domain lookup
    if (DOMAIN_TO_BRAND[key]) {
      const brandKey = DOMAIN_TO_BRAND[key];
      if (BRAND_SVGS[brandKey]) return { url: ensureVisibleFill(BRAND_SVGS[brandKey]), brandName: brandKey, color: extractBrandColor(BRAND_SVGS[brandKey]) };
    }
  }

  // Then try domain
  if (!domain) return null;
  const brandKey = extractBrandKey(domain);
  if (!brandKey) return null;
  const url = BRAND_SVGS[brandKey];
  if (!url) return null;
  return { url: ensureVisibleFill(url), brandName: brandKey, color: extractBrandColor(url) };
}

/**
 * Check if a brand icon exists for a domain — synchronous.
 */
export function hasBrandIcon(domain: string | undefined | null): boolean {
  return getBrandIcon(domain) !== null;
}
