/** Observe the real Pixi waterline under full/lite/still policies; host APIs alone are fixtures. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkWaterline(view, manifest) {
  const output = join(dirname(fileURLToPath(import.meta.url)), 'review');
  const noon = Date.parse('2026-10-14T12:00:00Z');
  await view.setViewportSize({ width: 900, height: 900 });
  await view.clock.install({ time: noon });
  await view.reload(); await view.clock.pauseAt(noon + 20000);
  await view.getByRole('button', { name: 'Open Deck', exact: true }).click();
  const canvas = view.locator('canvas[data-firstmate-deck]');
  for (let i = 0; i < 100 && !(await canvas.count()); i++) {
    await view.clock.runFor(100); await view.waitForTimeout(50);
  }
  await canvas.waitFor(); await view.clock.runFor(500);
  const inspect = () => view.evaluate(() => {
    const all = [], walk = n => { all.push(n); for (const child of n.children ?? []) walk(child); };
    walk(window.motionReviewApp.stage);
    const get = label => all.find(n => n.label === label);
    const root = get('attention-carrier'), above = get('carrier-above-surface'), under = get('carrier-submerged');
    const front = get('carrier-ripple-front'), back = get('carrier-ripple-back');
    const bounds = front.getLocalBounds();
    return { x: root.x, y: root.y, frameX: above.texture.frame.x, aboveRows: above.texture.frame.height,
      underY: under.y, underRows: under.texture.frame.height, underAlpha: under.alpha,
      ripple: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY],
      attached: [above, under, front, back].every(child => child.parent === root) };
  });
  const first = await inspect();
  assert.equal(first.aboveRows, manifest.attentionCarrier.surface.row);
  assert.equal(first.underY, first.aboveRows);
  assert.equal(first.underRows + first.aboveRows, manifest.attentionCarrier.size[1]);
  assert.equal(first.underAlpha, manifest.attentionCarrier.surface.submergedAlpha);
  assert.equal(first.attached, true);
  await view.clock.runFor(2300);
  assert.deepEqual(await inspect(), first, 'reduced motion freezes the whole surface assembly');
  await view.emulateMedia({ reducedMotion: 'no-preference' });
  await view.clock.runFor(250);
  const mode = await canvas.getAttribute('data-firstmate-deck-motion');
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await view.clock.runFor(300);
    samples.push(await inspect());
    if (mode === 'full' && [0, 5, 10].includes(i)) {
      const fit = await view.evaluate(m => { const { fit } = window.drawOverlay(m); document.querySelector('[data-firstmate-deck-overlay]').remove(); return fit; }, manifest);
      const box = await canvas.boundingBox(), [x, y] = manifest.attentionCarrier.at;
      await view.screenshot({ path: join(output, `waterline-moving-${i}.png`), clip: {
        x: box.x + fit.x + (x - 8) * fit.scale, y: box.y + fit.y + (y - 4) * fit.scale,
        width: 72 * fit.scale, height: 52 * fit.scale,
      }});
    }
  }
  const distinct = select => new Set(samples.map(s => JSON.stringify(select(s)))).size;
  assert.equal(distinct(s => s.ripple) > 1, mode === 'full', 'surface ripple follows full/lite water policy');
  assert.equal(distinct(s => [s.x, s.y]) > 1, mode === 'full', 'surface travels with the shark');
  assert.equal(distinct(s => s.frameX) > 1, mode === 'full', 'swim cycle follows the same policy');
  assert(samples.every(s => s.attached && s.underY === first.underY && s.aboveRows === first.aboveRows));
  await view.emulateMedia({ reducedMotion: 'reduce' }); await view.clock.runFor(250);
  assert.deepEqual(await inspect(), first, 'reducing motion restores the still pose and ripple');
  await writeFile(join(output, `waterline-${mode}-checks.json`), JSON.stringify({ mode, still: first, samples }, null, 2) + '\n');
  console.log(JSON.stringify({ waterline: mode, samples: samples.length, attached: true, still: true }));
}
