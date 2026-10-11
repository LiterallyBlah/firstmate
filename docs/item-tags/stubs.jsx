/** Reuse the existing host fixture; tag RPCs and display settings are isolated browser state. */
export * from "../board-list/stubs";
import { useCallback, useState } from "react";
import { useRpc as hostRpc } from "../board-list/stubs";
import { fleet } from "../board-list/fixtures";
import { itemTagKey, tagIdentity } from "../../shared/item-tags";

const edit = async (input) => {
  window.fixtureCalls.push({ name: "firstmate.item.tag", input });
  if (window.fixtureFailTag)
    throw new Error("Fixture save conflict; refresh and try again.");
  const cards = fleet.cards.filter((card) => itemTagKey(card) === input.key);
  const tags = cards[0].tags.filter(
    (tag) => tagIdentity(tag) !== tagIdentity(input.tag),
  );
  if (input.present) tags.push(input.tag);
  for (const card of cards) card.tags = tags;
  const store = JSON.parse(localStorage.getItem("fixture-item-tags") ?? "{}");
  store[input.key] = tags;
  localStorage.setItem("fixture-item-tags", JSON.stringify(store));
  return { key: input.key, tags };
};
export function useRpc(contract) {
  const original = hostRpc(contract);
  return contract.name === "firstmate.item.tag" ? edit : original;
}
export function useSettings(contract) {
  const [values, setValues] = useState(() =>
    contract.schema.parse({
      chatWidthFraction: 0.36,
      crewView: new URLSearchParams(location.search).get("view") ?? "list",
      ...JSON.parse(localStorage.getItem("fixture-display") ?? "{}"),
    }),
  );
  const [revision, setRevision] = useState(1);
  const save = useCallback(async (next) => {
    localStorage.setItem("fixture-display", JSON.stringify(next));
    window.fixtureSettings = next;
    setValues(next);
    setRevision((value) => value + 1);
    return true;
  }, []);
  return { status: "ready", values, revision, save, saveError: null };
}
