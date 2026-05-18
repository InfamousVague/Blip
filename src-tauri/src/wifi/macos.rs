use super::WifiNetwork;
use std::process::Command;

/// Scan WiFi networks on macOS using system_profiler.
/// This runs as a child process of the Blip app, inheriting its Location Services permission.
/// The output includes SSIDs when the parent app has location access.
pub async fn scan() -> Result<Vec<WifiNetwork>, String> {
    let output = Command::new("/usr/sbin/system_profiler")
        .args(["SPAirPortDataType", "-json"])
        .output()
        .map_err(|e| format!("Failed to run system_profiler: {}", e))?;

    if !output.status.success() {
        return Err("system_profiler failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse system_profiler output: {}", e))?;

    let mut networks = Vec::new();

    let airport = json.get("SPAirPortDataType")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first());

    let Some(airport) = airport else { return Ok(networks); };

    let interfaces = airport.get("spairport_airport_interfaces")
        .and_then(|v| v.as_array());

    let Some(interfaces) = interfaces else { return Ok(networks); };

    for iface in interfaces {
        // Parse current network
        if let Some(current) = iface.get("spairport_current_network_information") {
            if let Some(net) = parse_network(current, true) {
                networks.push(net);
            }
        }

        // Parse other nearby networks
        if let Some(others) = iface.get("spairport_airport_other_local_wireless_networks")
            .and_then(|v| v.as_array())
        {
            for net_json in others {
                if let Some(net) = parse_network(net_json, false) {
                    networks.push(net);
                }
            }
        }
    }

    Ok(networks)
}

fn parse_network(json: &serde_json::Value, is_current: bool) -> Option<WifiNetwork> {
    let ssid = json.get("_name").and_then(|v| v.as_str()).unwrap_or("").to_string();

    // Parse channel string like "85 (6GHz, 160MHz)" or "6 (2GHz, 20MHz)"
    let channel_str = json.get("spairport_network_channel")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let (channel, band, channel_width) = parse_channel_string(channel_str);
    if channel == 0 { return None; }

    let frequency_mhz = if channel <= 14 {
        if channel == 14 { 2484 } else { 2407 + channel * 5 }
    } else {
        5000 + channel * 5
    };

    // Parse signal/noise like "-53 dBm / -95 dBm"
    let (signal_dbm, noise_dbm) = parse_signal_noise(
        json.get("spairport_signal_noise").and_then(|v| v.as_str()).unwrap_or("")
    );

    // Parse security
    let security = parse_security(
        json.get("spairport_security_mode").and_then(|v| v.as_str()).unwrap_or("")
    );

    // Parse BSSID
    let bssid = json.get("spairport_network_bssid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Some(WifiNetwork {
        ssid,
        bssid,
        signal_dbm,
        channel,
        frequency_mhz,
        channel_width,
        security,
        band,
        noise_dbm: if noise_dbm != 0 { Some(noise_dbm) } else { None },
        is_current,
    })
}

/// Parse "85 (6GHz, 160MHz)" → (85, "5GHz", 160)
fn parse_channel_string(s: &str) -> (u32, String, u32) {
    let parts: Vec<&str> = s.split_whitespace().collect();
    let channel: u32 = parts.first().and_then(|p| p.parse().ok()).unwrap_or(0);

    let mut band = if channel <= 14 { "2.4GHz" } else { "5GHz" }.to_string();
    let mut width: u32 = 20;

    // Parse the parenthetical part
    if let Some(paren_start) = s.find('(') {
        let paren = &s[paren_start..];
        if paren.contains("6GHz") { band = "6GHz".to_string(); }
        else if paren.contains("5GHz") { band = "5GHz".to_string(); }
        else if paren.contains("2GHz") || paren.contains("2.4GHz") { band = "2.4GHz".to_string(); }

        if paren.contains("160MHz") { width = 160; }
        else if paren.contains("80MHz") { width = 80; }
        else if paren.contains("40MHz") { width = 40; }
    }

    (channel, band, width)
}

/// Parse "-53 dBm / -95 dBm" → (signal, noise)
fn parse_signal_noise(s: &str) -> (i32, i32) {
    let parts: Vec<&str> = s.split('/').collect();
    let signal = parts.first()
        .and_then(|p| p.trim().strip_suffix(" dBm"))
        .and_then(|p| p.trim().parse().ok())
        .unwrap_or(-100);
    let noise = parts.get(1)
        .and_then(|p| p.trim().strip_suffix(" dBm"))
        .and_then(|p| p.trim().parse().ok())
        .unwrap_or(0);
    (signal, noise)
}

/// Parse security mode string
fn parse_security(s: &str) -> String {
    if s.contains("wpa3") { "WPA3".to_string() }
    else if s.contains("wpa2") && s.contains("wpa_") { "WPA/WPA2".to_string() }
    else if s.contains("wpa2") { "WPA2".to_string() }
    else if s.contains("wpa") { "WPA".to_string() }
    else if s.contains("wep") { "WEP".to_string() }
    else if s.contains("none") || s.is_empty() { "Open".to_string() }
    else { s.replace("spairport_security_mode_", "").replace('_', " ") }
}
