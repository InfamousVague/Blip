/** Resolves the latest .dmg download URL from GitHub Releases API.
 *  Falls back to the releases page if the API call fails. */

const RELEASES_PAGE = "https://github.com/InfamousVague/Blip/releases/latest";
const API_URL = "https://api.github.com/repos/InfamousVague/Blip/releases/latest";

let cached: string | null = null;

export async function getLatestDmgUrl(): Promise<string> {
  if (cached) return cached;
  try {
    const res = await fetch(API_URL);
    if (!res.ok) return RELEASES_PAGE;
    const data = await res.json();
    const dmg = data.assets?.find((a: { name: string }) => a.name.endsWith(".dmg"));
    if (dmg?.browser_download_url) {
      cached = dmg.browser_download_url;
      return cached;
    }
  } catch {
    // API failure — fall back to releases page
  }
  return RELEASES_PAGE;
}

export const GITHUB_URL = "https://github.com/InfamousVague/Blip";
export const RELEASES_FALLBACK = RELEASES_PAGE;
