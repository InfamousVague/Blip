import WebKit
import NetworkExtension
import SystemExtensions

/// Handles messages from the React frontend via WKWebView.
/// JS calls: window.blip.invoke("command_name", {args})
/// Swift processes, calls Rust FFI, returns result via JS callback.
class WebBridge: NSObject, WKScriptMessageHandler {

    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let callId = body["callId"] as? String,
              let command = body["command"] as? String else {
            return
        }

        let args = body["args"] as? [String: Any] ?? [:]
        let webView = message.webView

        // Process on background queue to avoid blocking the main thread
        DispatchQueue.global(qos: .userInteractive).async {
            let result = self.handleCommand(command, args: args)

            DispatchQueue.main.async {
                // Base64 encode to avoid all JSON escaping issues
                let b64 = Data(result.utf8).base64EncodedString()
                let js = "window.blip._resolve('\(callId)', JSON.parse(atob('\(b64)')))"
                webView?.evaluateJavaScript(js) { _, error in
                    if let error = error {
                        NSLog("Blip JS error for %@: %@", command, error.localizedDescription)
                    }
                }
            }
        }
    }

    private func handleCommand(_ command: String, args: [String: Any]) -> String {
        switch command {

        case "get_connections":
            return rustString { blip_get_connections() }

        case "get_bandwidth":
            return rustString { blip_get_bandwidth() }

        case "start_capture":
            let geoipPath = Bundle.main.path(forResource: "GeoLite2-City", ofType: "mmdb", inDirectory: "resources") ?? ""
            blip_start_capture(geoipPath)
            return "{\"ok\":true}"

        case "stop_capture":
            blip_stop_capture()
            return "{\"ok\":true}"

        case "get_dns_log":
            return rustString { blip_get_dns_log() }

        case "get_dns_stats":
            return rustString { blip_get_dns_stats() }

        case "get_blocklists":
            return rustString { blip_get_blocklists() }

        case "get_tracker_stats":
            return rustString { blip_get_tracker_stats() }

        case "get_user_location":
            let delegate = NSApplication.shared.delegate as? AppDelegate
            let lat = delegate?.userLatitude ?? 0
            let lon = delegate?.userLongitude ?? 0
            return "{\"latitude\":\(lat),\"longitude\":\(lon)}"

        case "add_blocklist_url":
            let url = args["url"] as? String ?? ""
            let name = args["name"] as? String ?? ""
            return rustString { blip_add_blocklist_url(url, name) }

        case "activate_network_extension":
            return activateNE()

        case "deactivate_network_extension":
            return deactivateNE()

        case "get_network_extension_status":
            return getNEStatus()

        // Elevation — not needed with NE architecture, return stubs
        case "request_elevation":
            return "{\"ok\":false}"

        case "check_elevation":
            return "false"

        case "disable_elevation":
            return "{\"ok\":true}"

        // Settings/diagnostics
        case "get_diagnostics":
            return "[]"

        case "get_preference":
            if let key = args["key"] as? String {
                return rustString { blip_get_preference(key) }
            }
            return "null"

        case "set_preference":
            if let key = args["key"] as? String,
               let value = args["value"] as? String {
                return rustString { blip_set_preference(key, value) }
            }
            return "{\"ok\":true}"

        case "get_historical_endpoints":
            return rustString { blip_get_historical_endpoints() }

        case "get_historical_stats":
            return rustString { blip_get_historical_stats() }

        case "get_self_info":
            // Fetch ISP info from ip-api.com
            var info = "{}"
            let sem = DispatchSemaphore(value: 0)
            if let url = URL(string: "https://ipwho.is/") {
                URLSession.shared.dataTask(with: url) { data, _, _ in
                    if let data = data,
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        let isp = (json["connection"] as? [String: Any])?["isp"] as? String ?? json["isp"] as? String ?? ""
                        let ispEscaped = isp.replacingOccurrences(of: "\"", with: "\\\"")
                        let asn = (json["connection"] as? [String: Any])?["asn"] as? Int ?? 0
                        info = "{\"isp\":\"\(ispEscaped)\",\"asn\":\(asn)}"
                    }
                    sem.signal()
                }.resume()
            } else {
                sem.signal()
            }
            _ = sem.wait(timeout: .now() + 5)
            return info

        case "remove_blocklist":
            return "{\"ok\":true}"

        case "toggle_blocklist":
            return "{\"ok\":true}"

        case "add_blocklist_content":
            return "{}"

        // Port / process management
        case "get_listening_ports":
            return rustString { blip_get_listening_ports() }

        case "kill_process":
            if let pid = args["pid"] as? Int {
                return rustString { blip_kill_process(UInt32(pid)) }
            }
            return "{\"error\":\"missing pid\"}"

        default:
            NSLog("Blip: unknown command: %@", command)
            return "{\"error\":\"unknown command: \(command)\"}"
        }
    }

    /// Call a Rust FFI function that returns a C string, convert to Swift String, free the C string.
    private func rustString(_ fn: () -> UnsafeMutablePointer<CChar>?) -> String {
        guard let ptr = fn() else { return "{}" }
        let str = String(cString: ptr)
        blip_free_string(ptr)
        return str
    }

    // MARK: - Network Extension Management

    private func activateNE() -> String {
        let bundleId = "com.infamousvague.blip.network-extension"
        let request = OSSystemExtensionRequest.activationRequest(
            forExtensionWithIdentifier: bundleId,
            queue: .main
        )
        let delegate = NEActivationDelegate.shared
        request.delegate = delegate
        OSSystemExtensionManager.shared.submitRequest(request)
        return "{\"status\":\"activating\"}"
    }

    private func deactivateNE() -> String {
        let manager = NEFilterManager.shared()
        manager.loadFromPreferences { error in
            if error != nil { return }
            manager.isEnabled = false
            manager.saveToPreferences { _ in }
        }
        return "{\"status\":\"deactivating\"}"
    }

    private func getNEStatus() -> String {
        var result = "{\"status\":\"not_installed\"}"
        let semaphore = DispatchSemaphore(value: 0)

        NEFilterManager.shared().loadFromPreferences { error in
            if error != nil {
                result = "{\"status\":\"not_installed\"}"
            } else if NEFilterManager.shared().providerConfiguration == nil {
                result = "{\"status\":\"not_installed\"}"
            } else if NEFilterManager.shared().isEnabled {
                result = "{\"status\":\"active\"}"
            } else {
                result = "{\"status\":\"inactive\"}"
            }
            semaphore.signal()
        }

        _ = semaphore.wait(timeout: .now() + 5)
        return result
    }
}

// MARK: - NE Activation Delegate

class NEActivationDelegate: NSObject, OSSystemExtensionRequestDelegate {
    static let shared = NEActivationDelegate()

    func request(_ request: OSSystemExtensionRequest,
                 didFinishWithResult result: OSSystemExtensionRequest.Result) {
        NSLog("NE activation finished: \(result.rawValue)")
        if result == .completed {
            enableFilter()
        }
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        NSLog("NE activation failed: \(error.localizedDescription)")
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        NSLog("NE needs user approval — check System Settings → Privacy & Security")
    }

    func request(_ request: OSSystemExtensionRequest,
                 actionForReplacingExtension existing: OSSystemExtensionProperties,
                 withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        return .replace
    }

    private func enableFilter() {
        let manager = NEFilterManager.shared()
        manager.loadFromPreferences { error in
            if let error = error {
                NSLog("Filter load error: \(error)")
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
                    NSLog("Filter save error: \(error)")
                } else {
                    NSLog("Blip network filter enabled")
                }
            }
        }
    }
}
