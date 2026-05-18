# Blip Windows Support — Implementation Plan

## Context

Blip is deeply macOS-specific: Network Extension (Swift system extension for firewall/DNS), `nettop`/`lsof`/`netstat` for capture, AppKit for dock icon, Unix domain sockets for IPC, and Apple codesign/notarization for distribution. The frontend (React/TypeScript/MapLibre/deck.gl) is 100% cross-platform — no changes needed. The backend (Rust) needs platform abstractions.

## Architecture: Platform Abstraction Layer

```
Frontend (React)              ← no changes
    │
Tauri Commands                ← thin wrappers calling platform layer
    │
Platform Trait Layer          ← NEW: defines cross-platform interfaces
    ├── platform/macos/       ← existing code moved here
    └── platform/windows/     ← new implementations
```

All platform-specific code isolated behind traits. Compile-time `#[cfg]` selects implementation.

---

## Phase 1: Core Network Monitoring (MVP) — 3-4 weeks

### 1.1 Create platform abstraction module

**New files:**

| File | Content |
|------|---------|
| `src-tauri/src/platform/mod.rs` | Traits: `NetworkCapture`, `TracerouteRunner`, `ElevationManager`, `AppIconResolver`. Shared types: `RawConnection`, `FlowBytes`, `ListeningPort`. `#[cfg]` re-exports. |
| `src-tauri/src/platform/macos/mod.rs` | Re-exports macOS implementations |
| `src-tauri/src/platform/macos/capture.rs` | Move from `nettop.rs`: `snapshot_netstat()`, `parse_netstat_addr()`, `snapshot_lsof_processes()`, `snapshot_nettop_flows()` |
| `src-tauri/src/platform/macos/traceroute.rs` | Move from `traceroute.rs`: `run_traceroute()`, `parse_traceroute_output()` |
| `src-tauri/src/platform/macos/elevation.rs` | Move from `commands/capture.rs`: sudo/osascript logic |
| `src-tauri/src/platform/macos/bandwidth.rs` | Move from `commands/system.rs`: `parse_netstat_bandwidth()`, `netstat -ib` |
| `src-tauri/src/platform/macos/ports.rs` | Move from `commands/system.rs`: `lsof -i -P -n -sTCP:LISTEN` |
| `src-tauri/src/platform/macos/icons.rs` | Move from `commands/system.rs`: `mdfind` + `plutil` + icon extraction |
| `src-tauri/src/platform/windows/mod.rs` | Re-exports Windows implementations |
| `src-tauri/src/platform/windows/capture.rs` | `GetExtendedTcpTable` + `GetExtendedUdpTable` + `sysinfo` for process names |
| `src-tauri/src/platform/windows/traceroute.rs` | `tracert.exe -d -h 30 -w 2000` parser |
| `src-tauri/src/platform/windows/elevation.rs` | UAC stub (most ops don't need admin on Windows) |
| `src-tauri/src/platform/windows/bandwidth.rs` | `GetIfTable2` or `sysinfo::Networks` |
| `src-tauri/src/platform/windows/ports.rs` | `GetExtendedTcpTable` filtered for LISTEN state |
| `src-tauri/src/platform/windows/icons.rs` | `SHGetFileInfo` or registry-based exe icon extraction |

### 1.2 Gate macOS-only modules

**Files to modify:**

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | `#[cfg(target_os = "macos")]` on: `mod ne_bridge`, `mod dns_capture`, `NEStatusState`, NE commands in invoke_handler |
| `src-tauri/src/state.rs` | `#[cfg(target_os = "macos")]` on: `dns_capture`, `ne_broadcast` fields |
| `src-tauri/src/commands/capture.rs` | Gate NE bridge startup in `start_capture()` |
| `src-tauri/src/commands/system.rs` | Gate NE dylib loading, `activate/deactivate_network_extension`, `mdfind`/`plutil` icon logic |
| `src-tauri/src/commands/firewall.rs` | Gate `sync_firewall_rules_to_ne()` NE broadcast path |

### 1.3 Cargo.toml changes

```toml
# Move to macOS-only:
[target.'cfg(target_os = "macos")'.dependencies]
cocoa = "0.26"     # already here
objc = "0.2"       # already here
pcap = "2"         # MOVE from unconditional
libloading = "0.8" # MOVE from unconditional

# Add Windows deps:
[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = [
    "Win32_NetworkManagement_IpHelper",
    "Win32_Networking_WinSock",
] }
```

### 1.4 Tauri config for Windows

- `transparent: true` → macOS only (causes issues on Windows)
- `titleBarStyle: "Overlay"` → macOS only
- `trafficLightPosition` → macOS only
- Add NSIS bundle config for Windows installer
- `beforeBuildCommand` → skip NE build on Windows

### 1.5 Windows capture: the core

`GetExtendedTcpTable` returns connections + PIDs in a single API call (replaces both `netstat` + `lsof`). Combined with `sysinfo` crate for process name resolution. Sub-millisecond, no elevation needed.

For byte tracking (replacing `nettop`): start with `GetPerTcpConnectionEStats` polling. Phase 4 upgrades to ETW.

### 1.6 CI: Add Windows build job

Split `.github/workflows/release.yml` into parallel macOS + Windows jobs. Windows: checkout → Node + Rust → `npm ci` → `npx tauri build --bundles nsis` → upload `.exe`.

---

## Phase 2: DNS Monitoring — 2-3 weeks

| New File | Content |
|----------|---------|
| `src-tauri/src/platform/windows/dns_etw.rs` | ETW consumer for `Microsoft-Windows-DNS-Client` provider |

ETW DNS tracing is passive (no interception), requires no admin, produces same `DnsEvent` structs as macOS pcap helper. Feeds into existing `SharedDnsMapping` → blocklist → DB → frontend unchanged.

For DNS **blocking**: local DNS proxy on `127.0.0.1:53`, returns NXDOMAIN for blocked domains.

---

## Phase 3: Firewall — 3-4 weeks

| New File | Content |
|----------|---------|
| `src-tauri/src/platform/windows/firewall.rs` | Windows Firewall API via `netsh advfirewall` or COM `INetFwPolicy2` |

Windows Firewall supports per-executable rules natively (exe path, not bundle ID). Existing `FirewallRule` DB stores strings — works for both.

Key limitation: no per-connection approval flow. Rules are pre-configured, not prompted in real-time.

---

## Phase 4: Advanced — 4-6 weeks

- ETW `Microsoft-Windows-TCPIP` for real-time byte tracking
- Windows service for background monitoring (named pipe IPC)
- WFP for kernel-level filtering (requires WHQL-signed driver)

---

## macOS-Specific Code Inventory

### Completely macOS-only (must be gated or replaced):

| Module | Lines | macOS Technology | Windows Alternative |
|--------|-------|-----------------|---------------------|
| `ne_bridge/` | ~785 | Unix socket + NE IPC | N/A (Phase 1: skip, Phase 3: Windows Firewall API) |
| `dns_capture/` | ~763 | pcap + sudo helper | ETW DNS tracing |
| `dock_icon.rs` | ~50 | AppKit NSImage | Already has no-op stub |
| NE Swift code | ~2000 | System Extension | N/A on Windows |
| Build scripts | ~400 | Xcode, codesign, notarytool | MSVC, signtool |

### Platform-specific functions in shared files:

| File | Function | macOS | Windows |
|------|----------|-------|---------|
| `capture/nettop.rs` | `snapshot_netstat()` | `netstat -an` | `GetExtendedTcpTable` |
| `capture/nettop.rs` | `snapshot_lsof_processes()` | `lsof -i` | PID from `GetExtendedTcpTable` + `sysinfo` |
| `capture/nettop.rs` | `snapshot_nettop_flows()` | `nettop -n -L 1` | `GetPerTcpConnectionEStats` |
| `traceroute.rs` | `run_traceroute()` | `/usr/sbin/traceroute` | `tracert.exe` |
| `traceroute.rs` | `parse_traceroute_output()` | macOS format | Windows format (3 RTT columns) |
| `commands/system.rs` | `get_app_icons()` | `mdfind` + `plutil` | `SHGetFileInfo` |
| `commands/system.rs` | `get_listening_ports()` | `lsof -sTCP:LISTEN` | `GetExtendedTcpTable` LISTEN filter |
| `commands/system.rs` | bandwidth parsing | `netstat -ib` | `GetIfTable2` |
| `commands/capture.rs` | elevation | `sudo -v` + `osascript` | UAC (app manifest) |

### Already cross-platform (no changes):

- Frontend (React/TypeScript) — all of `src/`
- SQLite database — `db/` module
- GeoIP — `geoip/mod.rs` (MaxMind .mmdb)
- Enrichment — `enrichment.rs` (pure Rust)
- Blocklist engine — `blocklist/` (pure Rust)
- Speed test — `speedtest.rs` (pure Rust/reqwest)
- PMTiles server — embedded HTTP server
- All Tauri plugins (notification, updater, geolocation, process)

---

## Implementation Sequence

1. Create `platform/` traits. Move macOS code. **Verify macOS still works.**
2. `#[cfg]` gate `ne_bridge/`, `dns_capture/`, NE commands. **Verify macOS compiles.**
3. Stub Windows implementations. Cross-compile: `cargo check --target x86_64-pc-windows-msvc`.
4. Implement `windows/capture.rs` — connections + process names.
5. Implement `windows/traceroute.rs` — tracert parser.
6. Implement remaining Windows platform modules.
7. Adjust `tauri.conf.json` for Windows.
8. Set up Windows CI.
9. End-to-end test on Windows.

---

## Effort Estimates

| Phase | Feature | Effort | Risk |
|-------|---------|--------|------|
| 1 | Connection listing + process names | 1-2 weeks | Low |
| 1 | Traceroute, bandwidth, ports, icons | 1 week | Low |
| 1 | Platform trait refactor + cfg gating | 1 week | Medium |
| 1 | Tauri config + CI + installer | 3-5 days | Low |
| 2 | ETW DNS monitoring | 2-3 weeks | Medium |
| 3 | Windows Firewall integration | 3-4 weeks | Medium |
| 4 | ETW byte tracking + WFP | 4-6 weeks | High |

**MVP (connections on map)**: ~3-4 weeks
**Full feature parity**: ~12-16 weeks
