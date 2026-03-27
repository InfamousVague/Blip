type RGBA = [number, number, number, number];

export function bytesToColor(_totalBytes: number, opacity: number = 1): RGBA {
  return [255, 255, 255, Math.round(opacity * 255)];
}

export function bytesToTargetColor(_totalBytes: number, opacity: number = 1): RGBA {
  return [255, 255, 255, Math.round(opacity * 255)];
}
