/** Label actual before/after component captures for review. */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), out = resolve(root, 'docs/smooth-pr7/evidence');
const local = createRequire(resolve(root, 'docs/board-list/package.json')), { chromium } = local('playwright');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--disable-gpu'] });
try {
  for (const theme of ['light', 'dark']) for (const device of ['desktop', 'phone']) {
    const width = device === 'phone' ? 390 : 720, page = await browser.newPage({ viewport: { width: width * 2 + 36, height: 1 } });
    let html = `<style>body{margin:0;padding:12px;font:16px system-ui;background:${theme === 'light' ? '#eef2ef' : '#121613'};color:${theme === 'light' ? '#16241b' : '#eef2ef'}}main{display:grid;grid-template-columns:repeat(2,${width}px);gap:12px}figure{margin:0}figcaption{font-weight:600;padding:8px 0}img{display:block;width:${width}px}</style><main>`;
    for (const [key, title] of [['before', 'Before · individual setup only'], ['normal-choose', 'After · explicit select-all'], ['normal-review', 'After · aggregate review and actual permissions'], ['normal-result', 'After · independent results'], ['capacity-review', 'After · all six kept selected, room for three'], ['uncertain-result', 'After · successful sibling and uncertain opening']]) {
      const png = await readFile(resolve(root, '.local/smooth-pr7/ui/screenshots', `${theme}-${device}-${key}.png`));
      html += `<figure><figcaption>${title}</figcaption><img src="data:image/png;base64,${png.toString('base64')}"></figure>`;
    }
    await page.setContent(html + '</main>'); await page.screenshot({ path: resolve(out, `${theme}-${device}.png`), fullPage: true }); await page.close();
  }
  const results = JSON.parse(await readFile(resolve(root, '.local/smooth-pr7/ui/results.json'), 'utf8'));
  await writeFile(resolve(out, 'verification.json'), JSON.stringify({ passed: results.passed, baseline: results.baseline, captures: results.captures, cases: results.results.map(r => r.key) }, null, 2) + '\n');
} finally { await browser.close(); }
