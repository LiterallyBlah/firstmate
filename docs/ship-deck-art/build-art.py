"""
Builds the ship deck's game-ready art from the captain-approved generated sources: hull C (low rig), the
two crew sheets and three props. Writes `art/ship-deck/deck.png` (one atlas) and `art/ship-deck/deck.json`
(where everything is in it), which the daemon serves through `firstmate.deck.art`.

    py docs/ship-deck-art/build-art.py <folder with the source PNGs>

Needs Python 3 with Pillow and NumPy. Deterministic: the same sources give the same bytes. Every step is
mechanical; nothing is repainted by hand. What it does, in order:

1. **One logical pixel grid.** The generated sources are drawn at different "pixel" sizes (the ship about
   4.5 source pixels a cell, the crew about 7.5, the props about 50). Each is cut to its pose or object
   and block-sampled onto one grid where a standing sailor is 32 px and the hull 426 px long: a cell is
   opaque when most of its source pixels are, and takes the median colour of those.
2. **Binary alpha.** No soft edges: the sources' faint dark halos and part-transparent fringes go.
3. **One palette.** Ship, crew and props are quantised together to `PALETTE_SIZE` colours, no dithering,
   so the wood, navy, cream and skin are the same few colours everywhere.
4. **Depth pieces.** The hull stays whole as the backdrop. The parts of it that stand in front of a sailor
   are cut out again as their own pieces, each with the deck row (`baseline`) it stands on: the mast,
   four bollards, and `near` — the bow bulwark, the near gunwale and its bollards, the stairs, the
   quarterdeck's front rail and the hull below them, in front of everything on deck. The canvas draws a
   piece over any sailor standing behind its baseline, so the sailor is hidden behind it.
5. **Atlas.** Everything packed into one PNG, with each frame's rectangle, and where in it each sailor's
   and prop's feet are, in the manifest.
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "art" / "ship-deck"
DOCS = Path(__file__).resolve().parent

#: The captain-approved sources, by the names the generation experiment gave them.
SOURCES = {
    "ship": "10-ship-low-rig.png",
    "crew-base": "01-crew-base.png",
    "crew-outfit": "02-crew-outfit.png",
    "barrel": "03-barrel.png",
    "crate": "04-crate.png",
    "rope": "05-rope.png",
}

PALETTE_SIZE = 48
SHIP_CELL = 4.5  # source pixels per logical pixel for the hull
CREW_CELL = 12.0  # for the crew: a front-idle sailor is 385 source pixels, so 32 logical

#: Each pose's box on the base crew sheet (x, y, width, height), from the generation experiment's metrics.json.
POSES = {
    "front-idle": (103, 67, 190, 385),
    "front-walk-a": (421, 67, 193, 385),
    "front-walk-b": (737, 67, 187, 385),
    "side-idle": (127, 541, 132, 373),
    "side-walk-a": (422, 541, 187, 373),
    "side-walk-b": (749, 541, 178, 373),
    "hauling": (84, 1019, 268, 354),
    "leaning": (433, 1019, 181, 354),
    "waiting": (751, 1003, 165, 378),
}
#: The outfit sheet's boxes differ by a pixel or two, and its hauling pose has no rope.
OUTFIT_POSES = {
    "front-idle": (102, 67, 192, 386),
    "front-walk-a": (421, 67, 194, 386),
    "front-walk-b": (737, 67, 190, 387),
    "side-idle": (127, 540, 133, 374),
    "side-walk-a": (422, 540, 188, 374),
    "side-walk-b": (749, 540, 179, 374),
    "hauling": (84, 1019, 228, 354),
    "leaning": (432, 1019, 183, 354),
    "waiting": (750, 1003, 168, 379),
}

#: Props: the size on deck, in logical pixels (the other side follows the source's aspect).
PROPS = {"barrel": {"height": 18}, "crate": {"height": 17}, "rope": {"width": 15}}

#: The top edge of `near`, in hull coordinates: everything of the hull on or below this line is in front
#: of every place a sailor can stand. Bow bulwark, near gunwale, the stairs and the quarterdeck's front
#: rail, then the stern's side rail.
NEAR_EDGE = [
    (0, 96), (46, 96), (51, 99), (60, 103), (70, 107), (80, 111), (90, 114), (100, 117), (110, 119),
    (120, 121), (321, 121), (323, 89), (358, 89), (358, 97), (402, 97), (410, 91), (418, 84), (426, 80),
]

#: Free-standing pieces: rectangles (x0, y0, x1, y1, inclusive) of the hull, and the deck row each stands on.
PIECES = {
    "mast": {
        "baseline": 110,
        "rects": [(207, 48, 215, 99), (205, 64, 217, 71), (205, 100, 218, 100), (202, 101, 220, 110), (203, 111, 219, 111)],
    },
    "bollard-bow-aft": {"baseline": 94, "rects": [(76, 79, 83, 86), (75, 87, 84, 94)]},
    "bollard-bow-fore": {"baseline": 110, "rects": [(64, 98, 70, 104), (62, 105, 71, 110)]},
    # The near gunwale's two, standing up out of it: in front of every deck row, cut to their own outline.
    "bollard-gunwale-fore": {"baseline": 121, "rects": [(272, 116, 275, 116), (271, 117, 276, 120)]},
    "bollard-gunwale-aft": {"baseline": 121, "rects": [(294, 116, 297, 116), (293, 117, 298, 120)]},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def alpha_box(im: Image.Image) -> tuple[int, int, int, int]:
    box = im.getchannel("A").point(lambda v: 255 if v >= 128 else 0).getbbox()
    assert box is not None
    return box


def block_sample(im: Image.Image, cell_w: float, cell_h: float, out_w: int, out_h: int) -> np.ndarray:
    """Each output pixel from its block: opaque when at least half the block is, coloured by the median of the opaque part."""
    a = np.asarray(im.convert("RGBA")).astype(np.float32)
    out = np.zeros((out_h, out_w, 4), np.uint8)
    for j in range(out_h):
        y0 = int(round(j * cell_h))
        y1 = max(int(round((j + 1) * cell_h)), y0 + 1)
        for i in range(out_w):
            x0 = int(round(i * cell_w))
            x1 = max(int(round((i + 1) * cell_w)), x0 + 1)
            block = a[y0:y1, x0:x1].reshape(-1, 4)
            opaque = block[block[:, 3] >= 128]
            if len(block) and len(opaque) * 2 >= len(block):
                out[j, i, :3] = np.median(opaque[:, :3], axis=0).round()
                out[j, i, 3] = 255
    return out


def trim(px: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(px[:, :, 3])
    return px[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def ship_logical(src: Path) -> np.ndarray:
    im = Image.open(src)
    im = im.crop(alpha_box(im))
    w, h = int(round(im.width / SHIP_CELL)), int(round(im.height / SHIP_CELL))
    return block_sample(im, im.width / w, im.height / h, w, h)


def crew_logical(src: Path, box: tuple[int, int, int, int]) -> np.ndarray:
    """A pose on the crew grid, the block rows anchored at the boots and the columns centred on the box."""
    x, y, w, h = box
    ow, oh = int(round(w / CREW_CELL)), int(round(h / CREW_CELL))
    x0 = x + w / 2 - ow * CREW_CELL / 2
    y0 = y + h - oh * CREW_CELL
    im = Image.open(src).crop((round(x0), round(y0), round(x0 + ow * CREW_CELL), round(y + h)))
    return trim(block_sample(im, im.width / ow, im.height / oh, ow, oh))


def prop_logical(src: Path, size: dict) -> np.ndarray:
    im = Image.open(src)
    im = im.crop(alpha_box(im))
    if "height" in size:
        oh = size["height"]
        ow = max(1, int(round(im.width * oh / im.height)))
    else:
        ow = size["width"]
        oh = max(1, int(round(im.height * ow / im.width)))
    return trim(block_sample(im, im.width / ow, im.height / oh, ow, oh))


def shared_palette(images: list[np.ndarray]) -> Image.Image:
    """One palette for everything, from the opaque pixels of all of it."""
    pixels = np.concatenate([im[im[:, :, 3] == 255][:, :3] for im in images])
    strip = Image.fromarray(pixels.reshape(1, -1, 3).astype(np.uint8), "RGB")
    return strip.quantize(colors=PALETTE_SIZE, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)


def apply_palette(px: np.ndarray, palette: Image.Image) -> np.ndarray:
    rgb = Image.fromarray(np.ascontiguousarray(px[:, :, :3]), "RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGB")
    out = np.zeros_like(px)
    out[:, :, :3] = np.asarray(rgb)
    out[:, :, 3] = np.where(px[:, :, 3] == 255, 255, 0)
    out[out[:, :, 3] == 0] = 0
    return out


def near_mask(width: int, height: int) -> np.ndarray:
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).polygon(NEAR_EDGE + [(width, height), (0, height)], fill=255)
    return np.asarray(mask) > 0


def rect_mask(width: int, height: int, rects) -> np.ndarray:
    mask = np.zeros((height, width), bool)
    for x0, y0, x1, y1 in rects:
        mask[y0 : y1 + 1, x0 : x1 + 1] = True
    return mask


def cut(ship: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, int, int]:
    """The hull's pixels under `mask`, cropped, with where the crop sits on the hull."""
    piece = np.where(mask[:, :, None], ship, 0).astype(np.uint8)
    ys, xs = np.nonzero(piece[:, :, 3])
    return piece[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1], int(xs.min()), int(ys.min())


def feet(px: np.ndarray) -> list[int]:
    """Where a sprite stands, in its own whole pixels: the middle of its bottom four rows' opaque pixels, on its bottom edge."""
    xs = np.nonzero(px[-4:, :, 3].any(axis=0))[0]
    return [int((xs.min() + xs.max() + 1) // 2), int(px.shape[0])]


def pack(frames: dict[str, np.ndarray], width: int) -> tuple[np.ndarray, dict[str, list[int]]]:
    """Shelf packing, tallest first, one transparent pixel between frames."""
    order = sorted(frames, key=lambda name: (-frames[name].shape[0], name))
    placed, x, y, shelf = {}, 0, 0, 0
    for name in order:
        h, w = frames[name].shape[:2]
        if x + w > width:
            x, y, shelf = 0, y + shelf + 1, 0
        placed[name] = [x, y, w, h]
        x += w + 1
        shelf = max(shelf, h)
    atlas = np.zeros((y + shelf, width, 4), np.uint8)
    for name, (fx, fy, fw, fh) in placed.items():
        atlas[fy : fy + fh, fx : fx + fw] = frames[name]
    return atlas, placed


def checkerboard(size: tuple[int, int]) -> Image.Image:
    board = Image.new("RGBA", size, (236, 236, 228, 255))
    draw = ImageDraw.Draw(board)
    for y in range(0, size[1], 16):
        for x in range((y // 16) % 2 * 16, size[0], 32):
            draw.rectangle([x, y, x + 15, y + 15], fill=(206, 210, 200, 255))
    return board


def main(source_dir: Path) -> None:
    sources = {name: source_dir / file for name, file in SOURCES.items()}
    ship = ship_logical(sources["ship"])
    crew = {}
    for outfit, boxes in (("base", POSES), ("outfit", OUTFIT_POSES)):
        for pose, box in boxes.items():
            crew[f"crew/{outfit}/{pose}"] = crew_logical(sources[f"crew-{outfit}"], box)
    props = {f"prop/{name}": prop_logical(sources[name], size) for name, size in PROPS.items()}

    palette = shared_palette([ship, *crew.values(), *props.values()])
    ship = apply_palette(ship, palette)
    crew = {name: apply_palette(px, palette) for name, px in crew.items()}
    props = {name: apply_palette(px, palette) for name, px in props.items()}

    height, width = ship.shape[:2]
    pieces = {}
    frames: dict[str, np.ndarray] = {"ship": ship, **crew, **props}
    near, nx, ny = cut(ship, near_mask(width, height))
    frames["piece/near"] = near
    pieces["near"] = {"x": nx, "y": ny, "baseline": None}
    for name, spec in PIECES.items():
        px, x, y = cut(ship, rect_mask(width, height, spec["rects"]))
        frames[f"piece/{name}"] = px
        pieces[name] = {"x": x, "y": y, "baseline": spec["baseline"]}

    atlas, placed = pack(frames, max(width, 256))
    colours = {tuple(c) for c in atlas[atlas[:, :, 3] == 255][:, :3].tolist()}
    assert len(colours) <= PALETTE_SIZE, len(colours)
    assert set(np.unique(atlas[:, :, 3]).tolist()) <= {0, 255}

    manifest = {
        "atlas": {"width": int(atlas.shape[1]), "height": int(atlas.shape[0]), "colours": len(colours)},
        "ship": {"frame": placed["ship"]},
        "pieces": {
            name: {"frame": placed[f"piece/{name}"], "x": piece["x"], "y": piece["y"], "baseline": piece["baseline"]}
            for name, piece in pieces.items()
        },
        "crew": {
            outfit: {
                pose: {"frame": placed[f"crew/{outfit}/{pose}"], "feet": feet(crew[f"crew/{outfit}/{pose}"])}
                for pose in POSES
            }
            for outfit in ("base", "outfit")
        },
        "props": {name: {"frame": placed[f"prop/{name}"], "feet": feet(props[f"prop/{name}"])} for name in PROPS},
        "sources": {name: {"file": SOURCES[name], "sha256": sha256(path)} for name, path in sources.items()},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas, "RGBA").save(OUT / "deck.png", optimize=True)
    (OUT / "deck.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")

    # Evidence: the atlas at 4x on a checkerboard, and the hull with every depth piece tinted.
    big = Image.fromarray(atlas, "RGBA").resize((atlas.shape[1] * 4, atlas.shape[0] * 4), Image.NEAREST)
    board = checkerboard(big.size)
    board.alpha_composite(big)
    board.save(DOCS / "atlas-4x.png", optimize=True)
    tint = ship.copy()
    for name in pieces:
        colour = (60, 140, 255) if name == "near" else (255, 70, 70) if name == "mast" else (255, 200, 0)
        fx, fy, fw, fh = placed[f"piece/{name}"]
        on = atlas[fy : fy + fh, fx : fx + fw, 3] == 255
        region = tint[pieces[name]["y"] : pieces[name]["y"] + fh, pieces[name]["x"] : pieces[name]["x"] + fw]
        region[on, :3] = (region[on, :3] * 0.45 + np.array(colour) * 0.55).astype(np.uint8)
    tinted = Image.fromarray(tint, "RGBA").resize((width * 3, height * 3), Image.NEAREST)
    board = checkerboard(tinted.size)
    board.alpha_composite(tinted)
    board.save(DOCS / "depth-pieces-3x.png", optimize=True)
    print(json.dumps(manifest["atlas"]), (OUT / "deck.png").stat().st_size, "bytes")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
