import Foundation
import NetworkExtension
import os.log

/// NEFilterDataProvider — Full firewall with rule engine.
/// SAFETY RULES:
/// 1. handleNewFlow() MUST return immediately — never block
/// 2. ALL processing (socket, string ops, process lookup) on background queue
/// 3. Every operation wrapped in do/catch — no crashes, no exceptions
/// 4. Socket failures are silently dropped — never propagate to filter
/// 5. macOS fail-closed: if this extension crashes, ALL internet dies
/// 6. On ANY error in the match path → .allow(). Never block traffic due to bugs.
class BlipFilterProvider: NEFilterDataProvider {

    private let log = OSLog(subsystem: "com.infamousvague.blip.network-extension", category: "filter")
    private var socketBridge: SocketBridge?
    private var flowCount: UInt64 = 0
    private var blockedCount: UInt64 = 0
    private let workQueue = DispatchQueue(label: "com.infamousvague.blip.ne.work", qos: .utility)

    /// IPs known to belong to blocked domains — populated from app via socket.
    private var blockedIPs: Set<String> = []
    private let blockedIPsLock = NSLock()

    /// Pre-compiled rule matching engine.
    private let ruleIndex = RuleIndex()

    /// IP→domain cache populated from DNS proxy events.
    private var ipToDomain: [String: (domain: String, timestamp: UInt64)] = [:]
    private let ipToDomainLock = NSLock()
    private let ipToDomainMaxEntries = 50_000
    private let ipToDomainTTLMs: UInt64 = 300_000 // 5 minutes

    /// System whitelist — Apple processes that always pass through.
    private let systemWhitelist: Set<String> = [
        "com.apple.mDNSResponder", "com.apple.trustd", "com.apple.nsurlsessiond",
        "com.apple.softwareupdated", "com.apple.mobileassetd", "com.apple.AppleIDAuthAgent",
        "com.apple.akd", "com.apple.cloudd", "com.apple.identityservicesd",
        "com.apple.timed", "com.apple.networkserviceproxy", "com.apple.symptomsd",
        "com.apple.mediaremoted", "com.apple.apsd", "com.apple.CommCenter",
        "com.apple.geod", "com.apple.locationd", "com.apple.parsecd",
        "com.apple.security.cloudkeychainproxy3", "com.apple.iCloudNotificationAgent",
        "com.infamousvague.blip",
    ]

    /// Per-flow byte accumulators — keyed by "destIp:destPort"
    private var flowBytes: [String: FlowByteTracker] = [:]
    private let flowBytesLock = NSLock()
    private var flowReportTimer: DispatchSourceTimer?

    /// Pending approval requests (flow allowed temporarily, waiting for user decision)
    private var pendingApprovals: [String: UInt64] = [:] // requestId -> timestamp

    // MARK: - Filter Lifecycle

    override func startFilter(completionHandler: @escaping (Error?) -> Void) {
        os_log("BlipFilter: starting (v2 rule engine)", log: log, type: .info)
        neDebugLog("BlipFilter: startFilter called (v2)")

        let networkRule = NENetworkRule(
            remoteNetwork: nil,
            remotePrefix: 0,
            localNetwork: nil,
            localPrefix: 0,
            protocol: .any,
            direction: .any
        )
        let filterRule = NEFilterRule(networkRule: networkRule, action: .filterData)
        let filterSettings = NEFilterSettings(rules: [filterRule], defaultAction: .allow)

        apply(filterSettings) { error in
            if let error = error {
                os_log("BlipFilter: failed to apply settings: %{public}@", log: self.log, type: .error, error.localizedDescription)
            } else {
                os_log("BlipFilter: settings applied, filter active", log: self.log, type: .info)
                self.workQueue.async {
                    self.socketBridge = SocketBridge()
                    self.socketBridge?.delegate = self
                    self.socketBridge?.connect()
                    self.startFlowReportTimer()
                }
            }
            completionHandler(error)
        }
    }

    override func stopFilter(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        os_log("BlipFilter: stopping, reason: %d, total flows: %llu", log: log, type: .info, reason.rawValue, flowCount)
        flowReportTimer?.cancel()
        flowReportTimer = nil
        socketBridge?.disconnect()
        socketBridge = nil
        completionHandler()
    }

    // MARK: - Flow Handling (HOT PATH — must be <1ms)

    override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
        flowCount += 1

        // Extract flow info — if any guard fails, allow
        guard let socketFlow = flow as? NEFilterSocketFlow,
              let remoteEndpoint = socketFlow.remoteEndpoint as? NWHostEndpoint else {
            return .allow()
        }

        let destIp = remoteEndpoint.hostname
        let destPort = UInt16(remoteEndpoint.port) ?? 0

        // 1. Always allow localhost
        if destIp == "127.0.0.1" || destIp == "::1" || destIp.hasPrefix("fe80:") {
            return .allow()
        }

        // 2. Always allow LAN (private IPs)
        if isPrivateIP(destIp) {
            return .allow()
        }

        // 3. Resolve bundle ID
        var bundleId: String? = nil
        if let token = socketFlow.sourceAppAuditToken {
            bundleId = bundleIdentifier(from: token)
        }

        // 4. System whitelist — always allow Apple processes and Blip itself
        if let bid = bundleId, systemWhitelist.contains(bid) {
            return .allow()
        }

        // 5. Check DNS-blocked IPs
        blockedIPsLock.lock()
        let isBlocked = blockedIPs.contains(destIp)
        blockedIPsLock.unlock()
        if isBlocked {
            blockedCount += 1
            sendBlockEvent(bundleId: bundleId ?? "unknown", destIp: destIp, destPort: destPort,
                           proto: "unknown", direction: "outbound", reason: "dns_block", ruleId: nil)
            return .drop()
        }

        // 6. Look up domain from DNS cache
        ipToDomainLock.lock()
        let cachedDomain = ipToDomain[destIp]?.domain
        ipToDomainLock.unlock()

        // 7. Determine protocol and direction
        let proto: CompiledProtocol
        switch socketFlow.socketProtocol {
        case 6:  proto = .tcp
        case 17: proto = .udp
        default: proto = .any
        }

        let dir: CompiledDirection
        switch socketFlow.direction {
        case .outbound: dir = .outbound
        case .inbound:  dir = .inbound
        default:        dir = .any
        }

        // 8. Match against rule index
        let matchResult = ruleIndex.match(
            bundleId: bundleId ?? "*",
            domain: cachedDomain,
            port: destPort,
            proto: proto,
            dir: dir
        )

        let protoStr: String
        switch proto {
        case .tcp: protoStr = "tcp"
        case .udp: protoStr = "udp"
        case .any: protoStr = "other"
        }

        let dirStr: String
        switch dir {
        case .outbound: dirStr = "outbound"
        case .inbound:  dirStr = "inbound"
        case .any:      dirStr = "any"
        }

        let bid = bundleId ?? "unknown"
        let verdict: NEFilterNewFlowVerdict

        if let (action, ruleId) = matchResult {
            switch action {
            case .allow:
                verdict = .filterDataVerdict(withFilterInbound: true, peekInboundBytes: Int.max,
                                             filterOutbound: true, peekOutboundBytes: Int.max)
                sendConnectionEvent(bundleId: bid, destIp: destIp, destPort: destPort,
                                    proto: protoStr, direction: dirStr, verdict: "allow",
                                    matchedRuleId: ruleId, domain: cachedDomain)
            case .deny:
                verdict = .drop()
                blockedCount += 1
                sendBlockEvent(bundleId: bid, destIp: destIp, destPort: destPort,
                               proto: protoStr, direction: dirStr, reason: "rule", ruleId: ruleId)
                sendConnectionEvent(bundleId: bid, destIp: destIp, destPort: destPort,
                                    proto: protoStr, direction: dirStr, verdict: "deny",
                                    matchedRuleId: ruleId, domain: cachedDomain)
            case .ask:
                // Allow temporarily, send approval request
                verdict = .filterDataVerdict(withFilterInbound: true, peekInboundBytes: Int.max,
                                             filterOutbound: true, peekOutboundBytes: Int.max)
                sendApprovalRequest(bundleId: bid, destIp: destIp, destPort: destPort,
                                   proto: protoStr, direction: dirStr, domain: cachedDomain)
            }
        } else {
            // No matching rule — use mode-based default
            switch ruleIndex.mode {
            case "deny_all":
                verdict = .drop()
                blockedCount += 1
                sendBlockEvent(bundleId: bid, destIp: destIp, destPort: destPort,
                               proto: protoStr, direction: dirStr, reason: "deny_all_mode", ruleId: nil)
            case "ask":
                // Allow temporarily, ask user
                verdict = .filterDataVerdict(withFilterInbound: true, peekInboundBytes: Int.max,
                                             filterOutbound: true, peekOutboundBytes: Int.max)
                sendApprovalRequest(bundleId: bid, destIp: destIp, destPort: destPort,
                                   proto: protoStr, direction: dirStr, domain: cachedDomain)
            default: // "allow_all" or unknown
                verdict = .filterDataVerdict(withFilterInbound: true, peekInboundBytes: Int.max,
                                             filterOutbound: true, peekOutboundBytes: Int.max)
                sendConnectionEvent(bundleId: bid, destIp: destIp, destPort: destPort,
                                    proto: protoStr, direction: dirStr, verdict: "allow",
                                    matchedRuleId: nil, domain: cachedDomain)
            }
        }

        return verdict
    }

    // MARK: - Data Handlers (byte tracking)

    override func handleInboundData(from flow: NEFilterFlow, readBytesStartOffset: Int, readBytes: Data) -> NEFilterDataVerdict {
        trackBytes(flow: flow, bytesIn: UInt64(readBytes.count), bytesOut: 0)
        return .allow()
    }

    override func handleOutboundData(from flow: NEFilterFlow, readBytesStartOffset: Int, readBytes: Data) -> NEFilterDataVerdict {
        trackBytes(flow: flow, bytesIn: 0, bytesOut: UInt64(readBytes.count))
        return .allow()
    }

    private func trackBytes(flow: NEFilterFlow, bytesIn: UInt64, bytesOut: UInt64) {
        guard let socketFlow = flow as? NEFilterSocketFlow,
              let remoteEndpoint = socketFlow.remoteEndpoint as? NWHostEndpoint else {
            return
        }

        let destIp = remoteEndpoint.hostname
        let destPort = Int(UInt16(remoteEndpoint.port) ?? 0)
        let key = "\(destIp):\(destPort)"

        var appId = "unknown"
        if let token = socketFlow.sourceAppAuditToken {
            appId = bundleIdentifier(from: token) ?? "unknown"
        }

        flowBytesLock.lock()
        if var tracker = flowBytes[key] {
            tracker.bytesIn += bytesIn
            tracker.bytesOut += bytesOut
            flowBytes[key] = tracker
        } else {
            var tracker = FlowByteTracker(destIp: destIp, destPort: destPort)
            tracker.bytesIn = bytesIn
            tracker.bytesOut = bytesOut
            tracker.sourceAppId = appId
            flowBytes[key] = tracker
        }
        flowBytesLock.unlock()
    }

    // MARK: - Event Senders (background queue)

    private func sendConnectionEvent(bundleId: String, destIp: String, destPort: UInt16,
                                     proto: String, direction: String, verdict: String,
                                     matchedRuleId: String?, domain: String?) {
        workQueue.async { [weak self] in
            let ts = UInt64(Date().timeIntervalSince1970 * 1000)
            let event = NEConnectionEvent(
                sourceAppId: bundleId, sourcePid: 0,
                destIp: destIp, destPort: Int(destPort),
                protocol: proto, direction: direction, timestampMs: ts
            )
            self?.socketBridge?.send(event: event, verdict: verdict,
                                    matchedRuleId: matchedRuleId, domain: domain)
        }
    }

    private func sendApprovalRequest(bundleId: String, destIp: String, destPort: UInt16,
                                     proto: String, direction: String, domain: String?) {
        workQueue.async { [weak self] in
            let requestId = UUID().uuidString
            let ts = UInt64(Date().timeIntervalSince1970 * 1000)

            self?.pendingApprovals[requestId] = ts

            let request: [String: Any] = [
                "id": requestId,
                "app_id": bundleId,
                "app_name": bundleId.components(separatedBy: ".").last ?? bundleId,
                "domain": domain as Any,
                "dest_ip": destIp,
                "dest_port": destPort,
                "protocol": proto,
                "direction": direction,
                "is_background": false,
                "is_tracker": false,
                "timestamp_ms": ts,
            ]
            self?.socketBridge?.sendApprovalRequest(request)
        }
    }

    private func sendBlockEvent(bundleId: String, destIp: String, destPort: UInt16,
                                proto: String, direction: String, reason: String, ruleId: String?) {
        workQueue.async { [weak self] in
            let ts = UInt64(Date().timeIntervalSince1970 * 1000)
            let event: [String: Any] = [
                "type": "block_event",
                "app_id": bundleId,
                "dest_ip": destIp,
                "dest_port": destPort,
                "protocol": proto,
                "direction": direction,
                "reason": reason,
                "rule_id": ruleId as Any,
                "timestamp_ms": ts,
            ]
            self?.socketBridge?.sendRaw(jsonDict: event)
        }
    }

    // MARK: - Flow Report Timer

    private func startFlowReportTimer() {
        let timer = DispatchSource.makeTimerSource(queue: workQueue)
        timer.schedule(deadline: .now() + 2.0, repeating: 2.0)
        timer.setEventHandler { [weak self] in
            self?.flushFlowUpdates()
        }
        timer.resume()
        flowReportTimer = timer
    }

    private func flushFlowUpdates() {
        flowBytesLock.lock()
        let snapshot = flowBytes
        flowBytesLock.unlock()

        let ts = UInt64(Date().timeIntervalSince1970 * 1000)

        for (_, tracker) in snapshot {
            if tracker.bytesIn == 0 && tracker.bytesOut == 0 { continue }

            let update = NEFlowUpdateEvent(
                destIp: tracker.destIp,
                destPort: tracker.destPort,
                sourceAppId: tracker.sourceAppId,
                bytesIn: tracker.bytesIn,
                bytesOut: tracker.bytesOut,
                timestampMs: ts
            )
            socketBridge?.send(flowUpdate: update)
        }

        // Clean stale IP→domain cache entries (>5 min old)
        let cutoff = ts - ipToDomainTTLMs
        ipToDomainLock.lock()
        ipToDomain = ipToDomain.filter { $0.value.timestamp > cutoff }
        ipToDomainLock.unlock()
    }

    // MARK: - Helpers

    private func isPrivateIP(_ ip: String) -> Bool {
        if ip.hasPrefix("10.") { return true }
        if ip.hasPrefix("192.168.") { return true }
        if ip.hasPrefix("172.") {
            let parts = ip.split(separator: ".")
            if parts.count >= 2, let second = Int(parts[1]) {
                return (16...31).contains(second)
            }
        }
        if ip == "0.0.0.0" || ip == "::" { return true }
        return false
    }

    private func bundleIdentifier(from auditToken: Data?) -> String? {
        guard let token = auditToken, token.count >= 32 else { return nil }

        let pid = token.withUnsafeBytes { ptr -> Int32 in
            ptr.load(fromByteOffset: 20, as: Int32.self)
        }
        guard pid > 0 else { return nil }

        var pathBuffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        let pathLen = proc_pidpath(pid, &pathBuffer, UInt32(MAXPATHLEN))
        guard pathLen > 0 else { return nil }

        let path = String(cString: pathBuffer)

        var url = URL(fileURLWithPath: path)
        while url.pathExtension != "app" && url.path != "/" {
            url = url.deletingLastPathComponent()
        }

        if url.pathExtension == "app" {
            let infoPlist = url.appendingPathComponent("Contents/Info.plist")
            if let dict = NSDictionary(contentsOf: infoPlist),
               let bundleId = dict["CFBundleIdentifier"] as? String {
                return bundleId
            }
        }

        return path.components(separatedBy: "/").last
    }
}

// MARK: - SocketBridgeDelegate

extension BlipFilterProvider: SocketBridgeDelegate {
    func socketBridge(_ bridge: SocketBridge, didReceiveBlocklistSync domains: Set<String>) {
        // Filter provider doesn't use domain blocklist — that's for the DNS proxy
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveBlockedIPs ips: Set<String>) {
        blockedIPsLock.lock()
        blockedIPs = ips
        blockedIPsLock.unlock()
        os_log("BlipFilter: updated blocked IPs (%d entries)", log: log, type: .info, ips.count)
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveFirewallRules rules: [FirewallRuleMsg]) {
        // Legacy compat — ignore, use firewall_config instead
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveFirewallConfig mode: String, killSwitch: Bool,
                      profileId: String, rules: [[String: Any]]) {
        ruleIndex.loadRules(from: rules, mode: mode, killSwitch: killSwitch, profileId: profileId)
        neDebugLog("BlipFilter: loaded \(rules.count) rules, mode=\(mode), killSwitch=\(killSwitch)")
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveDNSCacheUpdate mappings: [String: String]) {
        let ts = UInt64(Date().timeIntervalSince1970 * 1000)
        ipToDomainLock.lock()
        for (ip, domain) in mappings {
            ipToDomain[ip] = (domain: domain, timestamp: ts)
        }
        // Evict if too large
        if ipToDomain.count > ipToDomainMaxEntries {
            let sorted = ipToDomain.sorted { $0.value.timestamp < $1.value.timestamp }
            let removeCount = ipToDomain.count - ipToDomainMaxEntries + 1000
            for (key, _) in sorted.prefix(removeCount) {
                ipToDomain.removeValue(forKey: key)
            }
        }
        ipToDomainLock.unlock()
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveKillSwitch active: Bool) {
        ruleIndex.killSwitch = active
        neDebugLog("BlipFilter: kill switch \(active ? "ACTIVATED" : "deactivated")")
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveApprovalVerdict requestId: String, action: String) {
        pendingApprovals.removeValue(forKey: requestId)
        neDebugLog("BlipFilter: approval verdict for \(requestId): \(action)")
        // Note: The rule created from this verdict will be synced via firewall_config
    }
}
