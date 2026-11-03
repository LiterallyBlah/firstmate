/** Supervisor cleanup slice 2: the real Home chat before/after, synthetic read/send host, no live resources. */
import { createRequire } from 'node:module';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/supervisor-cleanup/s2'), baseline = '45f0488';
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
// Modules this slice deleted exist only at the baseline.
const removed = { 'conversation-list': 'ts', 'conversation-context': 'ts', 'conversation-switcher': 'tsx', 'mate-mentions': 'tsx', 'work-details': 'tsx', 'project-ownership': 'tsx', 'project-readiness': 'ts' };
await mkdir(resolve(out, 'screenshots'), { recursive: true });
for (const stage of ['before', 'after']) await build({ entryPoints: [resolve(here, 'panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true, jsx: 'automatic', logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated-host', setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(root, 'docs/smooth-pr11/stubs.jsx') }));
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
    b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
    if (stage === 'before') {
      b.onResolve({ filter: new RegExp(`^\\./(${Object.keys(removed).join('|')})$`) }, a => ({ path: resolve(a.resolveDir, `${a.path}.${removed[a.path.slice(2)]}`) }));
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
const results = [], scenarios = ['home', 'switcher', 'mention', 'scoped'];
const mutations = calls => calls.filter(c => /\.(discuss|answer|ask|activate|act|commit|resume)$|attach|provision/.test(c.name));
try {
  for (const stage of ['before', 'after']) for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [], key = `${stage}-${theme}-${device}-${scenario}`;
    page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/?stage=${stage}&theme=${theme}&home=upgraded&features=on&configured&case=${scenario}`, { waitUntil: 'networkidle' });
    const input = page.getByRole('textbox', { name: 'Message the first mate', exact: true });
    await input.waitFor(); await page.getByText('Can you help me get the reader update ready?', { exact: true }).waitFor();
    const switcher = page.getByRole('button', { name: /^Conversations: FirstMate/ });
    if (stage === 'before') await switcher.waitFor();
    if (scenario === 'switcher' && stage === 'before') { await switcher.click(); await page.getByRole('button', { name: /^Ariadne mate, / }).waitFor(); }
    if (scenario === 'mention') { await input.fill('@'); if (stage === 'before') await page.getByTestId('mate-mentions').waitFor(); }
    if (scenario === 'scoped') {
      await page.evaluate(() => window.review.openScope(window.review.ariadne));
      await page.getByRole('textbox', { name: 'Message recipient', exact: true }).waitFor();
    }
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > innerWidth, calls: window.review.calls }));
    assert.deepEqual(errors, [], key); assert.equal(state.overflow, false, key); assert.equal(mutations(state.calls).length, 0, key);
    if (stage === 'before') {
      assert.ok(await switcher.count() > 0 || scenario === 'scoped', key + ': baseline reproduces the switcher');
      if (['switcher', 'mention'].includes(scenario)) assert.match(state.text, /Ariadne mate/, key);
    }
    if (stage === 'after') {
      assert.equal(await page.getByTestId('conversation-switcher').count(), 0, key);
      assert.equal(await page.getByTestId('mate-mentions').count(), 0, key);
      assert.equal(await switcher.count(), 0, key);
      if (scenario === 'scoped') assert.match(state.text, /Back to FirstMate/, key);
      else {
        assert.doesNotMatch(state.text, /Ariadne mate|Starpath mate|Reader pass helper|No project mates yet/, key);
        assert.equal(state.calls.filter(c => c.name === 'firstmate.scope.conversation').length, 0, key + ': Home polls no bound history');
      }
    }
    await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') }); results.push({ key, errors, overflow: state.overflow, calls: state.calls.map(c => c.name) });
    await page.close();
  }
  // Checked sends after the change: @ prose goes to FirstMate as written; the explicit route still reaches its owner and returns.
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000);
    await page.goto(`${origin}/?stage=after&theme=light&home=upgraded&features=on&configured&case=interaction`, { waitUntil: 'networkidle' });
    const input = page.getByRole('textbox', { name: 'Message the first mate', exact: true }); await input.waitFor();
    await input.pressSequentially('@ariadne check chapter three please');
    assert.equal(await page.getByTestId('mate-mentions').count(), 0);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.review.calls.some(c => /\.(ask|discuss)$/.test(c.name)));
    let sends = mutations(await page.evaluate(() => window.review.calls));
    assert.deepEqual(sends.map(c => [c.name, c.input.text]), [['firstmate.mate.ask', '@ariadne check chapter three please']]);
    await page.evaluate(() => window.review.openScope(window.review.ariadne));
    const scoped = page.getByRole('textbox', { name: 'Message recipient', exact: true }); await scoped.waitFor();
    await scoped.fill('Explicit route still works');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.review.calls.some(c => c.name === 'firstmate.scope.discuss'));
    sends = mutations(await page.evaluate(() => window.review.calls));
    assert.equal(sends.at(-1).input.route.target.scopeId, await page.evaluate(() => window.review.ariadne));
    await page.getByRole('button', { name: 'Back to FirstMate', exact: true }).click(); await input.waitFor();
    assert.equal(await page.getByTestId('conversation-switcher').count(), 0);
    assert.deepEqual(errors, []); results.push({ key: `interaction-${width}`, checkedSend: true, explicitRoute: true }); await page.close();
  }
  for (const theme of ['light', 'dark']) for (const device of ['desktop', 'phone']) {
    const width = device === 'phone' ? 300 : 620, sheet = await browser.newPage({ viewport: { width: width * 4 + 60, height: 900 }, deviceScaleFactor: 1 }), rows = [];
    for (const stage of ['before', 'after']) {
      const cells = [];
      for (const scenario of scenarios) cells.push(`<figure><figcaption>${stage.toUpperCase()} · ${scenario}</figcaption><img width="${width}" src="data:image/png;base64,${(await readFile(resolve(out, 'screenshots', `${stage}-${theme}-${device}-${scenario}.png`))).toString('base64')}"></figure>`);
      rows.push(`<main>${cells.join('')}</main>`);
    }
    await sheet.setContent(`<style>body{margin:12px;font:14px system-ui;background:#ddd;color:#111}h1{margin:0 0 10px;font-size:18px}figure{margin:0}figcaption{font-size:13px;margin:4px 0}main{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}img{display:block}</style><h1>Supervisor cleanup slice 2 · ${theme} ${device} · actual Home chat · before ${baseline} / after · synthetic host</h1>${rows.join('')}`);
    await sheet.screenshot({ path: resolve(out, `${theme}-${device}.png`), fullPage: true }); await sheet.close();
  }
  const captures = results.filter(r => !r.checkedSend).length;
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ passed: true, baseline, captures, results }, null, 2));
  console.log(JSON.stringify({ passed: true, captures, interactions: 2, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
