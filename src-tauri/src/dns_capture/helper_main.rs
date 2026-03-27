//! blip-dns-helper — Privileged DNS packet capture helper.
//!
//! Runs with elevated privileges (via sudo), opens a BPF capture on all
//! interfaces filtered to UDP port 53, parses DNS queries and responses,
//! and writes JSON lines to stdout for the main Blip process to read.
//!
//! Output format (one JSON object per line):
//!   {"domain":"example.com","ips":["1.2.3.4"],"type":"A","ts":1234567890}

// We need the parser module — it's shared with the library crate.
// Since this is a binary in the same package, we include it directly.
mod parser {
    include!("parser.rs");
}

use std::io::{self, Write};
use std::time::{SystemTime, UNIX_EPOCH};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn main() {
    // Set up line-buffered stdout
    let stdout = io::stdout();

    // Find default capture device
    let device = match pcap::Device::lookup() {
        Ok(Some(d)) => d,
        Ok(None) => {
            eprintln!("blip-dns-helper: no capture device found");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("blip-dns-helper: device lookup failed: {}", e);
            std::process::exit(1);
        }
    };

    eprintln!("blip-dns-helper: capturing on {}", device.name);

    // Open capture with promiscuous mode, 1s timeout
    let mut cap = match pcap::Capture::from_device(device)
        .unwrap()
        .promisc(false)
        .snaplen(1500)
        .timeout(1000) // 1 second read timeout
        .open()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("blip-dns-helper: failed to open capture: {}", e);
            std::process::exit(1);
        }
    };

    // BPF filter: only UDP port 53 (DNS)
    if let Err(e) = cap.filter("udp port 53", true) {
        eprintln!("blip-dns-helper: failed to set filter: {}", e);
        std::process::exit(1);
    }

    eprintln!("blip-dns-helper: listening for DNS packets");

    // Capture loop
    loop {
        match cap.next_packet() {
            Ok(packet) => {
                if let Some(event) = process_packet(packet.data) {
                    let mut handle = stdout.lock();
                    // Write JSON line — ignore write errors (parent closed pipe)
                    if serde_json::to_writer(&mut handle, &event).is_err() {
                        break;
                    }
                    if handle.write_all(b"\n").is_err() {
                        break;
                    }
                    if handle.flush().is_err() {
                        break;
                    }
                }
            }
            Err(pcap::Error::TimeoutExpired) => {
                // Normal — no packets in the timeout window, loop again
                continue;
            }
            Err(e) => {
                eprintln!("blip-dns-helper: capture error: {}", e);
                break;
            }
        }
    }
}

/// Extract DNS payload from a raw Ethernet frame and parse it.
fn process_packet(data: &[u8]) -> Option<DnsJsonEvent> {
    // Ethernet header: 14 bytes
    if data.len() < 14 {
        return None;
    }
    let ethertype = u16::from_be_bytes([data[12], data[13]]);

    let ip_start = match ethertype {
        0x0800 => 14, // IPv4
        0x86DD => 14, // IPv6
        // Loopback on macOS uses a 4-byte header (AF_INET/AF_INET6), not Ethernet
        _ => {
            // Try as loopback: 4-byte null/loopback header
            if data.len() < 4 {
                return None;
            }
            let af = u32::from_ne_bytes([data[0], data[1], data[2], data[3]]);
            if af == 2 || af == 30 {
                // AF_INET=2, AF_INET6=30 on macOS
                4
            } else {
                return None;
            }
        }
    };

    if ip_start >= data.len() {
        return None;
    }

    let ip_version = (data[ip_start] >> 4) & 0x0F;
    let udp_start = match ip_version {
        4 => {
            let ihl = (data[ip_start] & 0x0F) as usize * 4;
            ip_start + ihl
        }
        6 => {
            // IPv6: fixed 40-byte header (no extension header handling for simplicity)
            ip_start + 40
        }
        _ => return None,
    };

    // UDP header: 8 bytes (src_port, dst_port, length, checksum)
    if udp_start + 8 > data.len() {
        return None;
    }
    let dns_start = udp_start + 8;
    let dns_payload = &data[dns_start..];

    let parsed = parser::parse_dns_payload(dns_payload)?;

    // Only emit responses with IPs, or queries (for the query log)
    if parsed.is_response && parsed.answer_ips.is_empty() && parsed.query_type == "A" {
        return None; // Skip empty A responses (NXDOMAIN etc.)
    }

    Some(DnsJsonEvent {
        domain: parsed.query_name,
        ips: parsed.answer_ips,
        r#type: parsed.query_type,
        ts: now_ms(),
    })
}

/// JSON output format — matches DnsEvent in types.rs
#[derive(serde::Serialize)]
struct DnsJsonEvent {
    domain: String,
    ips: Vec<String>,
    r#type: String,
    ts: u64,
}
