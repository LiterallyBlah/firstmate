/**
 * Enough of PNG for the pack linter: 8-bit RGB, RGBA or palette (with its transparency), not interlaced — what the
 * packs' images are. Every pixel as RGBA.
 */
import { inflateSync } from "node:zlib";

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row by row. */
  rgba: Uint8Array;
  /** The pixel's RGBA as one number, 0xRRGGBBAA. */
  at(x: number, y: number): number;
  alpha(x: number, y: number): number;
}

export function decodePng(file: Uint8Array): Pixels {
  const view = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  const width = view.readUInt32BE(16);
  const height = view.readUInt32BE(20);
  const [depth, type, interlace] = [view[24], view[25], view[28]];
  const channels = type === 6 ? 4 : type === 2 ? 3 : type === 3 ? 1 : 0;
  if (depth !== 8 || channels === 0 || interlace !== 0) throw new Error(`a PNG the linter cannot read: depth ${depth}, type ${type}, interlace ${interlace}`);
  const idat: Buffer[] = [];
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  for (let at = 8; at < view.length; ) {
    const length = view.readUInt32BE(at);
    const kind = view.toString("latin1", at + 4, at + 8);
    const data = view.subarray(at + 8, at + 8 + length);
    if (kind === "IDAT") idat.push(data);
    else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") transparency = data;
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const left = x >= channels ? line[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = (value + predicted) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 4;
      if (type === 3) {
        const index = line[x]!;
        rgba.set([palette![index * 3]!, palette![index * 3 + 1]!, palette![index * 3 + 2]!, transparency !== null && index < transparency.length ? transparency[index]! : 255], to);
      } else {
        const from = x * channels;
        rgba.set([line[from]!, line[from + 1]!, line[from + 2]!, channels === 4 ? line[from + 3]! : 255], to);
      }
    }
    previous = line;
  }
  const at = (x: number, y: number) => {
    const from = (y * width + x) * 4;
    return ((rgba[from]! << 24) | (rgba[from + 1]! << 16) | (rgba[from + 2]! << 8) | rgba[from + 3]!) >>> 0;
  };
  return { width, height, rgba, at, alpha: (x, y) => rgba[(y * width + x) * 4 + 3]! };
}
