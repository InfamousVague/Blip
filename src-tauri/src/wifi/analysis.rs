use crate::wifi::WifiNetwork;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelScore {
    pub channel: u32,
    pub score: f64,        // 0 = clear, higher = more congested
    pub network_count: u32, // networks on or overlapping this channel
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelRecommendation {
    pub band_2g: Option<ChannelScore>,
    pub band_5g: Option<ChannelScore>,
    pub all_channels_2g: Vec<ChannelScore>,
    pub all_channels_5g: Vec<ChannelScore>,
}

/// 2.4GHz non-overlapping channels to recommend
const CHANNELS_2G: [u32; 3] = [1, 6, 11];
/// All 2.4GHz channels for scoring
const ALL_CHANNELS_2G: [u32; 13] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
/// Common 5GHz channels
const CHANNELS_5G: [u32; 9] = [36, 40, 44, 48, 149, 153, 157, 161, 165];

/// Calculate channel congestion and recommend best channels.
pub fn analyze(networks: &[WifiNetwork]) -> ChannelRecommendation {
    let networks_2g: Vec<&WifiNetwork> = networks.iter().filter(|n| n.band == "2.4GHz").collect();
    let networks_5g: Vec<&WifiNetwork> = networks.iter().filter(|n| n.band == "5GHz").collect();

    // Score all 2.4GHz channels
    let all_channels_2g: Vec<ChannelScore> = ALL_CHANNELS_2G
        .iter()
        .map(|&ch| score_channel_2g(ch, &networks_2g))
        .collect();

    // Score 5GHz channels
    let all_channels_5g: Vec<ChannelScore> = CHANNELS_5G
        .iter()
        .map(|&ch| score_channel_5g(ch, &networks_5g))
        .collect();

    // Best 2.4GHz (only recommend 1, 6, or 11)
    let best_2g = CHANNELS_2G
        .iter()
        .map(|&ch| score_channel_2g(ch, &networks_2g))
        .min_by(|a, b| a.score.partial_cmp(&b.score).unwrap());

    // Best 5GHz
    let best_5g = all_channels_5g
        .iter()
        .min_by(|a, b| a.score.partial_cmp(&b.score).unwrap())
        .cloned();

    ChannelRecommendation {
        band_2g: best_2g,
        band_5g: best_5g,
        all_channels_2g,
        all_channels_5g,
    }
}

/// Score a 2.4GHz channel based on interference from nearby networks.
/// 2.4GHz channels overlap: each channel is 22MHz wide, spaced 5MHz apart.
/// Two channels overlap if they're within 4 channels of each other.
fn score_channel_2g(target: u32, networks: &[&WifiNetwork]) -> ChannelScore {
    let mut score = 0.0;
    let mut count = 0u32;

    for net in networks {
        let ch = net.channel;
        let distance = (target as i32 - ch as i32).unsigned_abs();

        if distance > 4 { continue; } // no overlap beyond 4 channels

        count += 1;

        // Overlap factor: 1.0 for same channel, decreasing with distance
        let overlap = match distance {
            0 => 1.0,
            1 => 0.75,
            2 => 0.50,
            3 => 0.25,
            4 => 0.10,
            _ => 0.0,
        };

        // Convert dBm to linear power (approximate) and weight by overlap
        let power = dbm_to_linear(net.signal_dbm);
        score += power * overlap;
    }

    ChannelScore { channel: target, score, network_count: count }
}

/// Score a 5GHz channel. Non-overlapping for 20MHz, but bonded channels overlap.
fn score_channel_5g(target: u32, networks: &[&WifiNetwork]) -> ChannelScore {
    let mut score = 0.0;
    let mut count = 0u32;

    for net in networks {
        let ch = net.channel;
        let width_channels = net.channel_width / 20; // 20MHz = 1 channel, 40MHz = 2, etc.
        let half_width = (width_channels / 2).max(1) as i32;

        let distance = (target as i32 - ch as i32).unsigned_abs() as i32;

        // Check if target falls within the bonded channel range
        // 5GHz channels are spaced 20MHz (4 channel numbers) apart
        let overlap_range = half_width * 4; // in channel number units

        if distance > overlap_range { continue; }

        count += 1;
        let overlap = 1.0 - (distance as f64 / (overlap_range as f64 + 1.0));
        let power = dbm_to_linear(net.signal_dbm);
        score += power * overlap;
    }

    ChannelScore { channel: target, score, network_count: count }
}

/// Convert dBm to approximate linear power scale (for summing interference).
fn dbm_to_linear(dbm: i32) -> f64 {
    10.0_f64.powf(dbm as f64 / 10.0)
}
