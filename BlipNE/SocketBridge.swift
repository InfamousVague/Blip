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

/// Unix domain socket client that sends events to the main Blip app.
/// The main app listens at ~/.blip/ne.sock.
class SocketBridge {

    private let log = OSLog(subsystem: "com.infamousvague.blip.network-extension", category: "socket")
    private let socketPath: String
    private var fileHandle: FileHandle?
    private let encoder = JSONEncoder()
    private let queue = DispatchQueue(label: "com.infamousvague.blip.ne.socket", qos: .userInteractive)
    private var reconnectTimer: DispatchSourceTimer?
    private var isConnected = false

    init() {
        // Socket path in the shared container
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        self.socketPath = "\(home)/.blip/ne.sock"
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
            guard let self = self, self.isConnected else {
                self?.connectInternal()
                return
            }

            do {
                var data = try self.encoder.encode(event)
                data.append(0x0A) // newline delimiter
                self.fileHandle?.write(data)
            } catch {
                os_log("Failed to encode event: %{public}@", log: self.log, type: .error, error.localizedDescription)
            }
        }
    }

    // MARK: - Internal

    private func connectInternal() {
        guard !isConnected else { return }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            os_log("Failed to create socket: %d", log: log, type: .error, errno)
            scheduleReconnect()
            return
        }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)

        let pathBytes = socketPath.utf8CString
        guard pathBytes.count <= MemoryLayout.size(ofValue: addr.sun_path) else {
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
            os_log("Failed to connect to %{public}@: %d", log: log, type: .debug, socketPath, errno)
            close(fd)
            scheduleReconnect()
            return
        }

        fileHandle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        isConnected = true
        reconnectTimer?.cancel()
        reconnectTimer = nil
        os_log("Connected to main app at %{public}@", log: log, type: .info, socketPath)
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
