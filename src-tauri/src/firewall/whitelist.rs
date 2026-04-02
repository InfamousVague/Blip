/// Apple system processes that should always be allowed through the firewall.
/// These are essential macOS services that would break the system if blocked.
const SYSTEM_BUNDLE_IDS: &[&str] = &[
    "com.apple.mDNSResponder",
    "com.apple.trustd",
    "com.apple.nsurlsessiond",
    "com.apple.softwareupdated",
    "com.apple.mobileassetd",
    "com.apple.AppleIDAuthAgent",
    "com.apple.akd",
    "com.apple.cloudd",
    "com.apple.identityservicesd",
    "com.apple.timed",
    "com.apple.networkserviceproxy",
    "com.apple.symptomsd",
    "com.apple.mediaremoted",
    "com.apple.apsd",
    "com.apple.CommCenter",
    "com.apple.geod",
    "com.apple.locationd",
    "com.apple.parsecd",
    "com.apple.security.cloudkeychainproxy3",
    "com.apple.iCloudNotificationAgent",
    // Blip itself
    "com.infamousvague.blip",
];

pub fn is_system_whitelisted(bundle_id: &str) -> bool {
    SYSTEM_BUNDLE_IDS.contains(&bundle_id)
}

/// Get the full list of whitelisted bundle IDs (for displaying in UI).
pub fn get_system_whitelist() -> Vec<String> {
    SYSTEM_BUNDLE_IDS.iter().map(|s| s.to_string()).collect()
}
