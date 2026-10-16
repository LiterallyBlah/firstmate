import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../../../../test/png.ts';
const here = fileURLToPath(new URL('./', import.meta.url));
const old = JSON.parse(execFileSync('git', ['show', '96d5914:art/settings/japanese-ship/setting.json'], { encoding: 'utf8' }));
const pack = JSON.parse(readFileSync('art/settings/japanese-ship/setting.json'));
const expected = structuredClone(old);
expected.stage.lights.forEach((light, i) => { light.row = [223, 223, 228][i]; });
assert.deepEqual(pack, expected, 'only the three light depths change');
const results = [];
for (const folder of ['', 'posts/']) for (const time of ['day', 'night']) for (const state of ['blocked', 'working', 'ready', 'idle']) {
  const file = `${folder}${time}-${state}.png`;
  const a = decodePng(readFileSync(here + 'before/' + file));
  const b = decodePng(readFileSync(here + 'after/' + file));
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let pixels = 0, minX = a.width, minY = a.height, maxX = 0, maxY = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) if (a.at(x, y) !== b.at(x, y)) {
    pixels++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (state === 'idle') assert.equal(pixels, 0, 'unoccluded lights and scenery remain pixel-identical');
  results.push({ file, pixels, bounds: pixels ? [minX, minY, maxX, maxY] : null });
}
writeFileSync(here + 'audit.json', JSON.stringify({ baseline: '96d5914', onlyThreeDepthsChanged: true, results }, null, 2) + '\n');
console.log(JSON.stringify(results));
