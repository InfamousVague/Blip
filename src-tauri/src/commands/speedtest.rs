use crate::speedtest;
use crate::state::AppState;

#[tauri::command]
pub async fn run_speed_test(app_handle: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<speedtest::SpeedTestResult, String> {
    // Prevent concurrent speed tests — two tests would both emit progress events
    // to the same channel, causing the UI to jump between their values.
    if state.speed_test_running.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Err("Speed test already running".into());
    }
    let result = speedtest::run_speed_test(app_handle).await;
    state.speed_test_running.store(false, std::sync::atomic::Ordering::SeqCst);
    let result = result?;
    let mut cached = state.speed_test_result.lock().unwrap();
    *cached = Some(result.clone());
    Ok(result)
}

#[tauri::command]
pub fn get_last_speed_test(state: tauri::State<AppState>) -> Option<speedtest::SpeedTestResult> {
    state.speed_test_result.lock().unwrap().clone()
}
