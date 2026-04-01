use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
pub struct SpeedTestResult {
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub ping_ms: f64,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
struct SpeedTestProgress {
    stage: String,
    mbps: f64,
    percent: u8,
}

const CF_DOWN: &str = "https://speed.cloudflare.com/__down";
const CF_UP: &str = "https://speed.cloudflare.com/__up";

/// Parallel streams for upload (upload endpoint has generous rate limits)
const UPLOAD_STREAMS: usize = 8;
/// Parallel streams for download — kept low to avoid Cloudflare 429
const DOWNLOAD_STREAMS: usize = 2;
/// How long to run each test phase (seconds)
const TEST_DURATION_SECS: f64 = 15.0;
/// Chunk size per download request (25 MB — fewer larger requests avoids rate-limit triggers)
const DOWN_CHUNK_BYTES: usize = 25_000_000;
/// Chunk size per upload request (50 MB)
const UP_CHUNK_BYTES: usize = 50_000_000;
/// Number of warmup requests per stream before measuring
const WARMUP_REQUESTS: usize = 2;
/// Warmup chunk size (5 MB — enough to open TCP windows)
const WARMUP_CHUNK_BYTES: usize = 5_000_000;
/// How often to emit progress events (ms)
const PROGRESS_INTERVAL_MS: u64 = 500;
/// How long to wait after a 429 before trying download again (seconds)
const DOWNLOAD_COOLDOWN_SECS: u64 = 300; // 5 minutes

/// Global state tracking download rate-limit cooldown.
/// Stores the last time we got 429'd and the last successful download result.
static DOWNLOAD_STATE: std::sync::LazyLock<Mutex<DownloadState>> =
    std::sync::LazyLock::new(|| Mutex::new(DownloadState::default()));

#[derive(Default)]
struct DownloadState {
    /// Epoch millis when we last got 429'd
    rate_limited_at_ms: u64,
    /// Last successful download measurement to reuse during cooldown
    last_good_mbps: f64,
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

pub async fn run_speed_test(app_handle: tauri::AppHandle) -> Result<SpeedTestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .pool_max_idle_per_host(UPLOAD_STREAMS + 2)
        .tcp_nodelay(true)
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    // Emit ping stage
    let _ = app_handle.emit("speed-test-progress", SpeedTestProgress {
        stage: "ping".into(), mbps: 0.0, percent: 0,
    });

    // Ping test
    let ping_ms = measure_ping(&client).await.unwrap_or(0.0);
    log::info!("Speed test: ping = {:.1}ms", ping_ms);

    // Check download cooldown — skip if we were recently rate-limited
    let (in_cooldown, cached_mbps) = {
        let state = DOWNLOAD_STATE.lock().unwrap();
        let elapsed_ms = now_epoch_ms().saturating_sub(state.rate_limited_at_ms);
        let cooldown = state.rate_limited_at_ms > 0
            && elapsed_ms < DOWNLOAD_COOLDOWN_SECS * 1000;
        if cooldown {
            let remaining_s = (DOWNLOAD_COOLDOWN_SECS * 1000 - elapsed_ms) / 1000;
            log::info!(
                "Speed test: download skipped (rate-limit cooldown, {}s remaining), reusing {:.1} Mbps",
                remaining_s, state.last_good_mbps
            );
            let _ = app_handle.emit("speed-test-progress", SpeedTestProgress {
                stage: "download".into(), mbps: state.last_good_mbps, percent: 25,
            });
        }
        (cooldown, state.last_good_mbps)
        // MutexGuard dropped here
    };

    let download_mbps = if in_cooldown {
        // Brief pause so the UI shows the download phase
        tokio::time::sleep(Duration::from_millis(500)).await;
        cached_mbps
    } else {
        measure_download_parallel(&client, &app_handle).await.unwrap_or(0.0)
    };

    log::info!("Speed test: download = {:.1} Mbps", download_mbps);

    // Emit final download result so frontend can lock in the number before upload starts
    let _ = app_handle.emit("speed-test-progress", SpeedTestProgress {
        stage: "download_done".into(), mbps: download_mbps, percent: 50,
    });

    // Upload test
    let upload_mbps = measure_upload_parallel(&client, &app_handle).await.unwrap_or(0.0);
    log::info!("Speed test: upload = {:.1} Mbps", upload_mbps);

    let timestamp_ms = now_epoch_ms();

    // Emit completion
    let _ = app_handle.emit("speed-test-progress", SpeedTestProgress {
        stage: "done".into(), mbps: 0.0, percent: 100,
    });

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

/// Handle returned from spawn_progress_reporter — stop flag + collected EMA samples.
struct ProgressHandle {
    stop: Arc<AtomicBool>,
    samples: Arc<Mutex<Vec<f64>>>,
}

impl ProgressHandle {
    /// Stop the reporter and return the average of the top 80% of EMA samples.
    fn finish(&self) -> f64 {
        self.stop.store(true, Ordering::Relaxed);
        let samples = self.samples.lock().unwrap();
        if samples.is_empty() {
            return 0.0;
        }
        let mut sorted: Vec<f64> = samples.iter().copied().filter(|v| *v > 0.0).collect();
        if sorted.is_empty() {
            return 0.0;
        }
        sorted.sort_by(|a, b| b.partial_cmp(a).unwrap());
        let top_count = (sorted.len() as f64 * 0.8).ceil() as usize;
        let top = &sorted[..top_count.min(sorted.len())];
        top.iter().sum::<f64>() / top.len() as f64
    }
}

/// Spawns a progress reporter that emits events every 500ms.
/// Uses exponential moving average for smooth display.
fn spawn_progress_reporter(
    app_handle: &tauri::AppHandle,
    stage: &str,
    total_bytes: Arc<AtomicU64>,
    start: Instant,
    base_percent: u8,
    percent_range: u8,
) -> ProgressHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();
    let samples: Arc<Mutex<Vec<f64>>> = Arc::new(Mutex::new(Vec::new()));
    let samples_clone = samples.clone();
    let app = app_handle.clone();
    let stage = stage.to_string();
    let duration = TEST_DURATION_SECS;

    tokio::spawn(async move {
        let mut ema_mbps: f64 = 0.0;
        let mut last_bytes: u64 = 0;
        let mut last_time = start;
        let alpha = 0.3;

        loop {
            tokio::time::sleep(Duration::from_millis(PROGRESS_INTERVAL_MS)).await;
            if stop_clone.load(Ordering::Relaxed) {
                break;
            }

            let now = Instant::now();
            let elapsed_total = now.duration_since(start).as_secs_f64();
            let current_bytes = total_bytes.load(Ordering::Relaxed);

            let interval_secs = now.duration_since(last_time).as_secs_f64();
            let interval_bytes = current_bytes.saturating_sub(last_bytes);
            let instant_mbps = if interval_secs > 0.0 && interval_bytes > 0 {
                (interval_bytes as f64 * 8.0) / interval_secs / 1_000_000.0
            } else {
                0.0
            };

            if ema_mbps < 0.01 {
                ema_mbps = instant_mbps;
            } else if instant_mbps > 0.0 {
                ema_mbps = alpha * instant_mbps + (1.0 - alpha) * ema_mbps;
            }

            if ema_mbps > 0.0 {
                if let Ok(mut s) = samples_clone.lock() {
                    s.push(ema_mbps);
                }
            }

            let pct = ((elapsed_total / duration).min(1.0) * percent_range as f64) as u8 + base_percent;

            let _ = app.emit("speed-test-progress", SpeedTestProgress {
                stage: stage.clone(),
                mbps: ema_mbps,
                percent: pct,
            });

            last_bytes = current_bytes;
            last_time = now;
        }
    });

    ProgressHandle { stop, samples }
}

/// Download using parallel streams, streaming bytes for accurate measurement.
/// If Cloudflare returns 429, all streams stop immediately and the cooldown timer starts.
async fn measure_download_parallel(client: &reqwest::Client, app_handle: &tauri::AppHandle) -> Result<f64, String> {
    // Probe: single tiny request to check if we're rate-limited before committing
    let probe = client
        .get(format!("{}?bytes=100000", CF_DOWN))
        .send()
        .await;
    match probe {
        Ok(resp) if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS => {
            log::warn!("Speed test: download probe got 429 — entering cooldown");
            let mut state = DOWNLOAD_STATE.lock().unwrap();
            state.rate_limited_at_ms = now_epoch_ms();
            return Ok(state.last_good_mbps);
        }
        Ok(resp) => {
            // Consume the probe response
            let mut r = resp;
            while let Ok(Some(_)) = r.chunk().await {}
        }
        Err(e) => {
            log::warn!("Speed test: download probe failed: {}", e);
        }
    }

    log::info!("Speed test: download probe OK, starting measurement");

    // Shared flag: any stream that hits 429 sets this to stop all streams immediately
    let rate_limited = Arc::new(AtomicBool::new(false));
    let total_bytes = Arc::new(AtomicU64::new(0));
    let start = Instant::now();
    let deadline = Duration::from_secs_f64(TEST_DURATION_SECS);

    let reporter = spawn_progress_reporter(
        app_handle, "download", total_bytes.clone(), start, 0, 50,
    );

    let mut handles = Vec::new();
    for stream_id in 0..DOWNLOAD_STREAMS {
        let client = client.clone();
        let total_bytes = total_bytes.clone();
        let rate_limited = rate_limited.clone();
        let start = start;
        let deadline = deadline;

        handles.push(tokio::spawn(async move {
            // Stagger stream starts slightly
            if stream_id > 0 {
                tokio::time::sleep(Duration::from_millis(stream_id as u64 * 300)).await;
            }
            loop {
                if start.elapsed() >= deadline || rate_limited.load(Ordering::Relaxed) {
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
                        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                            log::warn!("Speed test download stream {}: 429 — stopping all streams", stream_id);
                            rate_limited.store(true, Ordering::Relaxed);
                            break;
                        }
                        loop {
                            if start.elapsed() >= deadline || rate_limited.load(Ordering::Relaxed) {
                                break;
                            }
                            match resp.chunk().await {
                                Ok(Some(chunk)) => {
                                    total_bytes.fetch_add(chunk.len() as u64, Ordering::Relaxed);
                                }
                                Ok(None) => break,
                                Err(_) => break,
                            }
                        }
                    }
                    Err(_) => {
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                }
            }
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    let was_rate_limited = rate_limited.load(Ordering::Relaxed);
    let elapsed = start.elapsed().as_secs_f64();
    let bytes = total_bytes.load(Ordering::Relaxed);

    let ema_avg = reporter.finish();
    let raw_mbps = if elapsed > 0.0 && bytes > 0 {
        (bytes as f64 * 8.0) / elapsed / 1_000_000.0
    } else {
        0.0
    };

    let result = if ema_avg > 0.0 { ema_avg } else { raw_mbps };

    log::info!(
        "Speed test: download done — {} bytes in {:.1}s, raw={:.1} Mbps, ema={:.1} Mbps, rate_limited={}",
        bytes, elapsed, raw_mbps, ema_avg, was_rate_limited
    );

    // Update cooldown state
    let mut state = DOWNLOAD_STATE.lock().unwrap();
    if was_rate_limited {
        state.rate_limited_at_ms = now_epoch_ms();
        // Still use whatever data we managed to collect
        if result > state.last_good_mbps * 0.5 {
            state.last_good_mbps = result;
        }
    } else if result > 0.0 {
        state.last_good_mbps = result;
        state.rate_limited_at_ms = 0; // clear cooldown on successful test
    }

    Ok(if result > 0.0 { result } else { state.last_good_mbps })
}

/// Upload using multiple parallel streams with pre-allocated payload.
async fn measure_upload_parallel(client: &reqwest::Client, app_handle: &tauri::AppHandle) -> Result<f64, String> {
    let warmup_payload: Arc<Vec<u8>> = Arc::new(vec![0x42u8; WARMUP_CHUNK_BYTES]);

    // Phase 1: Warmup — establish upload connections
    let mut warmup_handles = Vec::new();
    for _ in 0..UPLOAD_STREAMS {
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

    log::info!("Speed test: upload warmup complete, starting measurement");

    // Phase 2: Measure
    let payload: Arc<Vec<u8>> = Arc::new(vec![0x42u8; UP_CHUNK_BYTES]);
    let total_bytes = Arc::new(AtomicU64::new(0));
    let start = Instant::now();
    let deadline = Duration::from_secs_f64(TEST_DURATION_SECS);

    let reporter = spawn_progress_reporter(
        app_handle, "upload", total_bytes.clone(), start, 50, 50,
    );

    let mut handles = Vec::new();
    for _ in 0..UPLOAD_STREAMS {
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

    let ema_avg = reporter.finish();
    let raw_mbps = if elapsed > 0.0 && bytes > 0 {
        (bytes as f64 * 8.0) / elapsed / 1_000_000.0
    } else {
        0.0
    };

    log::info!("Speed test: upload done — {} bytes in {:.1}s, raw={:.1} Mbps, ema_avg={:.1} Mbps",
        bytes, elapsed, raw_mbps, ema_avg);

    Ok(if ema_avg > 0.0 { ema_avg } else { raw_mbps })
}
