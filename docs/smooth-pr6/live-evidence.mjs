/** Comparison sheets from actual before/after captures; sanitized registry fixtures only. */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), out = resolve(root, 'docs/smooth-pr6/evidence');
const local = createRequire(resolve(root, 'docs/board-list/package.json')), { chromium } = local('playwright');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--disable-gpu'] });
try {
  for (const theme of ['light', 'dark']) for (const device of ['desktop', 'phone']) {
    const width = device === 'phone' ? 390 : 720, page = await browser.newPage({ viewport: { width: width * 2 + 36, height: 1 } });
    let html = `<style>body{margin:0;padding:12px;font:16px system-ui;background:${theme === 'light' ? '#eef2ef' : '#121613'};color:${theme === 'light' ? '#16241b' : '#eef2ef'}}main{display:grid;grid-template-columns:repeat(2,${width}px);gap:12px}figure{margin:0}figcaption{font-weight:600;padding:8px 0}img{display:block;width:${width}px}</style><main>`;
    for (const [name, title] of [['home-before', 'Before · full-width bottom strip'], ['home-after', 'After · compact header entry'], ['board-before', 'Before · bottom strip reduces board height'], ['board-after', 'After · board uses the full height'], ['details-before', 'Before · expanded warnings and project metadata'], ['details-after', 'After · collapsed summary'], ['projects-after', 'After · compact project rows'], ['project-details-after', 'After · identity details and folded plan count']]) {
      const png = await readFile(resolve(root, '.local/smooth-pr6/live-ui/screenshots', `${theme}-${device}-${name}.png`));
      html += `<figure><figcaption>${title}</figcaption><img src="data:image/png;base64,${png.toString('base64')}"></figure>`;
    }
    await page.setContent(html + '</main>'); await page.screenshot({ path: resolve(out, `live-${theme}-${device}.png`), fullPage: true }); await page.close();
  }
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1312, height: 1 } });
    let html = `<style>body{margin:0;padding:12px;font:16px system-ui;background:${theme === 'light' ? '#eef2ef' : '#121613'};color:${theme === 'light' ? '#16241b' : '#eef2ef'}}main{display:grid;grid-template-columns:repeat(2,638px);gap:12px}figure{margin:0}figcaption{font-weight:600;padding:8px 0}img{display:block;width:638px}</style><main>`;
    for (const width of [638, 900]) for (const stage of ['before', 'after']) {
      const png = await readFile(resolve(root, '.local/smooth-pr6/live-ui/screenshots', `${theme}-narrow-${width}-${stage}.png`));
      html += `<figure><figcaption>${stage === 'before' ? 'Before' : 'After'} · ${width}px desktop header</figcaption><img src="data:image/png;base64,${png.toString('base64')}"></figure>`;
    }
    await page.setContent(html + '</main>'); await page.screenshot({ path: resolve(out, `live-narrow-${theme}.png`), fullPage: true }); await page.close();
  }
  const results = JSON.parse(await readFile(resolve(root, '.local/smooth-pr6/live-ui/results.json'), 'utf8'));
  await writeFile(resolve(out, 'live-verification.json'), JSON.stringify({ passed: results.passed, baseline: results.baseline, captures: results.captures, cases: results.results.map(r => r.key), geometry: results.results.filter(r => r.entryBox) }, null, 2) + '\n');
} finally { await browser.close(); }
