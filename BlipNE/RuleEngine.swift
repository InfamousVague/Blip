import Foundation

// MARK: - Rule Matching Engine
// Pre-compiled rule index for fast matching in handleNewFlow().
// Target: <1ms per match. No allocations, no async, no DNS lookups.

enum RuleAction: String {
    case allow = "allow"
    case deny = "deny"
    case ask = "ask"
}

enum CompiledDirection {
    case inbound, outbound, any
}

enum CompiledProtocol {
    case tcp, udp, any
}

// MARK: - Domain Matcher

enum DomainMatcher {
    case exact(String)                    // "example.com"
    case wildcard(String)                 // Stored as ".example.com"
    case regex(NSRegularExpression)       // Pre-compiled regex
    case category(String)                 // Category name (resolved externally)

    func matches(_ domain: String?) -> Bool {
        guard let domain = domain?.lowercased() else { return false }

        switch self {
        case .exact(let pattern):
            return domain == pattern.lowercased()

        case .wildcard(let suffix):
            let lowerSuffix = suffix.lowercased()
            // Matches "foo.example.com" and "example.com" for pattern "*.example.com"
            return domain.hasSuffix(lowerSuffix) || domain == String(lowerSuffix.dropFirst())

        case .regex(let regex):
            let range = NSRange(domain.startIndex..<domain.endIndex, in: domain)
            return regex.firstMatch(in: domain, range: range) != nil

        case .category:
            // Category matching is resolved at compile time by expanding into exact/wildcard rules
            return false
        }
    }
}

// MARK: - Port Matcher

enum PortMatcher {
    case single(UInt16)
    case range(ClosedRange<UInt16>)
    case set(Set<UInt16>)

    func matches(_ port: UInt16) -> Bool {
        switch self {
        case .single(let p): return port == p
        case .range(let r):  return r.contains(port)
        case .set(let s):    return s.contains(port)
        }
    }
}

// MARK: - Compiled Rule

struct CompiledRule {
    let id: String
    let appId: String
    let action: RuleAction
    let domainMatcher: DomainMatcher?
    let portMatcher: PortMatcher?
    let protocolMatch: CompiledProtocol
    let direction: CompiledDirection
    let lifetime: String       // "once", "session", "forever"
    let priority: Int
    let specificity: Int       // Higher = more specific = checked first

    /// Check if this rule matches the given connection parameters.
    func matches(domain: String?, port: UInt16, proto: CompiledProtocol, dir: CompiledDirection) -> Bool {
        // Domain check
        if let dm = domainMatcher, !dm.matches(domain) {
            return false
        }
        // Port check
        if let pm = portMatcher, !pm.matches(port) {
            return false
        }
        // Protocol check
        switch (protocolMatch, proto) {
        case (.any, _), (_, .any): break
        case (.tcp, .tcp), (.udp, .udp): break
        default: return false
        }
        // Direction check
        switch (direction, dir) {
        case (.any, _), (_, .any): break
        case (.inbound, .inbound), (.outbound, .outbound): break
        default: return false
        }
        return true
    }
}

// MARK: - Rule Index

class RuleIndex {
    /// Rules grouped by app bundle ID, sorted by specificity desc then priority asc.
    private var rulesByApp: [String: [CompiledRule]] = [:]
    /// Rules where app_id = "*" (global rules).
    private var globalRules: [CompiledRule] = []
    /// Kill switch — when true, block ALL traffic.
    var killSwitch: Bool = false
    /// Active profile ID.
    var activeProfileId: String = "default"
    /// Firewall mode: "ask", "allow_all", "deny_all"
    var mode: String = "ask"

    private let lock = NSLock()

    /// Load rules from JSON array received from the Rust backend.
    func loadRules(from jsonRules: [[String: Any]], mode: String, killSwitch: Bool, profileId: String) {
        var byApp: [String: [CompiledRule]] = [:]
        var global: [CompiledRule] = []

        for json in jsonRules {
            guard let compiled = compileRule(json) else { continue }

            if compiled.appId == "*" {
                global.append(compiled)
            } else {
                byApp[compiled.appId, default: []].append(compiled)
            }
        }

        // Sort each app's rules: specificity desc, then priority asc
        for key in byApp.keys {
            byApp[key]?.sort { a, b in
                if a.specificity != b.specificity { return a.specificity > b.specificity }
                return a.priority < b.priority
            }
        }
        global.sort { a, b in
            if a.specificity != b.specificity { return a.specificity > b.specificity }
            return a.priority < b.priority
        }

        lock.lock()
        self.rulesByApp = byApp
        self.globalRules = global
        self.mode = mode
        self.killSwitch = killSwitch
        self.activeProfileId = profileId
        lock.unlock()
    }

    /// Match a connection against the rule index.
    /// Returns (action, ruleId) or nil if no matching rule.
    func match(bundleId: String, domain: String?, port: UInt16, proto: CompiledProtocol, dir: CompiledDirection) -> (RuleAction, String)? {
        lock.lock()
        defer { lock.unlock() }

        // Kill switch overrides everything
        if killSwitch {
            return (.deny, "kill_switch")
        }

        // Check app-specific rules first
        if let appRules = rulesByApp[bundleId] {
            for rule in appRules {
                if rule.matches(domain: domain, port: port, proto: proto, dir: dir) {
                    return (rule.action, rule.id)
                }
            }
        }

        // Check global rules
        for rule in globalRules {
            if rule.matches(domain: domain, port: port, proto: proto, dir: dir) {
                return (rule.action, rule.id)
            }
        }

        return nil
    }

    // MARK: - Rule Compilation

    private func compileRule(_ json: [String: Any]) -> CompiledRule? {
        guard let id = json["id"] as? String,
              let appId = json["app_id"] as? String,
              let actionStr = json["action"] as? String,
              let action = RuleAction(rawValue: actionStr) else {
            return nil
        }

        // Compile domain matcher
        var domainMatcher: DomainMatcher? = nil
        if let pattern = json["domain_pattern"] as? String {
            let matchType = json["domain_match_type"] as? String ?? "exact"
            switch matchType {
            case "wildcard":
                // "*.example.com" → store as ".example.com"
                if pattern.hasPrefix("*.") {
                    domainMatcher = .wildcard(String(pattern.dropFirst()))
                } else {
                    domainMatcher = .wildcard("." + pattern)
                }
            case "regex":
                let cleanPattern = pattern.hasPrefix("regex:") ? String(pattern.dropFirst(6)) : pattern
                if let regex = try? NSRegularExpression(pattern: cleanPattern, options: .caseInsensitive) {
                    domainMatcher = .regex(regex)
                }
            case "category":
                domainMatcher = .category(pattern)
            default:
                domainMatcher = .exact(pattern)
            }
        }

        // Compile port matcher
        var portMatcher: PortMatcher? = nil
        if let portStr = json["port"] as? String, !portStr.isEmpty {
            if portStr.contains("-") {
                let parts = portStr.split(separator: "-")
                if parts.count == 2,
                   let start = UInt16(parts[0].trimmingCharacters(in: .whitespaces)),
                   let end = UInt16(parts[1].trimmingCharacters(in: .whitespaces)) {
                    portMatcher = .range(start...end)
                }
            } else if portStr.contains(",") {
                let ports = Set(portStr.split(separator: ",").compactMap { UInt16($0.trimmingCharacters(in: .whitespaces)) })
                if !ports.isEmpty {
                    portMatcher = .set(ports)
                }
            } else if let port = UInt16(portStr) {
                portMatcher = .single(port)
            }
        }

        // Protocol
        let protoMatch: CompiledProtocol
        switch json["protocol"] as? String ?? "any" {
        case "tcp": protoMatch = .tcp
        case "udp": protoMatch = .udp
        default:    protoMatch = .any
        }

        // Direction
        let dir: CompiledDirection
        switch json["direction"] as? String ?? "any" {
        case "inbound":  dir = .inbound
        case "outbound": dir = .outbound
        default:         dir = .any
        }

        // Specificity: +4 for domain, +2 for port, +1 for specific protocol
        var specificity = 0
        if domainMatcher != nil { specificity += 4 }
        if portMatcher != nil { specificity += 2 }
        if case .tcp = protoMatch { specificity += 1 }
        if case .udp = protoMatch { specificity += 1 }

        let priority = json["priority"] as? Int ?? 100
        let lifetime = json["lifetime"] as? String ?? "forever"

        return CompiledRule(
            id: id,
            appId: appId,
            action: action,
            domainMatcher: domainMatcher,
            portMatcher: portMatcher,
            protocolMatch: protoMatch,
            direction: dir,
            lifetime: lifetime,
            priority: priority,
            specificity: specificity
        )
    }
}
