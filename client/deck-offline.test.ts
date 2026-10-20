import { expect, it, vi } from "vitest";
import { displaySettings } from "../shared/settings";
import { createDisconnectedReveals, hiddenWorkersText } from "./deck-offline";

it("defaults old settings documents on and preserves an explicit off through serialization", () => {
  expect(displaySettings.schema.parse({ pollSeconds: 10 }).hideDisconnectedWorkers).toBe(true);
  const saved = displaySettings.schema.parse({ hideDisconnectedWorkers: false });
  expect(displaySettings.schema.parse(JSON.parse(JSON.stringify(saved))).hideDisconnectedWorkers).toBe(false);
  expect(displaySettings.version).toBe(1);
});

it("shares Show across bundle reloads, scopes it by host, and forgets it in a new app session", () => {
  const session = {}, first = createDisconnectedReveals(session), reloaded = createDisconnectedReveals(session);
  const changed = vi.fn(), unsubscribe = first.subscribe(changed);
  reloaded.show("local-daemon");
  expect(first.has("local-daemon")).toBe(true);
  expect(first.has("another-daemon")).toBe(false);
  expect(changed).toHaveBeenCalledOnce();
  expect(createDisconnectedReveals({}).has("local-daemon")).toBe(false);
  unsubscribe();
  reloaded.show("another-daemon");
  expect(changed).toHaveBeenCalledOnce();
});

it("labels worker and host totals independently", () => {
  expect(hiddenWorkersText(1, 1)).toBe("1 worker hidden on 1 offline host");
  expect(hiddenWorkersText(12, 1)).toBe("12 workers hidden on 1 offline host");
  expect(hiddenWorkersText(12, 2)).toBe("12 workers hidden on 2 offline hosts");
});
