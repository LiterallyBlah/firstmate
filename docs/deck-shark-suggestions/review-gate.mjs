/** Contact sheets of the gate's complete screenshots, for visual review before recording exact pairs. */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const { chromium } = createRequire(resolve(root, 'docs/board-list/package.json'))('playwright');
const results = JSON.parse(readFileSync(resolve(root, 'docs/deck-settings/gate-results.json'), 'utf8'));
const dir = resolve(root, 'docs/ship-deck-canvas/.generated/gate');
mkdirSync(resolve(here, '.generated'), { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const scenario of results.scenarios) {
    const rows = scenario.shots.map(shot => {
      const images = shot.identical ? ['branch'] : ['main', 'branch', 'diff'];
      return `<p>${scenario.scenario} / ${shot.shot}</p><div>${images.map(side => {
        const file = shot.identical ? resolve(dir, 'shots', `${scenario.scenario}-${shot.shot}.png`) : resolve(dir, `${scenario.scenario}-${shot.shot}.${side}.png`);
        return `<figure><figcaption>${side}</figcaption><img src="data:image/png;base64,${readFileSync(file).toString('base64')}"></figure>`;
      }).join('')}</div>`;
    });
    // Six full screenshot pairs per page keep the contact sheets readable.
    for (let start = 0; start < rows.length; start += 6) {
      await page.setContent(`<style>body{margin:0;background:#ddd;font:14px Arial}p{margin:8px}div{display:flex}figure{margin:0;width:480px}img{width:480px;display:block}figcaption{text-align:center}</style>${rows.slice(start, start + 6).join('')}`);
      await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await page.screenshot({ path: resolve(here, '.generated', `${scenario.scenario}-${start}.png`), fullPage: true });
    }
  }
} finally { await browser.close(); }
