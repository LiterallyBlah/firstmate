/** Captain's installed-main drawer reproduction, exact diagnostics, no production effects. */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/smooth-pr10/drawer'), baseline = 'fbdf3ae0';
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
await mkdir(out, { recursive: true });
for (const stage of ['before','after']) await build({ entryPoints: [resolve(here, 'drawer-panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true, jsx: 'automatic', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'drawer-fixture', setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, 'stubs.jsx') }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
  b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
  if (stage === 'before') b.onLoad({ filter: /(maintenance-ownership|feature-settings-model)[.]tsx?$/ }, a => ({ contents: execFileSync('git', ['show', `${baseline}:client/${a.path.replaceAll('\\','/').split('/').at(-1)}`], { cwd: root, encoding: 'utf8' }), loader: 'tsx' }));
} }] });
const server = createServer(async (req,res) => { const stage = req.url.includes('before') ? 'before' : 'after';
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/html');
  res.end(req.url.endsWith('.js') ? await readFile(resolve(out, stage + '.js')) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px;min-width:44px}:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true }), results = [];
try {
  for (const stage of ['before','after']) for (const theme of ['light','dark']) for (const [device,width,height] of [['desktop',1440,1000],['phone',390,844]]) for (const inventory of ['empty','retained']) {
    const page = await browser.newPage({ viewport: { width,height } }), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?` + new URLSearchParams({ stage,theme,case:inventory === 'retained' ? 'saved' : 'default',home:'upgraded',features:'off',empty:'','drawer-diagnostics':'' }), { waitUntil: 'networkidle' });
    await page.getByRole('button', { name:stage === 'before' ? 'Review routine checks' : 'Set up routine checks',exact:true }).waitFor();
    if (inventory === 'empty') { const key = `${stage}-${theme}-${device}-setup`; await page.screenshot({ path:resolve(out,key+'.png') }); results.push({key}); }
    await page.getByRole('button', { name:'Advanced work details',exact:true }).click();
    const dialog = page.getByRole('dialog', { name:'Work details',exact:true }), board = dialog.getByTestId('maintenance-ownership');
    await board.waitFor(); await board.scrollIntoViewIfNeeded();
    if (stage === 'before') { assert.match(await board.innerText(),/G8: automatic cleanup is held/); assert.equal(await board.getByRole('button', { name:'Refresh maintenance',exact:true }).count(),1); }
    else {
      assert.match(await board.innerText(),/Automatic clean-up isn't available yet; routine checks only report problems\./);
      assert.doesNotMatch(await board.innerText(),/G8|realpath|N7|advisory gate|no-follow-delete|live-readers/);
      assert.equal(await board.getByRole('button', { name:'Create maintenance owner',exact:true }).count(),0,'setup remains settings-only');
      assert.equal(await board.getByRole('button', { name:'Refresh routine checks',exact:true }).count(),inventory === 'retained' ? 1 : 0);
      assert.equal(await board.getByRole('button', { name:'Technical details',exact:true }).count(),1);
    }
    const key = `${stage}-${theme}-${device}-${inventory}`;
    await page.screenshot({ path:resolve(out,key+'.png') }); results.push({ key, text:await board.innerText() });
    if (stage === 'after' && inventory === 'empty') {
      const disclosure = board.getByRole('button', { name:'Technical details',exact:true });
      await disclosure.click();
      assert.match(await board.innerText(),/G8: automatic cleanup is held.*realpath: met.*N7: Not acknowledged at the advisory gate/s);
      await board.scrollIntoViewIfNeeded(); await page.screenshot({ path:resolve(out,`after-${theme}-${device}-expanded.png`) }); results.push({ key:`after-${theme}-${device}-expanded`,text:await board.innerText() });
      await disclosure.click(); assert.doesNotMatch(await board.innerText(),/G8|N7/);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth>innerWidth),false);
    const dimensions = await board.evaluate(el => ({ width:el.scrollWidth,client:el.clientWidth })); assert.ok(dimensions.width<=dimensions.client+1,'routine section wraps within the drawer');
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(() => window.review.calls.filter(c=>/admit-ui|attach|provision|[.]set$|[.]admin$/.test(c.name)).length),0,'drawer inspection has no effects');
    await page.close(); console.log(key);
  }
  for (const theme of ['light','dark']) for (const device of ['desktop','phone']) {
    const width = device==='desktop'?600:390, page=await browser.newPage({viewport:{width:width*2+48,height:1000}}), rows=[];
    for (const state of ['setup','empty','expanded','retained']) {
      const images = await Promise.all(['before','after'].map(async stage => {
        const file = `${stage}-${theme}-${device}-${stage==='before' && state==='expanded'?'empty':state}.png`;
        return `<figure><figcaption>${stage==='before'?'Before · installed main fbdf3ae0':'After · plain summary and optional diagnostics'}</figcaption><img src="data:image/png;base64,${(await readFile(resolve(out,file))).toString('base64')}"></figure>`;
      }));
      rows.push(`<h2>${state}</h2><div class="pair">${images.join('')}</div>`);
    }
    await page.setContent(`<style>body{margin:16px;background:${theme==='light'?'#eef2ef':'#151a17'};color:${theme==='light'?'#16241b':'#f1f3f1'};font:14px system-ui}.pair{display:flex;gap:16px}figure{margin:0;width:${width}px}img{display:block;width:100%}h2{font-size:16px}</style><h1>Work details · routine checks · ${theme} · ${device}</h1><p>Actual SettingsScreen and Work details modal. Synthetic data; no live effects.</p>${rows.join('')}`);
    await page.screenshot({path:resolve(out,`${theme}-${device}-comparison.png`),fullPage:true}); await page.close();
  }
  await writeFile(resolve(out,'results.json'),JSON.stringify({passed:true,baseline,captures:28,results},null,2)); console.log(JSON.stringify({passed:true,captures:28,out}));
} finally { await browser.close(); await new Promise(done=>server.close(done)); }
