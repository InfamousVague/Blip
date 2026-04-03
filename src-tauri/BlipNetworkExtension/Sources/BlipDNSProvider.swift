import Foundation
import NetworkExtension
import os.log

/// NEDNSProxyProvider — intercepts all DNS queries system-wide.
/// Forwards to upstream resolver, checks blocklist via main app, and returns
/// NXDOMAIN for blocked domains.
class BlipDNSProvider: NEDNSProxyProvider {

    private let log = OSLog(subsystem: "com.infamousvague.blip.network-extension", category: "dns-proxy")
    private var socketBridge: SocketBridge?

    /// Domains to block — loaded from the main app via socket.
    /// For Phase 3 we send DNS events to the main app and it tells us if blocked.
    /// For simplicity, we do a fire-and-forget approach: forward all queries,
    /// log them, and the main app handles visibility. Active blocking will come
    /// when we add a bidirectional protocol (verdict flow).
    private var blockedDomains: Set<String> = []
    private let blockedDomainsLock = NSLock()

    // Upstream DNS servers to forward queries to
    private let upstreamServers: [String] = [
        "1.1.1.1",   // Cloudflare
        "8.8.8.8",   // Google
    ]

    // MARK: - Lifecycle

    override func startProxy(options: [String: Any]? = nil, completionHandler: @escaping (Error?) -> Void) {
        os_log("Starting DNS proxy", log: log, type: .info)
        neDebugLog("BlipDNSProvider: startProxy called")

        // Load cached blocklist from disk immediately so blocking works before socket connects
        loadPersistedBlocklist()

        socketBridge = SocketBridge()
        socketBridge?.delegate = self
        socketBridge?.connect()

        completionHandler(nil)
    }

    override func stopProxy(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        os_log("Stopping DNS proxy, reason: %d", log: log, type: .info, reason.rawValue)
        socketBridge?.disconnect()
        socketBridge = nil
        completionHandler()
    }

    // MARK: - DNS Flow Handling

    override func handleNewFlow(_ flow: NEAppProxyFlow) -> Bool {
        guard let udpFlow = flow as? NEAppProxyUDPFlow else {
            // We only handle UDP DNS
            return false
        }

        // Handle this flow
        handleDNSFlow(udpFlow)
        return true
    }

    private func handleDNSFlow(_ flow: NEAppProxyUDPFlow) {
        // Open the flow to start reading datagrams
        flow.open(withLocalEndpoint: nil) { [weak self] error in
            guard let self = self else { return }

            if let error = error {
                os_log("Failed to open DNS flow: %{public}@", log: self.log, type: .error, error.localizedDescription)
                return
            }

            self.readAndForwardDNS(flow)
        }
    }

    private func readAndForwardDNS(_ flow: NEAppProxyUDPFlow) {
        flow.readDatagrams { [weak self] datagrams, endpoints, error in
            guard let self = self else { return }

            if let error = error {
                os_log("DNS read error: %{public}@", log: self.log, type: .debug, error.localizedDescription)
                return
            }

            guard let datagrams = datagrams, let endpoints = endpoints,
                  !datagrams.isEmpty else {
                return
            }

            for (index, datagram) in datagrams.enumerated() {
                self.processDNSQuery(datagram, flow: flow, originalEndpoint: endpoints[index])
            }

            // Continue reading
            self.readAndForwardDNS(flow)
        }
    }

    private func processDNSQuery(_ datagram: Data, flow: NEAppProxyUDPFlow, originalEndpoint: NWEndpoint) {
        // Parse the DNS query to extract the domain name
        guard let queryName = parseDNSQueryName(from: datagram) else {
            // Can't parse — forward as-is
            forwardToUpstream(datagram, flow: flow, originalEndpoint: originalEndpoint, domain: nil)
            return
        }

        let queryType = parseDNSQueryType(from: datagram) ?? "A"

        // Get source app info from the flow
        let sourceAppAuditToken = flow.metaData.sourceAppAuditToken
        let sourceAppId = resolveBundleId(from: sourceAppAuditToken) ?? "unknown"
        let sourcePid = pidFromAuditToken(sourceAppAuditToken)

        // Check if domain is blocked
        let isBlocked = isDomainBlocked(queryName)

        // Send DNS event to main app for logging
        let dnsEvent = NEDnsEvent(
            domain: queryName,
            queryType: queryType,
            responseIps: [],
            timestampMs: UInt64(Date().timeIntervalSince1970 * 1000),
            sourceAppId: sourceAppId,
            sourcePid: sourcePid,
            blocked: isBlocked
        )
        socketBridge?.send(dnsEvent: dnsEvent)

        if isBlocked {
            // Return NXDOMAIN response
            if let nxdomainResponse = buildNXDOMAINResponse(for: datagram) {
                flow.writeDatagrams([nxdomainResponse], sentBy: [originalEndpoint]) { error in
                    if let error = error {
                        os_log("Failed to write NXDOMAIN: %{public}@", log: self.log, type: .error, error.localizedDescription)
                    }
                }
            }
            return
        }

        // Forward to upstream
        forwardToUpstream(datagram, flow: flow, originalEndpoint: originalEndpoint, domain: queryName)
    }

    // MARK: - DNS Forwarding

    private func forwardToUpstream(_ datagram: Data, flow: NEAppProxyUDPFlow, originalEndpoint: NWEndpoint, domain: String?) {
        // Create a UDP socket to the upstream DNS server
        let upstreamHost = upstreamServers.first ?? "1.1.1.1"
        let endpoint = NWHostEndpoint(hostname: upstreamHost, port: "53")

        // Use a simple UDP send/receive
        let socket = createUDPSocket()
        guard let sock = socket else {
            os_log("Failed to create upstream socket", log: log, type: .error)
            return
        }

        sendUDPQuery(sock: sock, data: datagram, to: upstreamHost, port: 53) { [weak self] response in
            guard let self = self, let response = response else { return }

            // Parse response IPs for logging
            let ips = parseDNSResponseIPs(from: response)
            if let domain = domain, !ips.isEmpty {
                // Send updated DNS event with resolved IPs
                let sourceAppAuditToken = flow.metaData.sourceAppAuditToken
                let sourceAppId = self.resolveBundleId(from: sourceAppAuditToken) ?? "unknown"
                let sourcePid = self.pidFromAuditToken(sourceAppAuditToken)

                let dnsEvent = NEDnsEvent(
                    domain: domain,
                    queryType: "A",
                    responseIps: ips,
                    timestampMs: UInt64(Date().timeIntervalSince1970 * 1000),
                    sourceAppId: sourceAppId,
                    sourcePid: sourcePid,
                    blocked: false
                )
                self.socketBridge?.send(dnsEvent: dnsEvent)
            }

            // Write response back to the original flow
            flow.writeDatagrams([response], sentBy: [originalEndpoint]) { error in
                if let error = error {
                    os_log("Failed to write DNS response: %{public}@", log: self.log, type: .debug, error.localizedDescription)
                }
            }

            close(sock)
        }
    }

    // MARK: - Blocklist

    func updateBlockedDomains(_ domains: Set<String>) {
        blockedDomainsLock.lock()
        blockedDomains.formUnion(domains)
        let count = blockedDomains.count
        blockedDomainsLock.unlock()
        neDebugLog("Blocklist updated: now \(count) domains (added \(domains.count) in this chunk)")

        // Persist to disk so blocking works even without the app
        persistBlocklist()
    }

    /// Save blocklist to disk for offline blocking
    private func persistBlocklist() {
        blockedDomainsLock.lock()
        let domains = blockedDomains
        blockedDomainsLock.unlock()

        let path = "/private/var/tmp/blip-blocklist-cache.txt"
        let content = domains.joined(separator: "\n")
        try? content.write(toFile: path, atomically: true, encoding: .utf8)
    }

    /// Load blocklist from disk cache (called on startup before socket connects)
    func loadPersistedBlocklist() {
        let path = "/private/var/tmp/blip-blocklist-cache.txt"
        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else { return }
        let domains = Set(content.split(separator: "\n").map { String($0) })
        if domains.isEmpty { return }

        blockedDomainsLock.lock()
        blockedDomains.formUnion(domains)
        let count = blockedDomains.count
        blockedDomainsLock.unlock()
        neDebugLog("Loaded \(count) domains from disk cache")
    }

    private func isDomainBlocked(_ domain: String) -> Bool {
        let lower = domain.lowercased()
        blockedDomainsLock.lock()
        defer { blockedDomainsLock.unlock() }
        // Exact match
        if blockedDomains.contains(lower) { return true }
        // Subdomain match: "ad.tracker.com" matches "tracker.com"
        var d = lower
        while let dotIdx = d.firstIndex(of: ".") {
            d = String(d[d.index(after: dotIdx)...])
            if blockedDomains.contains(d) { return true }
        }
        return false
    }

    // MARK: - UDP Socket Helpers

    private func createUDPSocket() -> Int32? {
        let sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard sock >= 0 else { return nil }

        // Set receive timeout (2 seconds)
        var timeout = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

        return sock
    }

    private func sendUDPQuery(sock: Int32, data: Data, to host: String, port: UInt16, completion: @escaping (Data?) -> Void) {
        DispatchQueue.global(qos: .userInteractive).async {
            var addr = sockaddr_in()
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = port.bigEndian
            inet_pton(AF_INET, host, &addr.sin_addr)

            let sent = data.withUnsafeBytes { ptr in
                withUnsafePointer(to: &addr) { addrPtr in
                    addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                        sendto(sock, ptr.baseAddress, data.count, 0, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
                    }
                }
            }

            guard sent > 0 else {
                completion(nil)
                return
            }

            // Receive response
            var buffer = [UInt8](repeating: 0, count: 4096)
            let received = recv(sock, &buffer, buffer.count, 0)

            if received > 0 {
                completion(Data(buffer.prefix(received)))
            } else {
                completion(nil)
            }
        }
    }

    // MARK: - Process Identification

    private func pidFromAuditToken(_ token: Data?) -> Int {
        guard let token = token, token.count >= 32 else { return 0 }
        return token.withUnsafeBytes { ptr -> Int in
            Int(ptr.load(fromByteOffset: 20, as: Int32.self))
        }
    }

    private func resolveBundleId(from token: Data?) -> String? {
        guard let token = token else { return nil }
        let pid = pidFromAuditToken(token)
        guard pid > 0 else { return nil }

        var pathBuffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        let pathLen = proc_pidpath(Int32(pid), &pathBuffer, UInt32(MAXPATHLEN))
        guard pathLen > 0 else { return nil }

        let path = String(cString: pathBuffer)
        return path.components(separatedBy: "/").last
    }
}

// MARK: - SocketBridgeDelegate

extension BlipDNSProvider: SocketBridgeDelegate {
    func socketBridge(_ bridge: SocketBridge, didReceiveBlocklistSync domains: Set<String>) {
        updateBlockedDomains(domains)
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveBlockedIPs ips: Set<String>) {
        // DNS proxy doesn't use IP blocking — that's for the filter provider
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveFirewallRules rules: [FirewallRuleMsg]) {
        // DNS proxy doesn't use firewall rules — that's for the filter provider
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveFirewallConfig mode: String, killSwitch: Bool,
                      profileId: String, rules: [[String: Any]]) {
        // DNS proxy doesn't use firewall config — that's for the filter provider
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveDNSCacheUpdate mappings: [String: String]) {
        // DNS proxy doesn't use DNS cache updates — that's for the filter provider
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveKillSwitch active: Bool) {
        // DNS proxy doesn't use kill switch — that's for the filter provider
    }

    func socketBridge(_ bridge: SocketBridge, didReceiveApprovalVerdict requestId: String, action: String) {
        // DNS proxy doesn't use approval verdicts — that's for the filter provider
    }

    func socketBridgeDidReceiveQueryStatus(_ bridge: SocketBridge) {
        // DNS proxy doesn't handle query_status — that's for the filter provider
    }
}
