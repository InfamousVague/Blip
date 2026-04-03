/** Resolves the latest .dmg download URL from GitHub Releases API.
 *  Falls back to the releases page if the API call fails. */

const RELEASES_PAGE = "https://github.com/InfamousVague/Blip/releases/latest";
const API_URL = "https://api.github.com/repos/InfamousVague/Blip/releases/latest";

let cached: { url: string; version: string } | null = null;

async function fetchRelease() {
  if (cached) return cached;
  try {
    const res = await fetch(API_URL);
    if (!res.ok) return null;
    const data = await res.json();
    const dmg = data.assets?.find((a: { name: string }) => a.name.endsWith(".dmg"));
    const version = (data.tag_name as string)?.replace(/^v/, "") || "";
    if (dmg?.browser_download_url) {
      cached = { url: dmg.browser_download_url, version };
      return cached;
    }
  } catch {
    // API failure
  }
  return null;
}

export async function getLatestDmgUrl(): Promise<string> {
  const release = await fetchRelease();
  return release?.url || RELEASES_PAGE;
}

export async function getLatestVersion(): Promise<string> {
  const release = await fetchRelease();
  return release?.version || "";
}

export const GITHUB_URL = "https://github.com/InfamousVague/Blip";
export const RELEASES_FALLBACK = RELEASES_PAGE;
