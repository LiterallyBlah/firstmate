/**
 * The focus host (`docs/ship-deck-focus/host.jsx`: the crowded fleet and `window.focusAnchor()`), plus the
 * first mate's suggestions as replies:
 *
 * - `?replies=1` gives the fleet suggestions that name four crewmates — block-0, block-1 (two replies),
 *   block-2 and work-5 — beside the fixture's two that name no one;
 * - `?replies=all` gives one more naming every crewmate on deck, for the crowded deck's markers;
 * - `window.deckSpots()` and `window.deckMarks()` say where every sailor and every reply marker is on the
 *   page, worked out with the deck's own crew placement, fit and `askMarks`, as the still deck stands them.
 *   Both use the fit the tall mast gives the deck (`deckBox` from its top, as `docs/ship-deck-mast/host.jsx`
 *   does), which replaces the rest host's `deckSpots` here.
 */
import "../ship-deck-focus/host.jsx";
import { applyCrew, createCrew, crewFigures } from "../../client/deck-crew";
import { askMarks, badgeTop, figureBox, markBox, toCanvas } from "../../client/deck-hover";
import { deckBox, fitDeck } from "../../client/deck-pixi";
import { deckScene } from "../../client/deck-scene";
import { answeredReplies, repliesByCard } from "../../client/deck-replies";

/** The tall rig's top, in deck rows above the hull (`docs/ship-deck-mast/host.jsx`). */
const RIG_TOP = -112;

const REPLIES = [
  { label: "Smoke check passed", prompt: "block-0: I ran the local smoke check on the live panel and it passed; carry on." },
  { label: "Reviewed PR", prompt: "For block-1, deliver the next chapter review as a reviewed pull request." },
  { label: "Local-only", prompt: "For block-1, deliver the next chapter review local-only." },
  { label: "Opening B reads best", prompt: "Tell block-2 the second story opening reads best; roll that one out." },
  { label: "Stop waiting", prompt: "Tell work-5 to stop waiting on the background check and report what it has." },
];

const mountPlugin = window.mountPlugin;
window.mountPlugin = function mountReplies(source, params) {
  mountPlugin(source, params);
  const replies = params.get("replies");
  if (replies === null) return;
  const fleet = window.fixtureFleet;
  const everyone =
    replies === "all"
      ? [{ label: "Report in", prompt: `Ask ${fleet.cards.map((card) => card.taskId).filter(Boolean).join(", ")} to report where they are.` }]
      : [];
  window.fixtureFleet = { ...fleet, suggestions: [...REPLIES, ...everyone, ...fleet.suggestions] };
};

/** The still deck as the page shows it: the crew at their anchors, the markers, and deck → page. */
async function stillDeck() {
  const { manifest } = await (await fetch("/deck-art.json")).json();
  const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
  const fit = fitDeck({ width: rect.width, height: rect.height }, deckBox({ width: 426, height: 161 }, RIG_TOP), window.devicePixelRatio);
  const cards = window.fixtureFleet.cards;
  const asking = new Set(repliesByCard(cards, window.fixtureFleet.suggestions, answeredReplies.has).keys());
  const scene = deckScene(cards, window.fixtureTheme, { asking });
  const crew = createCrew();
  applyCrew(crew, scene.sailors, { snap: true });
  const figures = crewFigures(crew, 0, { still: true });
  const page = (point) => {
    const at = toCanvas(point, fit, { x: 0, y: 0 });
    return { x: rect.left + at.x, y: rect.top + at.y };
  };
  const onPage = (box) => {
    const topLeft = page({ x: box.left, y: box.top });
    const bottomRight = page({ x: box.right, y: box.bottom });
    return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
  };
  return { manifest, scene, figures, marks: askMarks(figures, manifest), page, onPage };
}

/** Every sailor on the page: its key, state and title, its box (badge included, marker not), the middle of its badge. */
window.deckSpots = async function deckSpots() {
  const { manifest, scene, figures, page, onPage } = await stillDeck();
  return figures.map((figure) => ({
    key: figure.key,
    state: figure.state,
    title: scene.sailors.find((each) => each.key === figure.key).caption.title,
    deck: { x: figure.x, y: figure.row },
    box: onPage(figureBox(figure, manifest)),
    badge: page({ x: figure.x + 0.5, y: badgeTop(figure, manifest) + 3.5 }),
  }));
};

/** Every reply marker on the page: its sailor's key, whether it is the badge's frame, and its box. */
window.deckMarks = async function deckMarks() {
  const { marks, onPage } = await stillDeck();
  return [...marks.entries()].map(([key, mark]) => ({ key, framed: mark.framed, box: onPage(markBox(mark)) }));
};
