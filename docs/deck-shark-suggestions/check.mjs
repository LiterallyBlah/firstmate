/** Real compiled client, renderer and RPCs; host fixture only. No daemon changes. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkSharkSuggestions(view, manifest, phase) {
  const output = join(dirname(fileURLToPath(import.meta.url)), 'review');
  await mkdir(output, { recursive: true });
  const canvas = view.locator('canvas[data-firstmate-deck]');
  const popup = view.getByTestId('firstmate-deck-suggestions');
  const refresh = async () => { await view.getByRole('button', { name: 'Refresh', exact: true }).click(); await view.waitForTimeout(500); };
  await view.evaluate(() => window.changeFleet(fleet => {
    fleet.cards = fleet.cards.filter(c => c.agent !== null && c.agent.status !== 'closed').slice(0, 4);
    fleet.cards[0].column = 'blocked';
    fleet.suggestions = [{ label: 'Review next steps', prompt: 'Review the next steps for the fleet.' }, { label: 'Take bearings', prompt: 'Give me a summary of the current work.' }, { label: 'Plan tomorrow', prompt: 'Help me plan tomorrow.' }];
  }));
  await refresh();
  const shot = async name => { await view.mouse.move(1, 1); await view.screenshot({ path: join(output, `${manifest.id}-${phase}-${name}.png`) }); };
  const shark = async () => {
    const fit = await view.evaluate(m => { const { fit } = window.drawOverlay(m); document.querySelector('[data-firstmate-deck-overlay]').remove(); return fit; }, manifest);
    const box = await canvas.boundingBox();
    await view.mouse.click(box.x + fit.x + (manifest.attentionCarrier.at[0] + 30) * fit.scale, box.y + fit.y + (manifest.attentionCarrier.at[1] + 30) * fit.scale);
  };
  for (const hour of [12, 0]) {
    await view.clock.setFixedTime(new Date(`2026-10-14T${String(hour).padStart(2, '0')}:00:00Z`));
    for (const width of [900, 640]) {
      await view.setViewportSize({ width, height: 900 });
      await view.waitForTimeout(500);
      await shot(`${hour === 12 ? 'day' : 'night'}-${width}`);
      if (phase !== 'before') {
        await shark();
        await popup.waitFor();
        const box = await popup.boundingBox(), deck = await canvas.boundingBox();
        assert(box.x >= deck.x && box.y >= deck.y && box.x + box.width <= deck.x + deck.width && box.y + box.height <= deck.y + deck.height, 'suggestions stay on canvas');
        assert.equal(await view.getByTestId('firstmate-deck-focus').count(), 0);
        assert.deepEqual(await popup.getByRole('button').filter({ hasText: /Review next steps|Take bearings|Plan tomorrow/ }).allTextContents(), [
          'Review next stepsReview the next steps for the fleet.', 'Take bearingsGive me a summary of the current work.', 'Plan tomorrowHelp me plan tomorrow.'
        ]);
        await shot(`${hour === 12 ? 'day' : 'night'}-${width}-bubbles`);
        await view.keyboard.press('Escape');
        await popup.waitFor({ state: 'hidden' });
      }
    }
  }
  if (phase === 'before') return;
  await shark(); await popup.waitFor(); await shark(); await popup.waitFor({ state: 'hidden' });
  const trigger = view.getByRole('button', { name: 'Shark suggestions', exact: true });
  await trigger.focus(); await view.keyboard.press('Enter'); await popup.waitFor();
  await view.mouse.click(1, 1); await popup.waitFor({ state: 'hidden' });
  await shark(); await popup.waitFor(); await shot('01-click-shark');
  await popup.getByRole('button', { name: /^Review next steps: send/ }).click();
  await view.waitForTimeout(500);
  await shot('02-picked');
  // The deck's existing suggest handler returns to Home chat, as the List/Board strip does.
  assert.ok(await view.evaluate(() => window.fixtureCalls.some(call => call.name === 'firstmate.mate.ask' && call.input.text === 'Review the next steps for the fleet.')));
  await view.getByRole('button', { name: 'Open Deck', exact: true }).click();
  await canvas.waitFor(); await view.waitForTimeout(500);
  await shark(); await popup.waitFor();
  assert.equal(await popup.getByRole('button', { name: /^Review next steps: send/ }).getAttribute('aria-disabled'), 'true');
  await shot('03-answered');
  await view.keyboard.press('Escape');
  // A held send gates every option, even across leaving Deck and reopening it. Failure restores the choice.
  await view.evaluate(() => { window.fixtureSharkSend = true; });
  await refresh(); await shark(); await popup.waitFor();
  await popup.getByRole('button', { name: /^Take bearings: send/ }).click();
  await view.getByRole('button', { name: 'Open Deck', exact: true }).click();
  await canvas.waitFor(); await view.waitForTimeout(500); await shark(); await popup.waitFor();
  for (const button of await popup.getByRole('button').filter({ hasText: /Review next steps|Take bearings|Plan tomorrow/ }).all())
    assert.equal(await button.getAttribute('aria-disabled'), 'true');
  await view.evaluate(() => window.finishSharkSend('Fixture delivery failure'));
  await view.waitForFunction(() => window.fixtureErrors.includes('Fixture delivery failure'));
  await popup.getByRole('button', { name: /^Take bearings: send/ }).waitFor();
  assert.notEqual(await popup.getByRole('button', { name: /^Take bearings: send/ }).getAttribute('aria-disabled'), 'true');
  await view.keyboard.press('Escape');
  await view.evaluate(() => { window.fixtureSharkSend = false; });
  // Long lists scroll inside the available canvas space, without losing entries.
  await view.evaluate(() => window.changeFleet(fleet => { fleet.suggestions = Array.from({ length: 24 }, (_, i) => ({ label: 'Option ' + i, prompt: 'A longer suggestion to verify the list can scroll inside the deck. '.repeat(3) + i })); }));
  await refresh(); await shark(); await popup.waitFor();
  const last = popup.getByRole('button', { name: /^Option 23: send/ });
  await last.scrollIntoViewIfNeeded(); assert.equal(await popup.getByRole('button').count(), 25);
  await shot('long-list'); await view.keyboard.press('Escape');
  await view.evaluate(() => window.changeFleet(fleet => { fleet.suggestions = []; fleet.cards = []; }));
  await refresh(); await shark(); await popup.waitFor();
  await popup.getByText('Nothing to suggest right now.').waitFor(); await shot('empty');
  await writeFile(join(output, `${manifest.id}-checks.json`), JSON.stringify({ checks: ['day/night 640/900 bounds', 'file order', 'no worker focus', 'shark toggle', 'Escape', 'keyboard', 'outside click', 'existing send path', 'answered', 'pending send gate across mounts', 'failure toast and retry', 'long list scrolling', 'empty without crew'] }, null, 2) + '\n');
}
