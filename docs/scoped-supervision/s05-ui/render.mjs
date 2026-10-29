/** Actual S05 components; synthetic host RPCs only. All evidence stays in ignored .local/s05-ui. */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../../.."), out = resolve(root, ".local/s05-ui");
const repo = createRequire(resolve(root, "package.json")), local = createRequire(resolve(root, "docs/board-list/package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
await mkdir(out, { recursive: true });
await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(out, "fixture.js"), bundle: true, jsx: "automatic", logLevel: "warning",
  define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "isolated-host", setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
  } }] });
const server = createServer(async (req, res) => {
  if (req.url.startsWith("/fixture.js")) { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(out, "fixture.js"))); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}*{box-sizing:border-box}</style><div id="root"></div><script src="/fixture.js"></script>'); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true, args: ["--disable-gpu"], timeout: 20000 });
const origin = `http://127.0.0.1:${server.address().port}`, results = [];
async function choose(page, label) {
  await page.getByRole("button", { name: /^Discussion scope:/ }).click();
  await page.getByRole("dialog", { name: "Choose a discussion" }).getByRole("button", { name: new RegExp(`^${label},`) }).click();
}
// R05 reproductions use the real components; remove query state, not durable draft/selection state.
async function restoredScope(page, theme, device) {
  await page.goto(`${origin}/?restored&theme=${theme}`); await page.getByTestId("scope-discussion").waitFor();
  const composer = page.getByRole("textbox", { name: "Message recipient" });
  await composer.fill("@reader-pass Please explain this plan");
  await page.evaluate(() => { window.failScopeRead = true; window.dropScopeCache(); });
  await page.getByText("This conversation couldn't be checked. Try again before sending.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Message the first mate" }).count(), 0);
  assert.equal(await page.evaluate(() => window.fixtureCalls.filter(c => c.name === "firstmate.mate.ask").length), 0);
  assert.equal(await page.evaluate(() => window.scopeActions.filter(a => /discuss|answer|activate/.test(a.name)).length), 0);
  await page.screenshot({ path: resolve(out, `${theme}-${device}-restored-unavailable.png`) });
  await page.evaluate(() => { window.failScopeRead = false; });
  await page.getByRole("button", { name: "Refresh conversation", exact: true }).click();
  await composer.waitFor(); assert.equal(await composer.inputValue(), "@reader-pass Please explain this plan");
  await page.getByText("To Reader pass", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => window.scopeActions.some(a => a.name === "firstmate.scope.discuss"));
  const sent = await page.evaluate(() => window.scopeActions.find(a => a.name === "firstmate.scope.discuss").input);
  assert.equal(sent.route.target.scopeId, "00000000-0000-4000-8000-000000000101");
  assert.equal(await page.evaluate(() => window.fixtureCalls.filter(c => c.name === "firstmate.mate.ask").length), 0);
  return { heldWithoutGeneral: true, draftRetained: true, scopeId: sent.route.target.scopeId };
}
async function rejectedAnswer(page, theme, device) {
  await page.goto(`${origin}/?decisions&theme=${theme}`); await page.getByTestId("scoped-needs").waitFor();
  await page.getByRole("button", { name: /^Answer: Choose the follow-up/ }).last().click();
  await page.getByRole("button", { name: "Both layouts", exact: true }).click();
  const notes = page.getByRole("textbox", { name: "Answer notes: Choose the follow-up" });
  await notes.fill("Retain these answer notes");
  await page.evaluate(() => { window.refuseAnswer = true; });
  await page.getByRole("button", { name: "Submit scoped answer", exact: true }).click();
  await page.getByText("STALE: Policy vector changed; reread the scoped rules.", { exact: true }).waitFor();
  await page.evaluate(() => { window.refuseAnswer = false; window.scopeNeeds.scopedSequence++; window.scopeNeeds.scopedDecisions[0].answerContext.policyVector = [{ kind: "policy-rule", id: "00000000-0000-4000-8000-000000000501", version: 2 }]; });
  await page.getByRole("button", { name: "Refresh scoped decisions", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Submit scoped answer", exact: true }).isEnabled(), true);
  assert.equal(await notes.inputValue(), "Retain these answer notes");
  assert.equal(await page.getByRole("button", { name: "Selected: Both layouts", exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.scopeActions.filter(a => a.name === "firstmate.scope.answer").length), 1);
  await page.screenshot({ path: resolve(out, `${theme}-${device}-refused-answer-recovered.png`) });
  await page.evaluate(() => window.remountScope());
  await page.getByRole("button", { name: /^Answer: Choose the follow-up/ }).last().click();
  assert.equal(await notes.inputValue(), "Retain these answer notes");
  await page.getByRole("button", { name: "Submit scoped answer", exact: true }).click();
  await page.getByRole("button", { name: "Answer committed", exact: true }).waitFor();
  const attempts = await page.evaluate(() => window.scopeActions.filter(a => a.name === "firstmate.scope.answer").map(a => a.input));
  assert.equal(attempts.length, 2); assert.notEqual(attempts[0].submissionId, attempts[1].submissionId);
  assert.deepEqual(attempts[1].policyVector, [{ kind: "policy-rule", id: "00000000-0000-4000-8000-000000000501", version: 2 }]);
  assert.equal(attempts[1].option, attempts[0].option); assert.equal(attempts[1].text, attempts[0].text);
  return { refusalReleasesComposer: true, retainedOptionAndNotes: true, explicitFreshAttempt: true };
}
async function uncertainAnswer(page, theme) {
  await page.goto(`${origin}/?decisions&theme=${theme}`); await page.getByTestId("scoped-needs").waitFor();
  await page.getByRole("button", { name: /^Answer: Choose the follow-up/ }).last().click();
  await page.getByRole("button", { name: "Both layouts", exact: true }).click();
  await page.getByRole("textbox", { name: "Answer notes: Choose the follow-up" }).fill("Keep this uncertain submission");
  await page.evaluate(() => { window.loseAnswerReply = true; });
  await page.getByRole("button", { name: "Submit scoped answer", exact: true }).click();
  await page.getByText("Answer response unavailable (recovery fixture)", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Refresh scoped decisions", exact: true }).click();
  await page.evaluate(() => window.remountScope());
  await page.getByRole("button", { name: /^Answer: Choose the follow-up/ }).last().click();
  assert.equal(await page.getByRole("button", { name: "Answer unconfirmed · original submission retained", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("textbox", { name: "Answer notes: Choose the follow-up" }).inputValue(), "Keep this uncertain submission");
  const attempts = await page.evaluate(() => window.scopeActions.filter(a => a.name === "firstmate.scope.answer"));
  assert.equal(attempts.length, 1);
  return { originalSubmissionRetained: true, pendingReadDoesNotProveRefusal: true, noRetry: true };
}
async function maintenanceAnswer(page, theme, device) {
  await page.goto(`${origin}/?decisions&maintenance&theme=${theme}`); await page.getByTestId("scope-inbox-filters").waitFor();
  const chooseFilter = async label => {
    await page.getByRole("button", { name: /^Inbox scope:/ }).click();
    await page.getByRole("dialog", { name: "Filter Needs you" }).getByRole("button", { name: new RegExp(`^${label}(,|$)`) }).click();
  };
  for (const label of ["General", "Project", "Plan", "Maintenance", "All scopes"]) {
    await chooseFilter(label); await page.getByText("Global Needs you: 1.", { exact: false }).waitFor();
    assert.equal(await page.getByTestId("scoped-needs").count(), ["Maintenance", "All scopes"].includes(label) ? 1 : 0);
  }
  await chooseFilter("Maintenance");
  assert.equal(await page.evaluate(() => window.scopeActions.filter(a => /answer|discuss|activate/.test(a.name)).length), 0);
  await page.getByRole("button", { name: /^Answer: Storage authority/ }).last().click();
  await page.getByRole("button", { name: "Keep held", exact: true }).click();
  const notes = page.getByRole("textbox", { name: "Answer notes: Storage authority" }); await notes.fill("Retain the hold; no work authority.");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(out, `${theme}-${device}-maintenance-choice.png`) });
  await page.evaluate(() => { window.holdRead = true; });
  await page.getByRole("button", { name: "Submit scoped answer", exact: true }).click();
  await page.getByText("Combined decision read unavailable", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Answer unconfirmed · original submission retained", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.remountScope()); await page.getByRole("button", { name: /^Answer: Storage authority/ }).last().click();
  assert.equal(await notes.inputValue(), "Retain the hold; no work authority.");
  assert.equal(await page.getByRole("button", { name: "Answer unconfirmed · original submission retained", exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.holdRead = false; }); await page.getByRole("button", { name: "Refresh scoped decisions", exact: true }).click();
  await page.getByRole("button", { name: "Answer committed", exact: true }).waitFor();
  for (const label of ["General", "Project", "Plan", "Maintenance", "All scopes"]) {
    await chooseFilter(label); await page.getByText("Global Needs you: 0.", { exact: false }).waitFor();
    await page.getByText("Global pending answers: 1", { exact: true }).waitFor();
  }
  const calls = await page.evaluate(() => window.scopeActions.filter(a => /answer|discuss|activate/.test(a.name)));
  assert.equal(calls.length, 1); assert.equal(calls[0].name, "firstmate.maintenance.answer-ui");
  assert.deepEqual(calls[0].input.evidence, [{ ref: "verified/storage-authority-report", digest: "a".repeat(64) }]);
  assert.equal(await page.evaluate(() => window.fixtureCalls.filter(c => /mate.ask|needs-you.answer|workflow.act/.test(c.name)).length), 0);
  await page.screenshot({ path: resolve(out, `${theme}-${device}-maintenance-pending.png`) });
  return { checkedMaintenanceAnswer: true, sharedFilters: 5, pendingAnswerRetained: true, noFallback: true };
}
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["wide", 1440, 1000], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.setDefaultTimeout(15000); page.on("pageerror", e => errors.push(e.message));
    if (process.env.S05_RECOVERY_ONLY) {
      const result = process.env.S05_RECOVERY_ONLY === "f1" ? await restoredScope(page, theme, device) : await rejectedAnswer(page, theme, device);
      results.push({ theme, device, recovery: result, errors }); await page.close(); continue;
    }
    await page.goto(`${origin}/?before&theme=${theme}`); await page.getByRole("textbox", { name: "Message the first mate" }).waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-before.png`) });
    await page.goto(`${origin}/?theme=${theme}`); await page.getByTestId("scope-discussion").waitFor();
    const composer = page.getByRole("textbox", { name: "Message recipient" });
    await composer.fill("#reader Explain the next step");
    await page.getByText("To FirstMate · project context: reader", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.scopeActions.filter(a => /discuss|answer|activate|navigation/.test(a.name)).length), 0);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-shared.png`) });
    await composer.fill("x".repeat(16001)); await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByText("The message or its address is outside the supported limits. Shorten it or refresh its scope.", { exact: true }).waitFor();
    assert.equal((await composer.inputValue()).length, 16001);
    assert.equal(await page.evaluate(() => window.scopeActions.filter(a => a.name === "firstmate.scope.discuss").length), 0);
    await composer.fill("@unknown Explain"); await page.getByText(/Unknown recipient @unknown/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
    await choose(page, "Reader project"); await composer.fill("Project draft");
    await choose(page, "Reader pass"); await composer.fill("Plan draft");
    await page.evaluate(() => window.remountScope()); await composer.waitFor(); assert.equal(await composer.inputValue(), "Plan draft");
    await choose(page, "Reader project"); assert.equal(await composer.inputValue(), "Project draft");
    await page.evaluate(() => { window.holdSend = true; }); await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("button", { name: "Activating or sending…", exact: true }).waitFor();
    await choose(page, "Reader pass"); assert.equal(await composer.inputValue(), "Plan draft");
    await page.getByText("Sending to Reader project: Project draft", { exact: true }).waitFor();
    await page.evaluate(() => { window.releaseSend(); window.holdSend = false; });
    await page.waitForFunction(() => window.scopeActions.filter(a => a.name === "firstmate.scope.discuss").length === 1);
    const delivered = await page.evaluate(() => window.scopeActions.find(a => a.name === "firstmate.scope.discuss").input);
    assert.equal(delivered.route.target.scopeId, "00000000-0000-4000-8000-000000000201");
    assert.equal(delivered.text, "Project draft");
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await page.getByText(/0 tracked workers/).waitFor(); await page.getByText(/Review accepted; the outcome still needs a follow-up task/).waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-status.png`) });
    await page.getByRole("button", { name: "Open Reader pass conversation", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.scopeActions.filter(a => a.name === "navigation.openAgent").at(-1).input), { agentId: "plan-session" });
    await page.evaluate(() => { window.refuseNext = true; }); await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByText("The captured binding changed. Preserve this draft and refresh.", { exact: true }).waitFor();
    assert.equal(await composer.inputValue(), "Plan draft");
    await choose(page, "New trial"); await composer.fill("Discuss the trial");
    await page.getByText("First Send creates a persistent discussion session. Reading does not.", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-activation.png`) });
    await page.goto(`${origin}/?absent&theme=${theme}`); await page.getByTestId("scope-discussion").waitFor();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await page.getByText(/Reader project · dormant/).waitFor();
    assert.equal(await page.evaluate(() => window.scopeActions.filter(a => /discuss|answer|activate|navigation/.test(a.name)).length), 0);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-absent.png`) });
    await page.goto(`${origin}/?decisions&theme=${theme}`); await page.getByTestId("scoped-needs").waitFor();
    await page.getByRole("button", { name: /^Answer: Choose the follow-up/ }).last().click();
    await page.getByRole("button", { name: "Both layouts", exact: true }).click();
    await page.getByRole("textbox", { name: "Answer notes: Choose the follow-up" }).fill("Cover both within the current grant.");
    await page.screenshot({ path: resolve(out, `${theme}-${device}-decision.png`) });
    await page.evaluate(() => { window.holdRead = true; });
    await page.getByRole("button", { name: "Submit scoped answer", exact: true }).click();
    await page.getByText("Combined decision read unavailable", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Answer unconfirmed · original submission retained", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.scopeActions.filter(a => a.name === "firstmate.scope.answer").length), 1);
    await page.evaluate(() => { window.holdRead = false; }); await page.getByRole("button", { name: "Refresh scoped decisions", exact: true }).click();
    await page.getByRole("button", { name: "Answer committed", exact: true }).waitFor();
    const restoration = await restoredScope(page, theme, device), refusal = await rejectedAnswer(page, theme, device), uncertainty = await uncertainAnswer(page, theme), maintenance = await maintenanceAnswer(page, theme, device);
    assert.deepEqual(errors, []); results.push({ theme, device, width, height, capturedScope: delivered.route.target.scopeId, resourceCallsOnRead: 0, scopedAnswers: 1, restoration, refusal, uncertainty, maintenance, errors }); await page.close();
  }
  await writeFile(resolve(out, "results.json"), JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, output: out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
