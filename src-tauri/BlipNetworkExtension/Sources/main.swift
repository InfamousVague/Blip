import Foundation
import NetworkExtension

// Entry point for the Network Extension system extension.
// macOS loads this as a separate process managed by the system.
@main
struct BlipNEMain {
    static func main() {
        autoreleasepool {
            NEProvider.startSystemExtensionMode()
        }
        dispatchMain()
    }
}
