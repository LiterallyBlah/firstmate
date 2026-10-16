/**
 * The tall mast (`art/settings/ship/mast/`), the ship pack's `tall-mast` and `topmast` parts, read against the hull it
 * stands on, without Pixi: its foot is the hull's own, what it leaves out of the hull is only the short rig, its parts
 * and the rows it stands in for the mast piece with are cut where they belong, and the deck's fit takes in its top and
 * still the whole of the way off the plank. The sprites themselves are `deck-environment.test.ts`'s, through
 * `startDeck` with a stand-in Pixi.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { compileParts } from "./deck-parts";
import { deckBox, fitDeck } from "./deck-pixi";
import { shipFile, shipManifest, shipPlankMarks, shipStage } from "../test/ship-pack";

const art = (path: string) => shipFile(path);

// The ship's stage, under the names its constants had in the deck's code.
const stage = shipStage();
const DECK_PROPS = stage.props.map((prop) => ({ name: prop.id, x: prop.x, y: prop.y }));
const PLANK = { ...shipPlankMarks(), water: shipPlankMarks().water.y };

// The pack's pieces and parts, under the names the deck's manifests had for them.
const ship = shipManifest();
const deck = {
  pieces: Object.fromEntries(ship.stage.pieces.map((piece) => [piece.id, { frame: piece.sprite.rect ?? [0, 0, 1, 1], x: piece.at[0], y: piece.at[1], baseline: piece.baseline }])),
};
const part = (id: string) => ship.stage.parts.find((each) => each.id === id)!;
const tallMast = part("tall-mast");
const topmast = part("topmast");
const sailPart = part("sail");
const mast = {
  texture: ship.images[tallMast.sprite.image]!.path,
  size: ship.images[tallMast.sprite.image]!.size,
  position: topmast.at,
  sway: topmast.sprite.rect![3],
  clears: tallMast.cutout!,
  replaces: tallMast.replacesPiece!.piece,
};
const manifest = { sail: { position: sailPart.at, frameSize: [sailPart.sprite.rect![2], sailPart.sprite.rect![3]] as const } };

/** Enough of PNG for the art here (8-bit RGBA, not interlaced): each pixel as 0xRRGGBBAA, 0 where transparent. */
function decodePng(file: Buffer): { width: number; height: number; at: (x: number, y: number) => number } {
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  expect([file[24], file[25], file[28]]).toEqual([8, 6, 0]);
  const chunks: Buffer[] = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    if (file.toString("latin1", at + 4, at + 8) === "IDAT") chunks.push(file.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const corner = x >= 4 && y > 0 ? (pixels[(y - 1) * stride + x - 4] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { width, height, at: (x, y) => (pixels[y * stride + x * 4 + 3] === 0 ? 0 : pixels.readUInt32BE(y * stride + x * 4)) };
}

const atlas = decodePng(readFileSync(art("deck.png")));
const tall = decodePng(readFileSync(art(mast.texture)));
const [mastX, mastY] = mast.position;

describe("the tall mast on the hull", () => {
  it("is the size the manifest says, and stands on the hull's own foot, pixel for pixel", () => {
    expect([tall.width, tall.height]).toEqual(mast.size);
    // The mast piece's rows from 73 down (the foot and the lower mast) are the tall mast's own, unchanged.
    const piece = deck.pieces[mast.replaces]!;
    const [fx, fy, fw, fh] = piece.frame;
    for (let y = 73; y < piece.y + fh; y += 1) {
      for (let x = piece.x; x < piece.x + fw; x += 1) {
        expect(tall.at(x - mastX, y - mastY), `${x},${y}`).toBe(atlas.at(fx + x - piece.x, fy + y - piece.y));
      }
    }
    // Nothing of it below the foot's last row.
    expect(mastY + tall.height).toBe(piece.y + fh);
  });

  it("reaches well above the hull's top row, with only the tip above the occupied basket swaying", () => {
    let top = tall.height;
    for (let y = 0; y < tall.height && top === tall.height; y += 1) for (let x = 0; x < tall.width; x += 1) if (tall.at(x, y) !== 0) top = y;
    // Its tip 78 rows above the hull's top row: 188 rows from the deck, where the short rig had 109.
    expect(mastY + top).toBe(-78);
    // The crow's nest (sprite rows 22 to 44), its rigging lugs and the yard now stay on the rigid shaft.
    expect(mast.sway).toBe(20);
    expect(mastY + mast.sway).toBeLessThan(manifest.sail.position[1]);
  });

  it("brings its crow's nest down snug over the sail: 23 rows of pole and lugs between the basket and the yard", () => {
    const span = (y: number) => {
      const xs = [...Array(tall.width).keys()].filter((x) => tall.at(x, y) !== 0);
      return xs.length === 0 ? 0 : xs[xs.length - 1]! - xs[0]! + 1;
    };
    // The basket is sprite rows 23 to 44, its lugs 45 to 48, and from row 49 only the 9-pixel pole.
    expect(span(22)).toBe(9);
    for (let y = 23; y <= 44; y += 1) expect(span(y), `row ${y}`).toBeGreaterThan(9);
    // The sail's yard lashing (the strip's (57, 3)) on the pole at hull row -12, 23 rows under the basket's floor.
    const lashing = manifest.sail.position[1] + 3;
    expect([manifest.sail.position[0] + 57, lashing]).toEqual([mastX + 24, -12]);
    expect(lashing - (mastY + 44) - 1).toBe(23);
    for (let y = 49; y < lashing - mastY; y += 1) expect(span(y), `row ${y}`).toBe(9);
  });

  it("leaves out of the hull only its short rig: open sky besides, above the rail, clear of every piece and prop but the mast", () => {
    const [cx, cy, cw, ch] = mast.clears;
    expect(cy).toBe(0);
    const near = deck.pieces.near!;
    // Above the near rail's top, and above every prop.
    expect(cy + ch).toBeLessThanOrEqual(near.y - 10);
    for (const prop of DECK_PROPS) expect(prop.y < cy + ch && prop.x >= cx && prop.x < cx + cw, prop.name).toBe(false);
    for (const [name, piece] of Object.entries(deck.pieces)) {
      if (name === mast.replaces || name === "near") continue;
      const [, , width, height] = piece.frame;
      const overlaps = piece.x < cx + cw && piece.x + width > cx && piece.y < cy + ch && piece.y + height > cy;
      expect(overlaps, name).toBe(false);
    }
    // The near rail's piece has nothing drawn inside it.
    const [nx, ny] = near.frame;
    for (let y = near.y; y < cy + ch; y += 1) for (let x = cx; x < cx + cw; x += 1) expect(atlas.at(nx + x - near.x, ny + y - near.y)).toBe(0);
    // The short rig is all that is in it: its crow's nest stood in it, and both its stays reach in.
    const opaque = (x0: number, x1: number) => {
      let count = 0;
      for (let y = cy; y < cy + ch; y += 1) for (let x = x0; x < x1; x += 1) if (atlas.at(x, y) !== 0) count += 1;
      return count;
    };
    expect(opaque(cx, 192)).toBeGreaterThan(0);
    expect(opaque(193, 230)).toBeGreaterThan(400);
    expect(opaque(230, cx + cw)).toBeGreaterThan(0);
  });

  it("is drawn only with its image, its rows standing in for the mast piece; without it, the hull's own masthead", () => {
    const whole = compileParts(ship, () => true);
    expect(whole.parts.map((each) => each.id)).toEqual(["tall-mast", "topmast", "sail", "access-ladder"]);
    expect(whole.cutout).toEqual(mast.clears);
    expect(whole.pieces.find((piece) => piece.id === mast.replaces)?.by).toBe("tall-mast");
    const bare = compileParts(ship, (image) => image !== tallMast.sprite.image);
    expect(bare.parts.map((each) => [each.id, each.place])).toEqual([["masthead", "topmast"]]);
    expect(bare.cutout).toEqual(part("masthead").cutout);
    expect(bare.pieces.find((piece) => piece.id === mast.replaces)?.by).toBeNull();
    expect([whole.top, bare.top]).toEqual([mastY, 0]);
  });
});

describe("the tall mast's parts", () => {
  const piece = deck.pieces[mast.replaces]!;

  it("cuts its swaying head from its fixed shaft, together the whole image", () => {
    expect([topmast.sprite.rect, topmast.at]).toEqual([[0, 0, 48, mast.sway], [mastX, mastY]]);
    expect([tallMast.sprite.rect, tallMast.at]).toEqual([[0, mast.sway, 48, mast.size[1] - mast.sway], [mastX, mastY + mast.sway]]);
    expect(topmast.behaviour?.kind).toBe("sway");
  });

  it("stands its own rows in for the mast piece, on its row, from below the sail's hem", () => {
    const hem = manifest.sail.position[1] + manifest.sail.frameSize[1];
    expect(hem).toBeGreaterThan(piece.y);
    expect(tallMast.replacesPiece).toEqual({ piece: mast.replaces, sprite: { image: tallMast.sprite.image, rect: [0, hem - mastY, 48, mastY + mast.size[1] - hem] }, at: [mastX, hem] });
    // Its rows from the hem down are the mast with nothing cleared: the foot and the shaft over a sailor behind them.
    for (let y = hem; y < mastY + mast.size[1]; y += 1) expect(tall.at(211 - mastX, y - mastY), `211,${y}`).not.toBe(0);
  });
});

describe("the deck's fit under the tall mast", () => {
  it("is the hull's own without it", () => {
    expect(deckBox(shipStage(), 0)).toEqual({ width: 426, height: 161 });
    expect(fitDeck({ width: 900, height: 500 }, { width: 426, height: 161, top: 0 }, 2, shipStage().fit.margin)).toEqual(fitDeck({ width: 900, height: 500 }, { width: 426, height: 161 }, 2, shipStage().fit.margin));
  });

  it("shows the mast's tip, the hull and the shark's lowest row in any pane, wide or tall", () => {
    const box = deckBox(shipStage(), mastY);
    expect(box).toEqual({ width: 426, height: shipStage().fit.bottom, top: shipStage().fit.top });
    expect(shipStage().fit.top).toBe(mastY);
    expect(shipStage().fit.bottom).toBeGreaterThan(PLANK.water);
    for (const [width, height] of [
      [400, 300],
      [800, 400],
      [1440, 600],
      [2400, 500],
      [390, 844],
      [1200, 1200],
    ] as const) {
      const fit = fitDeck({ width, height }, box, 2, shipStage().fit.margin);
      const visibleTop = -fit.y / fit.scale;
      const visibleBottom = (height - fit.y) / fit.scale;
      expect(visibleTop, `${width}x${height}`).toBeLessThan(mastY);
      expect(visibleBottom, `${width}x${height}`).toBeGreaterThan(shipStage().fit.bottom);
      expect(fit.scale * 426, `${width}x${height}`).toBeLessThanOrEqual(width);
    }
  });
});
