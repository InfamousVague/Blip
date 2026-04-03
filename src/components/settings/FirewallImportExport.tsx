import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { Button } from "../../ui/components/Button";

interface Props {
  importCount: number | null;
  onImportCountChange: (count: number | null) => void;
}

export function FirewallImportExport({ importCount, onImportCountChange }: Props) {
  const handleExport = useCallback(async () => {
    try {
      const json = await invoke<string>("export_firewall_config");
      const path = await save({
        defaultPath: "blip-firewall-config.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path) await writeTextFile(path, json);
    } catch (e) {
      console.error("Export failed:", e);
    }
  }, []);

  const handleImport = useCallback(async () => {
    try {
      const path = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
      });
      if (!path) return;
      const content = await readTextFile(path as string);
      const count = await invoke<number>("import_firewall_config", { json: content });
      onImportCountChange(count);
      setTimeout(() => onImportCountChange(null), 3000);
    } catch (e) {
      console.error("Import failed:", e);
    }
  }, [onImportCountChange]);

  return (
    <>
      <span className="settings-group-title">Import / Export</span>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <Button variant="secondary" size="sm" onClick={handleExport}>Export Config</Button>
        <Button variant="secondary" size="sm" onClick={handleImport}>Import Config</Button>
        {importCount !== null && (
          <span className="blip-text-row-desc" style={{ alignSelf: "center", color: "var(--blip-success)" }}>
            Imported {importCount} rules
          </span>
        )}
      </div>
    </>
  );
}
