/// DNS packet parser — extracts query names and answer records from raw DNS UDP payloads.
///
/// DNS wire format (RFC 1035):
///   Header: 12 bytes (ID, flags, counts)
///   Questions: variable (QNAME + QTYPE + QCLASS)
///   Answers: variable (NAME + TYPE + CLASS + TTL + RDLENGTH + RDATA)

/// Parse a DNS name from the packet, handling compression pointers (0xC0).
/// Returns (name, bytes_consumed) or None on malformed input.
fn parse_dns_name(data: &[u8], offset: usize) -> Option<(String, usize)> {
    let mut labels = Vec::new();
    let mut pos = offset;
    let mut jumped = false;
    let mut first_jump_pos = 0;
    let mut hops = 0;

    loop {
        if pos >= data.len() || hops > 64 {
            return None;
        }
        let len = data[pos] as usize;

        if len == 0 {
            // End of name
            if !jumped {
                first_jump_pos = pos + 1;
            }
            break;
        }

        // Compression pointer: top 2 bits = 11
        if len & 0xC0 == 0xC0 {
            if pos + 1 >= data.len() {
                return None;
            }
            let ptr = ((len & 0x3F) << 8) | data[pos + 1] as usize;
            if !jumped {
                first_jump_pos = pos + 2;
            }
            pos = ptr;
            jumped = true;
            hops += 1;
            continue;
        }

        // Regular label
        pos += 1;
        if pos + len > data.len() {
            return None;
        }
        let label = std::str::from_utf8(&data[pos..pos + len]).ok()?;
        labels.push(label.to_string());
        pos += len;
        hops += 1;
    }

    let name = labels.join(".");
    let consumed = if jumped {
        first_jump_pos - offset
    } else {
        first_jump_pos - offset
    };
    Some((name, consumed))
}

/// Parsed DNS query/response.
pub struct ParsedDns {
    pub is_response: bool,
    pub query_name: String,
    pub query_type: String,
    pub answer_ips: Vec<String>,
}

/// Parse a raw DNS UDP payload (no Ethernet/IP/UDP headers).
pub fn parse_dns_payload(payload: &[u8]) -> Option<ParsedDns> {
    if payload.len() < 12 {
        return None;
    }

    // Header
    let flags = u16::from_be_bytes([payload[2], payload[3]]);
    let is_response = (flags & 0x8000) != 0;
    let qdcount = u16::from_be_bytes([payload[4], payload[5]]) as usize;
    let ancount = u16::from_be_bytes([payload[6], payload[7]]) as usize;

    if qdcount == 0 {
        return None;
    }

    // Parse first question
    let (query_name, name_len) = parse_dns_name(payload, 12)?;
    let qtype_offset = 12 + name_len;
    if qtype_offset + 4 > payload.len() {
        return None;
    }
    let qtype = u16::from_be_bytes([payload[qtype_offset], payload[qtype_offset + 1]]);

    let query_type = match qtype {
        1 => "A",
        28 => "AAAA",
        5 => "CNAME",
        15 => "MX",
        2 => "NS",
        12 => "PTR",
        6 => "SOA",
        16 => "TXT",
        33 => "SRV",
        65 => "HTTPS",
        _ => "OTHER",
    }
    .to_string();

    // For queries (not responses), return just the query info
    if !is_response {
        return Some(ParsedDns {
            is_response: false,
            query_name,
            query_type,
            answer_ips: Vec::new(),
        });
    }

    // Parse answers — skip remaining questions first
    let mut pos = qtype_offset + 4; // past QTYPE + QCLASS of first question
    for _ in 1..qdcount {
        let (_, skip) = parse_dns_name(payload, pos)?;
        pos += skip + 4; // skip QTYPE + QCLASS
        if pos > payload.len() {
            return None;
        }
    }

    // Parse answer records
    let mut answer_ips = Vec::new();
    for _ in 0..ancount {
        if pos >= payload.len() {
            break;
        }
        let (_, name_skip) = parse_dns_name(payload, pos)?;
        pos += name_skip;
        if pos + 10 > payload.len() {
            break;
        }

        let rtype = u16::from_be_bytes([payload[pos], payload[pos + 1]]);
        let rdlength = u16::from_be_bytes([payload[pos + 8], payload[pos + 9]]) as usize;
        pos += 10;

        if pos + rdlength > payload.len() {
            break;
        }

        match rtype {
            1 if rdlength == 4 => {
                // A record — IPv4
                let ip = format!(
                    "{}.{}.{}.{}",
                    payload[pos],
                    payload[pos + 1],
                    payload[pos + 2],
                    payload[pos + 3]
                );
                answer_ips.push(ip);
            }
            28 if rdlength == 16 => {
                // AAAA record — IPv6
                let mut segments = Vec::new();
                for i in 0..8 {
                    let seg =
                        u16::from_be_bytes([payload[pos + i * 2], payload[pos + i * 2 + 1]]);
                    segments.push(format!("{:x}", seg));
                }
                answer_ips.push(segments.join(":"));
            }
            _ => {}
        }

        pos += rdlength;
    }

    Some(ParsedDns {
        is_response: true,
        query_name,
        query_type,
        answer_ips,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_a_query() {
        // Minimal DNS query for "example.com" type A
        // Header: ID=0x1234, flags=0x0100 (standard query), QDCOUNT=1
        let mut pkt = vec![
            0x12, 0x34, // ID
            0x01, 0x00, // Flags: standard query
            0x00, 0x01, // QDCOUNT: 1
            0x00, 0x00, // ANCOUNT: 0
            0x00, 0x00, // NSCOUNT: 0
            0x00, 0x00, // ARCOUNT: 0
        ];
        // Question: example.com, type A, class IN
        pkt.extend_from_slice(&[7]); // length of "example"
        pkt.extend_from_slice(b"example");
        pkt.extend_from_slice(&[3]); // length of "com"
        pkt.extend_from_slice(b"com");
        pkt.push(0); // end of name
        pkt.extend_from_slice(&[0x00, 0x01]); // QTYPE: A
        pkt.extend_from_slice(&[0x00, 0x01]); // QCLASS: IN

        let result = parse_dns_payload(&pkt).unwrap();
        assert!(!result.is_response);
        assert_eq!(result.query_name, "example.com");
        assert_eq!(result.query_type, "A");
        assert!(result.answer_ips.is_empty());
    }

    #[test]
    fn test_parse_a_response() {
        // DNS response for "example.com" → 93.184.216.34
        let mut pkt = vec![
            0x12, 0x34, // ID
            0x81, 0x80, // Flags: response, recursion available
            0x00, 0x01, // QDCOUNT: 1
            0x00, 0x01, // ANCOUNT: 1
            0x00, 0x00, // NSCOUNT
            0x00, 0x00, // ARCOUNT
        ];
        // Question: example.com
        pkt.extend_from_slice(&[7]);
        pkt.extend_from_slice(b"example");
        pkt.extend_from_slice(&[3]);
        pkt.extend_from_slice(b"com");
        pkt.push(0);
        pkt.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]); // QTYPE A, QCLASS IN

        // Answer: example.com (compressed pointer to offset 12) → 93.184.216.34
        pkt.extend_from_slice(&[0xC0, 0x0C]); // name pointer to offset 12
        pkt.extend_from_slice(&[0x00, 0x01]); // TYPE: A
        pkt.extend_from_slice(&[0x00, 0x01]); // CLASS: IN
        pkt.extend_from_slice(&[0x00, 0x00, 0x00, 0x3C]); // TTL: 60
        pkt.extend_from_slice(&[0x00, 0x04]); // RDLENGTH: 4
        pkt.extend_from_slice(&[93, 184, 216, 34]); // RDATA: 93.184.216.34

        let result = parse_dns_payload(&pkt).unwrap();
        assert!(result.is_response);
        assert_eq!(result.query_name, "example.com");
        assert_eq!(result.query_type, "A");
        assert_eq!(result.answer_ips, vec!["93.184.216.34"]);
    }
}
