/// BlipNEBridge — Swift dynamic library loaded by the main Tauri app process.
/// Non-blocking approach: Swift writes results to a file, Rust polls it.
/// This avoids the main-thread RunLoop deadlock entirely.

import Foundation
import NetworkExtension
import SystemExtensions

// MARK: - File-based result passing

private let resultPath = NSString("~/.blip/ne-result.json").expandingTildeInPath
private let logPath = NSString("~/Desktop/blip-ne-bridge.log").expandingTildeInPath

private func neLog(_ msg: String) {
    let ts = ISO8601DateFormatter().string(from: Date())
    let line = "[\(ts)] \(msg)\n"
    if let data = line.data(using: .utf8) {
        if let handle = FileHandle(forWritingAtPath: logPath) {
            handle.seekToEndOfFile()
            handle.write(data)
            handle.closeFile()
        } else {
            FileManager.default.createFile(atPath: logPath, contents: data)
        }
    }
}

private func writeResult(_ json: String) {
    neLog("writeResult: \(json)")
    try? json.write(toFile: resultPath, atomically: true, encoding: .utf8)
}

private func clearResult() {
    try? FileManager.default.removeItem(atPath: resultPath)
}

// MARK: - System Extension Delegate

private class ExtensionDelegate: NSObject, OSSystemExtensionRequestDelegate {
    func request(_ request: OSSystemExtensionRequest,
                 didFinishWithResult result: OSSystemExtensionRequest.Result) {
        neLog("Extension request finished with result: \(result.rawValue)")
        switch result {
        case .completed:
            enableFilter()
        case .willCompleteAfterReboot:
            writeResult("{\"status\":\"pending_reboot\"}")
        @unknown default:
            writeResult("{\"status\":\"error\",\"error\":\"Unknown result: \(result.rawValue)\"}")
        }
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        neLog("Extension request failed: \(error)")
        let msg = error.localizedDescription.replacingOccurrences(of: "\"", with: "\\\"")
        writeResult("{\"status\":\"error\",\"error\":\"\(msg)\"}")
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        neLog("Extension needs user approval")
        writeResult("{\"status\":\"pending_approval\"}")
    }

    func request(_ request: OSSystemExtensionRequest,
                 actionForReplacingExtension existing: OSSystemExtensionProperties,
                 withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        neLog("Replacing existing extension")
        return .replace
    }
}

private func enableFilter() {
    neLog("Enabling NEFilterManager...")
    let manager = NEFilterManager.shared()
    manager.loadFromPreferences { error in
        if let error = error {
            neLog("Filter load error: \(error)")
            let msg = error.localizedDescription.replacingOccurrences(of: "\"", with: "\\\"")
            writeResult("{\"status\":\"error\",\"error\":\"Filter load failed: \(msg)\"}")
            return
        }

        let config = NEFilterProviderConfiguration()
        config.filterPackets = false
        config.filterSockets = true

        manager.providerConfiguration = config
        manager.localizedDescription = "Blip Network Monitor"
        manager.isEnabled = true

        manager.saveToPreferences { error in
            if let error = error {
                neLog("Filter save error: \(error)")
                let msg = error.localizedDescription.replacingOccurrences(of: "\"", with: "\\\"")
                writeResult("{\"status\":\"error\",\"error\":\"Filter save failed: \(msg)\"}")
                return
            }
            neLog("Filter enabled successfully")
            writeResult("{\"status\":\"active\"}")
        }
    }
}

// Keep delegate alive
private var activeDelegate: ExtensionDelegate?

// MARK: - C-callable API (all non-blocking — write result to file)

/// Kick off NE activation. Returns immediately with "pending".
/// Actual result written to ~/.blip/ne-result.json asynchronously.
@_cdecl("blip_ne_activate")
public func blipNEActivate() -> UnsafePointer<CChar>? {
    neLog("blip_ne_activate called from thread: \(Thread.current)")
    clearResult()

    let bundleId = "com.infamousvague.blip.network-extension"

    // Submit on the main queue — this is required by macOS
    DispatchQueue.main.async {
        neLog("Submitting system extension request for \(bundleId)")
        let request = OSSystemExtensionRequest.activationRequest(
            forExtensionWithIdentifier: bundleId,
            queue: .main
        )
        let delegate = ExtensionDelegate()
        activeDelegate = delegate
        request.delegate = delegate
        OSSystemExtensionManager.shared.submitRequest(request)
        neLog("System extension request submitted")
    }

    // Return immediately — Rust will poll the result file
    return UnsafePointer(strdup("{\"status\":\"activating\"}"))
}

/// Kick off NE deactivation. Returns immediately.
@_cdecl("blip_ne_deactivate")
public func blipNEDeactivate() -> UnsafePointer<CChar>? {
    neLog("blip_ne_deactivate called")
    clearResult()

    DispatchQueue.main.async {
        let manager = NEFilterManager.shared()
        manager.loadFromPreferences { error in
            if let error = error {
                let msg = error.localizedDescription.replacingOccurrences(of: "\"", with: "\\\"")
                writeResult("{\"status\":\"error\",\"error\":\"\(msg)\"}")
                return
            }
            manager.isEnabled = false
            manager.saveToPreferences { error in
                if let error = error {
                    let msg = error.localizedDescription.replacingOccurrences(of: "\"", with: "\\\"")
                    writeResult("{\"status\":\"error\",\"error\":\"\(msg)\"}")
                    return
                }
                writeResult("{\"status\":\"inactive\"}")
            }
        }
    }

    return UnsafePointer(strdup("{\"status\":\"deactivating\"}"))
}

/// Query NE status. Returns immediately.
/// Result written to ~/.blip/ne-result.json asynchronously.
@_cdecl("blip_ne_status")
public func blipNEStatus() -> UnsafePointer<CChar>? {
    neLog("blip_ne_status called")
    clearResult()

    DispatchQueue.main.async {
        neLog("Querying NEFilterManager on main thread...")
        let manager = NEFilterManager.shared()
        manager.loadFromPreferences { error in
            if error != nil {
                neLog("loadFromPreferences error: \(error!)")
                writeResult("{\"status\":\"not_installed\"}")
                return
            }
            let config = manager.providerConfiguration
            if config == nil {
                neLog("No provider config — not installed")
                writeResult("{\"status\":\"not_installed\"}")
            } else if manager.isEnabled {
                neLog("Filter is active")
                writeResult("{\"status\":\"active\"}")
            } else {
                neLog("Filter is inactive")
                writeResult("{\"status\":\"inactive\"}")
            }
        }
    }

    // Return immediately — Rust polls the file
    return UnsafePointer(strdup("{\"status\":\"checking\"}"))
}
