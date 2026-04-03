use crate::state::AppState;
use crate::traceroute;

#[tauri::command]
pub async fn trace_route(state: tauri::State<'_, AppState>, dest_ip: String) -> Result<traceroute::TracedRoute, String> {
    // Run traceroute (async, no locks held)
    let raw_hops = traceroute::run_traceroute(&dest_ip).await?;

    // Geolocate hops (sync, brief lock)
    let geoip_guard = state.geoip.read().unwrap();
    let geoip = geoip_guard.as_ref().ok_or("GeoIP not loaded")?.clone();
    drop(geoip_guard);

    let route = {
        let enricher = state.enricher.lock().unwrap();
        traceroute::geolocate_and_build(&dest_ip, raw_hops, &geoip, &enricher)
    };

    state.db.insert_traced_route(&route);
    Ok(route)
}

#[tauri::command]
pub fn get_traced_route(state: tauri::State<AppState>, dest_ip: String) -> Option<traceroute::TracedRoute> {
    state.db.get_traced_route(&dest_ip)
}

#[tauri::command]
pub fn get_all_traced_routes(state: tauri::State<AppState>) -> std::collections::HashMap<String, traceroute::TracedRoute> {
    state.db.get_all_traced_routes()
}
