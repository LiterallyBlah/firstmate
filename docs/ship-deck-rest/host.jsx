/**
 * The ship deck's host (`docs/ship-deck-canvas/host.jsx`), plus what the rest-area checks need:
 *
 * - `?crowd=1` puts nine more idle crewmates aboard the fixture fleet, eleven idle in all beside its five
 *   working, one waiting and four blocked — the live deck the captain described, the sleepers outnumbering
 *   the crew at work;
 * - `window.deckSpots()` says where every sailor is on screen, worked out with the deck's own crew
 *   placement, fit and hit boxes: its key, state and title, its box, and the middle of its badge;
 * - `window.wake(key)` and `window.sleep(key)` move one crewmate between Working and Idle for the next
 *   fleet poll, so a walk to rest and back can be watched.
 */
import "../ship-deck-canvas/host.jsx";
import { applyCrew, createCrew, crewFigures, PLACES } from "../../client/deck-crew";
import { anchorsAt } from "../../client/deck-geometry";
import { badgeTop, figureBox, toCanvas } from "../../client/deck-hover";
import { fitDeck } from "../../client/deck-pixi";
import { deckScene } from "../../client/deck-scene";

const SLEEPERS = [
  "Tidy the chapter-craft notes into the style guide",
  "Re-run the humour drafts against the new rubric",
  "Sort the leftover tone experiments by outcome",
  "Collect the reviewers' notes on chapter openings",
  "Write up the coach prompt's failure cases",
  "Draft release notes for the story controls",
  "Measure the brief helper's response times",
  "Index the blind review packets by chapter",
  "List the stale branches in the Ariadne repo",
];

const mountPlugin = window.mountPlugin;
window.mountPlugin = function mountCrowd(source, params) {
  mountPlugin(source, params);
  if (params.get("crowd") !== "1") return;
  const fleet = window.fixtureFleet;
  const template = fleet.cards.find((card) => card.column === "idle");
  const extra = SLEEPERS.map((title, index) => {
    const key = `rest-${index}`;
    return {
      ...structuredClone(template),
      key,
      title,
      taskId: key,
      report: null,
      backlog: { ...template.backlog, id: key, title },
      remote: { ...template.remote, worker: { ...template.remote.worker, id: key, name: title, followed: false } },
    };
  });
  window.fixtureFleet = { ...fleet, cards: [...fleet.cards, ...extra] };
};

function setColumn(key, column) {
  window.fixtureFleet = {
    ...window.fixtureFleet,
    cards: window.fixtureFleet.cards.map((card) =>
      card.key !== key
        ? card
        : {
            ...card,
            column,
            note: null,
            report: column === "working" ? { state: "working", text: "Back at it" } : null,
            remote: card.remote == null ? card.remote : { ...card.remote, worker: { ...card.remote.worker, status: column === "working" ? "running" : "idle" } },
          },
    ),
  };
}
window.wake = (key) => setColumn(key, "working");
window.sleep = (key) => setColumn(key, "idle");

/** Every sailor on screen as the still deck stands it, in CSS px from the page's corner. */
window.deckSpots = async function deckSpots() {
  const { manifest } = await (await fetch("/deck-art.json")).json();
  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const rect = canvas.getBoundingClientRect();
  const fit = fitDeck({ width: rect.width, height: rect.height }, { width: 426, height: 161 }, window.devicePixelRatio);
  const scene = deckScene(window.fixtureFleet.cards, window.fixtureTheme);
  const crew = createCrew();
  applyCrew(crew, scene.sailors, { snap: true });
  const bob = { x: 0, y: 0 };
  const page = (point) => {
    const at = toCanvas(point, fit, bob);
    return { x: rect.left + at.x, y: rect.top + at.y };
  };
  return crewFigures(crew, 0, { still: true }).map((figure) => {
    const box = figureBox(figure, manifest);
    const topLeft = page({ x: box.left, y: box.top });
    const bottomRight = page({ x: box.right, y: box.bottom });
    const sailor = scene.sailors.find((each) => each.key === figure.key);
    return {
      key: figure.key,
      state: figure.state,
      title: sailor.caption.title,
      deck: { x: figure.x, y: figure.row },
      box: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y },
      badge: page({ x: figure.x + 0.5, y: badgeTop(figure, manifest) + 3.5 }),
    };
  });
};

/** The middle of the badge of a sailor at each spot `state`'s place has, every anchor of it held: where to look for a walker. */
window.placeBadges = async function placeBadges(state) {
  const { manifest } = await (await fetch("/deck-art.json")).json();
  const canvas = document.querySelector("canvas[data-firstmate-deck]");
  const rect = canvas.getBoundingClientRect();
  const fit = fitDeck({ width: rect.width, height: rect.height }, { width: 426, height: 161 }, window.devicePixelRatio);
  const crew = createCrew();
  const count = anchorsAt(PLACES[state]).length;
  applyCrew(
    crew,
    Array.from({ length: count }, (_, index) => ({ key: `spot-${String(index).padStart(2, "0")}`, label: "", state, identity: `spot-${index}`, stale: false, caption: null })),
    { snap: true },
  );
  return crewFigures(crew, 0, { still: true }).map((figure) => {
    const at = toCanvas({ x: figure.x + 0.5, y: badgeTop(figure, manifest) + 3.5 }, fit, { x: 0, y: 0 });
    return { deck: { x: figure.x, y: figure.row }, badge: { x: rect.left + at.x, y: rect.top + at.y } };
  });
};
