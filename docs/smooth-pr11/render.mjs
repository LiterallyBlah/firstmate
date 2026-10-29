/** Real Home/chat before/current, synthetic read/send host, no live resources. */
import { createRequire } from 'node:module';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { contactSheets } from './contact-sheets.mjs';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/smooth-pr11/ui'), baseline = '0e720c2';
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
await mkdir(resolve(out, 'screenshots'), { recursive: true });
for (const stage of ['before', 'after']) await build({ entryPoints: [resolve(here, 'panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true, jsx: 'automatic', logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated-host', setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, 'stubs.jsx') }));
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
    b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
    if (stage === 'before') b.onLoad({ filter: /[\\/](client|shared)[\\/][^\\/]+\.tsx?$/ }, args => {
      const path = relative(root, args.path).replaceAll('\\', '/');
      return { contents: execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' }), loader: path.endsWith('tsx') ? 'tsx' : 'ts' };
    });
  } }] });
const server = createServer(async (req, res) => {
  const stage = req.url.includes('before') ? 'before' : 'after', script = req.url.endsWith('.js');
  res.setHeader('Content-Type', script ? 'application/javascript' : 'text/html');
  res.end(script ? await readFile(resolve(out, stage + '.js')) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}:focus-visible{outline:2px solid #348b72;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--disable-gpu'] });
const results = [], captures = [];
const interactionOnly = process.argv.includes('--interactions-only');
const mutations = calls => calls.filter(c => /\.(discuss|answer|ask|activate|act|commit|resume)$|attach|provision/.test(c.name));
try {
  for (const stage of interactionOnly ? [] : ['before', 'after']) for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    for (const scenario of ['home', 'mentions', 'choice', 'switcher', 'scoped', 'empty', 'error', 'paused']) {
      const page = await browser.newPage({ viewport: { width, height } }), errors = [];
      page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${origin}/?stage=${stage}&theme=${theme}&home=upgraded&features=on&configured&case=${scenario}`, { waitUntil: 'networkidle' });
      const input = page.getByRole('textbox', { name: 'Message the first mate', exact: true });
      await input.waitFor();
      await page.getByText('Can you help me get the reader update ready?', { exact: true }).waitFor();
      if (['mentions', 'choice', 'empty', 'error', 'paused'].includes(scenario)) await input.fill('@');
      if (stage === 'after' && ['choice', 'paused'].includes(scenario)) await page.getByRole('button', { name: 'Reader project mate. Project: Reader project', exact: true }).click();
      if (stage === 'after' && scenario === 'switcher') await page.getByRole('button', { name: /^Conversations: FirstMate/ }).click();
      if (scenario === 'scoped') await page.evaluate(() => window.review.openScope(window.review.scope.scopes.find(s => s.kind === 'project').id));
      if (stage === 'after' && scenario === 'empty') await page.getByRole('button', { name: 'No project mates yet. Set one up', exact: true }).waitFor();
      const state = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > innerWidth, calls: window.review.calls }));
      assert.deepEqual(errors, [], `${stage}/${theme}/${device}/${scenario}`); assert.equal(state.overflow, false); assert.equal(mutations(state.calls).length, 0);
      if (stage === 'after') {
        assert.doesNotMatch(state.text, /Updating…|as of \d\d:/);
        if (scenario === 'mentions') { assert.match(state.text, /Reader project mate/); assert.match(state.text, /Reader pass helper/); assert.doesNotMatch(state.text, /New trial helper/); }
        if (scenario === 'error') { assert.match(state.text, /Conversations couldn't be checked/); assert.doesNotMatch(state.text, /No project mates yet/); }
        if (scenario === 'switcher') assert.match(state.text, /1 unread/);
        if (['mentions', 'choice', 'empty', 'error', 'paused'].includes(scenario)) for (const button of await page.getByTestId('mate-mentions').getByRole('button').all()) {
          if (await button.isVisible()) assert.ok((await button.boundingBox()).height >= 44);
        }
      }
      const key = `${stage}-${theme}-${device}-${scenario}`; await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') }); captures.push(key); results.push({ key, errors, ...state });
      await page.close();
    }
  }
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000);
    await page.goto(`${origin}/?stage=after&theme=light&home=upgraded&features=on&configured&long&case=interaction`, { waitUntil: 'networkidle' });
    const input = page.getByRole('textbox', { name: 'Message the first mate', exact: true }), transcript = page.getByTestId('firstmate-transcript');
    await input.fill('Explain the next step @reader');
    await page.getByRole('button', { name: 'Reader project mate. Project: Reader project', exact: true }).click();
    await page.getByRole('button', { name: 'Message Reader project mate', exact: true }).click();
    const scoped = page.getByRole('textbox', { name: 'Message recipient', exact: true }); await scoped.waitFor();
    assert.equal(await scoped.inputValue(), 'Explain the next step');
    assert.equal(await scoped.evaluate(el => el === document.activeElement), true);
    assert.equal((await page.evaluate(() => window.review.calls)).filter(c => c.name === 'firstmate.scope.discuss').length, 0);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => window.review.calls.some(c => c.name === 'firstmate.scope.discuss'));
    assert.equal(await page.evaluate(() => window.review.calls.find(c => c.name === 'firstmate.scope.discuss').input.route.target.agentId), 'project-session');
    await page.getByRole('button', { name: 'Back to FirstMate', exact: true }).click(); await input.waitFor();
    assert.equal(await input.inputValue(), 'Explain the next step @reader');
    assert.equal(await input.evaluate(el => el === document.activeElement), true);
    await page.evaluate(() => window.review.attach()); await page.getByText('reader-notes.txt', { exact: true }).waitFor();
    await input.fill('@reader'); await page.getByRole('button', { name: 'Reader project mate. Project: Reader project', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Message Reader project mate', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Open Reader project mate conversation', exact: true }).click(); await scoped.waitFor();
    await page.getByRole('button', { name: 'Back to FirstMate', exact: true }).click(); await input.waitFor();
    assert.equal(await page.getByText('reader-notes.txt', { exact: true }).count(), 1);
    await input.fill('@'); await input.press('ArrowDown'); await input.press('Enter');
    await page.getByRole('button', { name: 'Message Reader project mate', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel mention', exact: true }).click();
    assert.equal(await input.evaluate(el => el === document.activeElement), true);
    await input.fill('@r'); await input.press('Escape'); assert.equal(await page.getByTestId('mate-mentions').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    assert.equal((await page.evaluate(() => window.review.calls)).some(c => c.name === 'firstmate.mate.ask'), false);
    const trigger = page.getByRole('button', { name: /^Conversations: FirstMate/ }); await trigger.click();
    await page.getByRole('button', { name: 'Reader pass helper, 1 unread', exact: true }).click(); await scoped.waitFor();
    await page.getByRole('button', { name: /^Conversations: Reader pass helper/ }).click();
    await page.getByRole('button', { name: 'Reader pass helper, 0 unread', exact: true }).waitFor();
    await page.getByRole('button', { name: 'FirstMate, 0 unread', exact: true }).click(); await input.waitFor();
    await trigger.click(); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('button', { name: 'Close conversations', exact: true }).count(), 0);
    await input.fill('Keep this position');
    await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
    await page.getByText('Earlier reader message 1', { exact: true }).waitFor({ state: 'attached' });
    await transcript.evaluate(el => { el.scrollTop = 225; el.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(150); const position = await transcript.evaluate(el => el.scrollTop);
    await trigger.click(); await page.getByRole('button', { name: 'Reader project mate, 0 unread', exact: true }).click(); await scoped.waitFor();
    await page.getByRole('button', { name: 'Back to FirstMate', exact: true }).click(); await input.waitFor();
    assert.ok(Math.abs(await transcript.evaluate(el => el.scrollTop) - position) < 3, 'reading position retained');
    assert.equal(await input.inputValue(), 'Keep this position');
    assert.equal(await page.getByText('Earlier reader message 1', { exact: true }).count(), 1);
    assert.deepEqual(errors, []); results.push({ key: `interaction-${width}`, checkedSend: true, generalPreserved: true, attachmentsPreserved: true, keyboard: true, unread: true }); await page.close();
  }
  if (!interactionOnly) await contactSheets(browser, out);
  await writeFile(resolve(out, interactionOnly ? 'interaction-results.json' : 'results.json'), JSON.stringify({ passed: true, baseline, captures, results }, null, 2));
  console.log(JSON.stringify({ passed: true, captures: captures.length, interactions: 2, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
