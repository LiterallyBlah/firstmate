/** Supervisor cleanup slice 3: Work details before, Supervisors after, on the real Home and Settings. Synthetic read-only host. */
import { createRequire } from 'node:module';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/supervisor-cleanup/s3'), baseline = 'bbf29e7';
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
// Modules this slice removed or renamed exist only at the baseline.
const removed = { 'work-details': 'tsx', 'project-ownership': 'tsx', 'project-readiness': 'ts' };
await mkdir(resolve(out, 'screenshots'), { recursive: true });
for (const stage of ['before', 'after']) await build({ entryPoints: [resolve(root, 'docs/smooth-pr2/panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true, jsx: 'automatic', logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'read-only-host', setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, 'supervisors-stubs.jsx') }));
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
    b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
    if (stage === 'before') {
      b.onResolve({ filter: /^\.\/(work-details|project-ownership|project-readiness)$/ }, a => ({ path: resolve(a.resolveDir, `${a.path}.${removed[a.path.slice(2)]}`) }));
      b.onLoad({ filter: /[\\/](client|shared)[\\/][^\\/]+\.tsx?$/ }, args => {
        const path = relative(root, args.path).replaceAll('\\', '/');
        return { contents: execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' }), loader: path.endsWith('tsx') ? 'tsx' : 'ts' };
      });
    }
  } }] });
const server = createServer(async (req, res) => {
  const stage = req.url.includes('before') ? 'before' : 'after', script = req.url.endsWith('.js');
  res.setHeader('Content-Type', script ? 'application/javascript' : 'text/html');
  res.end(script ? await readFile(resolve(out, stage + '.js')) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}:focus-visible{outline:2px solid #348b72;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--disable-gpu'] });
const results = [], scenarios = ['home', 'open', 'projects', 'settings'];
const effects = calls => calls.filter(c => /act-ui|admit-ui|provision|attach|recover-ui|\.set$|\.admin$|\.ask$|\.discuss$/.test(c.name));
const label = { before: 'Work details', after: 'Supervisors' }, section = { before: 'Project mates and plans', after: 'Projects' };
const legacy = /Project mates|Create \w+ mate|Set up a mate|Mate active|ready to create|Work details/;
try {
  for (const stage of ['before', 'after']) for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [], key = `${stage}-${theme}-${device}-${scenario}`;
    page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/?stage=${stage}&theme=${theme}&home=upgraded&features=on${scenario === 'settings' ? '&surface=settings' : ''}`, { waitUntil: 'networkidle' });
    if (scenario === 'settings') {
      await page.getByText(stage === 'before' ? 'Advanced work details' : 'Supervisors', { exact: true }).first().waitFor();
      await page.locator('h2', { hasText: stage === 'before' ? 'Work details' : 'Supervisors' }).evaluate(el => el.scrollIntoView({ block: 'center' }));
    }
    else {
      const entry = page.getByRole('button', { name: label[stage], exact: true });
      await entry.waitFor();
      if (scenario !== 'home') {
        await entry.click();
        await page.getByRole('button', { name: section[stage], exact: true }).waitFor();
        if (scenario === 'projects') {
          const header = page.getByRole('button', { name: section[stage], exact: true });
          await header.click(); await header.evaluate(el => el.scrollIntoView({ block: 'start' }));
        }
      }
    }
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > innerWidth, calls: window.review.calls }));
    assert.deepEqual(errors, [], key); assert.equal(state.overflow, false, key); assert.deepEqual(effects(state.calls), [], key + ': opening or browsing has no effect');
    if (stage === 'before' && scenario === 'open') assert.match(state.text, /Project mates/, key + ': baseline reproduces the symptom');
    if (stage === 'before' && scenario === 'projects') assert.match(state.text, /Mate active/, key);
    if (stage === 'after') {
      // Settings' Help switches still say "Project mates"; slice 5 renames them. This slice renames only its Work details group.
      assert.doesNotMatch(state.text, scenario === 'settings' ? /Work details/ : legacy, key);
      if (scenario === 'open') {
        assert.equal(await page.getByTestId('supervisor-row').count(), 2, key);
        assert.match(state.text, /Ariadne\s+Project · Active/, key); assert.match(state.text, /Used 1 of 1 session · 1 of 8 turns/, key);
        assert.equal(await page.getByRole('button', { name: 'Supervisor settings', exact: true }).count(), 2, key);
        assert.ok(state.calls.some(c => c.name === 'firstmate.supervisors.read'), key);
      }
      if (scenario === 'projects') assert.match(state.text, /Starpath\s+Admitted/, key);
    }
    await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') }); results.push({ key, errors, calls: state.calls.map(c => c.name) });
    await page.close();
  }
  // The header keeps one row with the renamed entry at the narrow desktop widths smooth-pr6 checked.
  for (const theme of ['light', 'dark']) for (const width of [638, 900]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }), key = `after-${theme}-narrow-${width}`;
    await page.goto(`${origin}/?stage=after&theme=${theme}&home=upgraded&features=on&narrow`, { waitUntil: 'networkidle' });
    const header = page.locator('#firstmate-home-header');
    await header.getByRole('button', { name: 'Supervisors', exact: true }).waitFor();
    assert.ok((await header.boundingBox()).height < 65, key + ': header keeps its single row');
    let right = 0;
    for (const control of await header.getByRole('button').all()) { const box = await control.boundingBox(); assert.ok(box.x >= right && box.x + box.width <= width, key + ': header controls fit'); right = box.x + box.width; }
    await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') }); results.push({ key, narrow: true }); await page.close();
  }
  for (const theme of ['light', 'dark']) for (const device of ['desktop', 'phone']) {
    const width = device === 'phone' ? 300 : 620, sheet = await browser.newPage({ viewport: { width: width * 4 + 60, height: 900 }, deviceScaleFactor: 1 }), rows = [];
    for (const stage of ['before', 'after']) {
      const cells = [];
      for (const scenario of scenarios) cells.push(`<figure><figcaption>${stage.toUpperCase()} · ${scenario}</figcaption><img width="${width}" src="data:image/png;base64,${(await readFile(resolve(out, 'screenshots', `${stage}-${theme}-${device}-${scenario}.png`))).toString('base64')}"></figure>`);
      rows.push(`<main>${cells.join('')}</main>`);
    }
    await sheet.setContent(`<style>body{margin:12px;font:14px system-ui;background:#ddd;color:#111}h1{margin:0 0 10px;font-size:18px}figure{margin:0}figcaption{font-size:13px;margin:4px 0}main{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}img{display:block}</style><h1>Supervisor cleanup slice 3 · ${theme} ${device} · Work details → Supervisors · before ${baseline} / after · synthetic host</h1>${rows.join('')}`);
    await sheet.screenshot({ path: resolve(out, `${theme}-${device}.png`), fullPage: true }); await sheet.close();
  }
  const captures = results.length;
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ passed: true, baseline, captures, results }, null, 2));
  console.log(JSON.stringify({ passed: true, captures, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
