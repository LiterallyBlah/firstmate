/** Pixel evidence from saved browser captures, using the pack linter's PNG reader. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { decodePng } from "../../test/png.ts";
const before = new URL("./before/", import.meta.url), after = new URL("./after/", import.meta.url);
const results = readdirSync(after).filter((name) => name.endsWith(".png")).map((name) => {
  const a = decodePng(readFileSync(new URL(name, before))), b = decodePng(readFileSync(new URL(name, after)));
  if (a.width !== b.width || a.height !== b.height) throw Error(`size changed: ${name}`);
  let changed = 0, box = null;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    if (a.at(x, y) === b.at(x, y)) continue;
    changed++;
    box = box === null ? [x, y, x, y] : [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  }
  return { name, width: a.width, height: a.height, changedPixels: changed, changedBounds: box };
});
writeFileSync(new URL("./pixel-comparison.json", import.meta.url), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results));
