import Foundation
import os.log

// MARK: - Debug Logging

let neDebugLogPath = "/private/var/tmp/blip-ne-debug.log"
func neDebugLog(_ msg: String) {
    let ts = ISO8601DateFormatter().string(from: Date())
    let line = "[\(ts)] \(msg)\n"
    if let data = line.data(using: .utf8) {
        if let handle = FileHandle(forWritingAtPath: neDebugLogPath) {
            handle.seekToEndOfFile()
            handle.write(data)
            handle.closeFile()
        } else {
            FileManager.default.createFile(atPath: neDebugLogPath, contents: data, attributes: [.posixPermissions: 0o666])
        }
    }
}

// MARK: - Socket Bridge

class SocketBridge {

    private let log = OSLog(subsystem: "com.infamousvague.blip.network-extension", category: "socket")
    private let socketPath: String
    private var fileHandle: FileHandle?
    private let encoder = JSONEncoder()
    private let queue = DispatchQueue(label: "com.infamousvague.blip.ne.socket", qos: .utility)
    private let readQueue = DispatchQueue(label: "com.infamousvague.blip.ne.socket.read", qos: .utility)
    private var reconnectTimer: DispatchSourceTimer?
    private var isConnected = false
    weak var delegate: SocketBridgeDelegate?

    init() {
        self.socketPath = "/private/var/tmp/blip-ne.sock"
    }

    func connect() {
        queue.async { [weak self] in
            self?.connectInternal()
        }
    }

    func disconnect() {
        queue.async { [weak self] in
            self?.reconnectTimer?.cancel()
            self?.reconnectTimer = nil
            self?.closeSocket()
        }
    }

    // MARK: - Send Methods

    func send(event: NEConnectionEvent, verdict: String? = nil,
              matchedRuleId: String? = nil, domain: String? = nil) {
        let wrapped = NEEvent(type_: "connection", connection: event,
                              verdict: verdict, matched_rule_id: matchedRuleId, domain: domain)
        sendEncodable(wrapped)
    }

    func send(dnsEvent: NEDnsEvent) {
        let wrapped = NEEvent(type_: "dns", dns: dnsEvent)
        sendEncodable(wrapped)
    }

    func send(flowUpdate: NEFlowUpdateEvent) {
        let wrapped = NEEvent(type_: "flow_update", flow_update: flowUpdate)
        sendEncodable(wrapped)
    }

    func sendApprovalRequest(_ request: [String: Any]) {
        let codableRequest = request.mapValues { AnyCodable($0) }
        let wrapped = NEEvent(type_: "approval_request", approval_request: codableRequest)
        sendEncodable(wrapped)
    }

    /// Send an ACK for a critical message. No-op if msg_id is nil.
    func sendAck(msgId: String?, status: String) {
        guard let msgId = msgId else { return }
        sendRaw(jsonDict: [
            "type": "ack",
            "msg_id": msgId,
            "status": status,
        ])
    }

    func sendRaw(jsonDict: [String: Any]) {
        queue.async { [weak self] in
            guard let self = self, self.isConnected, let fh = self.fileHandle else {
                if self?.isConnected == false { self?.connectInternal() }
                return
            }
            do {
                var data = try JSONSerialization.data(withJSONObject: jsonDict)
                data.append(0x0A)
                let fd = fh.fileDescriptor
                data.withUnsafeBytes { ptr in
                    guard let base = ptr.baseAddress else { return }
                    let _ = Darwin.write(fd, base, ptr.count)
                }
            } catch {}
        }
    }

    private func sendEncodable<T: Encodable>(_ value: T) {
        queue.async { [weak self] in
            guard let self = self, self.isConnected, let fh = self.fileHandle else {
                if self?.isConnected == false { self?.connectInternal() }
                return
            }

            do {
                var data = try self.encoder.encode(value)
                data.append(0x0A)
                let fd = fh.fileDescriptor
                let written = data.withUnsafeBytes { ptr -> Int in
                    guard let base = ptr.baseAddress else { return -1 }
                    return Darwin.write(fd, base, ptr.count)
                }
                if written < 0 {
                    if errno != EAGAIN {
                        self.closeSocket()
                        self.scheduleReconnect()
                    }
                }
            } catch {}
        }
    }

    // MARK: - Connection

    private func connectInternal() {
        guard !isConnected else { return }

        neDebugLog("connectInternal: attempting to connect to \(socketPath)")

        let exists = FileManager.default.fileExists(atPath: socketPath)
        if !exists {
            neDebugLog("Socket file not found, scheduling reconnect")
            scheduleReconnect()
            return
        }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            neDebugLog("Failed to create socket fd: errno=\(errno)")
            scheduleReconnect()
            return
        }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)

        let pathBytes = socketPath.utf8CString
        guard pathBytes.count <= MemoryLayout.size(ofValue: addr.sun_path) else {
            close(fd)
            return
        }

        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            let raw = UnsafeMutableRawPointer(ptr)
            pathBytes.withUnsafeBufferPointer { buf in
                raw.copyMemory(from: buf.baseAddress!, byteCount: buf.count)
            }
        }

        let addrLen = socklen_t(MemoryLayout<sa_family_t>.size + pathBytes.count)
        let result = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Foundation.connect(fd, sockPtr, addrLen)
            }
        }

        if result < 0 {
            neDebugLog("connect() failed: errno=\(errno) (\(String(cString: strerror(errno))))")
            close(fd)
            scheduleReconnect()
            return
        }

        let flags = fcntl(fd, F_GETFL)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)

        neDebugLog("connect() succeeded! Connected to \(socketPath)")
        fileHandle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        isConnected = true
        reconnectTimer?.cancel()
        reconnectTimer = nil
        os_log("Connected to main app at %{public}@", log: log, type: .info, socketPath)

        // Send NE version hello so the app can detect stale NE installs
        let neVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        let neBuild = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        sendRaw(jsonDict: [
            "type": "ne_hello",
            "ne_version": neVersion,
            "ne_build": neBuild,
            "features": ["rule_engine", "bidirectional", "dns_cache", "kill_switch"]
        ])

        startReadLoop(fd: fd)
    }

    // MARK: - Read Loop (bidirectional)

    private func startReadLoop(fd: Int32) {
        let readFd = dup(fd)
        guard readFd >= 0 else { return }
        let flags = fcntl(readFd, F_GETFL)
        _ = fcntl(readFd, F_SETFL, flags & ~O_NONBLOCK)

        readQueue.async { [weak self] in
            var buffer = Data()
            var readBuf = [UInt8](repeating: 0, count: 8192)

            while true {
                guard let self = self, self.isConnected else { break }

                let n = Darwin.read(readFd, &readBuf, readBuf.count)
                if n <= 0 {
                    if n == 0 || (errno != EINTR) {
                        close(readFd)
                        self.queue.async {
                            self.closeSocket()
                            self.scheduleReconnect()
                        }
                    }
                    break
                }

                buffer.append(contentsOf: readBuf.prefix(n))

                while let newlineIdx = buffer.firstIndex(of: 0x0A) {
                    let lineData = buffer.prefix(upTo: newlineIdx)
                    buffer = Data(buffer.suffix(from: buffer.index(after: newlineIdx)))

                    guard !lineData.isEmpty else { continue }

                    // Try v2 format first (raw JSON), fall back to legacy NEAppMessage
                    if let json = try? JSONSerialization.jsonObject(with: Data(lineData)) as? [String: Any],
                       let type = json["type"] as? String {
                        self.handleAppMessageV2(type: type, json: json)
                    } else {
                        // Legacy decode
                        if let msg = try? JSONDecoder().decode(NEAppMessage.self, from: Data(lineData)) {
                            self.handleAppMessageLegacy(msg)
                        }
                    }
                }
            }
        }
    }

    private func handleAppMessageV2(type: String, json: [String: Any]) {
        switch type {
        case "firewall_config":
            let mode = json["mode"] as? String ?? "ask"
            let killSwitch = json["kill_switch"] as? Bool ?? false
            let profileId = json["active_profile_id"] as? String ?? "default"
            let rules = json["rules"] as? [[String: Any]] ?? []
            delegate?.socketBridge(self, didReceiveFirewallConfig: mode, killSwitch: killSwitch,
                                  profileId: profileId, rules: rules)
            sendAck(msgId: json["msg_id"] as? String, status: "ok")

        case "dns_cache_update":
            if let mappings = json["mappings"] as? [String: String] {
                delegate?.socketBridge(self, didReceiveDNSCacheUpdate: mappings)
            }
            sendAck(msgId: json["msg_id"] as? String, status: "ok")

        case "kill_switch":
            if let active = json["active"] as? Bool {
                delegate?.socketBridge(self, didReceiveKillSwitch: active)
            }
            sendAck(msgId: json["msg_id"] as? String, status: "ok")

        case "approval_verdict":
            if let requestId = json["request_id"] as? String,
               let action = json["action"] as? String {
                delegate?.socketBridge(self, didReceiveApprovalVerdict: requestId, action: action)
            }

        case "blocklist_sync":
            if let domains = json["domains"] as? [String] {
                let domainSet = Set(domains.map { $0.lowercased() })
                delegate?.socketBridge(self, didReceiveBlocklistSync: domainSet)
            }
            sendAck(msgId: json["msg_id"] as? String, status: "ok")

        case "blocked_ips":
            if let ips = json["ips"] as? [String] {
                delegate?.socketBridge(self, didReceiveBlockedIPs: Set(ips))
            }

        case "firewall_rules":
            // Legacy format — decode as FirewallRuleMsg
            if let rulesJson = json["rules"] as? [[String: Any]] {
                let rules: [FirewallRuleMsg] = rulesJson.compactMap { dict in
                    guard let appId = dict["app_id"] as? String,
                          let action = dict["action"] as? String else { return nil }
                    return FirewallRuleMsg(app_id: appId, domain: dict["domain"] as? String, action: action)
                }
                delegate?.socketBridge(self, didReceiveFirewallRules: rules)
            }

        case "query_status":
            delegate?.socketBridgeDidReceiveQueryStatus(self)

        default:
            break
        }
    }

    private func handleAppMessageLegacy(_ msg: NEAppMessage) {
        switch msg.type_ {
        case "blocklist_sync":
            if let domains = msg.domains {
                delegate?.socketBridge(self, didReceiveBlocklistSync: Set(domains.map { $0.lowercased() }))
            }
        case "blocked_ips":
            if let ips = msg.ips {
                delegate?.socketBridge(self, didReceiveBlockedIPs: Set(ips))
            }
        case "firewall_rules":
            if let rules = msg.rules {
                delegate?.socketBridge(self, didReceiveFirewallRules: rules)
            }
        default:
            break
        }
    }

    private func closeSocket() {
        fileHandle = nil
        isConnected = false
    }

    private func scheduleReconnect() {
        guard reconnectTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 2.0, repeating: 2.0)
        timer.setEventHandler { [weak self] in
            self?.connectInternal()
        }
        timer.resume()
        reconnectTimer = timer
    }
}
