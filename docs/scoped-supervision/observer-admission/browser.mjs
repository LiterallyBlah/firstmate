/** Prepared wrapper around the unchanged startup fixture. Not installed in render.mjs. */
import { join } from 'node:path';

export function startupPageAt(pageAt, createCase) {
  return async (query, width, prepare) => {
    const { session, output } = createCase();
    let observed;
    try {
      await session.run(() => pageAt(query, width, async page => {
        observed = await observeStartupPage(page, session, output);
        await prepare(observed);
      }));
      return observed;
    } catch (error) {
      // Preserve the pageAt failure even if observer/cleanup also fails.
      try { await observed?.close(); } catch (cleanup) { session.observerError(cleanup); }
      session.flush('pageAt-failure'); session.dispose(); throw error;
    }
  };
}

export async function observeStartupPage(page, session, output, { captureBudgetMs = 250 } = {}) {
  const context = page.context(), restores = [];
  const binding = `observer_${session.identity.caseId.replaceAll('-', '')}`;
  // Observer-only budget. Never passed as an action timeout; originals retain 10000ms.
  async function capture(label, work) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`Observer ${label} did not settle in ${captureBudgetMs}ms`)), captureBudgetMs);
      })]);
    } catch (error) { session.observerError(error); }
    finally { clearTimeout(timer); }
  }
  await capture('trace-start', () => context.tracing.start({ screenshots: true, snapshots: true, sources: true }));
  await capture('binding', () => page.exposeBinding(binding, (_source, value) => session.note('browser.pointer', JSON.stringify(value))));
  await capture('init-script', () => page.addInitScript(({ binding }) => {
    for (const type of ['pointerdown', 'pointerup']) document.addEventListener(type, event => {
      const target = event.target.closest?.('[data-testid="firstmate-deck-decision-legend"]');
      if (!target) return;
      const rect = target.getBoundingClientRect();
      // Recording never prevents/defaults/releases a native event or the startup gate.
      void window[binding]({ type, browserMs: performance.now(), drawing: document.body.innerText.includes('Drawn with WebGL'),
        x: event.clientX, y: event.clientY, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }).catch(() => {});
    }, true);
  }, { binding }));
  const seen = new WeakMap();
  function wrap(target, label) {
    if (seen.has(target)) return seen.get(target);
    const proxy = new Proxy(target, { get(object, key) {
      const value = Reflect.get(object, key, object);
      if (typeof value !== 'function') return value;
      if (['getByText', 'getByTestId', 'getByRole'].includes(key)) return (...args) => wrap(Reflect.apply(value, object, args), `${label}.${String(key)}(${String(args[0]).slice(0, 120)})`);
      if (key === 'waitFor' || key === 'click') return (...args) => {
        session.note(`browser.${key}.entry`, JSON.stringify({ label, args }));
        if (key === 'click') void capture('geometry', async () => {
          const geometry = await page.evaluate(() => {
            const target = document.querySelector('[data-testid="firstmate-deck-decision-legend"]');
            const rect = target?.getBoundingClientRect();
            return { browserMs: performance.now(), drawing: document.body.innerText.includes('Drawn with WebGL'),
              rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null };
          });
          session.note('browser.geometry', JSON.stringify(geometry));
        });
        let result;
        try { result = Reflect.apply(value, object, args); }
        catch (error) { session.note(`browser.${key}.throw`, error.message); throw error; }
        void result.then(() => session.note(`browser.${key}.complete`, label), error => {
          session.note(`browser.${key}.failed`, JSON.stringify({ label, message: error.message })); session.flush('action-failure');
        }).catch(error => session.observerError(error));
        return result; // held delay, timeout, result and original failure are unchanged
      };
      return value.bind(object);
    } });
    seen.set(target, proxy); return proxy;
  }
  // Existing fixture closes in finally: retain trace and receipt BEFORE original close.
  const originalClose = page.close;
  page.close = async function (...args) {
    try {
      await capture('trace-stop', () => context.tracing.stop({ path: join(output, `${session.identity.caseId}.zip`) }));
      session.flush('before-page-close');
    } finally {
      for (const restore of restores) restore();
      session.dispose();
    }
    return Reflect.apply(originalClose, page, args);
  };
  restores.push(() => { page.close = originalClose; });
  return wrap(page, 'page');
}
