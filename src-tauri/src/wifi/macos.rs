use super::WifiNetwork;
use std::process::Command;
use std::path::PathBuf;

/// Scan WiFi networks on macOS using a compiled Swift helper that calls CoreWLAN.
/// The helper outputs a JSON array of network objects.
pub async fn scan() -> Result<Vec<WifiNetwork>, String> {
    let helper = find_helper()?;

    let output = Command::new(&helper)
        .output()
        .map_err(|e| format!("Failed to run wifi-scan helper: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "wifi-scan helper failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let networks: Vec<WifiNetwork> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse wifi-scan output: {}", e))?;

    Ok(networks)
}

fn find_helper() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    // Development: check resources/ and scripts/ dirs
    for subdir in &["resources", "scripts"] {
        let path = manifest_dir.join(subdir).join("wifi-scan");
        if path.exists() {
            log::info!("wifi-scan helper found at {:?}", path);
            return Ok(path);
        }
    }

    // Bundled app: check next to the binary and in Resources
    if let Ok(exe) = std::env::current_exe() {
        let dir = exe.parent().unwrap_or(std::path::Path::new("."));
        for candidate in &[
            dir.join("wifi-scan"),
            dir.join("../Resources/resources/wifi-scan"),
            dir.join("../Resources/scripts/wifi-scan"),
        ] {
            if candidate.exists() {
                log::info!("wifi-scan helper found at {:?}", candidate);
                return Ok(candidate.clone());
            }
        }
    }

    Err("wifi-scan helper not found. Searched resources/ and scripts/ in CARGO_MANIFEST_DIR".to_string())
}
