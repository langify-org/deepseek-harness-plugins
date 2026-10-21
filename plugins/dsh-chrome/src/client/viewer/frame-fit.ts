export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where a frame is drawn inside the viewer surface, in surface CSS pixels. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Fits a frame inside the surface without cropping or stretching, centred. When the
 * viewer owns the viewport the frame already has the surface's size and fills it.
 */
export function fitFrame(surface: Size, frame: Size): Placement {
  const scale = Math.min(surface.width / frame.width, surface.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return { x: (surface.width - width) / 2, y: (surface.height - height) / 2, width, height };
}

/**
 * Maps a point on the surface to the page's CSS pixels, or `undefined` when the point
 * lies outside the drawn frame (in the letterbox).
 */
export function toPagePoint(
  placement: Placement,
  frame: Size,
  surfaceX: number,
  surfaceY: number,
): { readonly x: number; readonly y: number } | undefined {
  const relativeX = (surfaceX - placement.x) / placement.width;
  const relativeY = (surfaceY - placement.y) / placement.height;
  if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) return undefined;
  return { x: relativeX * frame.width, y: relativeY * frame.height };
}
