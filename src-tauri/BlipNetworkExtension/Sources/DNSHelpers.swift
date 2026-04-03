import Foundation

// MARK: - DNS Parsing Helpers

/// Parse the query name (domain) from a raw DNS packet.
func parseDNSQueryName(from data: Data) -> String? {
    guard data.count > 12 else { return nil }

    var labels: [String] = []
    var offset = 12 // Skip DNS header

    while offset < data.count {
        let len = Int(data[offset])
        if len == 0 { break }
        if len & 0xC0 == 0xC0 { break } // Compression pointer

        offset += 1
        guard offset + len <= data.count else { return nil }

        let labelData = data.subdata(in: offset..<(offset + len))
        guard let label = String(data: labelData, encoding: .utf8) else { return nil }
        labels.append(label)
        offset += len
    }

    return labels.isEmpty ? nil : labels.joined(separator: ".")
}

/// Parse the query type (A, AAAA, CNAME, etc.) from a raw DNS packet.
func parseDNSQueryType(from data: Data) -> String? {
    guard data.count > 12 else { return nil }

    // Skip to after the query name
    var offset = 12
    while offset < data.count {
        let len = Int(data[offset])
        if len == 0 { offset += 1; break }
        offset += 1 + len
    }

    guard offset + 2 <= data.count else { return nil }
    let qtype = UInt16(data[offset]) << 8 | UInt16(data[offset + 1])

    switch qtype {
    case 1: return "A"
    case 28: return "AAAA"
    case 5: return "CNAME"
    case 15: return "MX"
    case 2: return "NS"
    case 65: return "HTTPS"
    default: return "OTHER"
    }
}

/// Parse IP addresses from DNS response answer records.
func parseDNSResponseIPs(from data: Data) -> [String] {
    guard data.count > 12 else { return [] }

    // Skip header
    let ancount = UInt16(data[6]) << 8 | UInt16(data[7])
    guard ancount > 0 else { return [] }

    // Skip question section
    var offset = 12
    let qdcount = UInt16(data[4]) << 8 | UInt16(data[5])
    for _ in 0..<qdcount {
        while offset < data.count {
            let len = Int(data[offset])
            if len == 0 { offset += 1; break }
            if len & 0xC0 == 0xC0 { offset += 2; break }
            offset += 1 + len
        }
        offset += 4 // QTYPE + QCLASS
    }

    // Parse answer records
    var ips: [String] = []
    for _ in 0..<ancount {
        guard offset < data.count else { break }

        // Skip name (may be compressed)
        if data[offset] & 0xC0 == 0xC0 {
            offset += 2
        } else {
            while offset < data.count {
                let len = Int(data[offset])
                if len == 0 { offset += 1; break }
                offset += 1 + len
            }
        }

        guard offset + 10 <= data.count else { break }
        let rtype = UInt16(data[offset]) << 8 | UInt16(data[offset + 1])
        let rdlength = Int(UInt16(data[offset + 8]) << 8 | UInt16(data[offset + 9]))
        offset += 10

        guard offset + rdlength <= data.count else { break }

        if rtype == 1 && rdlength == 4 {
            // A record
            let ip = "\(data[offset]).\(data[offset+1]).\(data[offset+2]).\(data[offset+3])"
            ips.append(ip)
        } else if rtype == 28 && rdlength == 16 {
            // AAAA record
            var segments: [String] = []
            for i in stride(from: 0, to: 16, by: 2) {
                let seg = UInt16(data[offset + i]) << 8 | UInt16(data[offset + i + 1])
                segments.append(String(format: "%x", seg))
            }
            ips.append(segments.joined(separator: ":"))
        }

        offset += rdlength
    }

    return ips
}

/// Build an NXDOMAIN response for the given DNS query.
func buildNXDOMAINResponse(for query: Data) -> Data? {
    guard query.count >= 12 else { return nil }

    var response = Data(query)
    // Set QR bit (response) + RCODE=3 (NXDOMAIN)
    response[2] = response[2] | 0x80  // QR = 1
    response[3] = (response[3] & 0xF0) | 0x03  // RCODE = 3 (NXDOMAIN)
    // Zero answer/authority/additional counts
    response[6] = 0; response[7] = 0  // ANCOUNT = 0
    response[8] = 0; response[9] = 0  // NSCOUNT = 0
    response[10] = 0; response[11] = 0  // ARCOUNT = 0
    // Truncate to just header + question
    // Find end of question section
    var offset = 12
    let qdcount = UInt16(query[4]) << 8 | UInt16(query[5])
    for _ in 0..<qdcount {
        while offset < query.count {
            let len = Int(query[offset])
            if len == 0 { offset += 1; break }
            offset += 1 + len
        }
        offset += 4 // QTYPE + QCLASS
    }
    return Data(response.prefix(offset))
}
