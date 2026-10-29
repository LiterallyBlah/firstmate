/** Actual Home and Work details, before installed fbdf3ae0 / after this branch. No live writes. */
import { createRequire } from 'node:module';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/smooth-pr6/live-ui');
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright'), baseline = 'fbdf3ae0';
await mkdir(resolve(out, 'screenshots'), { recursive: true });
for (const stage of ['before', 'after']) await build({ entryPoints: [resolve(root, 'docs/smooth-pr2/panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true, jsx: 'automatic', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'read-only-host', setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, 'live-stubs.jsx') }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
  b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
  if (stage === 'before') b.onLoad({ filter: /[\\/]client[\\/](fleet|work-details|project-ownership)\.tsx$/ }, a => ({ contents: execFileSync('git', ['show', `${baseline}:${relative(root, a.path).replaceAll('\\', '/')}`], { cwd: root, encoding: 'utf8' }), loader: 'tsx' }));
} }] });
const server = createServer(async (req, res) => {
  const stage = req.url.includes('before') ? 'before' : 'after';
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/html');
  res.end(req.url.endsWith('.js') ? await readFile(resolve(out, stage + '.js')) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, results = [];
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--disable-gpu'] });
try {
  for (const stage of ['before', 'after']) for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000);
    await page.goto(`${origin}/?stage=${stage}&theme=${theme}&home=upgraded&features=on&surface=home`, { waitUntil: 'networkidle' });
    const capture = async name => {
      const key = `${theme}-${device}-${name}-${stage}`, text = await page.locator('body').innerText();
      assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, key + ' overflow');
      assert.equal(await page.evaluate(() => window.review.calls.filter(c => /attach-ui|provision-ui|recover-ui|abort-ui|\.commit$|\.resume$|\.preview$|\.migrate$|admit-ui|\.discuss$|\.answer$/.test(c.name)).length), 0, key + ' native effects');
      await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') }); results.push({ key, text });
    };
    const entry = page.getByTestId('work-details-entry'); await entry.waitFor();
    const entryBox = await entry.boundingBox(), chat = await page.getByTestId('firstmate-transcript').boundingBox();
    if (stage === 'after') {
      assert.ok(entryBox.width < 200, 'compact header entry'); assert.ok(entryBox.y < 150, 'entry is in header');
      assert.equal(await page.locator('#firstmate-home-header').getByTestId('work-details-entry').count(), 1);
      assert.doesNotMatch(await page.locator('body').innerText(), /couldn't be checked|before continuing|Refreshing|Updating/);
    } else assert.ok(entryBox.width > width * .9, 'baseline reproduces bottom strip');
    results.push({ key: `${theme}-${device}-geometry-${stage}`, entryBox, chat });
    await capture('home');
    await page.getByRole('tab', { name: 'Board', exact: true }).click();
    const board = await page.getByTestId('firstmate-task-board').boundingBox();
    results.at(-2).board = board;
    await capture('board');
    await page.getByRole('tab', { name: device === 'phone' ? 'First mate' : 'List', exact: true }).click();
    await page.getByRole('button', { name: 'Work details', exact: true }).click();
    if (stage === 'after') {
      await page.getByRole('button', { name: 'Project mates and plans', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Project mates and plans', exact: true }).getAttribute('aria-expanded'), 'false');
      assert.match(await page.locator('body').innerText(), /4 ready to create.*1 ready to set up.*2 on another machine/);
      assert.doesNotMatch(await page.locator('body').innerText(), /Stored state:|older-60|Ariadne archived plan|Refreshing|Updating/);
    } else {
      await page.getByRole('button', { name: 'Project mates and plans', exact: true }).click();
      const text = await page.locator('body').innerText();
      assert.match(text, /Plan older-60 has unresolved project or host membership/);
      assert.match(text, /Stored state: admitted/);
    }
    await capture('details');
    if (stage === 'after') await page.getByRole('button', { name: 'Project mates and plans', exact: true }).click();
    await capture('projects');
    if (stage === 'after') {
      let text = await page.locator('body').innerText(); assert.doesNotMatch(text, /Stored state:|older-60|Ariadne archived plan|need review/);
      assert.match(text, /Some older plans aren't linked to a project. No action needed./);
      assert.equal(await page.getByRole('button', { name: 'Create Ariadne mate', exact: true }).isEnabled(), true);
      await page.getByRole('button', { name: 'Create Ariadne mate', exact: true }).click();
      await page.getByRole('button', { name: 'Create project mate', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Show Ariadne details', exact: true }).click();
      text = await page.locator('body').innerText(); assert.match(text, /Stored state: admitted/); assert.doesNotMatch(text, /Ariadne archived plan/);
      await capture('project-details');
      await page.getByRole('button', { name: 'Ariadne plans: 28', exact: true }).click();
      assert.match(await page.locator('body').innerText(), /Ariadne archived plan 28/);
      await capture('plans');
      await page.getByRole('button', { name: 'Set up a mate for paseo', exact: true }).click();
      await page.getByRole('dialog', { name: 'paseo setup', exact: true }).waitFor();
      await capture('setup');
    }
    console.log(`${theme}/${device}/${stage}`); await page.close();
  }
  for (const theme of ['light', 'dark']) for (const device of ['desktop', 'phone']) {
    const before = results.find(r => r.key === `${theme}-${device}-geometry-before`), after = results.find(r => r.key === `${theme}-${device}-geometry-after`);
    assert.ok(after.chat.height > before.chat.height, 'chat gains the removed strip height');
    assert.ok(after.board.height > before.board.height, 'board gains the removed strip height');
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ passed: true, baseline, captures: results.filter(r => r.text).length, results }, null, 2));
  console.log(JSON.stringify({ passed: true, captures: results.filter(r => r.text).length, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
