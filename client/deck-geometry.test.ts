import { expect, it } from "vitest";
import { areaAt, clearLine, createFloor, findPath, walkable } from "./deck-geometry";

it("keeps concave, overlapping and sloped floor edges exact after bounding-box rejection", () => {
  const floor = createFloor({
    areas: [
      { id: "L", polygon: [[-4, -4], [4, -4], [4, 0], [0, 0], [0, 4], [-4, 4]] },
      { id: "triangle", polygon: [[-2, -2], [8, -2], [-2, 8]] },
    ],
    obstacles: [{ id: "box", rect: [-2, -2, 1, 1] }],
    grid: { cell: 1, bounds: [-5, -5, 14, 14] }, walkSpeed: 40,
  });
  for (let y = -5; y <= 9; y += 0.25) for (let x = -5; x <= 9; x += 0.25) {
    const inL = x >= -4 && x < 4 && y >= -4 && y < 4 && (x < 0 || y < 0);
    const inTriangle = x >= -2 && y >= -2 && x + y < 6;
    const blocked = x >= -2 && x < -1 && y >= -2 && y < -1;
    expect(areaAt(floor, x, y)?.id ?? null, `${x},${y}`).toBe(inL ? "L" : inTriangle ? "triangle" : null);
    expect(walkable(floor, x, y), `${x},${y}`).toBe((inL || inTriangle) && !blocked);
  }
});

it("counts actual half-pixel samples and search expansions, including unreachable fallbacks", () => {
  const floor = createFloor({
    areas: [{ id: "room", polygon: [[0, 0], [8, 0], [8, 8], [0, 8]] }],
    obstacles: [{ id: "wall", rect: [3, 0, 2, 8] }],
    grid: { cell: 1, bounds: [0, 0, 8, 8] }, walkSpeed: 40,
  });
  const from = { x: 1, y: 1 }, near = { x: 1, y: 2 }, far = { x: 6, y: 1 };
  const work = { expandedCells: 0, lineSamples: 0, failedSearches: 0 };
  expect(findPath(floor, from, near, work)).toEqual([near]);
  expect(work).toEqual({ expandedCells: 0, lineSamples: 3, failedSearches: 0 });
  expect(findPath(floor, from, far, work)).toEqual([far]);
  expect(work).toEqual({ expandedCells: 24, lineSamples: 8, failedSearches: 1 });
  expect(clearLine(floor, from, far)).toBe(false);
});
