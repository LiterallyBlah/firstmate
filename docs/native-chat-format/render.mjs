/** No install/reload: real compiled plugin, read-only Paseo projection and user-row source. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const generated = join(here, ".generated");
mkdirSync(generated, { recursive: true });
const rootRequire = createRequire(join(root, "package.json"));
const harness = createRequire(join(root, "docs/board-list/package.json"));
const { build } = harness("esbuild"),
  { chromium } = harness("playwright"),
  { parse } = rootRequire("@babel/parser");
const paseo = process.env.PASEO_SOURCE ?? "C:/Users/micha/.paseo/plugin-data/firstmate/home/projects/paseo";
const app = join(paseo, "packages/app/src");
// Keep the actual native user component and stylesheet unchanged. Omit its
// unrelated assistant/tool/Markdown tree; host services below are fixture stubs.
const text = readFileSync(join(app, "components/message.tsx"), "utf8");
const source = parse(text, { sourceType: "module", plugins: ["typescript", "jsx"] });
const names = new Set([
  "UserMessage",
  "userMessageStylesheet",
  "MessageOuterSpacingContext",
  "useDisableOuterSpacing",
  "MESSAGE_TEXT_DATASET",
]);
const statements = source.program.body.filter((statement) => {
  const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  if (declaration?.type === "FunctionDeclaration") return names.has(declaration.id?.name);
  return declaration?.type === "VariableDeclaration" && declaration.declarations.some((d) => names.has(d.id.name));
});
assert.equal(statements.length, names.size);
writeFileSync(
  join(generated, "native-user-message.tsx"),
  `
import React, { memo, useMemo, useState, useCallback, createContext, useContext } from 'react';
import { View, Text, Pressable } from 'react-native';
import { darkTheme, lightTheme } from 'native-theme';
const nativeTheme = new URLSearchParams(location.search).get('theme') === 'light' ? lightTheme : darkTheme;
const StyleSheet = { create: fn => fn(nativeTheme) };
const isWeb = true, isNative = false, STREAM_METADATA_FONT_SIZE = 13;
const useIsCompactFormFactor = () => innerWidth < 600;
const useTranslation = () => ({ t: () => 'Copy message' });
const formatMessageTimestamp = () => '12:00';
const useRewindAgentMutation = () => ({ isPending: false });
const AttachmentLightbox = () => null;
const TurnCopyButton = ({ accessibilityLabel }) => <Text accessibilityLabel={accessibilityLabel} style={{ color: nativeTheme.colors.foregroundMuted }}>Copy</Text>;
${statements.map((s) => text.slice(s.start, s.end)).join("\n")}
`,
);
const nativeModules = {
  "native-theme": "styles/theme.ts",
  "native-plugin-theme": "plugins/theme.ts",
  "native-projection": "plugins/timeline/projection.ts",
  "native-model": "plugins/timeline/model.ts",
};
await build({
  entryPoints: [join(here, "host.jsx")],
  outfile: join(generated, "host.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [
    {
      name: "fixture",
      setup(builder) {
        builder.onResolve({ filter: /^native-/ }, (args) => ({ path: join(app, nativeModules[args.path]) }));
        builder.onResolve({ filter: /^@getpaseo\/highlight$/ }, () => ({ path: "highlight", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const darkHighlightColors = {}; export const lightHighlightColors = {};",
        }));
        builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (args) => ({
          path: rootRequire.resolve(args.path),
        }));
        builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: harness.resolve(args.path) }));
        builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
      },
    },
  ],
});
const server = createServer((req, res) => {
  if (req.url === "/host.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(readFileSync(join(generated, "host.js")));
  } else
    res.end(
      '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/host.js"></script>',
    );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const [width, theme] of [
    [1100, "dark"],
    [390, "dark"],
    [390, "light"],
  ]) {
    for (const agent of ["mate", "second"]) {
      const shots = [];
      for (const revision of ["main", "branch"]) {
        const page = await browser.newPage({ viewport: { width, height: 950 }, deviceScaleFactor: 1 });
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}&agent=${agent}`);
        await page.evaluate(
          (bundle) => window.mountPlugin(bundle),
          readFileSync(join(root, `docs/ship-deck-canvas/.generated/${revision}.client.js`), "utf8"),
        );
        await page
          .getByText(`${agent === "mate" ? "First mate" : "Second agent"} · native timeline fixture`, { exact: true })
          .waitFor();
        await page.mouse.move(0, 0);
        const checks = await page.evaluate(() => window.fixtureChecks);
        assert.equal(checks.registrations, revision === "main" ? 0 : 1);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          "No horizontal overflow",
        );
        const file = `${agent}-${width}-${theme}-${revision}.png`;
        shots.push(await page.screenshot({ path: join(here, file), fullPage: true }));
        if (agent === "mate" && revision === "branch") {
          const watchButton = page.getByRole("button", { name: /^Show original: Watches:/ });
          await watchButton.focus();
          await page.keyboard.press("Enter");
          assert.equal(
            await page.getByRole("button", { name: /^Hide original: Watches:/ }).getAttribute("aria-expanded"),
            "true",
          );
          const originals = await page.locator("main").innerText();
          assert(originals.includes('<firstmate-watch name="health"'));
          const boardButton = page.getByRole("button", { name: /^Show original: The captain spoke/ });
          await boardButton.click();
          assert((await page.locator("main").innerText()).includes("Crewmate: The redirect fix is ready"));
          await page.screenshot({ path: join(here, `reveal-${width}-${theme}.png`), fullPage: true });
          const hide = page.getByRole("button", { name: /^Hide original: Watches:/ });
          await hide.focus();
          await page.keyboard.press("Space");
          await page.getByRole("button", { name: /^Show original: Watches:/ }).waitFor();
        }
        assert.deepEqual(errors, []);
        results.push({ file, ...checks, errors });
        await page.close();
      }
      if (agent === "second") assert(shots[0].equals(shots[1]), "Second agent before/after pixels must match");
    }
  }
} finally {
  await browser.close();
  server.close();
}
writeFileSync(
  join(here, "results.json"),
  JSON.stringify(
    {
      paseoRevision: execFileSync("git", ["-C", paseo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      fixture:
        "Compiled plugin; actual Paseo user row source and projection/model; synthetic sessions and host services. No installed app/device test.",
      secondAgentPixels: "identical in all three viewport/theme pairs",
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Passed ${results.length} before/after captures, 3 disclosure checks, second-agent pixel equality.`);
