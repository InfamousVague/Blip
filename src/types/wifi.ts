export interface WifiNetwork {
  ssid: string;
  bssid: string;
  signal_dbm: number;
  channel: number;
  frequency_mhz: number;
  channel_width: number;
  security: string;
  band: string;
  noise_dbm: number | null;
  is_current: boolean;
}

export interface ChannelScore {
  channel: number;
  score: number;
  network_count: number;
}

export interface ChannelRecommendation {
  band_2g: ChannelScore | null;
  band_5g: ChannelScore | null;
  all_channels_2g: ChannelScore[];
  all_channels_5g: ChannelScore[];
}
