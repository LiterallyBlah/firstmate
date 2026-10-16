/** Reuse the installed-pack render harness and its public canvas attributes; no Pixi instrumentation. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
let scaffold = readFileSync(resolve(root, "docs/deck-settings/render.mjs"), "utf8").split("const browser = await chromium.launch")[0];
scaffold = scaffold.replace("const here = dirname(fileURLToPath(import.meta.url));", `const here = ${JSON.stringify(resolve(root, "docs/deck-settings"))};`);
scaffold += `
const { review } = await import(${JSON.stringify(pathToFileURL(resolve(here, "review.mjs")).href)});
try {
  for (const mode of ["full", "lite", "still"]) {
    const browser = await chromium.launch({channel:"msedge",headless:true,
      ...(mode === "lite" ? {args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]} : {})});
    try { await review(browser, "http://127.0.0.1:"+http.address().port, mode); }
    finally { await browser.close(); }
  }
} finally { http.close(); }
`;
mkdirSync(resolve(here, ".generated"), { recursive: true });
const file = resolve(here, ".generated/render.mjs");
writeFileSync(file, scaffold);
await import(pathToFileURL(file));
