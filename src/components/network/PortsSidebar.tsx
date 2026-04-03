import { useState, useMemo } from "react";
import { StatCard } from "../../ui/components/StatCard";
import { SearchBar } from "../../ui/components/SearchBar";
import { PortRow } from "../../ui/components/PortRow";
import { Pagination } from "../../ui/components/Pagination";
import { FrostedCard } from "../../ui/glass";
import type { PortEntry } from "../../hooks/useListeningPorts";
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
      setTimeout(() => setConfirmPid((current) => (current === pid ? null : current)), 3000);
    }
  };

  return (
    <>
      <StatCard
        stats={[
          { label: "LISTENING", value: listeningCount, minDigits: 3 },
          { label: "TOTAL", value: ports.length, minDigits: 3 },
          { label: "PROCESSES", value: uniqueProcesses, minDigits: 3 },
        ]}
      />

      <SearchBar
        placeholder="Search ports or processes..."
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        onClear={() => { setSearch(""); setPage(1); }}
      />

      <FrostedCard className="blip-scroll-list">
        {visible.length === 0 ? (
          <div className="ports-sidebar__empty">
            <span style={{ color: "var(--blip-text-tertiary)", fontSize: 12 }}>
              {ports.length === 0 ? "No open ports detected." : "No ports match your search."}
            </span>
          </div>
        ) : (
          visible.map((entry, i) => (
            <PortRow
              key={`${entry.port}-${entry.pid}-${entry.state}-${i}`}
              port={entry.port}
              processName={entry.process_name}
              pid={entry.pid}
              protocol={entry.protocol}
              state={entry.state}
              connections={entry.connections}
              onKill={() => handleKill(entry.pid)}
              confirmKill={confirmPid === entry.pid}
            />
          ))
        )}
      </FrostedCard>

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
