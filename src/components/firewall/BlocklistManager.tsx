import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "@mattmattmattmatt/base/primitives/input/Input";
import { Button } from "../../ui/components/Button";
import { Toggle } from "../../ui/components/Toggle";
import { Badge } from "../../ui/components/Badge";
import { Separator } from "../../ui/components/Separator";
import { ScrollArea } from "@mattmattmattmatt/base/primitives/scroll-area/ScrollArea";
import { FileUploadZone } from "@mattmattmattmatt/base/primitives/file-upload-zone/FileUploadZone";
import { plus } from "@mattmattmattmatt/base/primitives/icon/icons/plus";
import { trash2 } from "@mattmattmattmatt/base/primitives/icon/icons/trash-2";
import { download } from "@mattmattmattmatt/base/primitives/icon/icons/download";
import "@mattmattmattmatt/base/primitives/input/input.css";
import "@mattmattmattmatt/base/primitives/scroll-area/scroll-area.css";
import "@mattmattmattmatt/base/primitives/file-upload-zone/file-upload-zone.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";

interface BlocklistInfo {
  id: string;
  name: string;
  domain_count: number;
  enabled: boolean;
  source_url: string;
}

const POPULAR_LISTS = [
  // Comprehensive — curated, well-maintained, good defaults
  { name: "OISD Big", url: "https://big.oisd.nl/domainswild2", desc: "Comprehensive ads + trackers + malware (~200k domains)" },
  { name: "Hagezi Multi Pro", url: "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/pro-onlydomains.txt", desc: "Aggressive tracking + ads + crypto mining (~300k domains)" },
  { name: "Steven Black Unified", url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts", desc: "Classic hosts file — ads + malware (~170k domains)" },

  // Privacy-focused
  { name: "Hagezi Threat Intelligence", url: "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/tif-onlydomains.txt", desc: "Malware, phishing, cryptojacking, scam domains" },
  { name: "AdGuard DNS Filter", url: "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt", desc: "AdGuard's curated DNS-level ad blocking" },
  { name: "1Hosts Lite", url: "https://o0.pages.dev/Lite/domains.txt", desc: "Lightweight privacy list — minimal false positives" },

  // Telemetry & fingerprinting
  { name: "Hagezi Anti-Piracy", url: "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/anti.piracy-onlydomains.txt", desc: "Blocks piracy tracking and reporting domains" },
  { name: "NoTracking", url: "https://raw.githubusercontent.com/notracking/hosts-blocklists/master/dnscrypt-proxy/dnscrypt-proxy.blacklist.txt", desc: "Trackers and analytics domains" },
];

export function BlocklistManager() {
  const [lists, setLists] = useState<BlocklistInfo[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<BlocklistInfo[]>("get_blocklists");
      setLists(result);
    } catch {
      // Backend not ready yet
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addFromUrl = async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("add_blocklist_url", { url: urlInput.trim(), name: urlInput.trim().split("/").pop() || "Custom List" });
      setUrlInput("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  const addPreset = async (name: string, url: string) => {
    setLoading(true);
    setError(null);
    try {
      await invoke("add_blocklist_url", { url, name });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  const handleFileUpload = async (files: File[]) => {
    for (const file of files) {
      setLoading(true);
      try {
        const content = await file.text();
        await invoke("add_blocklist_content", { content, name: file.name });
        await refresh();
      } catch (e) {
        setError(String(e));
      }
      setLoading(false);
    }
  };

  const toggleList = async (id: string, enabled: boolean) => {
    try {
      await invoke("toggle_blocklist", { id, enabled });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const removeList = async (id: string) => {
    try {
      await invoke("remove_blocklist", { id });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "stretch" }}>
      <span className="blip-text-heading">Blocklists</span>
      <span className="blip-text-row-desc">
        Import domain blocklists to identify and block ads, trackers, and malware.
      </span>
      <Separator />

      {/* Current lists */}
      <ScrollArea maxHeight="200px">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }}>
          {lists.length === 0 && (
            <span className="blip-text-empty">No blocklists imported yet.</span>
          )}
          {lists.map((list) => (
            <div key={list.id} style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "space-between", padding: "var(--sp-2)", borderRadius: "var(--radius-sm)", background: "rgba(255, 255, 255, 0.04)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, overflow: "hidden" }}>
                <span className="blip-text-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{list.name}</span>
                <div style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Badge variant="subtle" color="neutral" size="sm">
                    {list.domain_count.toLocaleString()} domains
                  </Badge>
                  <span className="blip-text-row-desc">{list.source_url}</span>
                </div>
              </div>
              <Toggle checked={list.enabled} onChange={() => toggleList(list.id, !list.enabled)} size="sm" />
              <Button variant="ghost" size="sm" icon={trash2} iconOnly aria-label="Remove" onClick={() => removeList(list.id)} />
            </div>
          ))}
        </div>
      </ScrollArea>

      <Separator />

      {/* Add by URL */}
      <span className="blip-text-row-title">Add from URL</span>
      <div style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Input
          placeholder="https://raw.githubusercontent.com/..."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          size="sm"
          style={{ flex: 1 }}
          onKeyDown={(e) => e.key === "Enter" && addFromUrl()}
        />
        <Button variant="secondary" size="sm" icon={plus} iconOnly aria-label="Add" onClick={addFromUrl} disabled={loading} />
      </div>

      {error && <span className="blip-text-row-desc" style={{ color: "var(--blip-text-secondary)" }}>{error}</span>}

      {/* Import file */}
      <span className="blip-text-row-title">Import file</span>
      <FileUploadZone
        onFiles={handleFileUpload}
        accept=".txt,.hosts,.conf"
        multiple={false}
      />

      <Separator />

      {/* Popular presets — hide already-installed ones */}
      {POPULAR_LISTS.filter((preset) => !lists.some((l) => l.source_url === preset.url)).length > 0 && (
        <>
          <span className="blip-text-row-title">Popular Lists</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }}>
            {POPULAR_LISTS.filter((preset) => !lists.some((l) => l.source_url === preset.url)).map((preset) => (
              <div key={preset.url} style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="blip-text-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", fontWeight: 500 }}>{preset.name}</span>
                  {"desc" in preset && <span className="blip-text-row-desc" style={{ fontSize: 10, opacity: 0.6 }}>{(preset as any).desc}</span>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={download}
                  iconOnly
                  aria-label={`Add ${preset.name}`}
                  onClick={() => addPreset(preset.name, preset.url)}
                  disabled={loading}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
