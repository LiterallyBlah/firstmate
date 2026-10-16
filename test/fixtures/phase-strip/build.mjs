// Schematic test pixels, not voyage art. Run from any directory to reproduce the fixture.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
const width = 256, height = 256;
const rgba = Buffer.alloc(width * height * 4);
function rect(x, y, w, h, colour) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    if (xx >= 0 && xx < width && yy >= 0 && yy < height) rgba.set(colour, (yy * width + xx) * 4);
  }
}
const phases = ["dawn", "day", "dusk", "night"];
const colours = [[180, 130, 90, 255], [80, 160, 100, 255], [130, 80, 100, 255], [30, 50, 80, 255]];
for (let i = 0; i < 4; i++) {
  const y = i * 48;
  rect(0, y + 36, 256, 12, colours[i]);
  rect(32, y + 20, 40, 16, colours[i]);
  rect(116, y + 12, 16, 24, colours[i]);
  rect(180, y + 4, 12, 32, colours[i]);
  rect(176, y, 20, 4, i === 3 ? [255, 220, 100, 255] : colours[i]);
  rect(44, y + 25, 5, 5, i === 3 ? [255, 220, 100, 255] : [45, 65, 60, 255]);
}
// Four shallow beam frames; row 192..207 is a completely transparent daytime set.
for (let i = 0; i < 3; i++) {
  const y = 208 + i * 16;
  for (let x = 0; x < 44; x++) {
    const xx = i === 0 ? 186 - x : i === 2 ? 186 + x : 186 + Math.floor(x / 3);
    rect(xx, y + Math.max(0, 7 - Math.floor(x / 8)), 1, 1 + Math.floor(x / 4), [255, 220, 100, 180]);
  }
}
function chunk(type, data) {
  const name = Buffer.from(type), out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), out.length - 4); return out;
}
const head = Buffer.alloc(13); head.writeUInt32BE(width); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6;
const scanlines = Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.concat([Buffer.from([0]), rgba.subarray(y * width * 4, (y + 1) * width * 4)])));
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(new URL("atlas.png", import.meta.url), png);
const frame = (y, h = 48) => ({ image: "phase-test", rect: [0, y, width, h] });
const coast = phases.map((_, i) => [frame(i * 48)]);
const blank = Array.from({ length: 3 }, () => frame(192, 16));
const common = { kind: "phase-strip", span: [-512, 1024], drift: { pxPerSecond: 8, clock: "voyage" } };
const fixture = {
  dayCycle: { phases: phases.map((id, i) => ({ id, localMinute: [360, 720, 1080, 1260][i] })), fadeMinutes: 120, night: "night", fallback: "day" },
  atmosphere: { table: [{ at: 0, pace: 1 }, { at: 1, pace: 1 }], delivered: { pace: 1 }, clocks: { voyage: "pace" } },
  images: { "phase-test": { path: "atlas.png", size: [width, height], sha256: createHash("sha256").update(png).digest("hex") } },
  ambience: [
    { id: "test-coast", slot: "back", order: 0, lite: "run", still: "first-frame", behaviour: { ...common, top: -48, frames: { sprites: coast[1], frameMs: 1000 }, byPhase: Object.fromEntries(phases.map((id, i) => [id, coast[i]])) } },
    { id: "test-beam", slot: "back", order: 1, lite: "run", still: "first-frame", behaviour: { ...common, top: -55, frames: { sprites: blank, frameMs: 300, clock: "voyage" }, byPhase: { dawn: blank, day: blank, dusk: blank, night: [frame(208, 16), frame(224, 16), frame(240, 16)] } } },
  ],
};
writeFileSync(new URL("scene.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
