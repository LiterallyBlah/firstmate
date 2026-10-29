/** Review P2: production settings navigation, pinned before, D8 and read-only retries. */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/smooth-pr10/delayed'), baseline = 'de4dac1';
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
await mkdir(out, { recursive: true });
for (const stage of ['before','after']) await build({ entryPoints: [resolve(here, 'delayed-panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true, jsx: 'automatic', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'delayed-fixture', setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, 'stubs.jsx') }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
  b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
  if (stage === 'before') b.onLoad({ filter: /routine-check-setup[.]tsx$/ }, () => ({ contents: execFileSync('git', ['show', `${baseline}:client/routine-check-setup.tsx`], { cwd: root, encoding: 'utf8' }), loader: 'tsx' }));
} }] });
const server = createServer(async (req,res) => { const stage = req.url.includes('before') ? 'before' : 'after';
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/html');
  res.end(req.url.endsWith('.js') ? await readFile(resolve(out, stage + '.js')) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px;min-width:44px}:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true }), results = [];
try {
  for (const stage of ['before','after']) for (const theme of ['light','dark']) for (const [device,width,height] of [['desktop',1440,1000],['phone',390,844]]) {
    const page = await browser.newPage({ viewport: { width,height } }), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
    await page.goto(`http://127.0.0.1:${server.address().port}/?` + new URLSearchParams({ stage,theme,case:'pilot',home:'upgraded',features:'on','delay-routine':'' }), { waitUntil: 'networkidle' });
    await page.getByRole('button', { name:'Review routine checks',exact:true }).click();
    const dialog = page.getByRole('dialog', { name:'Set up routine checks',exact:true });
    const pendingReads = await page.evaluate(() => window.review.calls.filter(c => c.name === 'firstmate.maintenance.read').length);
    for (const [elapsed,advance] of [[1,1000],[8,7000],[30,22000]]) {
      if (elapsed === 30) { await dialog.getByRole('button', { name:'Back to settings',exact:true }).click(); await page.clock.fastForward(advance); await page.getByRole('button', { name:'Review routine checks',exact:true }).click(); }
      else await page.clock.fastForward(advance);
      const state = await page.evaluate(() => ({ text: document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,calls:window.review.calls }));
      assert.deepEqual(errors, []); assert.equal(state.overflow,false); assert.doesNotMatch(state.text,/Can't connect/);
      assert.equal(await dialog.getByRole('button', { name:'Review checks profile',exact:true }).count(),0,'creation remains unavailable');
      if (stage === 'after' && elapsed >= 8) assert.match(state.text,/taking a little longer/);
      if (stage === 'before' || elapsed === 1) assert.match(state.text,/Loading routine checks/);
      if (stage === 'after' && elapsed === 30) {
        assert.equal(await dialog.getByRole('button', { name:'Try again',exact:true }).isEnabled(),true,'reopening inherits original deadline');
        await dialog.getByRole('button', { name:'Try again',exact:true }).click();
        await dialog.getByRole('button', { name:'Try again',exact:true }).click();
        assert.equal(await page.evaluate(() => window.review.calls.filter(c => c.name==='firstmate.maintenance.read').length),pendingReads,'retry coalesces');
        await dialog.getByRole('button', { name:'Connection details',exact:true }).click();
        await dialog.getByText(/Checking again only reads status/).waitFor();
      }
      const key = `${stage}-${theme}-${device}-${elapsed}s`; await page.screenshot({ path:resolve(out,key+'.png') }); results.push({ key,...state });
    }
    await page.evaluate(() => window.review.pendingRoutineReads.forEach(reject => reject(new Error('Synthetic connection failure'))));
    if (stage === 'after') await dialog.getByText("Can't connect to FirstMate right now. Try again.",{exact:true}).waitFor();
    else await dialog.getByText(/Can't check routine checks right now/).waitFor();
    await page.screenshot({ path:resolve(out,`${stage}-${theme}-${device}-failure.png`) });
    assert.equal(await page.evaluate(() => window.review.calls.filter(c=>/admit-ui|attach|provision|[.]set$|[.]admin$/.test(c.name)).length),0,'no effects');
    console.log(`${stage}-${theme}-${device}`); await page.close();
  }
  for (const theme of ['light','dark']) for (const device of ['desktop','phone']) {
    const width = device==='desktop'?600:390, page=await browser.newPage({viewport:{width:width*2+48,height:1000}}), rows=[];
    for (const phase of ['1s','8s','30s','failure']) {
      const images = await Promise.all(['before','after'].map(async stage=>`<figure><figcaption>${stage==='before'?'Before · de4dac1':'After · shared ReadProgress'}</figcaption><img src="data:image/png;base64,${(await readFile(resolve(out,`${stage}-${theme}-${device}-${phase}.png`))).toString('base64')}"></figure>`));
      rows.push(`<h2>${phase}${phase==='30s'?' · closed at8s, reopened at30s; retry coalesced':''}</h2><div class="pair">${images.join('')}</div>`);
    }
    await page.setContent(`<style>body{margin:16px;background:${theme==='light'?'#eef2ef':'#151a17'};color:${theme==='light'?'#16241b':'#f1f3f1'};font:14px system-ui}.pair{display:flex;gap:16px}figure{margin:0;width:${width}px}img{display:block;width:100%}h2{font-size:16px}</style><h1>Routine checks · D8 review fix · ${theme} · ${device}</h1><p>Real SettingsScreen, synthetic pending/rejected status reads. No model/session effects.</p>${rows.join('')}`);
    await page.screenshot({path:resolve(out,`${theme}-${device}-comparison.png`),fullPage:true}); await page.close();
  }
  await writeFile(resolve(out,'results.json'),JSON.stringify({passed:true,baseline,captures:32,results},null,2)); console.log(JSON.stringify({passed:true,captures:32,out}));
} finally { await browser.close(); await new Promise(done=>server.close(done)); }
