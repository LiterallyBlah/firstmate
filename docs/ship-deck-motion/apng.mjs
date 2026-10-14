/**
 * A minimal animated-PNG writer, for the deck's motion evidence: RGB frames of one size, each shown for
 * `delayMs`, looping, with one palette of their 256 most used colours. No dependencies: zlib and a CRC.
 */
import { deflateSync } from "node:zlib";

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** One frame's image data: rows of palette indices, unfiltered, deflated. */
function imageData(indices, width, height) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) indices.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  return deflateSync(raw, { level: 9 });
}

/**
 * The frames as indices into one palette of their 256 most used colours. The deck's art has far fewer;
 * what is left over is the lanterns' glow and the marks' soft edges, each mapped to its nearest colour.
 */
function indexed(frames) {
  const counts = new Map();
  for (const rgb of frames) {
    for (let at = 0; at < rgb.length; at += 3) {
      const colour = (rgb[at] << 16) | (rgb[at + 1] << 8) | rgb[at + 2];
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
  }
  const kept = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 256).map(([colour]) => colour);
  const lookup = new Map(kept.map((colour, index) => [colour, index]));
  const nearest = (colour) => {
    let found = lookup.get(colour);
    if (found !== undefined) return found;
    let best = Number.POSITIVE_INFINITY;
    kept.forEach((other, index) => {
      const dr = (colour >> 16) - (other >> 16);
      const dg = ((colour >> 8) & 0xff) - ((other >> 8) & 0xff);
      const db = (colour & 0xff) - (other & 0xff);
      const distance = dr * dr + dg * dg + db * db;
      if (distance < best) {
        best = distance;
        found = index;
      }
    });
    lookup.set(colour, found);
    return found;
  };
  const plte = Buffer.alloc(kept.length * 3);
  kept.forEach((colour, index) => plte.set([colour >> 16, (colour >> 8) & 0xff, colour & 0xff], index * 3));
  const indices = frames.map((rgb) => {
    const out = Buffer.alloc(rgb.length / 3);
    for (let at = 0; at < out.length; at += 1) out[at] = nearest((rgb[at * 3] << 16) | (rgb[at * 3 + 1] << 8) | rgb[at * 3 + 2]);
    return out;
  });
  return { plte, indices };
}

/** `frames` are Buffers of `width * height * 3` bytes. */
export function encodeApng(frames, width, height, delayMs) {
  const palette = indexed(frames);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  const control = Buffer.alloc(8);
  control.writeUInt32BE(frames.length, 0);
  control.writeUInt32BE(0, 4);
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("acTL", control)];
  parts.push(chunk("PLTE", palette.plte));
  let sequence = 0;
  frames.forEach((_rgb, index) => {
    const frameControl = Buffer.alloc(26);
    frameControl.writeUInt32BE(sequence++, 0);
    frameControl.writeUInt32BE(width, 4);
    frameControl.writeUInt32BE(height, 8);
    frameControl.writeUInt32BE(0, 12);
    frameControl.writeUInt32BE(0, 16);
    frameControl.writeUInt16BE(delayMs, 20);
    frameControl.writeUInt16BE(1000, 22);
    frameControl[24] = 0;
    frameControl[25] = 0;
    parts.push(chunk("fcTL", frameControl));
    const data = imageData(palette.indices[index], width, height);
    if (index === 0) parts.push(chunk("IDAT", data));
    else {
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(sequence++);
      parts.push(chunk("fdAT", Buffer.concat([prefix, data])));
    }
  });
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}
