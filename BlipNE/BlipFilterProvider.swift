import Foundation
import NetworkExtension
import os.log

/// NEFilterDataProvider subclass that receives callbacks for every TCP/UDP flow.
/// Sends connection events to the main Blip app via a Unix domain socket.
class BlipFilterProvider: NEFilterDataProvider {

    private let log = OSLog(subsystem: "com.infamousvague.blip.network-extension", category: "filter")
    private var socketBridge: SocketBridge?

    // MARK: - Filter Lifecycle

    override func startFilter(completionHandler: @escaping (Error?) -> Void) {
        os_log("Starting network filter", log: log, type: .info)

        // Configure filter to see ALL network traffic (TCP + UDP, any direction)
        let filterSettings = NEFilterSettings(
            rules: [
                NEFilterRule(networkRule: NENetworkRule(
                    remoteNetwork: nil,
                    remotePrefix: 0,
                    localNetwork: nil,
                    localPrefix: 0,
                    protocol: .any,
                    direction: .any
                ), action: .filterData)
            ],
            defaultAction: .allow
        )

        apply(filterSettings) { error in
            if let error = error {
                os_log("Failed to apply filter settings: %{public}@", log: self.log, type: .error, error.localizedDescription)
                completionHandler(error)
                return
            }

            os_log("Filter settings applied", log: self.log, type: .info)

            // Connect to the main app's Unix socket
            self.socketBridge = SocketBridge()
            self.socketBridge?.connect()

            completionHandler(nil)
        }
    }

    override func stopFilter(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        os_log("Stopping network filter, reason: %d", log: log, type: .info, reason.rawValue)
        socketBridge?.disconnect()
        socketBridge = nil
        completionHandler()
    }

    // MARK: - Flow Handling

    override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
        guard let socketFlow = flow as? NEFilterSocketFlow else {
            return .allow()
        }

        // Extract remote endpoint
        guard let remoteEndpoint = socketFlow.remoteEndpoint as? NWHostEndpoint else {
            return .allow()
        }

        let destIp = remoteEndpoint.hostname
        let destPort = UInt16(remoteEndpoint.port) ?? 0

        // Skip loopback and link-local
        if destIp == "127.0.0.1" || destIp == "::1" || destIp.hasPrefix("fe80:") {
            return .allow()
        }

        // Skip private ranges
        if isPrivateIP(destIp) {
            return .allow()
        }

        // Determine protocol
        let proto: String
        switch socketFlow.socketProtocol {
        case 6:  proto = "tcp"
        case 17: proto = "udp"
        default: proto = "other"
        }

        // Determine direction
        let direction: String
        switch socketFlow.direction {
        case .outbound: direction = "outbound"
        case .inbound:  direction = "inbound"
        default:        direction = "any"
        }

        // Get source app info via audit token
        let sourceAppAuditToken = socketFlow.sourceAppAuditToken
        let bundleId = bundleIdentifier(from: sourceAppAuditToken) ?? "unknown"

        // Build JSON event and send to main app
        let event = NEConnectionEvent(
            sourceAppId: bundleId,
            sourcePid: pidFromAuditToken(sourceAppAuditToken),
            destIp: destIp,
            destPort: Int(destPort),
            protocol: proto,
            direction: direction,
            timestampMs: UInt64(Date().timeIntervalSince1970 * 1000)
        )

        socketBridge?.send(event: event)

        // Phase 2: always allow (passive monitoring)
        // Phase 4 will add rule-based allow/deny
        return .allow()
    }

    // MARK: - Data Handling (required overrides)

    override func handleInboundData(from flow: NEFilterFlow, readBytesStartOffset: Int, readBytes: Data) -> NEFilterDataVerdict {
        return .allow()
    }

    override func handleOutboundData(from flow: NEFilterFlow, readBytesStartOffset: Int, readBytes: Data) -> NEFilterDataVerdict {
        return .allow()
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

    private func pidFromAuditToken(_ token: Data?) -> Int {
        guard let token = token, token.count >= 32 else { return 0 }
        return token.withUnsafeBytes { ptr -> Int in
            Int(ptr.load(fromByteOffset: 20, as: Int32.self))
        }
    }

    private func bundleIdentifier(from auditToken: Data?) -> String? {
        guard let token = auditToken, token.count >= 32 else { return nil }

        // Extract PID from audit token
        let pid = pidFromAuditToken(token)
        guard pid > 0 else { return nil }

        // Try to resolve bundle ID from PID using proc_pidpath
        var pathBuffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        let pathLen = proc_pidpath(Int32(pid), &pathBuffer, UInt32(MAXPATHLEN))
        guard pathLen > 0 else { return nil }

        let path = String(cString: pathBuffer)

        // Walk up to find .app bundle and extract bundle ID from Info.plist
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

        // Fallback: return the executable path
        return path.components(separatedBy: "/").last
    }
}
