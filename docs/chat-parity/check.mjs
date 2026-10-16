import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const screenshot = (name) => fileURLToPath(new URL(`.generated/${name}.png`, import.meta.url));

export async function checkParity(page, url) {
  await page.setViewportSize({ width: 980, height: 800 });
  await page.goto(url + "/?parity");
  const input = page.getByPlaceholder(/Tell the first mate what/);
  await input.fill("Retained screenshot");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const g = canvas.getContext("2d");
    g.fillStyle = "#2963a6";
    g.fillRect(0, 0, 1200, 800);
    g.fillStyle = "#fff";
    g.font = "60px sans-serif";
    g.fillText("Retained screenshot", 100, 180);
    return canvas.toDataURL().split(",")[1];
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files or images", exact: true }).click();
  await (await chooser).setFiles({ name: "retained.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.getByText("retained.png", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Enlarge image you sent", exact: true }).waitFor();
  // Wait for the actual asynchronous IndexedDB commit, then lose all JS memory with a reload.
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("paseo.firstmate.sent-images", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const records = await new Promise((resolve) => {
      const r = db.transaction("images").objectStore("images").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return records.some((row) => row.id === window.sends[0]?.messageId);
  });
  await page.reload();
  await page.getByRole("button", { name: "Enlarge image you sent", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Image you sent", exact: true });
  await dialog.waitFor();
  const before = await dialog.locator("img").evaluate((e) => e.parentElement.getBoundingClientRect().width);
  await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.ok((await dialog.locator("img").evaluate((e) => e.parentElement.getBoundingClientRect().width)) > before);
  await dialog.getByRole("button", { name: "Fit image", exact: true }).click();
  await page.screenshot({ path: screenshot("image-viewer") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Copy message", exact: true }).last().click();
  assert.equal(await page.evaluate(() => window.copiedText.at(-1)), "Retained screenshot");
  await page.getByRole("button", { name: "Full conversation", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.navigationCalls.at(-1)), { agentId: "first-mate" });
  await page.evaluate(
    (png) =>
      window.appendChatItems([
        {
          type: "assistant_message",
          text: `Here is the image:\n![Rendered reply](data:image/png;base64,${png})\n\n\`\`\`js\nconst answer = 42;\n\`\`\``,
          messageId: "reply-image",
        },
      ]),
    png,
  );
  await page.getByRole("button", { name: "Enlarge rendered reply", exact: true }).waitFor();
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  assert.equal(await page.evaluate(() => window.copiedText.at(-1)), "const answer = 42;");
  await page.screenshot({ path: screenshot("images-and-copy") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Enlarge rendered reply", exact: true }).click();
  await page.screenshot({ path: screenshot("phone-viewer") });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.keyboard.press("Escape");
  // More than two tail pages, streamed forward and then replaced by a new epoch.
  await page.evaluate(() =>
    window.replaceChatItems(
      Array.from({ length: 330 }, (_, i) => ({
        type: "user_message",
        text: `History row ${i}`,
        clientMessageId: `history-${i}`,
      })),
    ),
  );
  const load = page.getByRole("button", { name: "Load earlier messages", exact: true });
  await load.waitFor();
  assert.equal(await page.getByText("History row 0", { exact: true }).count(), 0);
  await page.evaluate(() => {
    window.failHistory = true;
  });
  await load.click();
  await page.getByText("History is offline", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.failHistory = false;
  });
  const rowTop = await page
    .getByText("History row 180", { exact: true })
    .evaluate((e) => e.getBoundingClientRect().top);
  await load.click();
  await page.getByText("History row 30", { exact: true }).waitFor();
  await page.waitForFunction((expected) => {
    const row = [...document.querySelectorAll("div")].find(
      (e) => e.childNodes.length === 1 && e.textContent === "History row 180",
    );
    return row && Math.abs(row.getBoundingClientRect().top - expected) < 2;
  }, rowTop);
  await page.evaluate(() =>
    window.appendChatItems([{ type: "assistant_message", text: "Live tail update", messageId: "live" }]),
  );
  await page.getByText("Live tail update", { exact: true }).waitFor({ state: "attached" });
  assert.equal(await page.getByText("History row 30", { exact: true }).count(), 1);
  await load.click();
  await page.getByText("History row 0", { exact: true }).waitFor({ state: "attached" });
  assert.equal(await load.count(), 0);
  await page.getByRole("button", { name: "Scroll to the latest", exact: true }).click();
  await page.getByText("Live tail update", { exact: true }).waitFor();
  // A history page of hidden reasoning has no rendered height. It must not leave
  // a pending prepend anchor that moves the viewport when the next reply arrives.
  await page.evaluate(() =>
    window.replaceChatItems(
      Array.from({ length: 450 }, (_, i) =>
        i < 300
          ? { type: "reasoning", text: `Hidden history ${i}` }
          : { type: "user_message", text: `Visible history ${i}` },
      ),
    ),
  );
  await load.waitFor();
  await load.click();
  await load.waitFor({ state: "visible" });
  const filteredTop = await page
    .getByText("Visible history 300", { exact: true })
    .evaluate((e) => e.getBoundingClientRect().top);
  await page.evaluate(() =>
    window.appendChatItems([
      { type: "assistant_message", text: "After hidden history\n".repeat(40), messageId: "after-hidden" },
    ]),
  );
  await page.getByRole("button", { name: "Copy message", exact: true }).last().waitFor({ state: "attached" });
  await page.waitForFunction(() => document.body.textContent.includes("After hidden history"));
  assert.ok(
    Math.abs(
      (await page.getByText("Visible history 300", { exact: true }).evaluate((e) => e.getBoundingClientRect().top)) -
        filteredTop,
    ) < 2,
  );
  await page.evaluate(() =>
    window.replaceChatItems([{ type: "assistant_message", text: "New conversation epoch", messageId: "new-epoch" }]),
  );
  await page.getByText("New conversation epoch", { exact: true }).waitFor();
  assert.equal(await page.getByText("History row 0", { exact: true }).count(), 0);
  console.log(
    "Parity: persisted sent image after full reload, zoom/fit/close, assistant image, copy message/code, native shortcut, phone viewer, earlier-history pagination/retry/anchoring/hidden pages/live merge/epoch reset passed.",
  );
}
