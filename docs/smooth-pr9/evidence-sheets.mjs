/** Nonempty evidence: reviewer baseline 4d449201, current actual-RPC review and disclosure. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFile, copyFile } from "node:fs/promises";
const local = createRequire(resolve("docs/board-list/package.json"));
const evidence = resolve("docs/smooth-pr9/evidence"), captures = resolve(".local/smooth-pr9/production");
const browser = await local("playwright").chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
try {
  for (const theme of ["light", "dark"]) for (const device of ["desktop", "phone"]) {
    const prefix = `${theme}-${device}`, width = device === "desktop" ? 720 : 390;
    const figures = [];
    for (const [kind, caption] of [["ordinary-before", "Before · 4d449201 reviewer reproduction"], ["ordinary-after", "After · ordinary review"], ["technical-after", "After · expanded Technical details"]]) {
      const file = `${prefix}-${kind}.png`;
      if (kind !== "ordinary-before") await copyFile(resolve(captures, file), resolve(evidence, file));
      const bytes = await readFile(resolve(evidence, file));
      figures.push(`<figure><figcaption>${caption}</figcaption><img src="data:image/png;base64,${bytes.toString("base64")}"></figure>`);
    }
    const page = await browser.newPage({ viewport: { width: width * 3 + 64, height: 1000 } });
    await page.setContent(`<style>body{margin:16px;background:${theme === "light" ? "#eef2ef" : "#151a17"};color:${theme === "light" ? "#16241b" : "#f1f3f1"};font:14px system-ui}main{display:flex;gap:16px}figure{margin:0;width:${width}px}img{display:block;width:100%}figcaption{margin-bottom:8px}</style><h2>PR 175 · Nonempty handover evidence · ${theme} · ${device}</h2><p>Actual approved plan and unfinished work; registered handlers and adapted native primitives. Details start collapsed. Viewing and toggling write nothing.</p><main>${figures.join("")}</main>`);
    await page.screenshot({ path: resolve(evidence, `${prefix}-nonempty-evidence-comparison.png`), fullPage: true });
    await page.close();
  }
} finally { await browser.close(); }
console.log("Four nonempty evidence comparison sheets saved.");
