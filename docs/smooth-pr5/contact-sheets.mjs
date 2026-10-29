/** Readable PR comparison images from actual component captures. */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), out = resolve(root, '.local/smooth-pr5/ui');
const evidence = resolve(root, 'docs/smooth-pr5/evidence');
const local = createRequire(resolve(root, 'docs/board-list/package.json')), { chromium } = local('playwright');
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
await mkdir(evidence, { recursive: true });
const data = async name => `data:image/png;base64,${(await readFile(resolve(out, 'screenshots', name + '.png'))).toString('base64')}`;
try {
  for (const theme of ['light', 'dark']) for (const device of ['desktop', 'phone']) {
    const width = device === 'desktop' ? 720 : 390, page = await browser.newPage({ viewport: { width: width * 2 + 48, height: 1000 } });
    const pair = [];
    for (const stage of ['before', 'after']) {
      const name = `${theme}-${device}-settings-${stage}`;
      pair.push(`<figure><figcaption>${stage === 'before' ? 'Before · 8e88715' : 'After · in-app help settings'}</figcaption><img src="${await data(name)}"></figure>`);
      await copyFile(resolve(out, 'screenshots', name + '.png'), resolve(evidence, name + '.png'));
    }
    await page.setContent(`<style>body{margin:16px;background:${theme === 'light' ? '#eef2ef' : '#151a17'};color:${theme === 'light' ? '#16241b' : '#f1f3f1'};font:14px system-ui}main{display:flex;gap:16px}figure{margin:0;width:${width}px}img{display:block;width:100%}figcaption{margin-bottom:8px}</style><h2>FirstMate settings · ${theme} · ${device}</h2><p>Actual settings components; isolated synthetic host. Viewing or canceling starts no work.</p><main>${pair.join('')}</main>`);
    await page.screenshot({ path: resolve(evidence, `${theme}-${device}-comparison.png`), fullPage: true }); await page.close();
    const reviewPage = await browser.newPage({ viewport: { width: width * 2 + 48, height: 1000 } }), rows = [];
    for (const names of [['project-review', 'off-review'], ['plan-review', 'checks-review'], ['partial-review', 'save-failure'], ['capacity', 'stale'], ['project-text200', 'off-review-text200']]) {
      const figures = [];
      for (const name of names) figures.push(`<figure><figcaption>${name}</figcaption><img src="${await data(`${theme}-${device}-${name}`)}"></figure>`);
      rows.push(`<main>${figures.join('')}</main>`);
    }
    await reviewPage.setContent(`<style>body{margin:16px;background:${theme === 'light' ? '#eef2ef' : '#151a17'};color:${theme === 'light' ? '#16241b' : '#f1f3f1'};font:14px system-ui}main{display:flex;gap:16px;margin:20px 0}figure{margin:0;width:${width}px}img{display:block;width:100%}figcaption{margin-bottom:8px}</style><h2>FirstMate settings reviews · ${theme} · ${device}</h2><p>Actual components, synthetic data. Off counts are explicitly incomplete. Last row checks 200% text.</p>${rows.join('')}`);
    await reviewPage.screenshot({ path: resolve(evidence, `${theme}-${device}-reviews.png`), fullPage: true }); await reviewPage.close();
  }
} finally { await browser.close(); }
console.log('Copied eight original settings screenshots and eight comparison/review sheets to ' + evidence);
