import Foundation

// MARK: - Event Types (NE -> App)

struct NEConnectionEvent: Codable {
    let sourceAppId: String
    let sourcePid: Int
    let destIp: String
    let destPort: Int
    let `protocol`: String
    let direction: String
    let timestampMs: UInt64

    enum CodingKeys: String, CodingKey {
        case sourceAppId = "source_app_id"
        case sourcePid = "source_pid"
        case destIp = "dest_ip"
        case destPort = "dest_port"
        case `protocol`
        case direction
        case timestampMs = "timestamp_ms"
    }
}

struct NEDnsEvent: Codable {
    let domain: String
    let queryType: String
    let responseIps: [String]
    let timestampMs: UInt64
    let sourceAppId: String
    let sourcePid: Int
    let blocked: Bool

    enum CodingKeys: String, CodingKey {
        case domain
        case queryType = "query_type"
        case responseIps = "response_ips"
        case timestampMs = "timestamp_ms"
        case sourceAppId = "source_app_id"
        case sourcePid = "source_pid"
        case blocked
    }
}

struct NEFlowUpdateEvent: Codable {
    let destIp: String
    let destPort: Int
    let sourceAppId: String
    let bytesIn: UInt64
    let bytesOut: UInt64
    let timestampMs: UInt64

    enum CodingKeys: String, CodingKey {
        case destIp = "dest_ip"
        case destPort = "dest_port"
        case sourceAppId = "source_app_id"
        case bytesIn = "bytes_in"
        case bytesOut = "bytes_out"
        case timestampMs = "timestamp_ms"
    }
}

/// Wrapper for typed events over the socket.
struct NEEvent: Codable {
    let type_: String
    let connection: NEConnectionEvent?
    let dns: NEDnsEvent?
    let flow_update: NEFlowUpdateEvent?
    // Extended fields for v2
    let verdict: String?
    let matched_rule_id: String?
    let domain: String?
    let approval_request: [String: AnyCodable]?

    enum CodingKeys: String, CodingKey {
        case type_ = "type"
        case connection
        case dns
        case flow_update
        case verdict
        case matched_rule_id
        case domain
        case approval_request
    }

    init(type_: String, connection: NEConnectionEvent? = nil, dns: NEDnsEvent? = nil,
         flow_update: NEFlowUpdateEvent? = nil, verdict: String? = nil,
         matched_rule_id: String? = nil, domain: String? = nil,
         approval_request: [String: AnyCodable]? = nil) {
        self.type_ = type_
        self.connection = connection
        self.dns = dns
        self.flow_update = flow_update
        self.verdict = verdict
        self.matched_rule_id = matched_rule_id
        self.domain = domain
        self.approval_request = approval_request
    }
}

/// Type-erased Codable for heterogeneous dictionaries.
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(String.self) { value = v }
        else if let v = try? container.decode(Int.self) { value = v }
        else if let v = try? container.decode(UInt64.self) { value = v }
        else if let v = try? container.decode(Double.self) { value = v }
        else if let v = try? container.decode(Bool.self) { value = v }
        else { value = "" }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let v = value as? String { try container.encode(v) }
        else if let v = value as? Int { try container.encode(v) }
        else if let v = value as? UInt64 { try container.encode(v) }
        else if let v = value as? UInt16 { try container.encode(v) }
        else if let v = value as? Double { try container.encode(v) }
        else if let v = value as? Bool { try container.encode(v) }
        else { try container.encode(String(describing: value)) }
    }
}

// MARK: - App -> NE Message Types

/// Legacy firewall rule format (kept for backwards compat).
struct FirewallRuleMsg: Codable {
    let app_id: String
    let domain: String?
    let action: String
}

/// Message from the main app to the NE (received via socket).
struct NEAppMessage: Codable {
    let type_: String
    let domains: [String]?
    let ips: [String]?
    let rules: [FirewallRuleMsg]?
    // New v2 fields
    let mode: String?
    let kill_switch: Bool?
    let active_profile_id: String?
    let config_rules: [[String: AnyCodable]]?
    let mappings: [String: String]?
    let active: Bool?
    let request_id: String?
    let action: String?

    enum CodingKeys: String, CodingKey {
        case type_ = "type"
        case domains, ips, rules
        case mode, kill_switch, active_profile_id
        case config_rules, mappings, active
        case request_id, action
    }
}

// MARK: - Delegate Protocol

protocol SocketBridgeDelegate: AnyObject {
    func socketBridge(_ bridge: SocketBridge, didReceiveBlocklistSync domains: Set<String>)
    func socketBridge(_ bridge: SocketBridge, didReceiveBlockedIPs ips: Set<String>)
    func socketBridge(_ bridge: SocketBridge, didReceiveFirewallRules rules: [FirewallRuleMsg])
    func socketBridge(_ bridge: SocketBridge, didReceiveFirewallConfig mode: String, killSwitch: Bool,
                      profileId: String, rules: [[String: Any]])
    func socketBridge(_ bridge: SocketBridge, didReceiveDNSCacheUpdate mappings: [String: String])
    func socketBridge(_ bridge: SocketBridge, didReceiveKillSwitch active: Bool)
    func socketBridge(_ bridge: SocketBridge, didReceiveApprovalVerdict requestId: String, action: String)
}
