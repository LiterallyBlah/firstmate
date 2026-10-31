/** Real composers + durable queue; independent native status drives readiness.
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
const baseline = 'e8a1c0810805b9e05c85cce20d275f52c14917d9';
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
    const value = { sent: [], turn: 0, enabled: true, active: 'initial', block: null };
    value.createQueue = () => new ChatQueue(resolve(out, id + '.json'), { enabled: async () => value.enabled, activity: async () => value.active ? 'busy' : 'ready', deliver: async (payload, messageId) => {
      value.sent.push({ payload, messageId });
      value.active = 'turn-' + ++value.turn; // Native reservation, with no started hook.
      if (value.block) { value.block.started(); await value.block.wait; }
    } }); value.queue = value.createQueue(); sessions.set(id, value);
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
        case 'end': {
          const turn = input.turn ?? s.active;
          if (turn === s.active) s.active = null;
          await s.queue.ended(input.agent, turn, true); result = s.sent; break;
        }
        case 'idle': s.active = null; await s.queue.reconcile(input.agent); result = s.sent; break;
        case 'poll': await s.queue.reconcile(input.agent); result = s.sent; break;
        case 'restart': {
          let started, finish;
          const began = new Promise(resolve => { started = resolve; });
          s.block = { started, wait: new Promise(resolve => { finish = resolve; }) };
          s.active = null;
          const pending = s.queue.reconcile(input.agent);
          await began; // Claim is durable, but the native reply has not returned.
          s.queue = s.createQueue(); await s.queue.recover();
          finish(); await pending; s.block = null; // Late reply must not restore the row.
          result = s.sent; break;
        }
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
  for (const stage of ['before', 'after']) for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844], ['small-phone', 320, 640], ['short-phone', 390, 480], ['short-pane', 390, 468]]) for (const scope of [false, true]) {
    if (stage === 'before' && ['small-phone', 'short-phone', 'short-pane'].includes(device)) continue;
    // Extra Home stress for the hosted header wrap; project keeps both reviewed short sizes.
    if (device === 'short-pane' && scope) continue;
    const key = `${stage}-${theme}-${device}-${scope ? 'project' : 'home'}`;
    const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
    if (selectedCase && selectedCase !== key) continue;
    const page = await browser.newPage({ viewport: { width, height } }), errors = [], id = randomUUID();
    page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000);
    const url = `${origin}/?stage=${stage}&theme=${theme}&home=upgraded&features=on&configured&session=${id}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    if (scope) await page.evaluate(() => window.review.openScope(window.review.scope.scopes.find(s => s.kind === 'project').id));
    const input = page.getByRole('textbox', { name: scope ? 'Message recipient' : 'Message the first mate', exact: true }); await input.waitFor();
    const rpc = (name, data) => page.evaluate(async ({ name, data }) => (await fetch('/rpc/' + name + location.search, { method: 'POST', body: JSON.stringify(data) })).json(), { name, data });
    const send = page.getByRole('button', { name: 'Send', exact: true });
    const bounds = async () => ({ input: await input.boundingBox(), send: await send.boundingBox() });
    const empty = await bounds(), composerY = empty.input.y;
    const withinViewport = async () => {
      for (const [name, control] of [['input', input], ['Send', send]]) {
        const box = await control.boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= height + 1, `${key}: ${name} must fit the viewport: ${JSON.stringify(box)}`);
      }
    };
    const stableComposer = async () => {
      // Include delayed RN Web onLayout/measurement work, not just the admission render.
      await page.waitForTimeout(200);
      const box = await input.boundingBox();
      assert.ok(Math.abs(box.y - composerY) < 1, `queue changes must not move the input: ${JSON.stringify({ stage, theme, device, scope, composerY, box })}`);
      await withinViewport();
    };
    if (stage === 'after') await withinViewport();
    {
      for (const text of ['Check the reader update.', 'Then review the tests.', 'Send me the result when ready.']) {
        await input.fill(text); await page.getByRole('button', { name: 'Send', exact: true }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(e => e.value === ''));
        if (stage === 'after') await stableComposer();
      }
      await page.getByText('3 queued · Sent one at a time', { exact: true }).waitFor();
      assert.equal((await rpc('sent', {})).length, 0);
    }
    const visibleQueue = page.getByTestId('chat-queue').filter({ visible: true });
    const composerContext = page.getByTestId(scope ? 'scope-composer-context' : 'chat-composer-context');
    if (stage === 'after') {
      const queueBox = await composerContext.boundingBox(), inputBox = await input.boundingBox();
      assert.ok(queueBox.y + queueBox.height <= inputBox.y, 'queue must appear before the composer');
      assert.ok(queueBox.height >= 44, 'the bounded context/queue viewport must fit a compact action');
      // Short panes share their upper viewport with context and toolbar controls.
      // Scroll it to inspect queued rows without scrolling the input or Send.
      await composerContext.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await stableComposer();
      assert.ok(await input.evaluate(el => !!(document.querySelector('[data-testid="chat-queue"]')?.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)), 'DOM and visual order must agree');
      assert.equal(await page.getByRole('button', { name: 'Send now', exact: true }).filter({ visible: true }).count(), 3, 'only per-item Send now controls');
      assert.equal(await visibleQueue.getByRole('button', { name: 'Send now', exact: true }).count(), 3);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.doesNotMatch(await page.locator('body').innerText(), /Updating…|as of \d/);
    await page.screenshot({ path: resolve(out, 'screenshots', key + '.png') });
    const three = await bounds();
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
      assert.equal((await rpc('poll', { agent })).length, 1);
      assert.equal((await rpc('idle', { agent })).length, 2); // Completed native turn, no lifecycle hooks.
      assert.equal((await rpc('poll', { agent })).length, 2);
      await input.fill('Keep this message after a restart.'); await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByText('1 queued · Sent one at a time', { exact: true }).waitFor();
      assert.equal((await rpc('restart', { agent })).length, 3);
      await page.reload({ waitUntil: 'networkidle' });
      if (scope) await page.evaluate(() => window.review.openScope(window.review.scope.scopes.find(s => s.kind === 'project').id));
      const saved = page.getByTestId('chat-queue').filter({ visible: true });
      await saved.getByText('Saved messages', { exact: true }).waitFor();
      await saved.getByText(/Delivery couldn't be confirmed/).waitFor();
      assert.equal(await saved.getByRole('button', { name: 'Edit', exact: true }).count(), 0);
      await page.screenshot({ path: resolve(out, 'screenshots', key.replace('after-', 'recovery-') + '.png') });
      await saved.getByRole('button', { name: 'Remove', exact: true }).click();
      await saved.getByText('Saved messages', { exact: true }).waitFor({ state: 'hidden' });
      assert.equal((await rpc('poll', { agent })).length, 3);
      await input.fill('Send this queued item now.'); await page.getByRole('button', { name: 'Send', exact: true }).click();
      await saved.getByText('1 queued · Sent one at a time', { exact: true }).waitFor();
      await saved.getByRole('button', { name: 'Send now', exact: true }).click();
      await page.waitForFunction(async () => (await (await fetch('/rpc/sent' + location.search, { method: 'POST', body: '{}' })).json()).length === 4);
      await saved.getByText('1 queued · Sent one at a time', { exact: true }).waitFor({ state: 'hidden' });
      assert.equal((await rpc('sent', {})).at(-1).payload.kind, scope ? 'scope' : 'mate');
      await stableComposer();
      assert.equal(await page.getByRole('button', { name: 'Send now', exact: true }).filter({ visible: true }).count(), 0);
      for (let i = 1; i <= 10; i++) {
        await input.fill(`Message ${i}`); await send.click();
        await saved.getByText(`${i} queued · Sent one at a time`, { exact: true }).waitFor();
        await stableComposer();
      }
      const queueScroll = saved.getByTestId('chat-queue-scroll');
      const scroll = await queueScroll.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
      assert.ok(scroll.content > scroll.height && scroll.height <= 224, 'large queues must scroll inside their height allowance');
      await queueScroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await composerContext.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await saved.getByRole('button', { name: 'Send now', exact: true }).last().focus();
      await stableComposer();
      const actionBox = await saved.getByRole('button', { name: 'Send now', exact: true }).last().boundingBox();
      const visibleBox = await composerContext.boundingBox();
      assert.ok(actionBox.y >= visibleBox.y - 1 && actionBox.y + actionBox.height <= visibleBox.y + visibleBox.height + 1, `a focused queue action must fit inside the scroll viewport: ${JSON.stringify({ key, actionBox, visibleBox })}`);
      await page.screenshot({ path: resolve(out, 'screenshots', key.replace('after-', 'large-') + '.png') });
      const ten = await bounds();
      await page.keyboard.press('Enter');
      await saved.getByText('9 queued · Sent one at a time', { exact: true }).waitFor();
      const delivered = (await rpc('sent', {})).at(-1).payload;
      assert.equal(scope ? delivered.input.addressedText : delivered.message.text, 'Message 10');
      for (let i = 9; i > 0; i--) {
        await saved.getByRole('button', { name: 'Remove', exact: true }).first().focus();
        await page.keyboard.press('Space');
        await saved.getByText(`${i} queued · Sent one at a time`, { exact: true }).waitFor({ state: 'hidden' });
        await stableComposer();
      }
      results.push({ key, viewport: { width, height }, empty, three, ten, emptied: await bounds(), scroll, queueBeforeComposer: true, stableComposer: true, inputAndSendVisible: true, largeQueueScrollable: true, keyboardItemActions: true, noStandaloneSendNow: true, perItemSendNow: true, reload: true, edit: true, remove: true, onePerTurn: true, duplicateBlocked: true, missingHooks: true, interruptedDeliveryRemovable: true });
    } else results.push({ key, viewport: { width, height }, empty, three });
    assert.deepEqual(errors, [], key); await page.close();
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`${results.length} before/after cases; both composers: stable queue-before-input layout, no standalone Send now, per-item Send now, reload, edit, remove and delivery recovery passed.`);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
