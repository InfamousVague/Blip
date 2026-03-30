use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
pub struct SpeedTestResult {
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub ping_ms: f64,
    pub timestamp_ms: u64,
}

const CF_DOWN: &str = "https://speed.cloudflare.com/__down";
const CF_UP: &str = "https://speed.cloudflare.com/__up";

/// Number of parallel streams — mimics what speedtest.net does
const PARALLEL_STREAMS: usize = 8;
/// How long to run each test phase (seconds)
const TEST_DURATION_SECS: f64 = 8.0;
/// Chunk size per request for download (100 MB — large enough for TCP to ramp)
const DOWN_CHUNK_BYTES: usize = 100_000_000;
/// Chunk size per request for upload (25 MB)
const UP_CHUNK_BYTES: usize = 25_000_000;

pub async fn run_speed_test() -> Result<SpeedTestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(PARALLEL_STREAMS + 2)
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    // Ping test
    let ping_ms = measure_ping(&client).await.unwrap_or(0.0);
    log::info!("Speed test: ping = {:.1}ms", ping_ms);

    // Download test — parallel streams for TEST_DURATION_SECS
    let download_mbps = measure_download_parallel(&client).await.unwrap_or(0.0);
    log::info!("Speed test: download = {:.1} Mbps", download_mbps);

    // Upload test — parallel streams for TEST_DURATION_SECS
    let upload_mbps = measure_upload_parallel(&client).await.unwrap_or(0.0);
    log::info!("Speed test: upload = {:.1} Mbps", upload_mbps);

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    Ok(SpeedTestResult {
        download_mbps,
        upload_mbps,
        ping_ms,
        timestamp_ms,
    })
}

async fn measure_ping(client: &reqwest::Client) -> Result<f64, String> {
    // Warm up connection
    let _ = client
        .get(format!("{}?bytes=0", CF_DOWN))
        .send()
        .await;

    // Measure 3 pings, take median
    let mut pings = Vec::new();
    for _ in 0..3 {
        let start = Instant::now();
        let resp = client
            .get(format!("{}?bytes=0", CF_DOWN))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let _ = resp.bytes().await;
        pings.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    pings.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Ok(pings[1]) // median
}

/// Download using multiple parallel streams, measuring total throughput.
/// Each stream repeatedly downloads large chunks until the time limit expires.
async fn measure_download_parallel(client: &reqwest::Client) -> Result<f64, String> {
    // Warmup: single small request to establish TLS + TCP
    let _ = client
        .get(format!("{}?bytes=1000000", CF_DOWN))
        .send()
        .await
        .and_then(|r| Ok(r));

    let total_bytes = Arc::new(AtomicU64::new(0));
    let start = Instant::now();
    let deadline = Duration::from_secs_f64(TEST_DURATION_SECS);

    let mut handles = Vec::new();
    for _ in 0..PARALLEL_STREAMS {
        let client = client.clone();
        let total_bytes = total_bytes.clone();
        let start = start;
        let deadline = deadline;

        handles.push(tokio::spawn(async move {
            loop {
                if start.elapsed() >= deadline {
                    break;
                }
                let remaining = (deadline - start.elapsed()).as_secs_f64();
                if remaining < 0.5 {
                    break;
                }
                // Scale chunk size down if we're near the end
                let chunk = if remaining < 3.0 {
                    DOWN_CHUNK_BYTES / 4
                } else {
                    DOWN_CHUNK_BYTES
                };
                match client
                    .get(format!("{}?bytes={}", CF_DOWN, chunk))
                    .send()
                    .await
                {
                    Ok(resp) => match resp.bytes().await {
                        Ok(data) => {
                            total_bytes.fetch_add(data.len() as u64, Ordering::Relaxed);
                        }
                        Err(_) => break,
                    },
                    Err(_) => break,
                }
            }
        }));
    }

    // Wait for all streams to finish
    for h in handles {
        let _ = h.await;
    }

    let elapsed = start.elapsed().as_secs_f64();
    let bytes = total_bytes.load(Ordering::Relaxed);

    if elapsed > 0.0 && bytes > 0 {
        Ok((bytes as f64 * 8.0) / elapsed / 1_000_000.0)
    } else {
        Ok(0.0)
    }
}

/// Upload using multiple parallel streams, measuring total throughput.
async fn measure_upload_parallel(client: &reqwest::Client) -> Result<f64, String> {
    // Pre-generate upload payload (shared across streams via Arc)
    let payload = Arc::new(vec![0x42u8; UP_CHUNK_BYTES]);

    let total_bytes = Arc::new(AtomicU64::new(0));
    let start = Instant::now();
    let deadline = Duration::from_secs_f64(TEST_DURATION_SECS);

    let mut handles = Vec::new();
    for _ in 0..PARALLEL_STREAMS {
        let client = client.clone();
        let total_bytes = total_bytes.clone();
        let payload = payload.clone();
        let start = start;
        let deadline = deadline;

        handles.push(tokio::spawn(async move {
            loop {
                if start.elapsed() >= deadline {
                    break;
                }
                let remaining = (deadline - start.elapsed()).as_secs_f64();
                if remaining < 0.5 {
                    break;
                }
                // Use smaller chunks near the end
                let chunk_size = if remaining < 3.0 {
                    UP_CHUNK_BYTES / 4
                } else {
                    UP_CHUNK_BYTES
                };
                let data = payload[..chunk_size].to_vec();
                let size = data.len() as u64;

                match client
                    .post(CF_UP)
                    .body(data)
                    .header("Content-Type", "application/octet-stream")
                    .send()
                    .await
                {
                    Ok(resp) => {
                        let _ = resp.bytes().await;
                        total_bytes.fetch_add(size, Ordering::Relaxed);
                    }
                    Err(_) => break,
                }
            }
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    let elapsed = start.elapsed().as_secs_f64();
    let bytes = total_bytes.load(Ordering::Relaxed);

    if elapsed > 0.0 && bytes > 0 {
        Ok((bytes as f64 * 8.0) / elapsed / 1_000_000.0)
    } else {
        Ok(0.0)
    }
}
