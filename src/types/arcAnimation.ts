import type { EndpointType } from "../utils/endpoint-type";

export interface ArcData {
  id: string;
  sourcePosition: [number, number];
  targetPosition: [number, number];
  sourceColor: [number, number, number, number];
  targetColor: [number, number, number, number];
  height: number;
  width: number;
  pingMs: number | null;
  midpoint: [number, number, number];
  /** Pre-computed 3D path points for PathLayer rendering */
  path: [number, number, number][];
  /** True if this arc uses a submarine cable route (render dashed) */
  cableRouted?: boolean;
}

export interface BlockedMarkerData {
  position: [number, number, number];
  opacity: number;
}

export interface BlockedFlashData {
  id: string;
  timestamp: number;
  domain: string;
}

export interface ParticleData {
  position: [number, number, number];
  color: [number, number, number, number];
  width: number;
  /** 0 = upload (user→endpoint), 1 = download (endpoint→user), 2 = neutral */
  direction?: number;
}

/** A short dash segment flowing along an arc — replaces scatter dot particles */
export interface DashSegment {
  id: string;
  /** Short sub-path (3-5 points) representing the dash */
  path: [number, number, number][];
  /** Dash color — service-tinted with direction */
  color: [number, number, number, number];
  /** Trail color — slightly dimmer version for the luminous fade */
  trailColor: [number, number, number, number];
  /** Trail sub-path — slightly behind the dash */
  trailPath: [number, number, number][];
  width: number;
}

export interface HopMarkerData {
  position: [number, number, number];
  color: [number, number, number, number];
  radius: number;
}

export interface EndpointData {
  id: string;
  position: [number, number];
  domain: string | null;
  ip: string | null;
  city: string | null;
  country: string | null;
  connectionCount: number;
  type: EndpointType;
  serviceName: string | null;
  services: string[];
  connectionDetails: { process: string; domain: string | null; port: number; service: string; color: string }[];
  datacenter: string | null;
  cloudProvider: string | null;
  cloudRegion: string | null;
  asnOrg: string | null;
  networkType: string | null;
  isCdn: boolean;
}
