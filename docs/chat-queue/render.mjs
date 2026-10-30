/** Real composers + durable queue; a synthetic agent provides turn boundaries.
 * All state, bundles, before-source copies and PNGs remain in .local/chat-queue.
 */
import { createRequire } from 'node:module';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/chat-queue/ui');
const baseline = '2c1b1ed96c73385ce72293e06aaf97b2a93a99ac';
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
await mkdir(resolve(out, 'screenshots'), { recursive: true });
await build({ entryPoints: [resolve(root, 'server/chat-queue.ts')], outfile: resolve(out, 'engine.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
const { ChatQueue } = repo(resolve(out, 'engine.cjs'));
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
const sessions = new Map();
function session(id) {
  if (!sessions.has(id)) {
    const value = { sent: [], turn: 0, enabled: true };
    value.queue = new ChatQueue(resolve(out, id + '.json'), { enabled: async () => value.enabled, activity: async () => 'busy', deliver: async (payload, messageId) => {
      value.sent.push({ payload, messageId });
      const agent = payload.kind === 'mate' ? payload.agentId : payload.input.route.target.agentId;
      await value.queue.started(agent, 'turn-' + ++value.turn);
    } }); sessions.set(id, value);
  }
  return sessions.get(id);
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/rpc/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString() || '{}'), s = session(url.searchParams.get('session'));
      let result;
      switch (url.pathname.slice(5)) {
        case 'firstmate.chat.queue': result = await s.queue.snapshot(input.target); break;
        case 'firstmate.chat.submit': result = await s.queue.submit(input.id, input.payload, input.now, input.replaces); break;
        case 'firstmate.chat.queue.change': result = await s.queue.change(input.target, input.id, input.action); break;
        case 'end': await s.queue.ended(input.agent, input.turn ?? (s.turn ? 'turn-' + s.turn : 'initial'), true); result = s.sent; break;
        case 'sent': result = s.sent; break;
        case 'setting': s.enabled = input.enabled; result = {}; break;
        default: throw Error('Unknown fixture RPC');
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
    }
    const stage = url.pathname.includes('before') || url.searchParams.get('stage') === 'before' ? 'before' : 'after';
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/html');
    res.end(url.pathname.endsWith('.js') ? await readFile(resolve(out, stage + '.js')) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}:focus-visible{outline:2px solid #348b72;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const results = [];
try {
  for (const stage of ['before', 'after']) for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) for (const scope of [false, true]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [], id = randomUUID();
    page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000);
    const url = `${origin}/?stage=${stage}&theme=${theme}&home=upgraded&features=on&configured&session=${id}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    if (scope) await page.evaluate(() => window.review.openScope(window.review.scope.scopes.find(s => s.kind === 'project').id));
    const input = page.getByRole('textbox', { name: scope ? 'Message recipient' : 'Message the first mate', exact: true }); await input.waitFor();
    const rpc = (name, data) => page.evaluate(async ({ name, data }) => (await fetch('/rpc/' + name + location.search, { method: 'POST', body: JSON.stringify(data) })).json(), { name, data });
    if (stage === 'after') {
      for (const text of ['Check the reader update.', 'Then review the tests.', 'Send me the result when ready.']) { await input.fill(text); await page.getByRole('button', { name: 'Send', exact: true }).click(); await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(e => e.value === '')); }
      await page.getByText('3 queued · Sent one at a time', { exact: true }).waitFor();
      assert.equal((await rpc('sent', {})).length, 0);
    } else await input.fill('Check the reader update.');
    const key = `${stage}-${theme}-${device}-${scope ? 'project' : 'home'}`;
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.doesNotMatch(await page.locator('body').innerText(), /Updating…|as of \d/);
    await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') });
    if (stage === 'after') {
      await page.reload({ waitUntil: 'networkidle' });
      if (scope) await page.evaluate(() => window.review.openScope(window.review.scope.scopes.find(s => s.kind === 'project').id));
      await page.getByText('3 queued · Sent one at a time', { exact: true }).waitFor();
      await page.getByTestId('chat-queue').filter({ visible: true }).getByRole('button', { name: 'Edit', exact: true }).first().click();
      await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(e => e.value === 'Check the reader update.'));
      await input.fill('Check the updated reader notes.'); await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByText('3 queued · Sent one at a time', { exact: true }).waitFor();
      await page.getByTestId('chat-queue').filter({ visible: true }).getByRole('button', { name: 'Remove', exact: true }).first().click();
      await page.getByText('2 queued · Sent one at a time', { exact: true }).waitFor();
      const agent = scope ? await page.evaluate(() => window.review.scope.scopes.find(s => s.kind === 'project').target.agentId) : 'first-mate';
      assert.equal((await rpc('end', { agent, turn: 'initial' })).length, 1);
      assert.equal((await rpc('end', { agent, turn: 'initial' })).length, 1);
      assert.equal((await rpc('end', { agent })).length, 2);
      results.push({ key, reload: true, edit: true, remove: true, onePerTurn: true, duplicateBlocked: true });
    } else results.push({ key });
    assert.deepEqual(errors, [], key); await page.close();
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log('16 before/after screenshots; both composers: durable reload, edit, remove, one-per-turn and duplicate callback checks passed.');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
