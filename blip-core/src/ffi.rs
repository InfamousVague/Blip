//! C-compatible FFI functions for the Swift app to call.
//!
//! All functions use C strings (null-terminated) for input/output.
//! The caller (Swift) is responsible for freeing returned strings via `blip_free_string`.

use crate::BlipCore;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::OnceLock;

/// Global singleton — initialized by `blip_init`.
static CORE: OnceLock<BlipCore> = OnceLock::new();

fn core() -> &'static BlipCore {
    CORE.get().expect("blip_init must be called first")
}

// ---- Lifecycle ----

/// Initialize the Blip core. Call once at app launch.
/// `resource_dir` is the path to bundled resources (GeoIP, ASN databases).
/// Returns 0 on success, -1 on error.
#[no_mangle]
pub extern "C" fn blip_init(resource_dir: *const c_char) -> i32 {
    let _ = env_logger::try_init();

    let dir = unsafe {
        if resource_dir.is_null() { return -1; }
        match CStr::from_ptr(resource_dir).to_str() {
            Ok(s) => s.to_string(),
            Err(_) => return -1,
        }
    };

    match BlipCore::new(&dir) {
        Ok(c) => {
            let _ = CORE.set(c);
            log::info!("Blip core initialized with resources at {}", dir);
            0
        }
        Err(e) => {
            log::error!("Blip init failed: {}", e);
            -1
        }
    }
}

/// Start network capture (netstat polling fallback).
/// `geoip_path` is the full path to GeoLite2-City.mmdb.
#[no_mangle]
pub extern "C" fn blip_start_capture(geoip_path: *const c_char) {
    let path = unsafe {
        if geoip_path.is_null() { return; }
        match CStr::from_ptr(geoip_path).to_str() {
            Ok(s) => s,
            Err(_) => return,
        }
    };
    core().start_capture(path);
}

/// Stop network capture.
#[no_mangle]
pub extern "C" fn blip_stop_capture() {
    core().stop_capture();
}

// ---- Data queries (return JSON strings) ----

/// Get current connections as JSON. Caller must free with `blip_free_string`.
#[no_mangle]
pub extern "C" fn blip_get_connections() -> *mut c_char {
    to_c_string(&core().get_connections_json())
}

/// Get DNS log as JSON array. Caller must free with `blip_free_string`.
#[no_mangle]
pub extern "C" fn blip_get_dns_log() -> *mut c_char {
    to_c_string(&core().get_dns_log_json())
}

/// Get DNS stats as JSON. Caller must free with `blip_free_string`.
#[no_mangle]
pub extern "C" fn blip_get_dns_stats() -> *mut c_char {
    to_c_string(&core().get_dns_stats_json())
}

/// Get blocklists as JSON array. Caller must free with `blip_free_string`.
#[no_mangle]
pub extern "C" fn blip_get_blocklists() -> *mut c_char {
    to_c_string(&core().get_blocklists_json())
}

/// Get tracker stats as JSON. Caller must free with `blip_free_string`.
#[no_mangle]
pub extern "C" fn blip_get_tracker_stats() -> *mut c_char {
    to_c_string(&core().get_tracker_stats_json())
}

/// Get bandwidth counters as JSON. Caller must free with `blip_free_string`.
#[no_mangle]
pub extern "C" fn blip_get_bandwidth() -> *mut c_char {
    to_c_string(&core().get_bandwidth_json())
}

// ---- Blocklist management ----

/// Add a blocklist from URL. Returns info JSON. Caller must free.
#[no_mangle]
pub extern "C" fn blip_add_blocklist_url(url: *const c_char, name: *const c_char) -> *mut c_char {
    let (url_str, name_str) = unsafe {
        if url.is_null() || name.is_null() {
            return to_c_string("{\"error\":\"null argument\"}");
        }
        let u = CStr::from_ptr(url).to_str().unwrap_or("");
        let n = CStr::from_ptr(name).to_str().unwrap_or("");
        (u, n)
    };
    to_c_string(&core().add_blocklist_url(url_str, name_str))
}

// ---- NE event ingestion ----

/// Process a batch of NE connection events (JSON array).
/// Called by Swift when the NE writes events to the shared App Group file.
#[no_mangle]
pub extern "C" fn blip_ingest_ne_events(json: *const c_char) {
    let json_str = unsafe {
        if json.is_null() { return; }
        match CStr::from_ptr(json).to_str() {
            Ok(s) => s,
            Err(_) => return,
        }
    };

    // Parse and process NE events
    if let Ok(events) = serde_json::from_str::<Vec<ne_bridge::types::NEConnectionEvent>>(json_str) {
        let core = core();
        for event in events {
            ne_bridge::process_ne_event(&event, &core.store, &core.blocklists, &core.db_writer, &core.enricher);
        }
    }
}

// ---- Memory management ----

/// Free a string returned by any `blip_*` function.
#[no_mangle]
pub extern "C" fn blip_free_string(s: *mut c_char) {
    if !s.is_null() {
        unsafe { drop(CString::from_raw(s)); }
    }
}

// ---- Helpers ----

fn to_c_string(s: &str) -> *mut c_char {
    CString::new(s).unwrap_or_default().into_raw()
}

use crate::ne_bridge;
