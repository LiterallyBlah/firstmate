/** Supervisor cleanup slice 5: Settings' Help switches before, one Supervisors setting after. Synthetic read-only host. */
import { createRequire } from 'node:module';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { removedAtBaseline } from './removed-at-baseline.mjs';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/supervisor-cleanup/s5'), baseline = 'b619103';
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
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
      removedAtBaseline(b, root, baseline);
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
// on: the owner's daemon, every FIRSTMATE_* switch set. off: a fresh home, nothing saved.
const results = [], scenarios = [['on', 'settings'], ['off', 'review'], ['on', 'details']];
const writes = calls => calls.filter(c => /\.set$|act-ui|admit-ui|provision|attach|recover-ui|abort-ui|\.commit$|\.folder$|\.admin$|\.ask$|\.discuss$/.test(c.name));
try {
  for (const stage of ['before', 'after']) for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) for (const [features, scenario] of scenarios) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [], key = `${stage}-${theme}-${device}-${scenario}`;
    page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/?stage=${stage}&theme=${theme}&home=upgraded&features=${features}&surface=settings`, { waitUntil: 'networkidle' });
    const help = page.getByTestId('help-settings'); await help.waitFor();
    if (scenario === 'settings') await help.evaluate(el => el.scrollIntoView({ block: 'start' }));
    else if (scenario === 'review') {
      await page.getByRole('button', { name: stage === 'before' ? 'Review project help' : 'Turn on Supervisors', exact: true }).click();
      await page.getByText('This save creates no session', { exact: false }).first().waitFor();
    } else {
      await page.getByRole('button', { name: 'Help details', exact: true }).click();
      await page.getByText(/^Source: /).evaluate(el => el.scrollIntoView({ block: 'center' }));
    }
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > innerWidth, calls: window.review.calls }));
    assert.deepEqual(errors, [], key); assert.equal(state.overflow, false, key); assert.deepEqual(writes(state.calls), [], key + ': browsing and opening a review make no write');
    if (stage === 'after') {
      assert.doesNotMatch(state.text, /Project mates|project mates|Plan help|Review project help|Review plan help|Keep existing setup/, key);
      if (scenario === 'settings') { assert.match(state.text, /Using the daemon's environment switches/, key); assert.match(state.text, /Save Supervisors setting/, key); assert.match(state.text, /Turn off Supervisors/, key); }
      if (scenario === 'review') for (const fence of ['Project Supervisors', 'Plan execution', 'Routine checks']) assert.match(state.text, new RegExp(`${fence}: off → on`), key);
      if (scenario === 'details') assert.match(state.text, /A saved Supervisors setting replaces the daemon's environment switches/, key);
    }
    await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') }); results.push({ key, errors, calls: state.calls.map(c => c.name) });
    await page.close();
  }
  for (const theme of ['light', 'dark']) for (const device of ['desktop', 'phone']) {
    const width = device === 'phone' ? 300 : 620, sheet = await browser.newPage({ viewport: { width: width * 3 + 48, height: 900 }, deviceScaleFactor: 1 }), rows = [];
    for (const stage of ['before', 'after']) {
      const cells = [];
      for (const [, scenario] of scenarios) cells.push(`<figure><figcaption>${stage.toUpperCase()} · ${scenario}</figcaption><img width="${width}" src="data:image/png;base64,${(await readFile(resolve(out, 'screenshots', `${stage}-${theme}-${device}-${scenario}.png`))).toString('base64')}"></figure>`);
      rows.push(`<main>${cells.join('')}</main>`);
    }
    await sheet.setContent(`<style>body{margin:12px;font:14px system-ui;background:#ddd;color:#111}h1{margin:0 0 10px;font-size:18px}figure{margin:0}figcaption{font-size:13px;margin:4px 0}main{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}img{display:block}</style><h1>Supervisor cleanup slice 5 · ${theme} ${device} · Help switches → one Supervisors setting · before ${baseline} / after · synthetic host</h1>${rows.join('')}`);
    await sheet.screenshot({ path: resolve(out, `${theme}-${device}.png`), fullPage: true }); await sheet.close();
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ passed: true, baseline, captures: results.length, results }, null, 2));
  console.log(JSON.stringify({ passed: true, captures: results.length, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
