/** Actual before/current setup components. No live plugin or home mutations. */
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/smooth-pr7/ui');
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright'), baseline = '0e720c2ff6af45e071920ea089baf3cfdfeb6a9c';
await mkdir(resolve(out, 'screenshots'), { recursive: true });
for (const stage of ['before', 'after']) await build({ entryPoints: [resolve(root, 'docs/smooth-pr6/panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true,
  jsx: 'automatic', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'batch-fixture', setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, 'stubs.jsx') }));
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
    b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
    if (stage === 'before') b.onLoad({ filter: /[\\/]client[\\/]project-setup\.tsx$/ }, a => ({
      contents: execFileSync('git', ['show', `${baseline}:${relative(root, a.path).replaceAll('\\', '/')}`], { cwd: root, encoding: 'utf8' }), loader: 'tsx',
    }));
  } }] });
const server = createServer(async (req, res) => {
  const stage = req.url.includes('before') ? 'before' : 'after';
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/html');
  res.end(req.url.endsWith('.js') ? await readFile(resolve(out, stage + '.js')) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px;min-width:44px}:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--disable-gpu'] }), results = [];
const button = (p, name) => p.getByRole('button', { name, exact: true });
async function capture(page, key) {
  const state = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > innerWidth, calls: window.review.calls }));
  assert.equal(state.overflow, false, key + ': overflow');
  await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') }); results.push({ key, ...state });
}
async function controls(page) {
  const list = page.getByTestId('project-setup').locator('button,[role="button"],[role="checkbox"],input,textarea');
  for (let i = 0; i < await list.count(); i++) {
    const item = list.nth(i); await item.scrollIntoViewIfNeeded();
    const r = await item.evaluate(el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, label: el.getAttribute('aria-label') || el.innerText, left: r.left, right: r.right }; });
    assert.ok(r.w >= 43.5 && r.h >= 43.5, JSON.stringify(r)); assert.ok(r.left >= -1 && r.right <= page.viewportSize().width + 1, JSON.stringify(r));
  }
}
try {
  for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    for (const stage of ['before', 'after']) for (const scenario of stage === 'before' ? ['normal'] : ['normal', 'capacity', 'uncertain', 'lost', 'text200']) {
      const page = await browser.newPage({ viewport: { width, height } }), errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000);
      await page.goto(`${origin}/?${new URLSearchParams({ stage, theme, home: 'upgraded', features: 'on', case: 'pilot', batch: scenario })}`, { waitUntil: 'networkidle' });
      await button(page, 'Set up project mates').click();
      if (stage === 'before') { await capture(page, `${theme}-${device}-before`); await page.close(); continue; }
      assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 0);
      assert.equal(await button(page, 'Review 0 selected projects').isDisabled(), true);
      const checkbox = page.getByRole('checkbox').first(); await checkbox.focus(); await checkbox.press('Space');
      await button(page, 'Review 1 selected project').waitFor();
      assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 1);
      await checkbox.press('Space'); await button(page, 'Review 0 selected projects').waitFor();
      await button(page, 'Select all eligible projects').click();
      const n = scenario === 'capacity' ? 6 : 2;
      await button(page, `Review ${n} selected projects`).waitFor();
      assert.equal(await page.getByRole('checkbox', { checked: true }).count(), n, JSON.stringify(await page.getByRole('checkbox').evaluateAll(nodes => nodes.map(n => n.outerHTML))));
      await capture(page, `${theme}-${device}-${scenario}-choose`); await controls(page);
      await button(page, `Review ${n} selected projects`).click();
      await page.getByText(`${n} selected; room for 3.`, { exact: false }).first().waitFor();
      if (scenario === 'text200') await page.evaluate(() => {
        for (const el of [...document.querySelectorAll('*')].filter(el => [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()))) {
          const s = getComputedStyle(el), size = parseFloat(s.fontSize), line = parseFloat(s.lineHeight); el.style.fontSize = `${size * 2}px`; if (Number.isFinite(line)) el.style.lineHeight = `${line * 2}px`;
        }
      });
      await capture(page, `${theme}-${device}-${scenario}-review`); await controls(page);
      assert.equal(await page.evaluate(() => window.review.calls.some(c => c.name === 'firstmate.projects.batch.commit')), false);
      if (scenario === 'capacity') {
        assert.equal(await button(page, 'Create 6 project mates').count(), 0);
        await button(page, 'Review capacity').click(); await page.getByRole('textbox', { name: 'Plugin slots', exact: true }).waitFor();
        await capture(page, `${theme}-${device}-capacity-settings`);
        assert.equal(await page.evaluate(() => window.review.calls.some(c => c.name === 'firstmate.features.set')), false);
        await button(page, 'Cancel').click(); await button(page, 'Back to selected projects').click();
        await button(page, 'Choose fewer projects or review settings').click(); assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 6);
      } else {
        await button(page, 'Create 2 project mates').click(); await page.getByText('Project mate setup · 2 projects', { exact: true }).waitFor();
        if (scenario === 'uncertain') assert.equal(await page.getByText('FirstMate · Checking whether setup finished', { exact: true }).count(), 1);
        await capture(page, `${theme}-${device}-${scenario}-result`); await controls(page);
        await button(page, 'Check saved setup').first().click();
        assert.equal(await page.evaluate(() => window.review.opened), undefined);
        assert.equal(await page.evaluate(() => window.review.calls.filter(c => c.name === 'firstmate.projects.batch.commit').length), 1);
        assert.equal(await page.evaluate(() => window.review.calls.some(c => c.name === 'firstmate.projects.batch.continue')), false);
        assert.equal(await button(page, 'Continue saved batch').count(), 0);
      }
      await button(page, 'Close setup').click(); assert.equal(await button(page, 'Set up project mates').evaluate(el => el === document.activeElement), true);
      assert.deepEqual(errors, []); await page.close();
    }
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ passed: true, baseline, captures: results.length, results }, null, 2));
  console.log(JSON.stringify({ passed: true, captures: results.length, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
