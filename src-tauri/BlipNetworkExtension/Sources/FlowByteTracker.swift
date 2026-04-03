import Foundation

/// Per-flow byte accumulators — keyed by "destIp:destPort"
struct FlowByteTracker {
    var bytesIn: UInt64 = 0
    var bytesOut: UInt64 = 0
    var sourceAppId: String = "unknown"
    var destIp: String
    var destPort: Int
    var lastReported: UInt64 = 0
}
