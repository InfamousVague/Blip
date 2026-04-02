// ---- Firewall Action & Enums ----

export type FirewallAction = "allow" | "deny" | "ask";
export type RuleLifetime = "once" | "session" | "forever";
export type DomainMatchType = "exact" | "wildcard" | "regex" | "category";
export type Direction = "inbound" | "outbound" | "any";
export type PrivacyGrade = "A+" | "A" | "B" | "C" | "D" | "F";
export type FirewallMode = "ask" | "allow_all" | "deny_all";
export type CodeSigningStatus = "apple" | "developer" | "unsigned" | "unknown";

// ---- Firewall Rule ----

export interface FirewallRule {
  id: string;
  profile_id: string;
  app_id: string;
  app_name: string;
  app_path: string | null;
  action: FirewallAction;
  domain_pattern: string | null;
  domain_match_type: DomainMatchType | null;
  port: string | null; // "443", "80,443", "1024-65535"
  protocol: string | null; // "tcp", "udp", "any"
  direction: Direction;
  lifetime: RuleLifetime;
  hit_count: number;
  bytes_allowed: number;
  bytes_blocked: number;
  last_triggered_ms: number | null;
  enabled: boolean;
  priority: number;
  created_at: number;
  updated_at: number;
}

// ---- App Registry ----

export interface AppInfo {
  app_id: string;
  app_name: string;
  app_path: string | null;
  is_apple_signed: boolean;
  is_system_app: boolean;
  code_signing_status: CodeSigningStatus;
  first_seen_ms: number;
  last_seen_ms: number;
  total_connections: number;
  total_bytes_in: number;
  total_bytes_out: number;
  privacy_score: PrivacyGrade | null;
  tracker_connection_count: number;
  clean_connection_count: number;
}

// ---- Network Profiles ----

export interface NetworkProfile {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  auto_switch_ssid: string | null;
  auto_switch_vpn: boolean;
  created_at: number;
}

// ---- Block History ----

export interface BlockHistoryEntry {
  id: number;
  app_id: string | null;
  domain: string | null;
  dest_ip: string | null;
  dest_port: number | null;
  protocol: string | null;
  direction: string | null;
  rule_id: string | null;
  reason: "rule" | "dns_block" | "kill_switch" | "tracker";
  timestamp_ms: number;
}

export interface BlockStatsHourly {
  hour_bucket: number;
  app_id: string | null;
  domain: string | null;
  block_count: number;
  bytes_blocked: number;
}

// ---- Privacy Scoring ----

export interface PrivacyScore {
  app_id: string;
  score: PrivacyGrade;
  tracker_domains: number;
  total_domains: number;
  tracker_bytes: number;
  total_bytes: number;
  last_calculated_ms: number;
}

// ---- Conflict Detection ----

export interface RuleConflict {
  existing_rule: FirewallRule;
  overlap_description: string;
}

// ---- Firewall State ----

export interface FirewallState {
  mode: FirewallMode;
  kill_switch_active: boolean;
  active_profile_id: string;
  wizard_completed: boolean;
}

// ---- Approval Request ----

export interface FirewallApprovalRequest {
  id: string;
  app_id: string;
  app_name: string;
  domain: string | null;
  dest_ip: string;
  dest_port: number;
  protocol: string;
  direction: string;
  is_background: boolean;
  is_tracker: boolean;
  tracker_category: string | null;
  timestamp_ms: number;
}

// ---- New Rule Request ----

export interface NewRuleRequest {
  profile_id?: string;
  app_id: string;
  app_name: string;
  app_path?: string | null;
  action: FirewallAction;
  domain_pattern?: string | null;
  domain_match_type?: DomainMatchType | null;
  port?: string | null;
  protocol?: string | null;
  direction?: Direction;
  lifetime?: RuleLifetime;
  priority?: number;
}

// ---- App with rules grouped (for UI display) ----

export interface AppWithRules {
  app: AppInfo;
  rules: FirewallRule[];
  blanketRule: FirewallRule | null; // Rule with no domain/port/protocol scoping
  iconUrl: string | null;
}
