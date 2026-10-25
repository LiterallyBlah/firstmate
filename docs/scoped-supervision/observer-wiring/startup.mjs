/** Owned startup wrapper. Real entry is gated; the core accepts only caller-owned pages. */
import { checkDeckStartup } from '../../needs-you/deck-startup-checks.mjs';
import { observeStartupPage } from '../observer-admission/browser.mjs';
import { requireRuntime } from './runtime.mjs';

export async function runOwnedStartup(createOwnedBrowser, createSlot) {
  requireRuntime('chromium'); // refuse BEFORE browser creation when ownership is unsupported
  const browser = await createOwnedBrowser();
  try { return await startupCore(browser.pageAt, createSlot); }
  finally { await browser.close(); }
}

/** Testable wiring core; does not establish process-tree ownership or grant admission. */
export async function startupCore(pageAt, createSlot, check = checkDeckStartup) {
  const slots = []; let current;
  async function finish(slot, error) {
    if (!slot || slot.finished) return;
    slot.finished = true;
    if (error) slot.reject(error); else slot.resolve();
    await slot.work.catch(() => {}); await Promise.resolve();
    slot.final = slot.bridge.finalize(error ? 'startup-rejected' : 'startup-fulfilled');
  }
  const observedAt = async (query, width, prepare) => {
    // Reaching the next original iteration proves the preceding assertions/finally completed.
    await finish(current);
    if (current && (!current.contextClosed || current.final.observer.incomplete || current.final.observer.pendingCount > 0)) {
      throw Object.assign(Error('Previous startup case is not admissible for reuse; retain fixture'), { code: 'DIAGNOSTIC_BLOCKED' });
    }
    const slot = createSlot(slots.length); slots.push(slot); current = slot;
    const originalWork = new Promise((resolve, reject) => { slot.resolve = resolve; slot.reject = reject; });
    slot.work = slot.bridge.run(() => originalWork); slot.work.catch(() => {});
    let observed, raw;
    try {
      await pageAt(query, width, async page => {
        raw = page;
        slot.bridge.registerLifecycle(page, 'owned-page');
        slot.bridge.registerLifecycle(page.context(), 'owned-context');
        const browser = page.context().browser?.();
        if (browser) slot.bridge.registerLifecycle(browser, 'browser-connection-only', 'disconnected');
        // The page observer restores its page wrapper; this owner disposes the SESSION
        // only after the original iteration's result and owned context close are known.
        const pageSession = { ...slot.bridge.session, dispose() {} };
        observed = await observeStartupPage(page, pageSession, slot.output);
        const closeObserved = page.close;
        page.close = async (...args) => {
          let value, error;
          try { value = await Reflect.apply(closeObserved, page, args); }
          catch (caught) { error = caught; }
          try { await page.context().close(); slot.contextClosed = true; }
          catch (caught) { slot.bridge.session.observerError(caught); }
          if (error) throw error;
          return value;
        };
        await prepare(observed);
      });
      return observed;
    } catch (error) {
      try { await raw?.close(); } catch (cleanup) { slot.bridge.session.observerError(cleanup); }
      throw error;
    }
  };
  try {
    const result = await check(observedAt);
    await finish(current); return result;
  } catch (error) { await finish(current, error); throw error; }
}
