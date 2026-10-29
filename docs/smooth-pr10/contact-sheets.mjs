/** Compose the saved real-component evidence; no product or fixture mutations. */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), out = resolve(root, '.local/smooth-pr10/ui');
const local = createRequire(resolve(root, 'docs/board-list/package.json')), { chromium } = local('playwright');
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
const screens = ['settings','opt-in','routine','profile','saved','inventory','advanced','introduction'];
const img = async name => `data:image/png;base64,${(await readFile(resolve(out, 'screenshots', name + '.png'))).toString('base64')}`;
try {
  for (const theme of ['light','dark']) for (const device of ['desktop','phone']) {
    const width = device === 'desktop' ? 600 : 390, page = await browser.newPage({ viewport: { width: width*2+48, height: 1000 } }), rows = [];
    for (const name of screens) rows.push(`<h2>${name}${name === 'introduction' ? ' · prepared component; production gate is closed' : ''}</h2><div class="pair"><figure><figcaption>Before · 9c3485e8</figcaption><img src="${await img(`before-${theme}-${device}-${name}`)}"></figure><figure><figcaption>After · slice 10</figcaption><img src="${await img(`after-${theme}-${device}-${name}`)}"></figure></div>`);
    await page.setContent(`<style>body{margin:16px;background:${theme === 'light' ? '#eef2ef' : '#151a17'};color:${theme === 'light' ? '#16241b' : '#f1f3f1'};font:14px system-ui}.pair{display:flex;gap:16px}figure{margin:0;width:${width}px}img{display:block;width:100%}h1{font-size:20px}h2{font-size:16px;margin:24px 0 8px}figcaption{margin-bottom:8px}</style><h1>FirstMate slice 10 · ${theme} · ${device}</h1><p>Actual components, synthetic host. Before left; after right. Introduction is prepared and remains hidden in production until the shared project setup path is usable.</p>${rows.join('')}`);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-comparison.png`), fullPage: true }); await page.close();
  }
} finally { await browser.close(); }
console.log('Four screenshot comparisons written to ' + out);
