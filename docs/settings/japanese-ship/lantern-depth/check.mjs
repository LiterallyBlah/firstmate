/** Existing render host, fixture cards and pure engine geometry; no Pixi observer. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const require = createRequire(join(root, 'docs/board-list/package.json'));

export async function checkLanterns(view, manifest) {
  const phase = process.env.SAKURA_LANTERNS;
  const postsOnly = process.env.SAKURA_LANTERN_POSTS === '1';
  const out = join(here, phase, ...(postsOnly ? ['posts'] : []));
  await mkdir(out, { recursive: true });
  const target = join(root, '.generated/lantern-engine.mjs');
  await require('esbuild').build({ stdin: { contents: "export {compileStage} from './client/deck-stage';export {compileCast} from './client/deck-cast';export {createCrew,applyCrew,crewFigures} from './client/deck-crew';export {badgeTop,sailorAt} from './client/deck-hover';", resolveDir: root }, outfile: target, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const engine = await import(pathToFileURL(target));
  const stage = engine.compileStage(manifest), cast = engine.compileCast(manifest);
  const canvas = view.locator('canvas[data-firstmate-deck]');
  const panel = view.getByTestId('firstmate-deck-focus');
  const source = await view.evaluate(() => window.fixtureFleet.cards.find(c => c.agent));
  const set = async cards => {
    await view.evaluate(cards => window.changeFleet(f => { f.cards = cards; f.suggestions = []; }), cards);
    await view.getByRole('button', { name: 'Refresh', exact: true }).click();
    await view.waitForTimeout(800);
  };
  const results = [];
  for (const [time, hour] of [['day', 12], ['night', 23]]) {
    await view.clock.setFixedTime(new Date(`2026-10-16T${hour}:00:00Z`));
    for (const [column, state] of [['blocked', 'blocked'], ['working', 'working'], ['ready', 'waiting'], ['idle', 'idle']]) {
      const count = postsOnly ? ({ blocked: 3, working: 7, ready: 3, idle: 0 })[column] : 24;
      const cards = Array.from({ length: count }, (_, i) => {
        const id = column + '-' + String(i).padStart(2, '0');
        return { ...structuredClone(source), key: id, taskId: id, title: id, column, note: null, remote: undefined,
          agent: { ...structuredClone(source.agent), id, status: column === 'working' ? 'running' : 'finished', pendingPermissions: column === 'blocked' ? 1 : 0 } };
      });
      await set([]); await set(cards);
      assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'), time === 'day' ? 'midday' : 'night');
      const crew = engine.createCrew(stage, cast);
      engine.applyCrew(crew, cards.map(c => ({ key: c.key, identity: c.agent.id, state, stale: false })), { snap: true });
      const figures = engine.crewFigures(crew, 0, { still: true });
      const fit = await view.evaluate(m => { const a = window.drawOverlay(m); document.querySelector('[data-firstmate-deck-overlay]').remove(); return a.fit; }, manifest);
      const box = await canvas.boundingBox();
      await view.mouse.move(1, 899);
      await canvas.screenshot({ path: join(out, `${time}-${column}.png`) });
      for (const light of manifest.stage.lights) {
        const [x, y] = light.at;
        await view.screenshot({ path: join(out, `${time}-${column}-${light.id}.png`), clip: {
          x: box.x + fit.x + (x - 23) * fit.scale, y: box.y + fit.y + (y - 14) * fit.scale,
          width: 52 * fit.scale, height: 62 * fit.scale } });
      }
      const focused = [];
      if (phase === 'after' && !postsOnly) for (const figure of figures) {
        let at = null;
        const top = engine.badgeTop(figure, cast);
        for (let y = top; y < top + 8 && !at; y++) for (let x = figure.x - 3; x <= figure.x + 3 && !at; x++)
          if (engine.sailorAt(figures, cast, { x: x + .5, y: y + .5 })?.key === figure.key) at = [x + .5, y + .5];
        assert.ok(at, figure.key + ' has a reachable badge');
        await view.mouse.click(box.x + fit.x + at[0] * fit.scale, box.y + fit.y + at[1] * fit.scale);
        await panel.waitFor({ state: 'visible' });
        assert.equal(await panel.getAttribute('aria-label'), figure.key + ': details and actions');
        focused.push(figure.key);
        await view.keyboard.press('Escape');
        await panel.waitFor({ state: 'hidden' });
        await view.waitForTimeout(350);
      }
      results.push({ time, state, focused, figures: figures.map(({ key, x, row, y }) => ({ key, x, row, y })) });
    }
  }
  await writeFile(join(out, 'checks.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ phase, captures: results.length, clicks: results.reduce((n, r) => n + r.focused.length, 0) }));
}
