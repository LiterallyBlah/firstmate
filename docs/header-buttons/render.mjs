/** Home's header controls before (190b510) and after: every button's size, and the header strip, on a synthetic read-only host. */
import { createRequire } from 'node:module';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { removedAtBaseline } from '../supervisor-cleanup/removed-at-baseline.mjs';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..'), out = resolve(root, '.local/header-buttons'), baseline = '190b510';
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
await mkdir(resolve(out, 'screenshots'), { recursive: true });
for (const stage of ['before', 'after']) await build({ entryPoints: [resolve(root, 'docs/smooth-pr2/panel.jsx')], outfile: resolve(out, stage + '.js'), bundle: true, jsx: 'automatic', logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'read-only-host', setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(root, 'docs/supervisor-cleanup/supervisors-stubs.jsx') }));
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
const results = [];
try {
  for (const stage of ['before', 'after']) for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 900], ['narrow', 900, 900], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [], key = `${stage}-${theme}-${device}`;
    page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/?stage=${stage}&theme=${theme}&home=upgraded&features=on`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Supervisors', exact: true }).first().waitFor();
    // The owner's case: nine decisions waiting, so Needs you shows its amber signal. The stub serves this object.
    await page.evaluate(() => { window.review.decisions.actionCount = 9; });
    await page.getByRole('button', { name: /^Needs you, 9/ }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(300);
    // Every button in the header band: the strip from the top of Home down to the first row of content.
    const header = await page.evaluate(() => {
      const supervisors = [...document.querySelectorAll('[role="button"]')].find(b => b.getAttribute('aria-label') === 'Supervisors');
      const band = supervisors.getBoundingClientRect(), top = band.top - 60, bottom = band.bottom + (innerWidth < 638 ? 60 : 8);
      return [...document.querySelectorAll('[role="button"],[role="tab"],[role="radio"]')].map(b => ({ b, r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.height > 0 && r.top >= top && r.bottom <= bottom)
        .map(({ b, r }) => ({ label: (b.getAttribute('aria-label') || b.innerText).trim().replace(/\s+/g, ' ').slice(0, 40), top: Math.round(r.top), height: Math.round(r.height * 10) / 10,
          // A segment's control is its framed group (the segmented control), not the segment inside it.
          group: (() => { let e = b.parentElement; for (let n = 0; e && n < 5; n++, e = e.parentElement) { const h = e.getBoundingClientRect().height; if (h > r.height + 1) return Math.round(h * 10) / 10; } return Math.round(r.height * 10) / 10; })(),
          width: Math.round(r.width), radius: getComputedStyle(b).borderTopLeftRadius, font: getComputedStyle(b.querySelector('div[dir], div') ?? b).fontSize }));
    });
    const strip = await page.evaluate(() => { const s = [...document.querySelectorAll('[role="button"]')].find(b => b.getAttribute('aria-label') === 'Supervisors').getBoundingClientRect(); return { y: Math.max(0, s.top - (innerWidth < 638 ? 120 : 40)), h: innerWidth < 638 ? 230 : 90 }; });
    await page.screenshot({ path: resolve(out, 'screenshots', key + '.png'), clip: { x: 0, y: strip.y, width, height: strip.h } });
    const needs = header.find(h => /needs you/i.test(h.label)), supervisors = header.find(h => h.label === 'Supervisors'), more = header.find(h => h.label === 'More');
    const row = { key, errors, needs, supervisors, more, header };
    console.log(key, JSON.stringify({ needs: needs?.height, supervisors: supervisors?.height, more: more?.height, all: header.map(h => `${h.label}:${h.height}/${h.group}`) }));
    assert.deepEqual(errors, [], key); assert.ok(needs && supervisors && more, key + ': the three header buttons render');
    if (stage === 'after') {
      if (device === 'phone') for (const h of [needs, supervisors, more]) assert.ok(h.height >= 43.5, `${key}: ${h.label} keeps its 44-point phone target (${h.height})`);
      else {
        // Desktop: Needs you and Supervisors match More (IconButton), and every other header button is that height too.
        for (const h of header) { const size = h.height < more.height - 1 && Math.abs(h.group - more.height) <= 1 ? h.group : h.height;
          assert.ok(Math.abs(size - more.height) <= 1, `${key}: ${h.label} is ${size}, More is ${more.height}`); }
      }
    }
    results.push(row); await page.close();
  }
  for (const theme of ['light', 'dark']) {
    const sheet = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 }), rows = [];
    for (const device of ['desktop', 'narrow', 'phone']) for (const stage of ['before', 'after'])
      rows.push(`<figure><figcaption>${stage.toUpperCase()} · ${device}</figcaption><img style="max-width:1440px" src="data:image/png;base64,${(await readFile(resolve(out, 'screenshots', `${stage}-${theme}-${device}.png`))).toString('base64')}"></figure>`);
    await sheet.setContent(`<style>body{margin:12px;font:14px system-ui;background:#ddd;color:#111}h1{margin:0 0 10px;font-size:18px}figure{margin:0 0 10px}figcaption{font-size:13px;margin:4px 0}img{display:block;border:1px solid #999}</style><h1>Home header controls · ${theme} · before ${baseline} / after · synthetic host</h1>${rows.join('')}`);
    await sheet.screenshot({ path: resolve(out, `${theme}.png`), fullPage: true }); await sheet.close();
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ passed: true, baseline, captures: results.length, results }, null, 2));
  console.log(JSON.stringify({ passed: true, captures: results.length, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
