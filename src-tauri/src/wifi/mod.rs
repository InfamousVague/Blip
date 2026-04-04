pub mod macos;
pub mod analysis;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WifiNetwork {
    pub ssid: String,
    pub bssid: String,
    pub signal_dbm: i32,
    pub channel: u32,
    pub frequency_mhz: u32,
    pub channel_width: u32,
    pub security: String,
    pub band: String,
    pub noise_dbm: Option<i32>,
    pub is_current: bool,
}

/// Scan for nearby WiFi networks using platform-specific APIs.
pub async fn scan() -> Result<Vec<WifiNetwork>, String> {
    #[cfg(target_os = "macos")]
    return macos::scan().await;

    #[cfg(target_os = "windows")]
    return Err("Windows WiFi scanning not yet implemented".to_string());

    #[cfg(target_os = "linux")]
    return Err("Linux WiFi scanning not yet implemented".to_string());
}

/// Map a channel number to its center frequency in MHz.
pub fn channel_to_freq(channel: u32) -> u32 {
    match channel {
        1..=13 => 2407 + channel * 5,   // 2.4GHz: ch1=2412, ch6=2437, ch11=2462
        14 => 2484,
        36..=64 => 5000 + channel * 5,  // 5GHz UNII-1/2
        100..=144 => 5000 + channel * 5, // 5GHz UNII-2e/3
        149..=165 => 5000 + channel * 5, // 5GHz UNII-3
        _ => 0,
    }
}

/// Determine band from channel number.
pub fn channel_band(channel: u32) -> &'static str {
    if channel <= 14 { "2.4GHz" } else { "5GHz" }
}
