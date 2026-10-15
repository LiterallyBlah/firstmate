/**
 * Where a sailor can stand and walk on hull C, and how it gets from one place to another. Pure.
 *
 * Everything is in the deck's own coordinates (`art/ship-deck/deck.json`'s ship frame, 426 × 161) and
 * is a sailor's **feet**: the row a sailor's feet are on is also its depth (`client/deck-scene.ts`).
 *
 * - **The walkable deck** is three polygons read off the atlas: the main deck from the bow to the foot
 *   of the stairs, the stairs, and the quarterdeck in front of the wheel. The main deck and the
 *   quarterdeck meet only on the stairs, so a sailor bound for the helm climbs them. The stairs are part
 *   of the hull's `near` depth piece, so a sailor on them is drawn behind their balustrade.
 * - **Obstacles** are the feet of what stands on deck: the mast's foot, the bollards, the props and the
 *   wheel. A path never crosses one.
 * - **Anchors** are the named places a state sends a sailor to, each with the way it faces there.
 *   `client/deck-crew.ts` reserves them, one sailor each.
 * - **The rest areas** are where idle crew go, off the working deck: the foredeck by the hatch, between
 *   the bow and the stations, and the foot of the quarterdeck stairs. Their anchors are spaced so every
 *   sleeper's badge stays in sight, and past them `restSpot` packs more in without covering one.
 * - **Paths** are A* over a 2-pixel grid of the walkable deck, then pulled tight: a corner is kept only
 *   where the straight line past it would leave the deck.
 *
 * `client/ship-deck.test.ts` holds all of it to the atlas's own pixels: every anchor and every walkable
 * cell on the hull, every path between any two anchors on the deck all the way.
 */

export interface Point {
  x: number;
  y: number;
}

/** Which way a sailor faces at its anchor. The side poses are drawn facing right. */
export type Facing = "left" | "right" | "front";

/** The places on deck an application state sends a sailor to. */
export type AnchorPlace = "station" | "rest" | "helm" | "bow";

export interface Anchor extends Point {
  id: string;
  place: AnchorPlace;
  facing: Facing;
}

/** The hatch: where a new crewmate climbs up from, and an archived one goes back down. */
export const HATCH: Point = { x: 140, y: 104 };

type Polygon = ReadonlyArray<readonly [number, number]>;

/**
 * The walkable deck, as feet positions. Read from the atlas (`docs/ship-deck-motion/README.md` has the
 * map): the far bulwark's foot is about row 86, the near rail runs from (47, 96) at the bow to row 121
 * amidships, the stairs fill x 322–358 below row 89, and the quarterdeck is open from row 90 (in front
 * of the wheel's foot) to row 96 (behind its front rail).
 */
export const WALKABLE: ReadonlyArray<{ name: string; polygon: Polygon }> = [
  { name: "main deck", polygon: [[54, 89], [320, 86], [320, 119], [117, 119], [60, 98]] },
  { name: "stairs", polygon: [[314, 104], [352, 89], [362, 90], [362, 96], [326, 117], [314, 118]] },
  { name: "quarterdeck", polygon: [[356, 90], [403, 90], [401, 96], [356, 96]] },
];

/** Feet-space rectangles nobody walks through: [x, y, width, height]. */
export const OBSTACLES: ReadonlyArray<{ name: string; rect: readonly [number, number, number, number] }> = [
  { name: "mast", rect: [200, 102, 24, 11] },
  { name: "bollard-bow-aft", rect: [74, 89, 13, 7] },
  { name: "bollard-gunwale-fore", rect: [269, 114, 10, 8] },
  { name: "bollard-gunwale-aft", rect: [291, 114, 10, 8] },
  { name: "barrel", rect: [244, 84, 16, 7] },
  { name: "crate", rect: [298, 85, 17, 7] },
  { name: "rope", rect: [170, 112, 17, 6] },
  { name: "wheel", rect: [360, 86, 20, 4] },
];

/**
 * The anchors, in order of preference within each place. The stations surround the mast and the
 * deck's stores; the helm spots are on the quarterdeck around the wheel; the bow spots are forward of
 * the hatch, round the bow's bollard. The rest spots are in the rest areas, filled in this order so a
 * few sleepers stand apart and a crowd stays tidy: the foredeck's front row along the near rail, its
 * back row nineteen rows behind (head and badge clear of the front row), the foot of the stairs, and
 * only then the gaps between the foredeck's rows.
 */
export const ANCHORS: readonly Anchor[] = [
  { id: "mast-fore", place: "station", x: 194, y: 106, facing: "right" },
  { id: "mast-aft", place: "station", x: 230, y: 106, facing: "left" },
  { id: "barrel", place: "station", x: 238, y: 91, facing: "right" },
  { id: "crate", place: "station", x: 290, y: 94, facing: "right" },
  { id: "rope", place: "station", x: 164, y: 116, facing: "right" },
  { id: "hatch-side", place: "station", x: 166, y: 97, facing: "left" },
  { id: "mast-far", place: "station", x: 212, y: 94, facing: "front" },
  { id: "rest-1", place: "rest", x: 132, y: 117, facing: "front" },
  { id: "rest-2", place: "rest", x: 120, y: 117, facing: "front" },
  { id: "rest-3", place: "rest", x: 144, y: 117, facing: "front" },
  { id: "rest-4", place: "rest", x: 132, y: 98, facing: "front" },
  { id: "rest-5", place: "rest", x: 120, y: 98, facing: "front" },
  { id: "rest-6", place: "rest", x: 144, y: 98, facing: "front" },
  { id: "rest-7", place: "rest", x: 312, y: 117, facing: "front" },
  { id: "rest-8", place: "rest", x: 312, y: 98, facing: "front" },
  { id: "rest-9", place: "rest", x: 316, y: 107, facing: "front" },
  { id: "rest-10", place: "rest", x: 126, y: 107, facing: "front" },
  { id: "rest-11", place: "rest", x: 138, y: 107, facing: "front" },
  { id: "rest-12", place: "rest", x: 126, y: 89, facing: "front" },
  { id: "rest-13", place: "rest", x: 138, y: 89, facing: "front" },
  { id: "helm-1", place: "helm", x: 386, y: 92, facing: "front" },
  { id: "helm-2", place: "helm", x: 366, y: 94, facing: "front" },
  { id: "helm-3", place: "helm", x: 397, y: 94, facing: "front" },
  { id: "helm-4", place: "helm", x: 376, y: 95, facing: "front" },
  { id: "bow-1", place: "bow", x: 94, y: 98, facing: "front" },
  { id: "bow-2", place: "bow", x: 70, y: 94, facing: "front" },
  { id: "bow-3", place: "bow", x: 106, y: 108, facing: "front" },
  { id: "bow-4", place: "bow", x: 84, y: 103, facing: "front" },
];

export function anchorsAt(place: AnchorPlace): Anchor[] {
  return ANCHORS.filter((anchor) => anchor.place === place);
}

function inPolygon(polygon: Polygon, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a sailor's feet can be at this point: on the walkable deck and clear of every obstacle. */
export function walkable(x: number, y: number): boolean {
  if (!WALKABLE.some((area) => inPolygon(area.polygon, x, y))) return false;
  return !OBSTACLES.some(({ rect: [rx, ry, rw, rh] }) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
}

/** The walkable area's name at a point, or null: the stairs are drawn behind their balustrade. */
export function areaAt(x: number, y: number): string | null {
  return WALKABLE.find((area) => inPolygon(area.polygon, x, y))?.name ?? null;
}

/** Whether the straight line from `a` to `b` stays on the walkable deck, checked every half pixel. */
export function clearLine(a: Point, b: Point): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    if (!walkable(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

const CELL = 2;
const GRID_X = 40;
const GRID_Y = 80;
const COLUMNS = Math.ceil((424 - GRID_X) / CELL);
const ROWS = Math.ceil((126 - GRID_Y) / CELL);

let gridCache: Uint8Array | null = null;

/** The walkable deck as cells: 1 where the cell's centre is walkable. Made once. */
function grid(): Uint8Array {
  if (gridCache !== null) return gridCache;
  const cells = new Uint8Array(COLUMNS * ROWS);
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const centre = cellCentre(column, row);
      cells[row * COLUMNS + column] = walkable(centre.x, centre.y) ? 1 : 0;
    }
  }
  gridCache = cells;
  return cells;
}

function cellCentre(column: number, row: number): Point {
  return { x: GRID_X + column * CELL + CELL / 2, y: GRID_Y + row * CELL + CELL / 2 };
}

/** The walkable cell nearest a point, searched outward ring by ring, or -1 when there is none near. */
function nearestCell(point: Point): number {
  const cells = grid();
  const column = Math.floor((point.x - GRID_X) / CELL);
  const row = Math.floor((point.y - GRID_Y) / CELL);
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let radius = 0; radius < 12 && best < 0; radius += 1) {
    for (let r = row - radius; r <= row + radius; r += 1) {
      for (let c = column - radius; c <= column + radius; c += 1) {
        if (r < 0 || c < 0 || r >= ROWS || c >= COLUMNS || cells[r * COLUMNS + c] !== 1) continue;
        const centre = cellCentre(c, r);
        const distance = Math.hypot(centre.x - point.x, centre.y - point.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = r * COLUMNS + c;
        }
      }
    }
  }
  return best;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** A* over the cells, 8-way, never cutting a blocked corner. The cells from start to goal, or null. */
function search(start: number, goal: number): number[] | null {
  const cells = grid();
  const cost = new Float64Array(cells.length).fill(Number.POSITIVE_INFINITY);
  const from = new Int32Array(cells.length).fill(-1);
  const closed = new Uint8Array(cells.length);
  const goalColumn = goal % COLUMNS;
  const goalRow = Math.floor(goal / COLUMNS);
  const estimate = (cell: number) => {
    const dx = Math.abs((cell % COLUMNS) - goalColumn);
    const dy = Math.abs(Math.floor(cell / COLUMNS) - goalRow);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  // A binary heap of [priority, cell]: a few thousand cells at most.
  const heap: Array<[number, number]> = [];
  const push = (item: [number, number]) => {
    heap.push(item);
    for (let at = heap.length - 1; at > 0; ) {
      const parent = (at - 1) >> 1;
      if (heap[parent]![0] <= heap[at]![0]) break;
      [heap[parent], heap[at]] = [heap[at]!, heap[parent]!];
      at = parent;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let at = 0; ; ) {
        const left = at * 2 + 1;
        const right = left + 1;
        let least = at;
        if (left < heap.length && heap[left]![0] < heap[least]![0]) least = left;
        if (right < heap.length && heap[right]![0] < heap[least]![0]) least = right;
        if (least === at) break;
        [heap[least], heap[at]] = [heap[at]!, heap[least]!];
        at = least;
      }
    }
    return top;
  };
  cost[start] = 0;
  push([estimate(start), start]);
  while (heap.length > 0) {
    const [, cell] = pop();
    if (closed[cell] === 1) continue;
    if (cell === goal) {
      const cellsOnPath = [cell];
      for (let at = from[cell]!; at >= 0; at = from[at]!) cellsOnPath.unshift(at);
      return cellsOnPath;
    }
    closed[cell] = 1;
    const column = cell % COLUMNS;
    const row = Math.floor(cell / COLUMNS);
    for (const [dx, dy, step] of NEIGHBOURS) {
      const c = column + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= COLUMNS || r >= ROWS) continue;
      const next = r * COLUMNS + c;
      if (cells[next] !== 1 || closed[next] === 1) continue;
      if (dx !== 0 && dy !== 0 && (cells[row * COLUMNS + c] !== 1 || cells[r * COLUMNS + column] !== 1)) continue;
      const through = cost[cell]! + step;
      if (through < cost[next]!) {
        cost[next] = through;
        from[next] = cell;
        push([through + estimate(next), next]);
      }
    }
  }
  return null;
}

/**
 * The way from `from` to `to` on the walkable deck: the corners to walk through, ending at `to`
 * itself. Empty when already there. A point off the deck (a sailor caught mid-step) starts from the
 * nearest walkable cell. When there is no way at all, the one straight step, so nobody is stranded.
 */
export function findPath(from: Point, to: Point): Point[] {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 0.5) return [];
  if (walkable(from.x, from.y) && clearLine(from, to)) return [{ x: to.x, y: to.y }];
  const start = nearestCell(from);
  const goal = nearestCell(to);
  const cells = start < 0 || goal < 0 ? null : search(start, goal);
  if (cells === null) return [{ x: to.x, y: to.y }];
  const corners: Point[] = cells.map((cell) => cellCentre(cell % COLUMNS, Math.floor(cell / COLUMNS)));
  corners.push({ x: to.x, y: to.y });
  // Pull the string tight: from each kept point, skip ahead to the furthest point still in sight.
  const tight: Point[] = [];
  let at: Point = walkable(from.x, from.y) ? from : corners[0]!;
  if (at !== from) tight.push(at);
  let index = at === from ? 0 : 1;
  while (index < corners.length) {
    let furthest = index;
    for (let ahead = corners.length - 1; ahead > index; ahead -= 1) {
      if (clearLine(at, corners[ahead]!)) {
        furthest = ahead;
        break;
      }
    }
    at = corners[furthest]!;
    tight.push(at);
    index = furthest + 1;
  }
  return tight;
}

/** The length of a walk from `from` through `path`. */
export function pathLength(from: Point, path: readonly Point[]): number {
  let length = 0;
  let at = from;
  for (const point of path) {
    length += Math.hypot(point.x - at.x, point.y - at.y);
    at = point;
  }
  return length;
}

let openDeck: Point[] | null = null;

/** Every other walkable pixel off the stairs, made once: where a crowd can spill. */
function openDeckPoints(): Point[] {
  if (openDeck !== null) return openDeck;
  const points: Point[] = [];
  for (let y = 80; y < 126; y += 1) {
    for (let x = 40; x < 424; x += 2) {
      const area = areaAt(x, y);
      if (area !== null && area !== "stairs" && walkable(x, y)) points.push({ x, y });
    }
  }
  openDeck = points;
  return points;
}

/**
 * A spot at an anchor for one more sailor: the anchor itself while nobody stands there, else the
 * nearest open spot beside it on the same deck, never within a few pixels of another taken spot and
 * never on the stairs, where the balustrade would hide a sailor's legs. Only when that deck is full —
 * a crowd at the helm, say — does it spill onto the nearest other deck. The anchor itself when the
 * whole ship is full.
 */
export function sharedSpot(anchor: Point, taken: readonly Point[]): Point {
  const crowded = (spot: Point) => taken.some((other) => Math.abs(other.x - spot.x) < 6 && Math.abs(other.y - spot.y) < 3);
  if (!crowded(anchor)) return { x: anchor.x, y: anchor.y };
  const area = areaAt(anchor.x, anchor.y);
  const cost = (spot: Point) => Math.hypot((spot.x - anchor.x) / 2, spot.y - anchor.y) + (areaAt(spot.x, spot.y) === area ? 0 : 1000);
  let best: Point | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const spot of openDeckPoints()) {
    const value = cost(spot);
    if (value < bestCost && !crowded(spot)) {
      best = spot;
      bestCost = value;
    }
  }
  return best === null ? { x: anchor.x, y: anchor.y } : { x: best.x, y: best.y };
}

/**
 * The rest areas, as feet-space rectangles [x, y, width, height]: the foredeck between the bow's spots
 * and the stations by the hatch, and the main deck's aft end between the crate's station and the
 * stairs. A sleeper standing anywhere in them covers no anchor of another place.
 */
export const REST_AREAS: ReadonlyArray<readonly [number, number, number, number]> = [
  [120, 86, 29, 34],
  [310, 95, 9, 25],
];

/**
 * How far apart sleepers stand: a badge's width across or its height (tail and gap included) down,
 * so no sleeper's badge is covered by another sleeper. The rest anchors keep it among themselves.
 */
export const REST_SPACING = { x: 8, y: 9 } as const;

/** Whether a point is in a rest area. */
export function inRestArea(point: Point): boolean {
  return REST_AREAS.some(([x, y, width, height]) => point.x >= x && point.x < x + width && point.y >= y && point.y < y + height);
}

/**
 * Where a sleeper stands at a rest anchor: the anchor itself while it stands `REST_SPACING` clear of
 * every taken spot, else the open spot in the rest areas nearest it that does. Only when the rest areas
 * hold no such spot does it settle for `sharedSpot`'s closer spacing, still in
 * the rest areas; the anchor itself when even that is gone. Never on the working deck.
 */
export function restSpot(anchor: Point, taken: readonly Point[]): Point {
  for (const spacing of [REST_SPACING, { x: 6, y: 3 }]) {
    const crowded = (spot: Point) => taken.some((other) => Math.abs(other.x - spot.x) < spacing.x && Math.abs(other.y - spot.y) < spacing.y);
    let best: Point | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const spot of openDeckPoints()) {
      if (!inRestArea(spot)) continue;
      const cost = Math.hypot(spot.x - anchor.x, spot.y - anchor.y);
      if (cost < bestCost && !crowded(spot)) {
        best = spot;
        bestCost = cost;
      }
    }
    if (best !== null) return { x: best.x, y: best.y };
  }
  return { x: anchor.x, y: anchor.y };
}
