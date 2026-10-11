/** Read-only evidence from the installed client. Not an API available to plugins. */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export async function installedRuntime(directory) {
  const name = (await readdir(directory)).find((name) => /^index-.*\.js$/.test(name));
  if (!name) throw new Error("No installed Metro index bundle found");
  const source = await readFile(resolve(directory, name), "utf8");
  const modules = new Map();
  const evidence = [];
  const selected = new Set([3812, 3915, 3916, 4771, 4906, 4907, 4908]);
  source.split("\n").forEach((line, index) => {
    const id = /},(\d+),\[[\d,]*\]\);$/.exec(line)?.[1];
    if (!selected.has(Number(id))) return;
    modules.set(Number(id), line);
    evidence.push({ moduleId: Number(id), line: index + 1, sha256: createHash("sha256").update(line).digest("hex") });
  });
  if (modules.size !== selected.size) throw new Error("Installed runtime changed: review module IDs before reproducing");
  // Expose the actual private click entry point for this evidence harness only.
  const actions = modules.get(4906).replace('const b={href:""}', 'e.__open=f;const b={href:""}');
  if (actions === modules.get(4906)) throw new Error("Native click entry point changed");
  modules.set(4906, actions);
  const moduleSource = `
const registered = new Map(), cache = new Map();
function __d(factory, id, dependencies) { registered.set(id, { factory, dependencies }); }
const stubs = new Map([
  [731, {}],
  [883, { getDesktopHost: () => ({ opener: { openUrl: async url => window.linkEvidence.external.push(url) } }) }],
  [882, { isWeb: true }],
  [3115, { i18n: { t: (_, {token}) => 'No file found: ' + token } }],
  [455, {}], [36, {}], [801, {}], [855, {}], [4136, {}], [4904, {}]
]);
function nativeRequire(id) {
  if (stubs.has(id)) return stubs.get(id);
  if (cache.has(id)) return cache.get(id);
  const record = registered.get(id);
  if (!record) throw new Error('Unstubbed native dependency ' + id);
  const module = { exports: {} }; cache.set(id, module.exports);
  record.factory(globalThis, nativeRequire, null, null, module, module.exports, record.dependencies);
  return module.exports;
}
${[...modules.values()].join("\n")}
export const externalOpener = nativeRequire(3915).openExternalUrl;
export const navigationFactory = nativeRequire(4771).createPluginHostNavigation;
export const nativeClick = nativeRequire(4906).__open;
export const nativeParser = nativeRequire(4908);
export const nativeResolver = nativeRequire(4907);
`;
  return { moduleSource, evidence, bundle: name, sha256: createHash("sha256").update(source).digest("hex") };
}
