/** Actual before/current Settings + shared setup destination, synthetic host only. */
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/smooth-pr6/ui');
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright'), baseline = '9c3485e';
// The reviewed 8f05e974 component's blob also belongs to the rebased ancestor; pin content across rebases.
const reviewBaselineBlob = 'e433ca0f0072b4aeba4e86a34030ea0c31a4585c';
await mkdir(resolve(out, 'screenshots'), { recursive: true });
for (const stage of ['before', 'after', 'review-before']) await build({ entryPoints: [resolve(here, 'panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true,
  jsx: 'automatic', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'setup-fixture', setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, 'stubs.jsx') }));
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
    b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
    if (stage === 'before') b.onLoad({ filter: /[\\/]client[\\/](settings-screen|help-settings)\.tsx$/ }, a => ({
      contents: execFileSync('git', ['show', `${baseline}:${relative(root, a.path).replaceAll('\\', '/')}`], { cwd: root, encoding: 'utf8' }), loader: 'tsx',
    }));
    if (stage === 'review-before') b.onLoad({ filter: /[\\/]client[\\/]project-setup\.tsx$/ }, a => ({
      contents: execFileSync('git', ['show', reviewBaselineBlob], { cwd: root, encoding: 'utf8' }), loader: 'tsx',
    }));
  } }] });
const server = createServer(async (req, res) => {
  const stage = req.url.includes('review-before') ? 'review-before' : req.url.includes('before') ? 'before' : 'after';
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/html');
  res.end(req.url.endsWith('.js') ? await readFile(resolve(out, stage + '.js')) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px;min-width:44px}:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--disable-gpu'] }), results = [];
async function capture(page, key) {
  const state = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > innerWidth, calls: window.review.calls }));
  assert.equal(state.overflow, false, key + ': document overflow');
  await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') }); results.push({ key, ...state });
}
async function controls(page, zoom = false) {
  if (zoom) await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')].filter(el => [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()));
    const sizes = nodes.map(el => ({ el, size: parseFloat(getComputedStyle(el).fontSize), line: parseFloat(getComputedStyle(el).lineHeight) }));
    for (const { el, size, line } of sizes) { el.style.fontSize = `${size * 2}px`; if (Number.isFinite(line)) el.style.lineHeight = `${line * 2}px`; }
  });
  const list = page.getByRole('dialog').locator('button,[role="button"],input,textarea');
  for (let i = 0; i < await list.count(); i++) {
    const item = list.nth(i); await item.scrollIntoViewIfNeeded();
    const r = await item.evaluate(el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, label: el.getAttribute('aria-label') || el.innerText, left: r.left, right: r.right }; });
    assert.ok(r.w >= 43.5 && r.h >= 43.5, JSON.stringify(r));
    assert.ok(r.left >= -1 && r.right <= page.viewportSize().width + 1, JSON.stringify(r));
  }
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function picker(page, label, choice) { await page.getByTestId('project-setup').getByRole('button', { name: new RegExp(`^${label}:`) }).click(); await page.getByRole('dialog').last().getByRole('button', { name: choice, exact: true }).click(); }
async function choose(page) {
  await button(page, 'Review Starpath').click();
  await picker(page, 'Model', 'Available project model'); await picker(page, 'Permissions', 'Full access (full-access)');
  await page.getByRole('textbox', { name: 'Total conversation turns', exact: true }).fill('8');
  await page.getByRole('textbox', { name: 'Project agent allocation', exact: true }).fill('3');
  await page.getByRole('textbox', { name: 'Project turn allocation', exact: true }).fill('20');
  await picker(page, 'Recorded instructions', 'project-orders');
}
try {
  for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    for (const stage of ['before', 'after']) {
      const page = await browser.newPage({ viewport: { width, height } }), errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000);
      await page.goto(`${origin}/?${new URLSearchParams({ stage, theme, home: 'upgraded', features: 'on', case: 'pilot' })}`, { waitUntil: 'networkidle' });
      await button(page, 'Set up project mates').click();
      await capture(page, `${theme}-${device}-${stage}`);
      assert.equal(await page.evaluate(() => window.review.calls.some(c => /\.(commit|resume|instructions|folder)$/.test(c.name))), false);
      if (stage === 'after') {
        await controls(page); await choose(page); await capture(page, `${theme}-${device}-profile`);
        await button(page, 'Review Starpath setup').click(); await page.getByText('What starts now:', { exact: false }).waitFor();
        await capture(page, `${theme}-${device}-review`); await controls(page);
        assert.equal(await page.evaluate(() => window.review.calls.some(c => c.name.endsWith('.commit'))), false);
        await button(page, 'Setup details').click(); await capture(page, `${theme}-${device}-details`);
        await button(page, 'Hide setup details').click(); await button(page, 'Create project mate').click();
        await page.getByText('Starpath is ready.', { exact: false }).waitFor(); await capture(page, `${theme}-${device}-result`);
        assert.equal(await page.evaluate(() => window.review.calls.filter(c => c.name.endsWith('.commit')).length), 1);
        await button(page, 'Close setup').click();
        assert.equal(await button(page, 'Set up project mates').evaluate(el => el === document.activeElement), true);
      }
      assert.deepEqual(errors, []); await page.close();
    }
    for (const setup of ['capacity', 'lost-reply', 'uncertain', 'instructions', 'text200']) {
      const page = await browser.newPage({ viewport: { width, height } }), errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000);
      await page.goto(`${origin}/?${new URLSearchParams({ stage: 'after', theme, home: 'upgraded', features: 'on', case: 'pilot', setup })}`, { waitUntil: 'networkidle' });
      await button(page, 'Set up project mates').click(); await choose(page);
      if (setup === 'instructions') {
        await page.getByRole('textbox', { name: 'Project instructions', exact: true }).fill('Keep track of this project and answer my questions. Do not execute plans.');
        await button(page, 'Save project instructions').click(); await page.getByText('Keep track of this project and answer my questions. Do not execute plans.', { exact: true }).waitFor();
      }
      await button(page, 'Review Starpath setup').click();
      if (setup === 'capacity') { await page.getByText(/There isn't confirmed room/).waitFor(); assert.equal(await button(page, 'Create project mate').count(), 0); }
      else if (setup === 'text200') { await controls(page, true); }
      else {
        await button(page, 'Create project mate').click();
        if (setup === 'lost-reply') {
          await page.getByText(/Couldn't confirm setup/).waitFor(); await button(page, 'Check saved setup').click();
          assert.equal(await page.evaluate(() => window.review.calls.filter(c => c.name.endsWith('.commit')).length), 1);
        } else if (setup === 'uncertain') { await page.getByText(/Checking whether setup finished/, { exact: false }).first().waitFor(); assert.equal(await button(page, 'Continue Starpath saved setup').isDisabled(), true); }
      }
      await capture(page, `${theme}-${device}-${setup}`); assert.deepEqual(errors, []); await page.close();
    }
    for (const setup of ['lost-create', 'missing-folder', 'retained-folder']) for (const stage of ['review-before', 'after']) {
      const page = await browser.newPage({ viewport: { width, height } }), errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000);
      await page.goto(`${origin}/?${new URLSearchParams({ stage, theme, home: 'upgraded', features: 'on', case: 'pilot', setup })}`, { waitUntil: 'networkidle' });
      await button(page, 'Set up project mates').click();
      if (setup === 'lost-create') {
        await page.getByText('Starpath · Checking whether setup finished', { exact: true }).waitFor();
        assert.equal(await button(page, 'Continue Starpath saved setup').isDisabled(), stage === 'review-before');
        await button(page, 'Continue Starpath saved setup').scrollIntoViewIfNeeded();
      } else {
        if (stage === 'after') {
          await page.getByText('C:/Projects/Starpath · Original computer', { exact: true }).waitFor();
          assert.equal(await button(page, 'Choose a replacement folder for Starpath').count(), setup === 'missing-folder' ? 1 : 0);
        }
      }
      await capture(page, `${theme}-${device}-${setup}-${stage}`); await controls(page);
      if (stage === 'after' && setup === 'lost-create') {
        await button(page, 'Check saved setup').click();
        assert.equal(await page.evaluate(() => window.review.calls.filter(c => c.name.endsWith('.resume')).length), 0);
        await button(page, 'Continue Starpath saved setup').click(); await page.getByText('Starpath is ready.', { exact: false }).waitFor();
        assert.equal(await page.evaluate(() => window.review.calls.filter(c => c.name.endsWith('.resume')).length), 1);
      }
      if (stage === 'after' && setup === 'missing-folder') {
        await button(page, 'Choose a replacement folder for Starpath').click(); await button(page, 'Review Starpath').waitFor();
        assert.equal(await page.evaluate(() => window.review.calls.some(c => /\.(commit|resume|preview)$/.test(c.name))), false);
      }
      assert.deepEqual(errors, []); await page.close();
    }
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ passed: true, baseline, captures: results.length, results }, null, 2));
  console.log(JSON.stringify({ passed: true, captures: results.length, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
