import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
export async function contactSheets(browser, out, { baseline = '0e720c2', groups = [['', ['mentions', 'switcher', 'scoped']], ['-states', ['choice', 'empty', 'error', 'paused']]] } = {}) {
  for (const [group, scenarios] of groups) {
    for (const theme of ['light', 'dark']) for (const device of ['desktop', 'phone']) {
      const width = device === 'phone' ? 380 : 780;
      const sheet = await browser.newPage({ viewport: { width: width * 2 + 40, height: 1000 }, deviceScaleFactor: 1 });
      const cells = [];
      for (const scenario of scenarios) for (const stage of ['before', 'after']) {
        const key = `${stage}-${theme}-${device}-${scenario}`, bytes = await readFile(resolve(out, 'screenshots', key + '.png'));
        cells.push(`<section><h2>${stage.toUpperCase()} · ${scenario}</h2><img width="${width}" src="data:image/png;base64,${bytes.toString('base64')}"></section>`);
      }
      await sheet.setContent(`<style>body{margin:12px;font:14px system-ui;background:#ddd;color:#111}h1{margin:0 0 12px;font-size:20px}h2{font-size:14px;margin:6px 0}main{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}img{display:block}</style><h1>Slice 11 · ${theme} ${device} · actual Home components · before ${baseline} / after · synthetic host</h1><main>${cells.join('')}</main>`);
      await sheet.screenshot({ path: resolve(out, `${theme}-${device}${group}.png`), fullPage: true }); await sheet.close();
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const local = createRequire(resolve(root, 'docs/board-list/package.json')), { chromium } = local('playwright');
  const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
  try { await contactSheets(browser, resolve(root, '.local/smooth-pr11/ui')); } finally { await browser.close(); }
}
