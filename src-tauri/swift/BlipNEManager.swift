/// BlipNEManager — Swift CLI tool for activating/deactivating the Network Extension.
/// Called from the main Tauri app via `Command::new()`.
///
/// Usage:
///   blip-ne-manager activate    — Submit system extension request + enable filter
///   blip-ne-manager deactivate  — Remove filter configuration
///   blip-ne-manager status      — Print current NE status as JSON

import Foundation
import NetworkExtension
import SystemExtensions

// MARK: - System Extension Request Delegate

class ExtensionDelegate: NSObject, OSSystemExtensionRequestDelegate {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<Void, Error> = .success(())

    func request(_ request: OSSystemExtensionRequest,
                 didFinishWithResult result: OSSystemExtensionRequest.Result) {
        switch result {
        case .completed:
            self.result = .success(())
        case .willCompleteAfterReboot:
            self.result = .success(())
        @unknown default:
            self.result = .failure(NSError(domain: "BlipNE", code: 1,
                                           userInfo: [NSLocalizedDescriptionKey: "Unknown result: \(result.rawValue)"]))
        }
        semaphore.signal()
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        self.result = .failure(error)
        semaphore.signal()
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        // User needs to go to System Settings → Privacy & Security → Allow
        print("{\"status\":\"pending_approval\"}")
        // Don't signal — wait for approval callback
    }

    func request(_ request: OSSystemExtensionRequest,
                 actionForReplacingExtension existing: OSSystemExtensionProperties,
                 withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        return .replace
    }
}

// MARK: - Filter Manager

func activateFilter() {
    let manager = NEFilterManager.shared()

    manager.loadFromPreferences { error in
        if let error = error {
            printError("Failed to load filter preferences: \(error.localizedDescription)")
            exit(1)
        }

        let config = NEFilterProviderConfiguration()
        config.filterPackets = false
        config.filterSockets = true

        manager.providerConfiguration = config
        manager.localizedDescription = "Blip Network Monitor"
        manager.isEnabled = true

        manager.saveToPreferences { error in
            if let error = error {
                printError("Failed to save filter preferences: \(error.localizedDescription)")
                exit(1)
            }

            // Also activate the DNS proxy
            activateDNSProxy {
                print("{\"status\":\"active\"}")
                exit(0)
            }
        }
    }
}

func activateDNSProxy(completion: @escaping () -> Void) {
    let manager = NEDNSProxyManager.shared()

    manager.loadFromPreferences { error in
        if let error = error {
            // DNS proxy activation is optional — don't fail if it can't load
            printError("DNS proxy load warning: \(error.localizedDescription)")
            completion()
            return
        }

        let config = NEDNSProxyProviderProtocol()
        config.providerBundleIdentifier = "com.infamousvague.blip.network-extension"

        manager.providerProtocol = config
        manager.localizedDescription = "Blip DNS Monitor"
        manager.isEnabled = true

        manager.saveToPreferences { error in
            if let error = error {
                printError("DNS proxy save warning: \(error.localizedDescription)")
            }
            completion()
        }
    }
}

func deactivateFilter() {
    let manager = NEFilterManager.shared()

    manager.loadFromPreferences { error in
        if let error = error {
            printError("Failed to load filter preferences: \(error.localizedDescription)")
            exit(1)
        }

        manager.isEnabled = false
        manager.saveToPreferences { error in
            if let error = error {
                printError("Failed to save filter preferences: \(error.localizedDescription)")
                exit(1)
            }
            print("{\"status\":\"inactive\"}")
            exit(0)
        }
    }
}

func getStatus() {
    let manager = NEFilterManager.shared()

    manager.loadFromPreferences { error in
        if let error = error {
            print("{\"status\":\"unavailable\",\"error\":\"\(error.localizedDescription)\"}")
            exit(0)
        }

        let enabled = manager.isEnabled
        let config = manager.providerConfiguration

        if config == nil {
            print("{\"status\":\"not_installed\"}")
        } else if enabled {
            print("{\"status\":\"active\"}")
        } else {
            print("{\"status\":\"inactive\"}")
        }
        exit(0)
    }
}

func activateExtension() {
    let bundleId = "com.infamousvague.blip.network-extension"
    let request = OSSystemExtensionRequest.activationRequest(
        forExtensionWithIdentifier: bundleId,
        queue: .main
    )

    let delegate = ExtensionDelegate()
    request.delegate = delegate

    OSSystemExtensionManager.shared.submitRequest(request)

    // Wait for the request to complete (with timeout)
    let result = delegate.semaphore.wait(timeout: .now() + 30)
    if result == .timedOut {
        // Check if it's pending user approval
        print("{\"status\":\"pending_approval\"}")
        exit(0)
    }

    switch delegate.result {
    case .success:
        // Extension activated, now enable the filter
        activateFilter()
    case .failure(let error):
        printError("Extension activation failed: \(error.localizedDescription)")
        exit(1)
    }
}

// MARK: - Helpers

func printError(_ message: String) {
    let escaped = message.replacingOccurrences(of: "\"", with: "\\\"")
    print("{\"status\":\"error\",\"error\":\"\(escaped)\"}")
}

// MARK: - Main

let args = CommandLine.arguments

guard args.count >= 2 else {
    print("Usage: blip-ne-manager [activate|deactivate|status]")
    exit(1)
}

switch args[1] {
case "activate":
    activateExtension()
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 35))
case "deactivate":
    deactivateFilter()
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 5))
case "status":
    getStatus()
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 5))
default:
    print("Unknown command: \(args[1])")
    print("Usage: blip-ne-manager [activate|deactivate|status]")
    exit(1)
}
