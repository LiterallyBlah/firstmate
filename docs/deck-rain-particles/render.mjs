/** Real compiled plugin/RPC renders, deterministic simulation frames encoded as 10 fps clips.
 * All outputs stay in ignored .local/rain-evidence. Set RAIN_SMOKE=1 for one downpour still.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
let scaffold = readFileSync(resolve(root, "docs/deck-settings/render.mjs"), "utf8").split("const browser = await chromium.launch")[0];
scaffold = scaffold.replace("const here = dirname(fileURLToPath(import.meta.url));", `const here = ${JSON.stringify(resolve(root, "docs/deck-settings"))};`);
scaffold += `
const { review } = await import(${JSON.stringify(pathToFileURL(resolve(here, "review.mjs")).href)});
const browser = await chromium.launch({channel:"msedge",headless:true});
try { await review(browser, "http://127.0.0.1:"+http.address().port); }
finally { await browser.close(); http.close(); }
`;
mkdirSync(resolve(root, ".local/rain-harness"), { recursive: true });
const file = resolve(root, ".local/rain-harness/render.mjs");
writeFileSync(file, scaffold);
await import(pathToFileURL(file));
