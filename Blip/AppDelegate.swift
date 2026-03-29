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

        // Set up WKWebView with message handlers
        let config = WKWebViewConfiguration()
        let contentController = WKUserContentController()

        webBridge = WebBridge()
        contentController.add(webBridge, name: "blip")

        // Inject the bridge JS so the frontend can call window.blip.invoke(...)
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

        // Allow loading local files and connecting to tile servers
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground") // Transparent background

        // Load the React frontend from bundled assets
        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        } else {
            NSLog("Could not find web/index.html in bundle")
        }

        // Create window
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
        // Fallback: try IP geolocation
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

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        blip_stop_capture()
    }
}
