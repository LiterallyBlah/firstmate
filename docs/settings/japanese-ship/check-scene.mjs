/** Real compiled client/RPC/art acceptance; the host alone is a fixture. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(join(root, 'docs/board-list/package.json'));

export async function checkJapaneseLite(view) {
  const canvas = view.locator('canvas[data-firstmate-deck]');
  assert.equal(await canvas.getAttribute('data-firstmate-deck-setting'), 'japanese-ship');
  await view.emulateMedia({ reducedMotion: 'no-preference' });
  await view.waitForTimeout(600);
  assert.equal(await canvas.getAttribute('data-firstmate-deck-motion'), 'lite');
  await canvas.evaluate(node => node.parentElement.focus());
  await view.keyboard.press('Enter');
  await view.getByTestId('firstmate-deck-focus').waitFor({ state: 'visible' });
  await view.keyboard.press('Escape');
  await view.getByTestId('firstmate-deck-focus').waitFor({ state: 'hidden' });
  await view.waitForTimeout(600);
  await view.mouse.move(1, 899);
  await view.screenshot({ path: join(here, 'review/lite.png') });
  const result = { renderer: 'SwiftShader', motion: 'lite', checks: ['pack renders on actual software WebGL', 'keyboard focus and Escape work in lite motion'], errors: [] };
  await writeFile(join(here, 'lite.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}

export async function checkJapaneseShip(view, manifest) {
  assert.equal(manifest.id, 'japanese-ship');
  const output = join(here, 'review');
  await mkdir(output, { recursive: true });
  const checks = [], screenshots = [];
  const canvas = view.locator('canvas[data-firstmate-deck]');
  const panel = view.getByTestId('firstmate-deck-focus');
  const refresh = async () => {
    await view.getByRole('button', { name: 'Refresh', exact: true }).click();
    await view.waitForTimeout(750);
  };
  const actual = id => view.waitForFunction(id => {
    const nodes = document.querySelectorAll('canvas[data-firstmate-deck]');
    return nodes.length === 1 && nodes[0].getAttribute('data-firstmate-deck-setting') === id && nodes[0].hasAttribute('data-firstmate-deck-motion');
  }, id);
  const choose = async name => {
    await view.getByRole('button', { name: /^Scene:/ }).click();
    await view.getByRole('button', { name: new RegExp(`^${name}, `) }).click();
  };
  const shot = async (name, sceneOnly = false) => {
    await view.mouse.move(1, 899);
    const file = `${name}.png`;
    await view.screenshot({ path: join(output, file), ...(sceneOnly ? { clip: await canvas.boundingBox() } : {}) });
    screenshots.push(file);
  };
  const point = async (x, y) => {
    const fit = await view.evaluate(m => {
      const { fit } = window.drawOverlay(m);
      document.querySelector('[data-firstmate-deck-overlay]').remove();
      return fit;
    }, manifest);
    const box = await canvas.boundingBox();
    await view.mouse.click(box.x + fit.x + x * fit.scale, box.y + fit.y + y * fit.scale);
  };
  const close = async () => {
    await view.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    await view.waitForTimeout(350);
  };

  await actual('japanese-ship');
  await view.getByRole('button', { name: /^Scene:/ }).click();
  assert.equal(await view.getByRole('button', { name: /^The office, / }).count(), 0);
  await view.getByRole('button', { name: /^Sakura coast, / }).waitFor();
  await view.getByRole('button', { name: /^Ship's deck, / }).waitFor();
  await shot('picker');
  await view.getByRole('button', { name: /^Ship's deck, / }).click();
  await actual('ship');
  const shipBox = await canvas.boundingBox();
  await view.evaluate(() => { window.failSceneSave = true; });
  await choose('Sakura coast');
  await view.waitForFunction(() => window.fixtureErrors.includes('The scene was not saved. Please try again.'));
  assert.equal(await canvas.getAttribute('data-firstmate-deck-setting'), 'ship');
  await view.evaluate(() => { window.failSceneSave = false; window.fixtureErrors = []; });
  await choose('Sakura coast');
  await actual('japanese-ship');
  await view.reload();
  await view.getByRole('button', { name: 'Open Deck', exact: true }).click();
  await actual('japanese-ship');
  await choose("Ship's deck");
  await actual('ship');
  assert.deepEqual(await canvas.boundingBox(), shipBox);
  await choose('Sakura coast');
  await actual('japanese-ship');
  checks.push('picker offers ship and Sakura coast only; failed save stays put; saved scene survives reload; ship geometry restored');

  const source = await view.evaluate(() => window.fixtureFleet.cards.find(c => c.agent !== null && c.agent.status !== 'closed'));
  const card = (id, column, pending = 0) => ({
    ...structuredClone(source), key: id, taskId: id, title: id, column, note: null, remote: undefined,
    agent: { ...structuredClone(source.agent), id, status: column === 'working' ? 'running' : 'finished', pendingPermissions: pending }
  });
  const mixed = [card('Rigging sailor', 'working'), card('Stern sailor', 'ready'), card('Bow sailor', 'blocked', 1),
    ...Array.from({ length: 6 }, (_, i) => card(`Sleeping sailor ${i + 1}`, 'idle'))];
  const setCards = async cards => {
    await view.evaluate(cards => window.changeFleet(fleet => { fleet.cards = cards; fleet.suggestions = []; }), cards);
    await refresh();
  };
  await setCards(mixed);
  await shot('day');
  await shot('day-canvas', true);
  await view.evaluate(m => window.drawOverlay(m), manifest);
  await shot('floor-overlay', true);
  await view.evaluate(() => document.querySelector('[data-firstmate-deck-overlay]').remove());
  const url = view.url();
  await canvas.evaluate(node => { window.japaneseOriginalCanvas = node; });
  await point(52, 307);
  await panel.waitFor({ state: 'visible' });
  assert.equal(await panel.getAttribute('aria-label'), 'Bow sailor: details and actions');
  assert.equal(view.url(), url);
  assert.ok(await canvas.evaluate(node => node === window.japaneseOriginalCanvas));
  assert.equal(await view.getByRole('complementary', { name: /Conversation with/ }).count(), 0);
  await shot('shark-focus');
  await close();
  await point(46, 283);
  await panel.waitFor({ state: 'visible' });
  assert.equal(await panel.getAttribute('aria-label'), 'Bow sailor: details and actions');
  await close();
  checks.push('all four crew states render; generated shark body and bubble focus their worker in place on the same canvas');

  await view.clock.setFixedTime(new Date('2026-10-14T23:00:00Z'));
  await refresh();
  assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'), 'night');
  await shot('night');
  await view.clock.setFixedTime(new Date('2026-10-14T12:00:00Z'));
  // The sky's monotonic refresh guard is not a clock-rewind API; remount after moving test time backwards.
  await choose("Ship's deck");
  await actual('ship');
  await choose('Sakura coast');
  await actual('japanese-ship');
  await refresh();
  assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'), 'day');
  const still = await canvas.screenshot();
  await view.waitForTimeout(500);
  assert.ok((await canvas.screenshot()).equals(still), 'reduced motion is stable');
  await view.emulateMedia({ reducedMotion: 'no-preference' });
  await view.waitForTimeout(800);
  assert.equal(await canvas.getAttribute('data-firstmate-deck-motion'), 'full');
  const moving = await canvas.screenshot();
  await view.waitForTimeout(900);
  assert.ok(!(await canvas.screenshot()).equals(moving), 'full motion animates');
  await shot('moving');
  await view.emulateMedia({ reducedMotion: 'reduce' });
  checks.push('day/night preserve composition; still motion is stable; full motion changes rendered pixels');

  // Resolve authored crowded positions through the engine, then exercise all targets in its real browser renderer.
  const modulePath = join(root, '.generated/japanese-interactions.mjs');
  await require('esbuild').build({ stdin: { contents: `export {compileStage} from './client/deck-stage'; export {compileCast} from './client/deck-cast'; export {createCrew,applyCrew,crewFigures} from './client/deck-crew';`, resolveDir: root }, outfile: modulePath, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const engine = await import(pathToFileURL(modulePath));
  const crowd = Array.from({ length: 24 }, (_, i) => card(`Sleeper ${String(i).padStart(2, '0')}`, 'idle'));
  await setCards([]);
  await setCards(crowd);
  const crew = engine.createCrew(engine.compileStage(manifest), engine.compileCast(manifest));
  engine.applyCrew(crew, crowd.map(c => ({ key: c.key, identity: c.agent.id, state: 'idle', stale: false })), { snap: true });
  const figures = engine.crewFigures(crew, 0, { still: true });
  await shot('sleepers-24');
  const names = [];
  for (const figure of figures) {
    await point(figure.x, figure.row - 8);
    await panel.waitFor({ state: 'visible' });
    names.push(await panel.getAttribute('aria-label'));
    await close();
  }
  assert.deepEqual([...names].sort(), crowd.map(c => `${c.title}: details and actions`).sort());
  checks.push('24 separate sleeping windows focus 24 distinct workers');

  await setCards(mixed);
  await view.evaluate(() => { window.fixtureFleetError = true; });
  await refresh();
  assert.equal(await view.getByTestId('firstmate-deck-attention').count(), 0);
  await shot('stale');
  await view.evaluate(() => { window.fixtureFleetError = false; });
  await refresh();
  for (const width of [900, 640]) {
    await view.setViewportSize({ width, height: 900 });
    await view.waitForTimeout(500);
    const footer = view.getByTestId('firstmate-deck-attention');
    assert.ok(await footer.isVisible());
    const box = await footer.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    assert.ok(await footer.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'compact response footer fits');
    await shot(`split-${width}`);
  }
  checks.push('stale feed removes reply target; compact footer fits 900 and 640 pixel panes');
  assert.deepEqual(await view.evaluate(() => window.fixtureErrors), []);
  assert.equal((await view.evaluate(() => window.fixtureCalls)).filter(c => /\.send$|\.steer$|\.respond$/.test(c.name)).length, 0);
  const evidence = { checks, focused: names, screenshots, errors: [] };
  await writeFile(join(here, 'interactions.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
