/**
 * The ship deck's host (`docs/ship-deck-canvas/host.jsx`), plus what the plank's checks need:
 *
 * - `window.leave(keys, column)` takes crewmates off the deck for the next fleet poll: to the Done column
 *   (`"done"`), or off the board altogether (`null`);
 * - `window.plankTimes(keys)` says, from the deck's own crew logic stepped the way the canvas steps it, how
 *   long after that poll each of them steps onto the plank — so the render can picture each beat of the
 *   sequence at its moment — with the sequence's own timings.
 */
import "../ship-deck-canvas/host.jsx";
import { applyCrew, createCrew } from "../../client/deck-crew";
import { CHOMP_AT, CHOMP_MS, FIN_AT, IMPACT_AT, PLANK_EXIT_MS, PLANK_WALK_MS, HOP_MS, TEETER_MS } from "../../client/deck-plank";
import { deckScene } from "../../client/deck-scene";
import { stepCrew } from "../../client/deck-crew";

let before = null;

window.leave = function leave(keys, column) {
  before = structuredClone(window.fixtureFleet.cards);
  window.fixtureFleet = {
    ...window.fixtureFleet,
    cards:
      column === null
        ? window.fixtureFleet.cards.filter((card) => !keys.includes(card.key))
        : window.fixtureFleet.cards.map((card) => (keys.includes(card.key) ? { ...card, column } : card)),
  };
};

window.plankTimes = function plankTimes(keys) {
  const crew = createCrew();
  applyCrew(crew, deckScene(before, window.fixtureTheme).sailors, { snap: true });
  const after = deckScene(window.fixtureFleet.cards, window.fixtureTheme);
  applyCrew(crew, after.sailors, { snap: false, departures: after.departures });
  const boards = {};
  for (let at = 0; at < 60_000 && Object.keys(boards).length < keys.length; at += 33) {
    stepCrew(crew, 33);
    for (const departure of crew.departures) {
      const key = departure.key.split("~")[0];
      if (keys.includes(key) && boards[key] === undefined) boards[key] = at + 33 - departure.ms;
    }
  }
  return {
    boards,
    sequence: { onPlank: HOP_MS + PLANK_WALK_MS / 2, teeter: HOP_MS + PLANK_WALK_MS + TEETER_MS / 2, impact: IMPACT_AT, fin: FIN_AT, chomp: CHOMP_AT, submerge: CHOMP_AT + CHOMP_MS, gone: PLANK_EXIT_MS },
  };
};
