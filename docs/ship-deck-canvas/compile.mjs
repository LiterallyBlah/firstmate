/**
 * Compiles this branch and origin/main with Paseo's own plugin compiler — the one the daemon runs on
 * install and reload — and checks what the ship deck costs a bundle:
 *
 * - both compile, and how big and how slow each is;
 * - the branch's bundle carries no Pixi and, like main's, no `class` syntax: Pixi is served by the daemon
 *   as `vendor/pixi.min.js` instead (see `client/deck-pixi.ts`);
 * - Hermes (react-native 0.81's `hermesc`, the host's version) parses both bundles with its default
 *   flags, so a phone still loads the plugin — and refuses `vendor/pixi.min.js` without `-Xes6-class`,
 *   which is why Pixi is not in the bundle.
 *
 * Writes `.generated/{main,branch}.client.js` for `render.mjs` and `compile-results.json` here.
 * `PASEO_COMPILER` overrides where Paseo's `compiler.js` is found.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const generated = join(here, ".generated");
mkdirSync(generated, { recursive: true });

const compilerPath =
  process.env.PASEO_COMPILER ??
  join(process.env.APPDATA ?? "", "npm/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js");
assert(existsSync(compilerPath), `Paseo's compiler not found at ${compilerPath}; set PASEO_COMPILER`);
const { compilePlugin } = await import(pathToFileURL(compilerPath).href);
const paseoVersion = JSON.parse(readFileSync(resolve(dirname(compilerPath), "../../../../package.json"), "utf8")).version;

// origin/main as files, with this checkout's node_modules beside it (main needs nothing it lacks).
const mainDir = join(tmpdir(), `firstmate-main-${process.pid}`);
rmSync(mainDir, { recursive: true, force: true });
mkdirSync(mainDir, { recursive: true });
execFileSync("git", ["-C", root, "archive", "--format=tar", "-o", join(mainDir, "main.tar"), "origin/main"]);
execFileSync("tar", ["-xf", "main.tar"], { cwd: mainDir }); // relative: GNU tar reads "C:" as a host
symlinkSync(join(root, "node_modules"), join(mainDir, "node_modules"), "junction");
const commit = (ref) => execFileSync("git", ["-C", root, "rev-parse", "--short", ref], { encoding: "utf8" }).trim();

async function compile(name, dir) {
  const started = Date.now();
  const compiled = await compilePlugin({ client: join(dir, "index.client.tsx"), server: join(dir, "index.server.ts") });
  const ms = Date.now() - started;
  // esbuild names each module by its path from where its service started, here; main's paths carry the
  // temporary folder, which is taken out so the two bundles compare byte for byte.
  const prefix = `${relative(root, dir).replaceAll("\\", "/")}/`;
  const clean = (bundle) => (dir === root ? bundle : bundle.split(prefix).join(""));
  const clientBundle = clean(compiled.clientBundle);
  const serverBundle = clean(compiled.serverBundle);
  writeFileSync(join(generated, `${name}.client.js`), clientBundle);
  return { clientBytes: Buffer.byteLength(clientBundle), serverBytes: Buffer.byteLength(serverBundle), ms, clientBundle };
}

// The branch first: esbuild's service process keeps the working directory it started in, and a
// temporary folder it sits in cannot be removed on Windows.
const branch = await compile("branch", root);
const main = await compile("main", mainDir);
// The junction goes first, as a link, so removing the folder can never reach this checkout's node_modules.
unlinkSync(join(mainDir, "node_modules"));
rmSync(mainDir, { recursive: true, force: true });

// No Pixi in either bundle, and no class syntax: the deck's code is plain functions, Pixi arrives as text.
const classes = (bundle) => (bundle.match(/\bclass\b/g) ?? []).length;
assert.equal(branch.clientBundle.includes("node_modules/pixi.js"), false, "the branch bundles no Pixi");
assert.equal(main.clientBundle.includes("node_modules/pixi.js"), false, "main bundles no Pixi");
assert.equal(classes(main.clientBundle), 0, "main has no class syntax");
assert.equal(classes(branch.clientBundle), 0, "the branch has no class syntax");
assert(branch.clientBundle.includes("client/deck-mount.ts"), "the deck is in the branch bundle");

const hermesc = join(
  root,
  "node_modules/react-native/sdks/hermesc",
  process.platform === "win32" ? "win64-bin/hermesc.exe" : process.platform === "darwin" ? "osx-bin/hermesc" : "linux64-bin/hermesc",
);
function hermesParse(file, flags = []) {
  const out = join(generated, "probe.hbc");
  try {
    execFileSync(hermesc, [...flags, "-emit-binary", "-out", out, file], { stdio: "pipe" });
    return "parsed";
  } catch (error) {
    const first = String(error.stderr ?? error).split("\n").find((line) => line.includes("error:")) ?? String(error);
    return `refused: ${first.replace(/^.*error: /, "").trim()}`;
  } finally {
    rmSync(out, { force: true });
  }
}
const hermes = {
  main: hermesParse(join(generated, "main.client.js")),
  branch: hermesParse(join(generated, "branch.client.js")),
  vendoredPixi: hermesParse(join(root, "vendor/pixi.min.js")),
  vendoredPixiWithEs6Class: hermesParse(join(root, "vendor/pixi.min.js"), ["-Xes6-class"]),
};
assert.equal(hermes.main, "parsed");
assert.equal(hermes.branch, "parsed");
assert.match(hermes.vendoredPixi, /^refused/, "Hermes refuses Pixi without the class flag — the reason it is served, not bundled");

const results = {
  paseoCompiler: paseoVersion,
  main: { commit: commit("origin/main"), clientBytes: main.clientBytes, serverBytes: main.serverBytes, ms: main.ms },
  branch: { commit: commit("HEAD"), clientBytes: branch.clientBytes, serverBytes: branch.serverBytes, ms: branch.ms },
  clientGrowthBytes: branch.clientBytes - main.clientBytes,
  vendoredPixiBytes: readFileSync(join(root, "vendor/pixi.min.js")).length,
  hermesc: "node_modules/react-native/sdks/hermesc (react-native " + JSON.parse(readFileSync(join(root, "node_modules/react-native/package.json"), "utf8")).version + ")",
  hermesParse: hermes,
};
writeFileSync(join(here, "compile-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
