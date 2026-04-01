import Foundation
import NetworkExtension
import os.log

/// NEFilterDataProvider — Phase 2 passive monitoring with socket bridge.
/// SAFETY RULES:
/// 1. handleNewFlow() MUST return .allow() immediately — never block
/// 2. ALL processing (socket, string ops, process lookup) on background queue
/// 3. Every operation wrapped in do/catch — no crashes, no exceptions
/// 4. Socket failures are silently dropped — never propagate to filter
/// 5. macOS fail-closed: if this extension crashes, ALL internet dies
class BlipFilterProvider: NEFilterDataProvider {

    private let log = OSLog(subsystem: "com.infamousvague.blip.network-extension", category: "filter")
    private var socketBridge: SocketBridge?
    private var flowCount: UInt64 = 0
    private var blockedCount: UInt64 = 0
    private let workQueue = DispatchQueue(label: "com.infamousvague.blip.ne.work", qos: .utility)

    /// IPs known to belong to blocked domains — populated from app via socket.
    private var blockedIPs: Set<String> = []
    private let blockedIPsLock = NSLock()

    /// Firewall rules: app bundle ID → action ("allow", "deny", "unspecified")
    private var firewallRules: [String: String] = [:]
    private let firewallRulesLock = NSLock()

    /// Per-flow byte accumulators — keyed by "destIp:destPort"
    private var flowBytes: [String: FlowByteTracker] = [:]
    private let flowBytesLock = NSLock()
    private var flowReportTimer: DispatchSourceTimer?

    struct FlowByteTracker {
        var bytesIn: UInt64 = 0
        var bytesOut: UInt64 = 0
        var sourceAppId: String = "unknown"
        var destIp: String
        var destPort: Int
        var lastReported: UInt64 = 0
    }

    // MARK: - Filter Lifecycle

    override func startFilter(completionHandler: @escaping (Error?) -> Void) {
        os_log("BlipFilter: starting", log: log, type: .info)
        neDebugLog("BlipFilter: startFilter called")

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
                // Start socket bridge on background queue — never block startFilter
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

    // MARK: - Flow Handling

    override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
        // SAFETY: Return .allow() FIRST, then do work on background queue.
        // This method is called on the filter's main queue — any delay = internet stalls.
        flowCount += 1

        // Capture everything we need from the flow object NOW (it may be invalid later)
        guard let socketFlow = flow as? NEFilterSocketFlow,
              let remoteEndpoint = socketFlow.remoteEndpoint as? NWHostEndpoint else {
            return .allow()
        }

        let destIp = remoteEndpoint.hostname
        let destPort = UInt16(remoteEndpoint.port) ?? 0

        // Skip private/loopback — no need to report these
        if destIp == "127.0.0.1" || destIp == "::1" || destIp.hasPrefix("fe80:") || isPrivateIP(destIp) {
            return .allow()
        }

        // Skip connections from Blip itself to avoid feedback loop
        // (each Tauri invoke creates a connection the NE sees → event → store → repeat)
        if let token = socketFlow.sourceAppAuditToken,
           let bid = bundleIdentifier(from: token),
           bid == "com.infamousvague.blip" || bid.hasPrefix("com.infamousvague.blip.") {
            return .allow()
        }

        // Check if this IP is blocked (populated from DNS proxy via app)
        blockedIPsLock.lock()
        let isBlocked = blockedIPs.contains(destIp)
        blockedIPsLock.unlock()
        if isBlocked {
            blockedCount += 1
            return .drop()
        }

        // Check firewall rules by app bundle ID
        let auditToken = socketFlow.sourceAppAuditToken
        if let token = auditToken {
            if let bundleId = bundleIdentifier(from: token) {
                firewallRulesLock.lock()
                let rule = firewallRules[bundleId] ?? firewallRules["*"]
                firewallRulesLock.unlock()
                if let action = rule {
                    if action == "deny" {
                        return .drop()
                    } else if action == "allow" {
                        return .allow()
                    }
                    // "unspecified" falls through to normal processing
                }
            }
        }

        let proto: String
        switch socketFlow.socketProtocol {
        case 6:  proto = "tcp"
        case 17: proto = "udp"
        default: proto = "other"
        }

        let direction: String
        switch socketFlow.direction {
        case .outbound: direction = "outbound"
        case .inbound:  direction = "inbound"
        default:        direction = "any"
        }
        let ts = UInt64(Date().timeIntervalSince1970 * 1000)

        // Fire-and-forget on background queue
        workQueue.async { [weak self] in
            guard let self = self else { return }

            // Resolve bundle ID — wrapped in safety
            var bundleId = "unknown"
            do {
                if let token = auditToken {
                    bundleId = self.bundleIdentifier(from: token) ?? "unknown"
                }
            } catch {
                // Should never happen but catch anyway
            }

            let event = NEConnectionEvent(
                sourceAppId: bundleId,
                sourcePid: 0,
                destIp: destIp,
                destPort: Int(destPort),
                protocol: proto,
                direction: direction,
                timestampMs: ts
            )

            // Send to app — silently drops if not connected
            self.socketBridge?.send(event: event)
        }

        // Return filterDataVerdict to get handleInboundData/handleOutboundData called for byte tracking.
        // peekInboundBytes/peekOutboundBytes = Int.max means "pass all data through the handlers".
        // The data handlers immediately return .allow() so data is never delayed.
        return .filterDataVerdict(withFilterInbound: true, peekInboundBytes: Int.max, filterOutbound: true, peekOutboundBytes: Int.max)
    }

    // Data handlers — track bytes then return .allow() immediately
    override func handleInboundData(from flow: NEFilterFlow, readBytesStartOffset: Int, readBytes: Data) -> NEFilterDataVerdict {
        trackBytes(flow: flow, bytesIn: UInt64(readBytes.count), bytesOut: 0)
        return .allow()
    }

    override func handleOutboundData(from flow: NEFilterFlow, readBytesStartOffset: Int, readBytes: Data) -> NEFilterDataVerdict {
        trackBytes(flow: flow, bytesIn: 0, bytesOut: UInt64(readBytes.count))
        return .allow()
    }

    /// Accumulate bytes for a flow. The timer sends batched updates to the app.
    private func trackBytes(flow: NEFilterFlow, bytesIn: UInt64, bytesOut: UInt64) {
        guard let socketFlow = flow as? NEFilterSocketFlow,
              let remoteEndpoint = socketFlow.remoteEndpoint as? NWHostEndpoint else {
            return
        }

        let destIp = remoteEndpoint.hostname
        let destPort = Int(UInt16(remoteEndpoint.port) ?? 0)
        let key = "\(destIp):\(destPort)"

        // Resolve app bundle ID
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

    /// Periodically flush accumulated bytes to the main app via socket.
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
        // Don't clear — keep cumulative totals. The Rust side uses "only update if larger".
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

        // Extract PID from audit token (offset 20, 4 bytes)
        let pid = token.withUnsafeBytes { ptr -> Int32 in
            ptr.load(fromByteOffset: 20, as: Int32.self)
        }
        guard pid > 0 else { return nil }

        // Get executable path from PID
        var pathBuffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        let pathLen = proc_pidpath(pid, &pathBuffer, UInt32(MAXPATHLEN))
        guard pathLen > 0 else { return nil }

        let path = String(cString: pathBuffer)

        // Walk up to .app bundle and read bundle ID from Info.plist
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

        // Fallback: executable name
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

    func socketBridge(_ bridge: SocketBridge, didReceiveFirewallRules rules: [FirewallRule]) {
        firewallRulesLock.lock()
        firewallRules.removeAll()
        for rule in rules {
            firewallRules[rule.app_id] = rule.action
        }
        firewallRulesLock.unlock()
        neDebugLog("BlipFilter: updated firewall rules (\(rules.count) entries)")
    }
}
