import { useMemo, useState, useCallback, useRef } from "react";
import { Treemap, ResponsiveContainer } from "recharts";
import { Modal } from "../ui/components/Modal";
import { classifyEndpoint } from "../utils/endpoint-type";
import { getServiceColor } from "../utils/service-colors";
import type { ResolvedConnection } from "../types/connection";
import "./NetworkTreemapModal.css";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

// --- Data types ---

interface TreeNode {
  name: string;
  size: number;
  fill: string;
  sent: number;
  received: number;
  count: number;
  meta?: string; // extra info (domain, IP, country, etc.)
  children?: TreeNode[];
}

interface DrillLevel {
  label: string;
  data: TreeNode[];
  parentColor?: string;
}

// --- Build tree from connections ---

function buildServiceTree(connections: ResolvedConnection[]): TreeNode[] {
  const serviceMap = new Map<string, {
    sent: number; received: number; count: number;
    connections: ResolvedConnection[];
  }>();

  for (const c of connections) {
    const { serviceName } = classifyEndpoint(c.domain, c.process_name, c.dest_ip);
    const name = serviceName || "Other";
    const entry = serviceMap.get(name) || { sent: 0, received: 0, count: 0, connections: [] };
    entry.sent += c.bytes_sent;
    entry.received += c.bytes_received;
    entry.count += 1;
    entry.connections.push(c);
    serviceMap.set(name, entry);
  }

  return [...serviceMap.entries()]
    .map(([name, data]) => ({
      name,
      size: data.sent + data.received,
      fill: getServiceColor(name),
      sent: data.sent,
      received: data.received,
      count: data.count,
      children: buildDomainTree(data.connections, getServiceColor(name)),
    }))
    .filter((n) => n.size > 0)
    .sort((a, b) => b.size - a.size);
}

function buildDomainTree(connections: ResolvedConnection[], parentColor: string): TreeNode[] {
  const domainMap = new Map<string, {
    sent: number; received: number; count: number;
    connections: ResolvedConnection[];
  }>();

  for (const c of connections) {
    const domain = c.domain || c.dest_ip;
    const entry = domainMap.get(domain) || { sent: 0, received: 0, count: 0, connections: [] };
    entry.sent += c.bytes_sent;
    entry.received += c.bytes_received;
    entry.count += 1;
    entry.connections.push(c);
    domainMap.set(domain, entry);
  }

  return [...domainMap.entries()]
    .map(([domain, data]) => ({
      name: domain,
      size: data.sent + data.received,
      fill: parentColor,
      sent: data.sent,
      received: data.received,
      count: data.count,
      meta: data.connections[0]?.country || undefined,
      children: buildConnectionTree(data.connections, parentColor),
    }))
    .filter((n) => n.size > 0)
    .sort((a, b) => b.size - a.size);
}

function buildConnectionTree(connections: ResolvedConnection[], parentColor: string): TreeNode[] {
  return connections
    .filter((c) => c.bytes_sent + c.bytes_received > 0)
    .map((c) => ({
      name: `${c.dest_ip}:${c.dest_port}`,
      size: c.bytes_sent + c.bytes_received,
      fill: parentColor,
      sent: c.bytes_sent,
      received: c.bytes_received,
      count: 1,
      meta: [c.protocol, c.country, c.asn_org].filter(Boolean).join(" · "),
    }))
    .sort((a, b) => b.size - a.size);
}

// --- Tile renderer ---

interface TileProps {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  size: number;
  fill: string;
  sent: number;
  received: number;
  count: number;
  totalBytes: number;
  depth: number;
  index: number;
  onTileClick: (name: string) => void;
  onHover: (e: React.MouseEvent, node: TreeNode | null) => void;
}

function DetailedTile({
  x, y, width, height, name, size, fill, sent, received, totalBytes,
  count, onTileClick, onHover,
}: TileProps) {
  const w = Math.max(width - 2, 0);
  const h = Math.max(height - 2, 0);
  const pct = totalBytes > 0 ? ((size / totalBytes) * 100) : 0;
  const showLabel = w > 40 && h > 24;
  const showDetail = w > 80 && h > 44;
  const showPct = w > 60 && h > 56;
  const sentPct = size > 0 ? (sent / size) * 100 : 50;

  return (
    <g
      style={{ cursor: "pointer" }}
      onClick={() => onTileClick(name)}
      onMouseMove={(e) => onHover(e, { name, size, fill, sent, received, count })}
      onMouseLeave={(e) => onHover(e, null)}
    >
      {/* Background */}
      <rect x={x + 1} y={y + 1} width={w} height={h} fill={fill} opacity={0.2} rx={6} />
      {/* Glass gradient */}
      <defs>
        <linearGradient id={`tmm-g-${name}-${x}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity={0.1} />
          <stop offset="50%" stopColor="white" stopOpacity={0.01} />
          <stop offset="100%" stopColor={fill} stopOpacity={0.12} />
        </linearGradient>
      </defs>
      <rect x={x + 1} y={y + 1} width={w} height={h} fill={`url(#tmm-g-${name}-${x})`} rx={6} />
      {/* Border */}
      <rect x={x + 1} y={y + 1} width={w} height={h} fill="none" stroke={fill} strokeOpacity={0.3} strokeWidth={1} rx={6} />
      {/* Top highlight */}
      {w > 30 && h > 20 && (
        <line x1={x + 8} y1={y + 2.5} x2={x + w - 6} y2={y + 2.5} stroke="white" strokeOpacity={0.08} strokeWidth={0.5} strokeLinecap="round" />
      )}
      {/* Labels */}
      {showLabel && (
        <text
          x={x + 8} y={y + 16}
          fill="white" fontSize={showDetail ? 12 : 10} fontWeight={600}
          opacity={0.9} fontFamily="var(--font-sans)"
        >
          {name.length > w / 7 ? name.slice(0, Math.floor(w / 7)) + "..." : name}
        </text>
      )}
      {showDetail && (
        <text
          x={x + 8} y={y + 30}
          fill={fill} fontSize={10} fontWeight={600}
          opacity={0.8} fontFamily="var(--font-mono)"
        >
          {formatBytes(size)}
        </text>
      )}
      {showPct && (
        <>
          <text
            x={x + 8} y={y + 43}
            fill="white" fontSize={9} fontWeight={500}
            opacity={0.45} fontFamily="var(--font-sans)"
          >
            {pct.toFixed(1)}% · {count} conn{count !== 1 ? "s" : ""}
          </text>
          {/* Up/down split bar */}
          {w > 70 && h > 64 && (
            <>
              <rect x={x + 8} y={y + 50} width={Math.max((w - 16) * sentPct / 100, 0)} height={2.5} rx={1} fill="#ec4899" opacity={0.6} />
              <rect x={x + 8 + (w - 16) * sentPct / 100} y={y + 50} width={Math.max((w - 16) * (100 - sentPct) / 100, 0)} height={2.5} rx={1} fill="#6366f1" opacity={0.6} />
            </>
          )}
        </>
      )}
    </g>
  );
}

// --- Modal component ---

interface Props {
  open: boolean;
  onClose: () => void;
  connections: ResolvedConnection[];
}

export function NetworkTreemapModal({ open, onClose, connections }: Props) {
  const [drillPath, setDrillPath] = useState<string[]>([]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const serviceTree = useMemo(() => buildServiceTree(connections), [connections]);

  // Resolve current drill level
  const currentLevel = useMemo<DrillLevel>(() => {
    if (drillPath.length === 0) {
      return { label: "All Services", data: serviceTree };
    }

    const serviceName = drillPath[0];
    const service = serviceTree.find((s) => s.name === serviceName);
    if (!service) return { label: "All Services", data: serviceTree };

    if (drillPath.length === 1) {
      return {
        label: serviceName,
        data: service.children || [],
        parentColor: service.fill,
      };
    }

    const domainName = drillPath[1];
    const domain = service.children?.find((d) => d.name === domainName);
    if (!domain) return { label: serviceName, data: service.children || [], parentColor: service.fill };

    return {
      label: domainName,
      data: domain.children || [],
      parentColor: service.fill,
    };
  }, [serviceTree, drillPath]);

  const totalBytes = useMemo(
    () => currentLevel.data.reduce((sum, n) => sum + n.size, 0),
    [currentLevel.data]
  );

  const handleTileClick = useCallback((name: string) => {
    if (drillPath.length >= 2) return; // max 3 levels
    setDrillPath((prev) => [...prev, name]);
    setTooltip(null);
  }, [drillPath.length]);

  const handleCrumbClick = useCallback((index: number) => {
    setDrillPath((prev) => prev.slice(0, index));
    setTooltip(null);
  }, []);

  const handleHover = useCallback((e: React.MouseEvent, node: TreeNode | null) => {
    if (!node) {
      setTooltip(null);
      return;
    }
    setTooltip({ x: e.clientX + 12, y: e.clientY - 10, node });
  }, []);

  if (!open) return null;

  const breadcrumbs = ["All Services", ...drillPath];

  return (
    <Modal open={open} onClose={onClose} variant="glass" width={1400} className="treemap-modal">
      {/* Header */}
      <div className="treemap-modal__header">
        <div className="treemap-modal__header-left">
          <span className="treemap-modal__title">Network Usage</span>
          <span className="treemap-modal__total">{formatBytes(totalBytes)}</span>
        </div>
        <button className="treemap-modal__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="treemap-modal__breadcrumb">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <span className="treemap-modal__sep">›</span>}
            <button
              className={`treemap-modal__crumb ${i === breadcrumbs.length - 1 ? "treemap-modal__crumb--active" : ""}`}
              onClick={() => handleCrumbClick(i)}
            >
              {crumb}
            </button>
          </span>
        ))}
      </div>

      {/* Treemap */}
      <div className="treemap-modal__body">
        {currentLevel.data.length === 0 ? (
          <div className="treemap-modal__empty">No data at this level</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={currentLevel.data as any}
              dataKey="size"
              aspectRatio={16 / 9}
              content={
                <DetailedTile
                  x={0} y={0} width={0} height={0}
                  name="" size={0} fill="" sent={0} received={0} count={0}
                  totalBytes={totalBytes} depth={0} index={0}
                  onTileClick={handleTileClick}
                  onHover={handleHover}
                />
              }
              isAnimationActive={false}
            />
          </ResponsiveContainer>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          ref={tooltipRef}
          className="treemap-modal__tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <span className="treemap-modal__tooltip-name">{tooltip.node.name}</span>
          <div className="treemap-modal__tooltip-row">
            <span className="treemap-modal__tooltip-label">Total</span>
            <span className="treemap-modal__tooltip-value">{formatBytes(tooltip.node.size)}</span>
          </div>
          <div className="treemap-modal__tooltip-row">
            <span className="treemap-modal__tooltip-label">Upload</span>
            <span className="treemap-modal__tooltip-value">{formatBytes(tooltip.node.sent)}</span>
          </div>
          <div className="treemap-modal__tooltip-row">
            <span className="treemap-modal__tooltip-label">Download</span>
            <span className="treemap-modal__tooltip-value">{formatBytes(tooltip.node.received)}</span>
          </div>
          <div className="treemap-modal__tooltip-row">
            <span className="treemap-modal__tooltip-label">Connections</span>
            <span className="treemap-modal__tooltip-value">{tooltip.node.count}</span>
          </div>
          {tooltip.node.meta && (
            <div className="treemap-modal__tooltip-row">
              <span className="treemap-modal__tooltip-label">Info</span>
              <span className="treemap-modal__tooltip-value">{tooltip.node.meta}</span>
            </div>
          )}
          <div className="treemap-modal__split-bar">
            <div className="treemap-modal__split-up" style={{ width: `${tooltip.node.size > 0 ? (tooltip.node.sent / tooltip.node.size) * 100 : 50}%` }} />
            <div className="treemap-modal__split-down" style={{ flex: 1 }} />
          </div>
        </div>
      )}
    </Modal>
  );
}
