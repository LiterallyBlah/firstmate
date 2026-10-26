/** Run with the installed desktop's ELECTRON_RUN_AS_NODE=1 (read-only compiler access),
 * or set PASEO_COMPILER to a qualified unpacked compiler. Does not install/reload a plugin.
 * All bundles, archive exports and receipts remain under ignored .local/s05/compile. */
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../.."), out = path.join(root, ".local/s05/compile");
fs.mkdirSync(out, { recursive: true });
const compilerPath = process.env.PASEO_COMPILER || path.join(process.env.LOCALAPPDATA || "", "Programs/Paseo/resources/app.asar/node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js");
const { compilePlugin } = require(compilerPath);
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
async function main() {
  const base = "ea613a57", revision = cp.execFileSync("git", ["rev-parse", base], { cwd: root, encoding: "utf8" }).trim();
  const baseline = fs.mkdtempSync(path.join(out, "baseline-"));
  cp.execFileSync("git", ["archive", "--format=tar", "-o", path.join(baseline, "source.tar"), revision], { cwd: root });
  cp.execFileSync("tar", ["-xf", "source.tar"], { cwd: baseline });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(baseline, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const hermesc = path.join(root, "node_modules/react-native/sdks/hermesc", process.platform === "win32" ? "win64-bin/hermesc.exe" : process.platform === "darwin" ? "osx-bin/hermesc" : "linux64-bin/hermesc");
  const results = [];
  for (const [name, directory] of [["branch", root], ["baseline", baseline]]) {
    const began = Date.now(), result = await compilePlugin({ client: path.join(directory, "index.client.tsx"), server: path.join(directory, "index.server.ts") });
    const file = path.join(out, `${name}.client.js`);
    fs.writeFileSync(file, result.clientBundle); fs.writeFileSync(path.join(out, `${name}.server.js`), result.serverBundle);
    assert.equal((result.clientBundle.match(/\bclass\b/g) || []).length, 0, "No class syntax in the evaluated native client");
    cp.execFileSync(hermesc, ["-emit-binary", "-out", path.join(out, `${name}.hbc`), file], { stdio: "pipe" });
    results.push({ name, clientBytes: Buffer.byteLength(result.clientBundle), serverBytes: Buffer.byteLength(result.serverBundle),
      clientSHA256: sha(result.clientBundle), serverSHA256: sha(result.serverBundle), durationMs: Date.now() - began, hermes: "passed" });
  }
  const receipt = { base: revision, runtime: process.version, compiler: compilerPath, compilerSHA256: sha(fs.readFileSync(compilerPath)),
    hermescSHA256: sha(fs.readFileSync(hermesc)), results, liveResources: 0 };
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
