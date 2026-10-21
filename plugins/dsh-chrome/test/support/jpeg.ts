/** The pixel size a JPEG declares in its frame header, or `undefined` if it has none. */
export function jpegSize(data: Uint8Array): { width: number; height: number } | undefined {
  if (data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) return undefined;
    const marker = data[offset + 1] ?? 0;
    const length = ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0);
    // Start-of-frame markers: C0–CF except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = ((data[offset + 5] ?? 0) << 8) | (data[offset + 6] ?? 0);
      const width = ((data[offset + 7] ?? 0) << 8) | (data[offset + 8] ?? 0);
      return { width, height };
    }
    offset += 2 + length;
  }
  return undefined;
}
