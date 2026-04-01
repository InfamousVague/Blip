/** Demo connection endpoints for the hero map animation */

export const USER_LOCATION: [number, number] = [-79.0, 35.8]; // North Carolina area

export interface DemoEndpoint {
  position: [number, number]; // [lon, lat]
  label: string;
  color: [number, number, number]; // RGB
}

export const DEMO_ENDPOINTS: DemoEndpoint[] = [
  { position: [-77.04, 38.90], label: "Ashburn", color: [99, 102, 241] },       // indigo
  { position: [-122.33, 47.61], label: "Seattle", color: [236, 72, 153] },       // pink
  { position: [-0.12, 51.51], label: "London", color: [139, 92, 246] },          // purple
  { position: [8.68, 50.11], label: "Frankfurt", color: [245, 158, 11] },        // amber
  { position: [139.69, 35.69], label: "Tokyo", color: [6, 182, 212] },           // cyan
  { position: [151.21, -33.87], label: "Sydney", color: [34, 197, 94] },         // green
  { position: [-46.63, -23.55], label: "São Paulo", color: [249, 115, 22] },     // orange
  { position: [103.85, 1.29], label: "Singapore", color: [99, 102, 241] },       // indigo
  { position: [-79.38, 43.65], label: "Toronto", color: [236, 72, 153] },        // pink
  { position: [72.88, 19.08], label: "Mumbai", color: [139, 92, 246] },          // purple
  { position: [-6.26, 53.35], label: "Dublin", color: [34, 197, 94] },           // green
  { position: [-87.63, 41.88], label: "Chicago", color: [6, 182, 212] },         // cyan
];
