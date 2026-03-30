import { useState, useMemo } from "react";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Input } from "@mattmattmattmatt/base/primitives/input/Input";
import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import { Pagination } from "@mattmattmattmatt/base/primitives/pagination/Pagination";
import { Badge } from "@mattmattmattmatt/base/primitives/badge/Badge";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { search as searchIcon } from "@mattmattmattmatt/base/primitives/icon/icons/search";
import { x as xIcon } from "@mattmattmattmatt/base/primitives/icon/icons/x";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/input/input.css";
import "@mattmattmattmatt/base/primitives/button/button.css";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
import "@mattmattmattmatt/base/primitives/pagination/pagination.css";
import "@mattmattmattmatt/base/primitives/badge/badge.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import type { PortEntry } from "../hooks/useListeningPorts";
import "./PortsSidebar.css";

interface Props {
  ports: PortEntry[];
  onKill: (pid: number) => void;
}

const PAGE_SIZE = 30;

export function PortsSidebar({ ports, onKill }: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [confirmPid, setConfirmPid] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (!search) return ports;
    const q = search.toLowerCase();
    return ports.filter(
      (p) =>
        String(p.port).includes(q) ||
        p.process_name.toLowerCase().includes(q) ||
        p.protocol.toLowerCase().includes(q)
    );
  }, [ports, search]);

  const listeningCount = useMemo(() => ports.filter((p) => p.state === "LISTEN").length, [ports]);
  const uniqueProcesses = useMemo(() => new Set(ports.map((p) => p.process_name)).size, [ports]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const handleKill = (pid: number) => {
    if (confirmPid === pid) {
      onKill(pid);
      setConfirmPid(null);
    } else {
      setConfirmPid(pid);
      // Auto-clear confirmation after 3s
      setTimeout(() => setConfirmPid((current) => (current === pid ? null : current)), 3000);
    }
  };

  return (
    <>
      {/* Stats header */}
      <Stack direction="horizontal" gap="4" align="center" style={{ flexShrink: 0 }}>
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">LISTENING</Text>
          <NumberRoll value={listeningCount} minDigits={2} fontSize="var(--text-lg-size)" commas />
        </Stack>
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">TOTAL</Text>
          <NumberRoll value={ports.length} minDigits={2} fontSize="var(--text-lg-size)" commas />
        </Stack>
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">PROCESSES</Text>
          <NumberRoll value={uniqueProcesses} minDigits={2} fontSize="var(--text-lg-size)" commas />
        </Stack>
      </Stack>

      {/* Search */}
      <div className="ports-sidebar__search">
        <Input
          placeholder="Search ports or processes..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          onClear={() => { setSearch(""); setPage(1); }}
          size="md"
          iconLeft={searchIcon}
          variant="filled"
        />
      </div>

      {/* List */}
      <div className="ports-sidebar__list">
        {visible.length === 0 ? (
          <div className="ports-sidebar__empty">
            <Text size="xs" color="tertiary">
              {ports.length === 0 ? "No open ports detected." : "No ports match your search."}
            </Text>
          </div>
        ) : (
          visible.map((entry, i) => (
            <div key={`${entry.port}-${entry.pid}-${entry.state}-${i}`} className="ports-row">
              <div className="ports-row__main">
                <div className="ports-row__port">
                  <Text size="sm" weight="semibold" font="mono">
                    {entry.port}
                  </Text>
                </div>
                <div className="ports-row__info">
                  <Stack direction="horizontal" gap="1" align="center">
                    <Text size="sm" weight="medium" truncate={1}>
                      {entry.process_name}
                    </Text>
                    <Text size="xs" color="tertiary" font="mono">
                      ({entry.pid})
                    </Text>
                  </Stack>
                  {entry.command && entry.command !== entry.process_name && (
                    <Text size="xs" color="tertiary" truncate={1} font="mono">
                      {entry.command.length > 60 ? "..." + entry.command.slice(-57) : entry.command}
                    </Text>
                  )}
                  <Stack direction="horizontal" gap="2" align="center">
                    <Badge
                      variant="subtle"
                      color={entry.protocol === "TCP" ? "accent" : "info"}
                      size="sm"
                    >
                      {entry.protocol}
                    </Badge>
                    <span className={`ports-row__dot ports-row__dot--${entry.state === "LISTEN" ? "listen" : entry.state === "ESTABLISHED" ? "established" : "other"}`} />
                    <Text size="xs" color="tertiary">{entry.state}</Text>
                    {entry.state === "LISTEN" && entry.connections > 0 && (
                      <Text size="xs" color="tertiary" font="mono">
                        {entry.connections} conn{entry.connections !== 1 ? "s" : ""}
                      </Text>
                    )}
                  </Stack>
                </div>
                <div className="ports-row__actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={xIcon}
                    iconOnly
                    aria-label={confirmPid === entry.pid ? "Confirm kill" : "Kill process"}
                    onClick={() => handleKill(entry.pid)}
                    style={confirmPid === entry.pid ? { color: "var(--color-error)" } : undefined}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Pagination
        page={safePage}
        totalPages={totalPages}
        totalItems={filtered.length}
        onPageChange={setPage}
        size="sm"
      />
    </>
  );
}
