/** Production settings at a pinned before revision and current files; synthetic host only. */
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/smooth-pr5/ui');
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
const baseline = '8e8871509188e8acc6d07ed14004698318b7aa79';
await mkdir(resolve(out, 'screenshots'), { recursive: true });
for (const stage of ['before', 'after']) await build({ entryPoints: [resolve(here, 'panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true,
  jsx: 'automatic', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated-settings', setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, 'stubs.jsx') }));
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
    b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
    if (stage === 'before') b.onLoad({ filter: /[\\/]client[\\/]settings-screen\.tsx$/ }, a => ({
      contents: execFileSync('git', ['show', `${baseline}:${relative(root, a.path).replaceAll('\\', '/')}`], { cwd: root, encoding: 'utf8' }), loader: 'tsx',
    }));
  } }] });
const server = createServer(async (req, res) => {
  const stage = req.url.includes('before') ? 'before' : 'after';
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/html');
  res.end(req.url.endsWith('.js') ? await readFile(resolve(out, stage + '.js')) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px;min-width:44px}:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--disable-gpu'] });
const results = [];
const mutations = page => page.evaluate(() => window.review.calls.filter(c => c.name !== 'firstmate.deck.settings' && !/\.(read|load|find|targets|list|compare|status)$/.test(c.name)));
async function capture(page, key) {
  const state = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > innerWidth, calls: window.review.calls }));
  assert.equal(state.overflow, false, key + ': document overflow');
  await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') }); results.push({ key, ...state });
}
async function checkControls(page, zoom = false) {
  if (zoom) await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')].filter(el => [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()));
    const sizes = nodes.map(el => ({ el, size: parseFloat(getComputedStyle(el).fontSize), line: parseFloat(getComputedStyle(el).lineHeight) }));
    for (const { el, size, line } of sizes) { el.style.fontSize = `${size * 2}px`; if (Number.isFinite(line)) el.style.lineHeight = `${line * 2}px`; }
  });
  const dialog = page.getByRole('dialog'), container = await dialog.count() ? dialog : page.getByTestId('help-settings');
  const controls = container.locator('button,[role="button"],input');
  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i); await control.scrollIntoViewIfNeeded();
    const measured = await control.evaluate(el => {
      const r = el.getBoundingClientRect(), clipped = [];
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (['hidden', 'auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) {
          const p = parent.getBoundingClientRect(); if (r.left < p.left - 1 || r.right > p.right + 1) clipped.push(parent.tagName);
        }
      }
      return { label: el.getAttribute('aria-label') || el.innerText, height: r.height, width: r.width, clipped };
    });
    assert.ok(measured.height >= 43.5 && measured.width >= 43.5, JSON.stringify(measured));
    assert.deepEqual(measured.clipped, [], JSON.stringify(measured));
  }
}
try {
  for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    for (const stage of ['before', 'after']) {
      const page = await browser.newPage({ viewport: { width, height } }), errors = []; page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${origin}/?${new URLSearchParams({ stage, theme, home: 'upgraded', features: 'on' })}`, { waitUntil: 'networkidle' });
      await capture(page, `${theme}-${device}-settings-${stage}`); assert.deepEqual(errors, []);
      assert.deepEqual(await mutations(page), [], 'navigation has no writes');
      if (stage === 'after') {
        assert.equal(await page.getByText('Off', { exact: true }).count(), 3);
        await page.getByRole('button', { name: 'Set up project mates', exact: true }).click();
        await capture(page, `${theme}-${device}-project-review`); await checkControls(page); assert.deepEqual(await mutations(page), []);
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('button', { name: 'Set up project mates', exact: true }).evaluate(el => el === document.activeElement), true, 'focus returns');
        await page.getByRole('button', { name: 'Set up project mates', exact: true }).click();
        await page.getByRole('button', { name: 'Save help settings', exact: true }).click();
        await page.getByText('Your settings are saved and applied here.', { exact: true }).waitFor();
        const writes = await mutations(page); assert.equal(writes.length, 1); assert.equal(writes[0].name, 'firstmate.features.set');
        assert.deepEqual(writes[0].input.change.requested, { projectMates: true, planSupervisors: false, scopedActivation: false, scopeUi: true, scopeExecution: true, maintenance: false });
        await capture(page, `${theme}-${device}-project-applied`);
      }
      await page.close();
    }
    for (const scenario of ['pilot', 'partial', 'off-review', 'save-failure', 'lost-reply', 'held', 'read-error', 'capacity', 'stale']) {
      const page = await browser.newPage({ viewport: { width, height } }), errors = []; page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${origin}/?${new URLSearchParams({ stage: 'after', theme, home: 'upgraded', features: 'on', case: scenario })}`, { waitUntil: 'networkidle' });
      if (scenario === 'pilot') {
        await page.getByText('Using your existing setup', { exact: true }).waitFor(); assert.deepEqual(await mutations(page), []);
        await capture(page, `${theme}-${device}-pilot`);
        await page.getByRole('button', { name: 'Keep existing setup', exact: true }).click();
        await page.getByRole('button', { name: 'Save help settings', exact: true }).click();
        await page.getByText('Your settings are saved and applied here.', { exact: true }).waitFor();
        assert.ok(Object.values((await mutations(page))[0].input.change.requested).every(Boolean));
      } else if (scenario === 'partial') {
        await page.getByRole('button', { name: 'Help details', exact: true }).click();
        await page.getByRole('button', { name: 'Keep existing setup', exact: true }).click();
        await capture(page, `${theme}-${device}-partial-review`);
        await page.getByRole('button', { name: 'Save help settings', exact: true }).click();
        await page.getByText('Your settings are saved and applied here.', { exact: true }).waitFor();
        assert.deepEqual((await mutations(page))[0].input.change.requested, { projectMates: false, planSupervisors: false, scopedActivation: false, scopeUi: false, scopeExecution: true, maintenance: false });
      } else if (scenario === 'off-review') {
        await page.getByRole('button', { name: 'Turn off project mates', exact: true }).click();
        await capture(page, `${theme}-${device}-off-review`);
        await page.getByRole('button', { name: 'Save help settings', exact: true }).click();
        await page.getByText('Your settings are saved and applied here.', { exact: true }).waitFor();
        assert.equal((await mutations(page))[0].input.change.requested.projectMates, false);
        assert.equal((await mutations(page))[0].input.change.requested.planSupervisors, true);
      } else if (['save-failure', 'lost-reply'].includes(scenario)) {
        await page.getByRole('button', { name: 'Set up project mates', exact: true }).click();
        await page.getByRole('button', { name: 'Save help settings', exact: true }).click();
        await page.getByText(/Couldn't confirm this settings save/).waitFor();
        await capture(page, `${theme}-${device}-${scenario}`);
        const original = (await mutations(page))[0].input;
        if (scenario === 'lost-reply') {
          await page.getByRole('button', { name: 'Check saved settings', exact: true }).click();
          await page.getByText('Your settings are saved and applied here.', { exact: true }).waitFor();
          assert.equal((await mutations(page)).length, 1);
        } else {
          await page.getByRole('button', { name: 'Retry exact settings save', exact: true }).click();
          await page.getByText('Your settings are saved and applied here.', { exact: true }).waitFor();
          assert.deepEqual((await mutations(page))[1].input, original);
        }
      } else if (scenario === 'capacity') {
        await page.getByRole('button', { name: 'Help details', exact: true }).click();
        await page.getByRole('button', { name: 'Review capacity', exact: true }).click();
        await page.getByRole('textbox', { name: 'Plugin slots', exact: true }).fill('6');
        await capture(page, `${theme}-${device}-capacity`);
        assert.deepEqual(await mutations(page), []);
        await page.getByRole('button', { name: 'Save help settings', exact: true }).click();
        await page.getByText('Your settings are saved and applied here.', { exact: true }).waitFor();
        assert.deepEqual((await mutations(page))[0].input.change.capacity, { slots: 6, generalHeadroom: 1 });
        assert.ok(Object.values((await mutations(page))[0].input.change.requested).every(v => !v));
      } else if (scenario === 'stale') {
        await page.getByRole('button', { name: 'Set up project mates', exact: true }).click();
        await page.evaluate(async () => { window.review.features.revision++; await window.review.cache.invalidateQueries({ queryKey: ['firstmate', 'feature-settings'] }); });
        await page.getByText(/Settings changed while this review was open/).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Save help settings', exact: true }).isDisabled(), true);
        await capture(page, `${theme}-${device}-stale`); assert.deepEqual(await mutations(page), []);
      } else {
        await capture(page, `${theme}-${device}-${scenario}`);
        assert.equal(await page.getByRole('button', { name: 'Set up project mates', exact: true }).isDisabled(), true);
        assert.deepEqual(await mutations(page), []);
      }
      assert.deepEqual(errors, []); await page.close();
    }
    for (const scenario of ['project', 'off-review', 'capacity']) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(`${origin}/?${new URLSearchParams({ stage: 'after', theme, home: 'upgraded', features: 'on', case: scenario })}`, { waitUntil: 'networkidle' });
      if (scenario === 'capacity') {
        await page.getByRole('button', { name: 'Help details', exact: true }).click();
        await page.getByRole('button', { name: 'Review capacity', exact: true }).click();
      } else await page.getByRole('button', { name: scenario === 'project' ? 'Set up project mates' : 'Turn off project mates', exact: true }).click();
      await checkControls(page, true); await capture(page, `${theme}-${device}-${scenario}-text200`);
      assert.deepEqual(await mutations(page), []); await page.close();
    }
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ passed: true, baseline, captures: results.length, results }, null, 2));
  console.log(JSON.stringify({ passed: true, captures: results.length, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
