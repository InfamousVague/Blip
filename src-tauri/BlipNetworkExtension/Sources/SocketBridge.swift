import Foundation
import os.log

/// Connection event sent from NE to the main Blip app.
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

/// DNS query event sent from NE DNS proxy to the main Blip app.
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

/// Wrapper enum for typed events over the socket.
/// The Rust side distinguishes by the "type" field.
struct NEEvent: Codable {
    let type_: String
    let connection: NEConnectionEvent?
    let dns: NEDnsEvent?

    enum CodingKeys: String, CodingKey {
        case type_ = "type"
        case connection
        case dns
    }
}

/// Firewall rule: allow, deny, or unspecified (default pass-through)
struct FirewallRule: Codable {
    let app_id: String       // Bundle ID or "*" for global
    let domain: String?      // Optional domain pattern
    let action: String       // "allow", "deny", "unspecified"
}

/// Message from the main app to the NE (received via socket).
struct NEAppMessage: Codable {
    let type_: String
    let domains: [String]?       // For blocklist_sync
    let ips: [String]?           // For blocked_ips
    let rules: [FirewallRule]?   // For firewall_rules

    enum CodingKeys: String, CodingKey {
        case type_ = "type"
        case domains
        case ips
        case rules
    }
}

/// Delegate for handling messages from the main app.
protocol SocketBridgeDelegate: AnyObject {
    func socketBridge(_ bridge: SocketBridge, didReceiveBlocklistSync domains: Set<String>)
    func socketBridge(_ bridge: SocketBridge, didReceiveBlockedIPs ips: Set<String>)
    func socketBridge(_ bridge: SocketBridge, didReceiveFirewallRules rules: [FirewallRule])
}

/// Unix domain socket client that sends events to the main Blip app.
/// The main app listens at ~/.blip/ne.sock.
/// Bidirectional: sends events to app, receives blocklist updates from app.
/// Debug log to a file readable by the user (NE runs as root, os_log is suppressed)
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
        // Use a fixed path accessible to both the NE (runs as root) and the main app (runs as user).
        // homeDirectoryForCurrentUser returns /var/root inside the NE process, not the user's home.
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

    func send(event: NEConnectionEvent) {
        let wrapped = NEEvent(type_: "connection", connection: event, dns: nil)
        sendRaw(wrapped)
    }

    func send(dnsEvent: NEDnsEvent) {
        let wrapped = NEEvent(type_: "dns", connection: nil, dns: dnsEvent)
        sendRaw(wrapped)
    }

    private func sendRaw(_ event: NEEvent) {
        queue.async { [weak self] in
            guard let self = self, self.isConnected, let fh = self.fileHandle else {
                // Not connected — silently drop event, try to reconnect
                if self?.isConnected == false {
                    self?.connectInternal()
                }
                return
            }

            do {
                var data = try self.encoder.encode(event)
                data.append(0x0A) // newline delimiter
                // Non-blocking write — if it fails, silently drop and reconnect.
                // NEVER let a socket issue propagate back to the filter provider.
                let fd = fh.fileDescriptor
                let written = data.withUnsafeBytes { ptr -> Int in
                    guard let base = ptr.baseAddress else { return -1 }
                    return Darwin.write(fd, base, ptr.count)
                }
                if written < 0 {
                    // EAGAIN (non-blocking full buffer) or EPIPE (broken) — drop silently
                    if errno != EAGAIN {
                        self.closeSocket()
                        self.scheduleReconnect()
                    }
                    // Either way, the event is dropped — this is fine for monitoring
                }
            } catch {
                // JSON encoding failure — should never happen, but silently drop
            }
        }
    }

    // MARK: - Internal

    private func connectInternal() {
        guard !isConnected else { return }

        neDebugLog("connectInternal: attempting to connect to \(socketPath)")

        // Check if socket file exists
        let exists = FileManager.default.fileExists(atPath: socketPath)
        neDebugLog("Socket file exists: \(exists)")
        if !exists {
            neDebugLog("Socket file not found, scheduling reconnect")
            scheduleReconnect()
            return
        }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            neDebugLog("Failed to create socket fd: errno=\(errno)")
            os_log("Failed to create socket: %d", log: log, type: .error, errno)
            scheduleReconnect()
            return
        }

        neDebugLog("Socket fd created: \(fd)")

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)

        let pathBytes = socketPath.utf8CString
        guard pathBytes.count <= MemoryLayout.size(ofValue: addr.sun_path) else {
            neDebugLog("Socket path too long: \(pathBytes.count)")
            os_log("Socket path too long", log: log, type: .error)
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
            os_log("Failed to connect to %{public}@: %d", log: log, type: .debug, socketPath, errno)
            close(fd)
            scheduleReconnect()
            return
        }

        // Set socket to non-blocking so writes never stall
        let flags = fcntl(fd, F_GETFL)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)

        neDebugLog("connect() succeeded! Connected to \(socketPath)")
        fileHandle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        isConnected = true
        reconnectTimer?.cancel()
        reconnectTimer = nil
        os_log("Connected to main app at %{public}@", log: log, type: .info, socketPath)

        // Start reading messages from the app (blocklist sync, blocked IPs)
        startReadLoop(fd: fd)
    }

    /// Read newline-delimited JSON messages from the app on a separate queue.
    /// Uses select() to wait for data since the fd is non-blocking.
    private func startReadLoop(fd: Int32) {
        // Dup the fd for reading so we can set it to blocking independently
        let readFd = dup(fd)
        guard readFd >= 0 else { return }
        // Set read fd to blocking
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

                // Process complete lines
                while let newlineIdx = buffer.firstIndex(of: 0x0A) {
                    let lineData = buffer.prefix(upTo: newlineIdx)
                    buffer = Data(buffer.suffix(from: buffer.index(after: newlineIdx)))

                    guard !lineData.isEmpty else { continue }
                    do {
                        let msg = try JSONDecoder().decode(NEAppMessage.self, from: lineData)
                        self.handleAppMessage(msg)
                    } catch {
                        // Silently ignore malformed messages
                    }
                }
            }
        }
    }

    private func handleAppMessage(_ msg: NEAppMessage) {
        switch msg.type_ {
        case "blocklist_sync":
            if let domains = msg.domains {
                let domainSet = Set(domains.map { $0.lowercased() })
                os_log("Received blocklist sync: %d domains", log: log, type: .info, domainSet.count)
                delegate?.socketBridge(self, didReceiveBlocklistSync: domainSet)
            }
        case "blocked_ips":
            if let ips = msg.ips {
                let ipSet = Set(ips)
                os_log("Received blocked IPs: %d IPs", log: log, type: .info, ipSet.count)
                delegate?.socketBridge(self, didReceiveBlockedIPs: ipSet)
            }
        case "firewall_rules":
            if let rules = msg.rules {
                neDebugLog("Received \(rules.count) firewall rules")
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
