import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Input } from "@mattmattmattmatt/base/primitives/input/Input";
import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import { Toggle } from "@mattmattmattmatt/base/primitives/toggle/Toggle";
import { Badge } from "@mattmattmattmatt/base/primitives/badge/Badge";
import { Separator } from "@mattmattmattmatt/base/primitives/separator/Separator";
import { ScrollArea } from "@mattmattmattmatt/base/primitives/scroll-area/ScrollArea";
import { FileUploadZone } from "@mattmattmattmatt/base/primitives/file-upload-zone/FileUploadZone";
import { plus } from "@mattmattmattmatt/base/primitives/icon/icons/plus";
import { trash2 } from "@mattmattmattmatt/base/primitives/icon/icons/trash-2";
import { download } from "@mattmattmattmatt/base/primitives/icon/icons/download";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/input/input.css";
import "@mattmattmattmatt/base/primitives/button/button.css";
import "@mattmattmattmatt/base/primitives/toggle/toggle.css";
import "@mattmattmattmatt/base/primitives/badge/badge.css";
import "@mattmattmattmatt/base/primitives/separator/separator.css";
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
  { name: "Steven Black's Unified Hosts", url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts" },
  { name: "AdGuard DNS Filter", url: "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt" },
  { name: "EasyList", url: "https://easylist.to/easylist/easylist.txt" },
  { name: "Pi-hole Default", url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn/hosts" },
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
    <Stack direction="vertical" gap="4" align="stretch">
      <Text size="lg" weight="semibold">Blocklists</Text>
      <Text size="xs" color="tertiary">
        Import domain blocklists to identify and block ads, trackers, and malware.
      </Text>
      <Separator />

      {/* Current lists */}
      <ScrollArea maxHeight="200px">
        <Stack direction="vertical" gap="2" align="stretch">
          {lists.length === 0 && (
            <Text size="sm" color="tertiary">No blocklists imported yet.</Text>
          )}
          {lists.map((list) => (
            <Stack key={list.id} direction="horizontal" gap="2" align="center" justify="between"
              style={{ padding: "var(--sp-2)", borderRadius: "var(--radius-sm)", background: "var(--glass-bg-subtle)" }}
            >
              <Stack direction="vertical" gap="1" style={{ flex: 1, overflow: "hidden" }}>
                <Text size="sm" weight="medium" truncate={1}>{list.name}</Text>
                <Stack direction="horizontal" gap="2" align="center">
                  <Badge variant="subtle" color="neutral" size="sm">
                    {list.domain_count.toLocaleString()} domains
                  </Badge>
                  <Text size="xs" color="tertiary">{list.source_url}</Text>
                </Stack>
              </Stack>
              <Toggle checked={list.enabled} onChange={() => toggleList(list.id, !list.enabled)} size="sm" />
              <Button variant="ghost" size="sm" icon={trash2} iconOnly aria-label="Remove" onClick={() => removeList(list.id)} />
            </Stack>
          ))}
        </Stack>
      </ScrollArea>

      <Separator />

      {/* Add by URL */}
      <Text size="sm" weight="medium">Add from URL</Text>
      <Stack direction="horizontal" gap="2" align="center">
        <Input
          placeholder="https://raw.githubusercontent.com/..."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          size="sm"
          style={{ flex: 1 }}
          onKeyDown={(e) => e.key === "Enter" && addFromUrl()}
        />
        <Button variant="secondary" size="sm" icon={plus} iconOnly aria-label="Add" onClick={addFromUrl} disabled={loading} />
      </Stack>

      {error && <Text size="xs" color="error">{error}</Text>}

      {/* Import file */}
      <Text size="sm" weight="medium">Import file</Text>
      <FileUploadZone
        onFiles={handleFileUpload}
        accept=".txt,.hosts,.conf"
        multiple={false}
      />

      <Separator />

      {/* Popular presets — hide already-installed ones */}
      {POPULAR_LISTS.filter((preset) => !lists.some((l) => l.source_url === preset.url)).length > 0 && (
        <>
          <Text size="sm" weight="medium">Popular Lists</Text>
          <Stack direction="vertical" gap="2" align="stretch">
            {POPULAR_LISTS.filter((preset) => !lists.some((l) => l.source_url === preset.url)).map((preset) => (
              <Stack key={preset.url} direction="horizontal" gap="2" align="center" justify="between">
                <Text size="sm" truncate={1} style={{ flex: 1 }}>{preset.name}</Text>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={download}
                  iconOnly
                  aria-label={`Add ${preset.name}`}
                  onClick={() => addPreset(preset.name, preset.url)}
                  disabled={loading}
                />
              </Stack>
            ))}
          </Stack>
        </>
      )}
    </Stack>
  );
}
