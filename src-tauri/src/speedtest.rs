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

/// Number of parallel streams — more streams = better saturation on fast links
const PARALLEL_STREAMS: usize = 8;
/// How long to run each test phase (seconds)
const TEST_DURATION_SECS: f64 = 12.0;
/// Chunk size per download request (100 MB — larger = fewer HTTP round-trips, better TCP window utilization)
const DOWN_CHUNK_BYTES: usize = 100_000_000;
/// Chunk size per upload request (50 MB — large enough for gigabit, small enough for timeouts)
const UP_CHUNK_BYTES: usize = 50_000_000;
/// Number of warmup requests per stream before measuring
const WARMUP_REQUESTS: usize = 2;
/// Warmup chunk size (5 MB — enough to open TCP windows)
const WARMUP_CHUNK_BYTES: usize = 5_000_000;

pub async fn run_speed_test() -> Result<SpeedTestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .pool_max_idle_per_host(PARALLEL_STREAMS + 2)
        .tcp_nodelay(true)
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
    let _ = client.get(format!("{}?bytes=0", CF_DOWN)).send().await;

    // Measure 5 pings, take median
    let mut pings = Vec::new();
    for _ in 0..5 {
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
    Ok(pings[2]) // median of 5
}

/// Download using multiple parallel streams, streaming bytes for accurate measurement.
async fn measure_download_parallel(client: &reqwest::Client) -> Result<f64, String> {
    // Phase 1: Warmup — establish all TCP+TLS connections and open windows
    let mut warmup_handles = Vec::new();
    for _ in 0..PARALLEL_STREAMS {
        let client = client.clone();
        warmup_handles.push(tokio::spawn(async move {
            for _ in 0..WARMUP_REQUESTS {
                if let Ok(resp) = client
                    .get(format!("{}?bytes={}", CF_DOWN, WARMUP_CHUNK_BYTES))
                    .send()
                    .await
                {
                    // Stream the response to actually receive the data and grow TCP window
                    let mut stream = resp;
                    while let Ok(Some(_chunk)) = stream.chunk().await {}
                }
            }
        }));
    }
    for h in warmup_handles {
        let _ = h.await;
    }

    // Phase 2: Measure — stream download data and count bytes as they arrive
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
                match client
                    .get(format!("{}?bytes={}", CF_DOWN, DOWN_CHUNK_BYTES))
                    .send()
                    .await
                {
                    Ok(mut resp) => {
                        // Stream chunks — count bytes as they arrive for accurate timing
                        loop {
                            if start.elapsed() >= deadline { break; }
                            match resp.chunk().await {
                                Ok(Some(chunk)) => {
                                    total_bytes.fetch_add(chunk.len() as u64, Ordering::Relaxed);
                                }
                                Ok(None) => break, // response complete
                                Err(_) => break,
                            }
                        }
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

/// Upload using multiple parallel streams with pre-allocated payload.
async fn measure_upload_parallel(client: &reqwest::Client) -> Result<f64, String> {
    let warmup_payload: Arc<Vec<u8>> = Arc::new(vec![0x42u8; WARMUP_CHUNK_BYTES]);

    // Phase 1: Warmup — establish upload connections
    let mut warmup_handles = Vec::new();
    for _ in 0..PARALLEL_STREAMS {
        let client = client.clone();
        let data = warmup_payload.clone();
        warmup_handles.push(tokio::spawn(async move {
            for _ in 0..WARMUP_REQUESTS {
                if let Ok(resp) = client
                    .post(CF_UP)
                    .body(data.as_ref().clone())
                    .header("Content-Type", "application/octet-stream")
                    .send()
                    .await
                {
                    let _ = resp.bytes().await;
                }
            }
        }));
    }
    for h in warmup_handles {
        let _ = h.await;
    }

    // Phase 2: Measure — pre-allocate payload once, reuse across iterations
    let payload: Arc<Vec<u8>> = Arc::new(vec![0x42u8; UP_CHUNK_BYTES]);
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
                let size = payload.len() as u64;

                match client
                    .post(CF_UP)
                    .body(payload.as_ref().clone())
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
