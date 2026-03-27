export type EndpointType = "streaming" | "chat" | "shield" | "server";

// Known IP ranges for major services (first octets or prefixes)
const IP_SERVICE_MAP: { prefix: string; service: string }[] = [
  // Google / YouTube
  { prefix: "142.250.", service: "google" },
  { prefix: "172.217.", service: "google" },
  { prefix: "216.58.", service: "google" },
  { prefix: "192.178.", service: "google" },
  { prefix: "74.125.", service: "google" },
  { prefix: "173.194.", service: "google" },
  { prefix: "209.85.", service: "google" },
  { prefix: "108.177.", service: "google" },
  { prefix: "172.253.", service: "google" },
  { prefix: "35.186.", service: "google" },
  { prefix: "35.190.", service: "google" },
  { prefix: "34.149.", service: "google" },
  { prefix: "34.117.", service: "google" },
  // Apple
  { prefix: "17.", service: "apple" },
  // Discord / Cloudflare
  { prefix: "162.159.", service: "discord" },
  { prefix: "104.16.", service: "cloudflare" },
  { prefix: "104.17.", service: "cloudflare" },
  { prefix: "104.18.", service: "cloudflare" },
  { prefix: "104.19.", service: "cloudflare" },
  { prefix: "104.20.", service: "cloudflare" },
  { prefix: "104.21.", service: "cloudflare" },
  { prefix: "104.22.", service: "cloudflare" },
  { prefix: "104.23.", service: "cloudflare" },
  { prefix: "104.24.", service: "cloudflare" },
  { prefix: "104.25.", service: "cloudflare" },
  { prefix: "104.26.", service: "cloudflare" },
  { prefix: "104.27.", service: "cloudflare" },
  // Amazon / AWS
  { prefix: "18.", service: "aws" },
  { prefix: "13.", service: "aws" },
  { prefix: "52.", service: "aws" },
  { prefix: "54.", service: "aws" },
  { prefix: "3.", service: "aws" },
  // Microsoft / Azure
  { prefix: "13.107.", service: "microsoft" },
  { prefix: "40.126.", service: "microsoft" },
  { prefix: "20.", service: "microsoft" },
  { prefix: "204.79.", service: "microsoft" },
  // Netflix
  { prefix: "45.57.", service: "netflix" },
  { prefix: "23.246.", service: "netflix" },
  { prefix: "185.2.220.", service: "netflix" },
  // Spotify
  { prefix: "35.186.224.", service: "spotify" },
  // Meta / Facebook
  { prefix: "157.240.", service: "meta" },
  { prefix: "31.13.", service: "meta" },
  // Anthropic / Claude
  { prefix: "160.79.", service: "anthropic" },
];

// Domain patterns for classification
const STREAMING_PATTERNS = [
  "youtube", "googlevideo", "netflix", "nflx", "spotify", "scdn",
  "twitch", "ttvnw", "hulu", "disneyplus", "disney", "hbo", "max.com",
  "primevideo", "amazon", "plex", "crunchyroll", "dazn", "apple.com/tv",
  "music.apple", "itunes", "soundcloud", "bandcamp", "vimeo", "dailymotion",
  "tidal", "pandora",
];

const CHAT_PATTERNS = [
  "discord", "slack", "whatsapp", "telegram", "signal", "messenger",
  "teams.microsoft", "zoom", "webex", "imessage", "facetime",
  "skype", "viber", "line.me", "kakaotalk", "wechat",
  "identityservicesd", // macOS iMessage/FaceTime
  "imagent", // macOS Messages
];

const VPN_SECURITY_PATTERNS = [
  "nordvpn", "expressvpn", "surfshark", "protonvpn", "mullvad",
  "wireguard", "openvpn", "tailscale", "1password", "lastpass",
  "bitwarden", "dashlane", "okta", "auth0", "duo",
  "littlesnitch", "lulu", "malwarebytes", "sophos", "crowdstrike",
];

/** Identify which service owns an IP address */
function identifyServiceByIp(ip: string | null): string | null {
  if (!ip) return null;
  for (const { prefix, service } of IP_SERVICE_MAP) {
    if (ip.startsWith(prefix)) return service;
  }
  return null;
}

/** Service name to type mapping */
const SERVICE_TO_TYPE: Record<string, EndpointType> = {
  google: "streaming",
  netflix: "streaming",
  spotify: "streaming",
  apple: "server",
  discord: "chat",
  meta: "chat",
  anthropic: "server",
  aws: "server",
  microsoft: "server",
  cloudflare: "server",
};

/** Human-readable service labels */
const SERVICE_LABELS: Record<string, string> = {
  google: "Google",
  netflix: "Netflix",
  spotify: "Spotify",
  apple: "Apple",
  discord: "Discord",
  meta: "Meta",
  anthropic: "Anthropic",
  aws: "AWS",
  microsoft: "Microsoft",
  cloudflare: "Cloudflare",
};

/**
 * Classify an endpoint based on domain name, process name, and/or IP address.
 */
export function classifyEndpoint(
  domain: string | null,
  processName: string | null,
  destIp?: string | null,
): { type: EndpointType; serviceName: string | null } {
  const domainLower = (domain ?? "").toLowerCase();
  const processLower = (processName ?? "").toLowerCase();
  const text = `${domainLower} ${processLower}`;

  // Check domain/process patterns first
  for (const pattern of CHAT_PATTERNS) {
    if (text.includes(pattern)) return { type: "chat", serviceName: pattern };
  }
  for (const pattern of VPN_SECURITY_PATTERNS) {
    if (text.includes(pattern)) return { type: "shield", serviceName: pattern };
  }
  for (const pattern of STREAMING_PATTERNS) {
    if (text.includes(pattern)) return { type: "streaming", serviceName: pattern };
  }

  // Fall back to IP-based identification
  const service = identifyServiceByIp(destIp ?? null);
  if (service) {
    return {
      type: SERVICE_TO_TYPE[service] ?? "server",
      serviceName: SERVICE_LABELS[service] ?? service,
    };
  }

  return { type: "server", serviceName: null };
}
