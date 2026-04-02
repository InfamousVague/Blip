export interface ResolvedConnection {
  id: string;
  dest_ip: string;
  dest_port: number;
  process_name: string | null;
  protocol: "Tcp" | "Udp" | "Other";
  dest_lat: number;
  dest_lon: number;
  domain: string | null;
  city: string | null;
  country: string | null;
  bytes_sent: number;
  bytes_received: number;
  first_seen_ms: number;
  last_seen_ms: number;
  active: boolean;
  ping_ms: number | null;
  is_tracker: boolean;
  tracker_category: string | null;
  asn?: number;
  asn_org?: string;
  cloud_provider?: string;
  cloud_region?: string;
  datacenter?: string;
  is_cdn: boolean;
  network_type?: string;
}

export interface CaptureSnapshot {
  connections: ResolvedConnection[];
  total_ever: number;
}

export interface HistoricalEndpoint {
  dest_lat: number;
  dest_lon: number;
  connection_count: number;
}

export interface HistoricalStats {
  total_connections: number;
  total_bytes_in: number;
  total_bytes_out: number;
  first_seen_ms: number | null;
  last_seen_ms: number | null;
}

export interface TrackerStats {
  total_tracker_hits: number;
  total_bytes_blocked: number;
  top_domains: TrackerDomainStat[];
}

export interface TrackerDomainStat {
  domain: string;
  category: string | null;
  total_hits: number;
  total_bytes: number;
  last_seen_ms: number;
}

export interface SelfIpInfo {
  isp?: string;
  asn?: number;
  network_type?: string;
}

export interface BlockedAttempt {
  domain: string;
  dest_lat: number;
  dest_lon: number;
  city: string | null;
  country: string | null;
  timestamp_ms: number;
  blocked_by: string | null;
  source_app: string | null;
}

export interface DnsQueryLogEntry {
  domain: string;
  query_type: string;
  response_ips: string[];
  timestamp_ms: number;
  is_blocked: boolean;
  blocked_by: string | null;
  /** Process that made the query (from NE DNS proxy) */
  source_app?: string;
}

export interface DnsStats {
  total_queries: number;
  unique_domains: number;
  blocked_count: number;
  recent_rate: number;
}

// ---- Traceroute ----

export interface TracerouteHop {
  hop_number: number;
  ip: string | null;
  rtt_ms: number | null;
  lat: number | null;
  lon: number | null;
  city: string | null;
  country: string | null;
  asn: number | null;
  asn_org: string | null;
}

export interface TracedRoute {
  dest_ip: string;
  hops: TracerouteHop[];
  traced_at: number;
}
