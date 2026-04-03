import { classifyEndpoint } from "./endpoint-type";
import { getServiceColor } from "./service-colors";
import type { ResolvedConnection } from "../types/connection";

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

export interface TreeNode {
  name: string;
  size: number;
  fill: string;
  sent: number;
  received: number;
  count: number;
  meta?: string;
  children?: TreeNode[];
}

export interface DrillLevel {
  label: string;
  data: TreeNode[];
  parentColor?: string;
}

export function buildServiceTree(connections: ResolvedConnection[]): TreeNode[] {
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

export function buildDomainTree(connections: ResolvedConnection[], parentColor: string): TreeNode[] {
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

export function buildConnectionTree(connections: ResolvedConnection[], parentColor: string): TreeNode[] {
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
