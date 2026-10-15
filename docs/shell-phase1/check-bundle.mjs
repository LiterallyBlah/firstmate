/** Compile with Paseo itself, then parse the complete client with RN 0.81's Hermes. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const compiler =
  process.env.PASEO_COMPILER ??
  join(
    process.env.APPDATA ?? "",
    "npm/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js",
  );
const { compilePlugin } = await import(pathToFileURL(compiler).href);
const { clientBundle, serverBundle } = await compilePlugin({
  client: join(root, "index.client.tsx"),
  server: join(root, "index.server.ts"),
});
assert.equal((clientBundle.match(/\bclass\b/g) ?? []).length, 0, "No class syntax in the entire client bundle");
assert.equal(clientBundle.includes("node_modules/pixi.js"), false);
assert.equal(clientBundle.includes("iVBORw0KGgo"), false);
const generated = join(here, ".generated");
mkdirSync(generated, { recursive: true });
writeFileSync(join(generated, "client.js"), clientBundle);
const platform =
  process.platform === "win32"
    ? "win64-bin/hermesc.exe"
    : process.platform === "darwin"
      ? "osx-bin/hermesc"
      : "linux64-bin/hermesc";
execFileSync(
  join(root, "node_modules/react-native/sdks/hermesc", platform),
  ["-emit-binary", "-out", join(generated, "client.hbc"), join(generated, "client.js")],
  { stdio: "pipe" },
);
console.log(
  JSON.stringify({
    compiler: JSON.parse(readFileSync(resolve(dirname(compiler), "../../../../package.json"), "utf8")).version,
    clientBytes: Buffer.byteLength(clientBundle),
    serverBytes: Buffer.byteLength(serverBundle),
    classes: 0,
    hermes: "parsed with default flags",
  }),
);
