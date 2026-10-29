/** Pinned real components, synthetic host. No production home/model/session effects. */
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/smooth-pr10/ui'), baseline = '9c3485e8';
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
await mkdir(resolve(out, 'screenshots'), { recursive: true });
for (const stage of ['before', 'after']) await build({ entryPoints: [resolve(here, 'panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true, jsx: 'automatic', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'slice10-fixture', setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, 'stubs.jsx') }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
  b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
  if (stage === 'before') b.onLoad({ filter: /(help-settings|maintenance-ownership|feature-settings-model)[.]tsx?$/ }, a => ({ contents: execFileSync('git', ['show', `${baseline}:${relative(root, a.path).replaceAll('\\', '/')}`], { cwd: root, encoding: 'utf8' }), loader: 'tsx' }));
} }] });
assert.doesNotMatch(await readFile(resolve(out, 'before.js'), 'utf8'), /function RoutineCheckSetup/, 'before bundle must use the pinned settings flow');
const server = createServer(async (req, res) => { const stage = req.url.includes('before') ? 'before' : 'after';
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/html');
  res.end(req.url.endsWith('.js') ? await readFile(resolve(out, stage + '.js')) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px;min-width:44px}:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--disable-gpu'] }), results = [];
const base = `http://127.0.0.1:${server.address().port}`;
async function state(page) { return page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > innerWidth, calls: window.review.calls })); }
try {
  for (const stage of ['before','after']) for (const theme of ['light','dark']) for (const [device,width,height] of [['desktop',1440,1000],['phone',390,844]]) for (const name of ['settings','opt-in','routine','profile','saved','inventory','advanced','introduction']) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = []; page.on('pageerror', e => errors.push(e.message));
    const scenario = ['routine','profile','inventory','advanced'].includes(name) ? 'pilot' : name === 'saved' ? 'saved' : 'default';
    const surface = ['advanced','introduction'].includes(name) ? name : 'settings';
    await page.goto(base + '/?' + new URLSearchParams({ stage, theme, case: scenario, surface, home: 'upgraded', features: 'on' }), { waitUntil: 'networkidle' });
    if (!['settings','advanced','introduction'].includes(name)) {
      await page.getByRole('button', { name: stage === 'before' ? 'Review routine checks' : 'Set up routine checks', exact: true }).click();
      if (stage === 'after' && name === 'opt-in') await page.getByRole('button', { name: 'Review routine-check opt-in', exact: true }).click();
      if (stage === 'after' && name === 'profile') await page.getByRole('button', { name: 'Review checks profile', exact: true }).click();
      if (stage === 'after' && name === 'saved') {
        await page.getByText('Storage checks · Setup needs review', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Review saved setup for Storage checks', exact: true }).click();
      }
      if (stage === 'after' && name === 'inventory') {
        await page.getByRole('button', { name: 'Details', exact: true }).click();
        await page.getByText(/Storage probe · disabled/).waitFor();
      }
    }
    const next = await state(page), key = `${stage}-${theme}-${device}-${name}`;
    assert.deepEqual(errors, [], key); assert.equal(next.overflow, false, key);
    assert.equal(next.calls.filter(c => /admit-ui|attach|provision|\.set$|\.admin$/.test(c.name)).length, 0, key + ': preview has effects');
    if (stage === 'after' && name === 'advanced') assert.doesNotMatch(next.text, /Create maintenance owner/);
    if (stage === 'after' && name === 'inventory') assert.match(next.text, /Storage probe · disabled/);
    if (stage === 'after' && name === 'profile') assert.match(next.text, /Automatic cleanup is unavailable/);
    await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') }); results.push({ key, ...next });
    if (stage === 'after' && name === 'introduction') {
      await page.getByRole('button', { name: 'Not now', exact: true }).click();
      await page.getByTestId('project-introduction').waitFor({ state: 'detached' });
      assert.equal((await state(page)).calls.filter(c => c.name === 'firstmate.introduction.dismiss').length, 1);
    }
    if (stage === 'after' && device === 'phone' && ['routine','profile','inventory','introduction'].includes(name)) {
      await page.evaluate(() => { const nodes = [...document.querySelectorAll('*')].filter(el => [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())); const sizes = nodes.map(el => ({ el, size: parseFloat(getComputedStyle(el).fontSize), line: parseFloat(getComputedStyle(el).lineHeight) })); for (const { el,size,line } of sizes) { el.style.fontSize = `${size*2}px`; if (Number.isFinite(line)) el.style.lineHeight = `${line*2}px`; } });
      assert.equal((await state(page)).overflow, false, key + ': text200');
      await page.screenshot({ path: resolve(out, 'screenshots', key + '-text200.png') });
    }
    console.log(key); await page.close();
  }
  // All ordinary destinations remain unchanged: update/fresh, off/on/UI-only, both widths/themes.
  for (const theme of ['light','dark']) for (const [device,width,height] of [['desktop',1440,1000],['phone',390,844]]) for (const home of ['fresh','upgraded']) for (const features of ['off','on','ui-only']) for (const surface of ['home','plans','discussion','needs','board']) {
    const page = await browser.newPage({ viewport: { width,height } }), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/?' + new URLSearchParams({ stage: 'after', theme, home, features, surface, case: features === 'on' ? 'pilot' : 'default' }), { waitUntil: 'networkidle' });
    const next = await state(page), key = `${theme}-${device}-${home}-${features}-${surface}`;
    assert.deepEqual(errors, [], key); assert.equal(next.overflow, false, key); assert.doesNotMatch(next.text, /A mate for each project/, 'production introduction stays dark');
    assert.equal(next.calls.filter(c => /admit-ui|attach|provision|\.set$|\.admin$/.test(c.name)).length, 0, key + ': navigation effects');
    results.push({ key, ...next }); await page.close();
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ passed: true, baseline, captures: 64, checks: results.length, results }, null, 2));
  console.log(JSON.stringify({ passed: true, captures: 64, checks: results.length, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
