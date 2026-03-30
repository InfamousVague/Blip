// C header for Rust FFI functions exported by libblip_core.a

#ifndef RustBridge_h
#define RustBridge_h

#include <stdint.h>

// Lifecycle
int32_t blip_init(const char *resource_dir);
void blip_start_capture(const char *geoip_path);
void blip_stop_capture(void);

// Data queries — all return JSON strings. Caller must free with blip_free_string.
char *blip_get_connections(void);
char *blip_get_dns_log(void);
char *blip_get_dns_stats(void);
char *blip_get_blocklists(void);
char *blip_get_tracker_stats(void);
char *blip_get_bandwidth(void);

// Blocklist management
char *blip_add_blocklist_url(const char *url, const char *name);

// Database queries
char *blip_get_historical_endpoints(void);
char *blip_get_historical_stats(void);
char *blip_get_preference(const char *key);
char *blip_set_preference(const char *key, const char *value);

// Port / process management
char *blip_get_listening_ports(void);
char *blip_kill_process(uint32_t pid);

// NE event ingestion
void blip_ingest_ne_events(const char *json);

// Memory management
void blip_free_string(char *s);

#endif
