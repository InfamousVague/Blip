import Cocoa
import WebKit
import CoreLocation

class AppDelegate: NSObject, NSApplicationDelegate, CLLocationManagerDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var webBridge: WebBridge!
    var locationManager: CLLocationManager!
    var userLatitude: Double = 0
    var userLongitude: Double = 0

    // Menu bar
    var statusItem: NSStatusItem!
    var popover: NSPopover!
    var menuBarWebView: WKWebView!
    var eventMonitor: Any?
    var bandwidthTimer: Timer?
    var prevBytesIn: UInt64 = 0
    var prevBytesOut: UInt64 = 0
    var prevTimestamp: Date?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Initialize Rust core
        let resourcePath = (Bundle.main.resourcePath ?? "") + "/resources"
        NSLog("Blip: initializing core with resources at %@", resourcePath)
        let result = blip_init(resourcePath)
        NSLog("Blip: init result = %d", result)
        if result != 0 {
            NSLog("Blip: Failed to initialize core!")
        }

        // Auto-start capture
        let geoipPath = resourcePath + "/GeoLite2-City.mmdb"
        NSLog("Blip: starting capture with GeoIP at %@", geoipPath)
        blip_start_capture(geoipPath)

        // Start location services
        locationManager = CLLocationManager()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyKilometer
        if CLLocationManager.authorizationStatus() == .notDetermined {
            locationManager.requestWhenInUseAuthorization()
        }
        locationManager.startUpdatingLocation()

        // Shared web bridge (used by both main window and menu bar)
        webBridge = WebBridge()

        // Set up main window WKWebView
        let mainConfig = createWebViewConfig()
        webView = WKWebView(frame: .zero, configuration: mainConfig)
        webView.setValue(false, forKey: "drawsBackground")

        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        } else {
            NSLog("Could not find web/index.html in bundle")
        }

        // Create main window
        let screenSize = NSScreen.main?.frame.size ?? NSSize(width: 1280, height: 800)
        let windowWidth: CGFloat = min(1440, screenSize.width * 0.85)
        let windowHeight: CGFloat = min(900, screenSize.height * 0.85)

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: windowWidth, height: windowHeight),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Blip"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(red: 0.06, green: 0.06, blue: 0.08, alpha: 1.0)
        window.minSize = NSSize(width: 800, height: 600)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)

        // Set up menu bar status item
        setupMenuBar()

        // Start bandwidth polling for menu bar
        startBandwidthPolling()
    }

    // MARK: - Shared WebView Configuration

    private func createWebViewConfig() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        let contentController = WKUserContentController()

        contentController.add(webBridge, name: "blip")

        let bridgeJS = """
        window.blip = {
            invoke: function(command, args) {
                return new Promise(function(resolve, reject) {
                    var callId = Math.random().toString(36).substr(2, 9);
                    window.blip._pending = window.blip._pending || {};
                    window.blip._pending[callId] = { resolve: resolve, reject: reject };
                    window.webkit.messageHandlers.blip.postMessage({
                        callId: callId,
                        command: command,
                        args: args || {}
                    });
                });
            },
            _resolve: function(callId, result) {
                if (window.blip._pending && window.blip._pending[callId]) {
                    window.blip._pending[callId].resolve(result);
                    delete window.blip._pending[callId];
                }
            },
            _reject: function(callId, error) {
                if (window.blip._pending && window.blip._pending[callId]) {
                    window.blip._pending[callId].reject(error);
                    delete window.blip._pending[callId];
                }
            }
        };
        """
        let script = WKUserScript(source: bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        contentController.addUserScript(script)

        config.userContentController = contentController
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        return config
    }

    // MARK: - Menu Bar Setup

    private func setupMenuBar() {
        // Variable length to fit the rate text
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.action = #selector(togglePopover(_:))
            button.target = self
            // Initial display
            updateStatusItemTitle(rateIn: 0, rateOut: 0)
        }

        // Create menu bar WKWebView with same bridge
        let menuBarConfig = createWebViewConfig()
        menuBarWebView = WKWebView(frame: NSRect(x: 0, y: 0, width: 340, height: 480), configuration: menuBarConfig)
        menuBarWebView.setValue(false, forKey: "drawsBackground")

        if let menuBarURL = Bundle.main.url(forResource: "menubar", withExtension: "html", subdirectory: "web") {
            menuBarWebView.loadFileURL(menuBarURL, allowingReadAccessTo: menuBarURL.deletingLastPathComponent())
        } else {
            NSLog("Could not find web/menubar.html in bundle")
        }

        // Wrap in a view controller
        let viewController = NSViewController()
        viewController.view = menuBarWebView
        viewController.preferredContentSize = NSSize(width: 340, height: 480)

        // Create popover
        popover = NSPopover()
        popover.contentSize = NSSize(width: 340, height: 480)
        popover.behavior = .semitransient
        popover.animates = true
        popover.contentViewController = viewController

        // Close popover when clicking outside
        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            if let popover = self?.popover, popover.isShown {
                popover.performClose(nil)
            }
        }
    }

    // MARK: - Live Bandwidth in Menu Bar

    private func startBandwidthPolling() {
        // Seed initial values
        if let (bytesIn, bytesOut) = fetchBandwidth() {
            prevBytesIn = bytesIn
            prevBytesOut = bytesOut
            prevTimestamp = Date()
        }

        // Poll every 1 second
        bandwidthTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.pollBandwidth()
        }
    }

    private func pollBandwidth() {
        guard let (bytesIn, bytesOut) = fetchBandwidth() else { return }
        let now = Date()

        if let prev = prevTimestamp {
            let elapsed = now.timeIntervalSince(prev)
            if elapsed > 0.1 {
                let rateIn = Double(bytesIn - prevBytesIn) / elapsed
                let rateOut = Double(bytesOut - prevBytesOut) / elapsed
                DispatchQueue.main.async {
                    self.updateStatusItemTitle(rateIn: rateIn, rateOut: rateOut)
                }
            }
        }

        prevBytesIn = bytesIn
        prevBytesOut = bytesOut
        prevTimestamp = now
    }

    private func fetchBandwidth() -> (UInt64, UInt64)? {
        guard let ptr = blip_get_bandwidth() else { return nil }
        let json = String(cString: ptr)
        blip_free_string(ptr)

        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let bytesIn = obj["bytes_in"] as? UInt64,
              let bytesOut = obj["bytes_out"] as? UInt64 else {
            return nil
        }
        return (bytesIn, bytesOut)
    }

    private func updateStatusItemTitle(rateIn: Double, rateOut: Double) {
        guard let button = statusItem.button else { return }

        let upStr = formatRate(rateOut)
        let downStr = formatRate(rateIn)

        // Two-line attributed string: ↑ rate / ↓ rate
        let style = NSMutableParagraphStyle()
        style.alignment = .right
        style.lineSpacing = 0
        style.maximumLineHeight = 9
        style.minimumLineHeight = 9

        let font = NSFont.monospacedSystemFont(ofSize: 9, weight: .medium)
        let dimColor = NSColor.secondaryLabelColor
        let brightColor = NSColor.labelColor

        let attributed = NSMutableAttributedString()

        // Upload line: ↑ XX KB/s
        let upArrow = NSAttributedString(string: "↑ ", attributes: [
            .font: font, .foregroundColor: NSColor(red: 0.93, green: 0.28, blue: 0.60, alpha: 1.0), // pink
            .paragraphStyle: style
        ])
        let upValue = NSAttributedString(string: upStr, attributes: [
            .font: font, .foregroundColor: rateOut > 1024 ? brightColor : dimColor,
            .paragraphStyle: style
        ])

        // Download line: ↓ XX KB/s
        let downArrow = NSAttributedString(string: "\n↓ ", attributes: [
            .font: font, .foregroundColor: NSColor(red: 0.39, green: 0.40, blue: 0.95, alpha: 1.0), // indigo
            .paragraphStyle: style
        ])
        let downValue = NSAttributedString(string: downStr, attributes: [
            .font: font, .foregroundColor: rateIn > 1024 ? brightColor : dimColor,
            .paragraphStyle: style
        ])

        attributed.append(upArrow)
        attributed.append(upValue)
        attributed.append(downArrow)
        attributed.append(downValue)

        button.attributedTitle = attributed
        button.image = nil // Remove icon, text only
    }

    private func formatRate(_ bytesPerSec: Double) -> String {
        if bytesPerSec < 1024 {
            return String(format: "%.0f B/s", bytesPerSec)
        } else if bytesPerSec < 1024 * 1024 {
            return String(format: "%.1f KB/s", bytesPerSec / 1024)
        } else if bytesPerSec < 1024 * 1024 * 1024 {
            return String(format: "%.1f MB/s", bytesPerSec / (1024 * 1024))
        } else {
            return String(format: "%.1f GB/s", bytesPerSec / (1024 * 1024 * 1024))
        }
    }

    @objc func togglePopover(_ sender: Any?) {
        guard let button = statusItem.button else { return }

        if popover.isShown {
            popover.performClose(sender)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            menuBarWebView.evaluateJavaScript("document.hidden") { _, _ in }
        }
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let loc = locations.last {
            userLatitude = loc.coordinate.latitude
            userLongitude = loc.coordinate.longitude
            NSLog("Blip: location updated to %.4f, %.4f", userLatitude, userLongitude)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        NSLog("Blip: location error: %@", error.localizedDescription)
        DispatchQueue.global().async {
            if let url = URL(string: "https://ipapi.co/json/"),
               let data = try? Data(contentsOf: url),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let lat = json["latitude"] as? Double,
               let lon = json["longitude"] as? Double {
                DispatchQueue.main.async {
                    self.userLatitude = lat
                    self.userLongitude = lon
                    NSLog("Blip: IP geolocation fallback: %.4f, %.4f", lat, lon)
                }
            }
        }
    }

    // Keep app alive in menu bar when main window is closed
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        bandwidthTimer?.invalidate()
        if let monitor = eventMonitor {
            NSEvent.removeMonitor(monitor)
        }
        blip_stop_capture()
    }
}
