/** Compile with Paseo's public plugin compiler and parse the client with the bundled Hermes. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, ".local/attention-deck"); mkdirSync(out, { recursive: true });
const compiler = process.env.PASEO_COMPILER ?? join(process.env.APPDATA, "npm/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js");
const { compilePlugin } = await import(pathToFileURL(compiler).href);
const { clientBundle, serverBundle } = await compilePlugin({ client: join(root, "index.client.tsx"), server: join(root, "index.server.ts") });
const client = join(out, "plugin.client.js"); writeFileSync(client, clientBundle);
assert(!/\bclass\b/.test(clientBundle));
assert(!clientBundle.includes("node_modules/pixi.js"));
assert(!clientBundle.includes("iVBORw0KGgo"));
const hermesc = join(root, "node_modules/react-native/sdks/hermesc", process.platform === "win32" ? "win64-bin/hermesc.exe" : "linux64-bin/hermesc");
execFileSync(hermesc, ["-emit-binary", "-out", join(out, "plugin.hbc"), client], { stdio: "pipe" });
const result = { clientBytes: Buffer.byteLength(clientBundle), serverBytes: Buffer.byteLength(serverBundle), hermes: "parsed", bundledPixi: false, bundledArt: false };
writeFileSync(join(out, "compile-results.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
