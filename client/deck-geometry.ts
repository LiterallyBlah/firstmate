/**
 * Where a worker can stand and walk on a setting's floor, and how it gets from one place to another. Pure.
 *
 * Everything is in the stage's own coordinates (the setting's `stage.size`) and is a worker's **feet**: the
 * row a worker's feet are on is also its depth (`client/deck-scene.ts`). The floor comes from the setting pack
 * (`floor` in `shared/deck-setting.ts`), compiled once by `createFloor`; nothing here knows which setting it is.
 *
 * - **The walkable floor** is the setting's polygons, as feet. An area marked `spill: false` (the ship's stairs,
 *   behind the near rail's balustrade) is walked across but never crowded onto.
 * - **Obstacles** are the feet of what stands on the floor: the setting's own, and each prop's footprint. A
 *   path never crosses one.
 * - **Paths** are A* over the setting's grid of the walkable floor, then pulled tight: a corner is kept only
 *   where the straight line past it would leave the floor.
 * - **Crowds**: `sharedSpot` stands one more worker beside a taken post, `restSpot` packs one into a zone's
 *   overflow areas; both search the floor's open points, never a `spill: false` area.
 *
 * The pack linter (`test/deck-settings.test.ts`) holds every setting's floor to its own backdrop's pixels: every
 * walkable point on it, every post and mark on open floor, every post and the entry reachable from every other.
 */

export interface Point {
  x: number;
  y: number;
}

/** Which way a worker faces at its post. The side poses are drawn facing right. */
export type Facing = "left" | "right" | "front";

/** A post: a named place a zone sends a worker to, with the way it faces there. */
export interface Anchor extends Point {
  id: string;
  /** The zone it belongs to. */
  place: string;
  facing: Facing;
}

type Polygon = ReadonlyArray<readonly [number, number]>;
type Rect = readonly [number, number, number, number];

/** A setting's floor, compiled: its areas, obstacles and pathing grid, and what is worked out from them once, on first use. */
export interface Floor {
  readonly areas: ReadonlyArray<{ id: string; polygon: Polygon; spill: boolean }>;
  readonly obstacles: ReadonlyArray<{ id: string; rect: Rect }>;
  /** The grid's cell, its top left, and how many cells across and down. */
  readonly cell: number;
  readonly left: number;
  readonly top: number;
  readonly columns: number;
  readonly rows: number;
  /** Walking pace, stage pixels a second. */
  readonly walkSpeed: number;
  readonly cache: { cells: Uint8Array | null; open: Point[] | null };
}

export function createFloor(spec: {
  areas: ReadonlyArray<{ id: string; polygon: Polygon; spill?: boolean | undefined }>;
  obstacles: ReadonlyArray<{ id: string; rect: Rect }>;
  grid: { cell: number; bounds: Rect };
  walkSpeed: number;
}): Floor {
  const [left, top, width, height] = spec.grid.bounds;
  const { cell } = spec.grid;
  return {
    areas: spec.areas.map((area) => ({ id: area.id, polygon: area.polygon, spill: area.spill !== false })),
    obstacles: spec.obstacles,
    cell,
    left,
    top,
    columns: Math.ceil(width / cell),
    rows: Math.ceil(height / cell),
    walkSpeed: spec.walkSpeed,
    cache: { cells: null, open: null },
  };
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

/** Whether a point is inside any of `rects` ([x, y, width, height]). */
export function inRects(rects: readonly Rect[], point: Point): boolean {
  return rects.some(([x, y, width, height]) => point.x >= x && point.x < x + width && point.y >= y && point.y < y + height);
}

/** Whether a worker's feet can be at this point: on the walkable floor and clear of every obstacle. */
export function walkable(floor: Floor, x: number, y: number): boolean {
  if (!floor.areas.some((area) => inPolygon(area.polygon, x, y))) return false;
  return !floor.obstacles.some(({ rect: [rx, ry, rw, rh] }) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
}

/** The walkable area at a point, or null. */
export function areaAt(floor: Floor, x: number, y: number): { id: string; spill: boolean } | null {
  return floor.areas.find((area) => inPolygon(area.polygon, x, y)) ?? null;
}

/** Whether the straight line from `a` to `b` stays on the walkable floor, checked every half pixel. */
export function clearLine(floor: Floor, a: Point, b: Point): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    if (!walkable(floor, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

/** The walkable floor as cells: 1 where the cell's centre is walkable. Made once. */
function grid(floor: Floor): Uint8Array {
  if (floor.cache.cells !== null) return floor.cache.cells;
  const cells = new Uint8Array(floor.columns * floor.rows);
  for (let row = 0; row < floor.rows; row += 1) {
    for (let column = 0; column < floor.columns; column += 1) {
      const centre = cellCentre(floor, column, row);
      cells[row * floor.columns + column] = walkable(floor, centre.x, centre.y) ? 1 : 0;
    }
  }
  floor.cache.cells = cells;
  return cells;
}

function cellCentre(floor: Floor, column: number, row: number): Point {
  return { x: floor.left + column * floor.cell + floor.cell / 2, y: floor.top + row * floor.cell + floor.cell / 2 };
}

/** The walkable cell nearest a point, searched outward ring by ring, or -1 when there is none near. */
function nearestCell(floor: Floor, point: Point): number {
  const cells = grid(floor);
  const { columns, rows } = floor;
  const column = Math.floor((point.x - floor.left) / floor.cell);
  const row = Math.floor((point.y - floor.top) / floor.cell);
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let radius = 0; radius < 12 && best < 0; radius += 1) {
    for (let r = row - radius; r <= row + radius; r += 1) {
      for (let c = column - radius; c <= column + radius; c += 1) {
        if (r < 0 || c < 0 || r >= rows || c >= columns || cells[r * columns + c] !== 1) continue;
        const centre = cellCentre(floor, c, r);
        const distance = Math.hypot(centre.x - point.x, centre.y - point.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = r * columns + c;
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
function search(floor: Floor, start: number, goal: number): number[] | null {
  const cells = grid(floor);
  const { columns, rows } = floor;
  const cost = new Float64Array(cells.length).fill(Number.POSITIVE_INFINITY);
  const from = new Int32Array(cells.length).fill(-1);
  const closed = new Uint8Array(cells.length);
  const goalColumn = goal % columns;
  const goalRow = Math.floor(goal / columns);
  const estimate = (cell: number) => {
    const dx = Math.abs((cell % columns) - goalColumn);
    const dy = Math.abs(Math.floor(cell / columns) - goalRow);
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
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    for (const [dx, dy, step] of NEIGHBOURS) {
      const c = column + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= columns || r >= rows) continue;
      const next = r * columns + c;
      if (cells[next] !== 1 || closed[next] === 1) continue;
      if (dx !== 0 && dy !== 0 && (cells[row * columns + c] !== 1 || cells[r * columns + column] !== 1)) continue;
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
 * The way from `from` to `to` on the walkable floor: the corners to walk through, ending at `to` itself. Empty
 * when already there. A point off the floor (a worker caught mid-step) starts from the nearest walkable cell.
 * When there is no way at all, the one straight step, so nobody is stranded.
 */
export function findPath(floor: Floor, from: Point, to: Point): Point[] {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 0.5) return [];
  if (walkable(floor, from.x, from.y) && clearLine(floor, from, to)) return [{ x: to.x, y: to.y }];
  const start = nearestCell(floor, from);
  const goal = nearestCell(floor, to);
  const cells = start < 0 || goal < 0 ? null : search(floor, start, goal);
  if (cells === null) return [{ x: to.x, y: to.y }];
  const corners: Point[] = cells.map((cell) => cellCentre(floor, cell % floor.columns, Math.floor(cell / floor.columns)));
  corners.push({ x: to.x, y: to.y });
  // Pull the string tight: from each kept point, skip ahead to the furthest point still in sight.
  const tight: Point[] = [];
  let at: Point = walkable(floor, from.x, from.y) ? from : corners[0]!;
  if (at !== from) tight.push(at);
  let index = at === from ? 0 : 1;
  while (index < corners.length) {
    let furthest = index;
    for (let ahead = corners.length - 1; ahead > index; ahead -= 1) {
      if (clearLine(floor, at, corners[ahead]!)) {
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

/** Every other walkable pixel across the grid, off any area a crowd may not spill onto, made once: where a crowd can stand. */
function openPoints(floor: Floor): Point[] {
  if (floor.cache.open !== null) return floor.cache.open;
  const points: Point[] = [];
  for (let y = floor.top; y < floor.top + floor.rows * floor.cell; y += 1) {
    for (let x = floor.left; x < floor.left + floor.columns * floor.cell; x += floor.cell) {
      const area = areaAt(floor, x, y);
      if (area !== null && area.spill && walkable(floor, x, y)) points.push({ x, y });
    }
  }
  floor.cache.open = points;
  return points;
}

/**
 * A spot at a post for one more worker: the post itself while nobody stands within `spacing` of it, else the
 * nearest open spot beside it on the same area, never within `spacing` of another taken spot and never on an area
 * a crowd may not spill onto. Only when that area is full does it spill onto the nearest other one. The post itself
 * when the whole floor is full.
 */
export function sharedSpot(floor: Floor, anchor: Point, taken: readonly Point[], spacing: readonly [number, number]): Point {
  const crowded = (spot: Point) => taken.some((other) => Math.abs(other.x - spot.x) < spacing[0] && Math.abs(other.y - spot.y) < spacing[1]);
  if (!crowded(anchor)) return { x: anchor.x, y: anchor.y };
  const area = areaAt(floor, anchor.x, anchor.y)?.id ?? null;
  const cost = (spot: Point) => Math.hypot((spot.x - anchor.x) / 2, spot.y - anchor.y) + ((areaAt(floor, spot.x, spot.y)?.id ?? null) === area ? 0 : 1000);
  let best: Point | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const spot of openPoints(floor)) {
    const value = cost(spot);
    if (value < bestCost && !crowded(spot)) {
      best = spot;
      bestCost = value;
    }
  }
  return best === null ? { x: anchor.x, y: anchor.y } : { x: best.x, y: best.y };
}

/**
 * Where a worker packed into a zone's overflow stands: the post itself while it stands `spacing` clear of every
 * taken spot, else the open spot in the overflow `areas` nearest it that does. Only when the areas hold no such spot
 * does it settle for the closer `fallback` spacing, still in the areas; the post itself when even that is gone.
 */
export function restSpot(
  floor: Floor,
  overflow: { areas: readonly Rect[]; spacing: readonly [number, number]; fallback: readonly [number, number] },
  anchor: Point,
  taken: readonly Point[],
): Point {
  for (const spacing of [overflow.spacing, overflow.fallback]) {
    const crowded = (spot: Point) => taken.some((other) => Math.abs(other.x - spot.x) < spacing[0] && Math.abs(other.y - spot.y) < spacing[1]);
    let best: Point | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const spot of openPoints(floor)) {
      if (!inRects(overflow.areas, spot)) continue;
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
