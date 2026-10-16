/**
 * The debug overlay, in the page: a setting's stage drawn over the Deck's own canvas with a 2D canvas — the walkable
 * areas (hatched where a crowd may not spill), obstacles, the pathing grid's bounds, each zone's posts with their ids
 * and facing, packing zones' overflow areas, label floors, the entry, every exit's marks, and the fit box — placed with
 * the deck's own fit (`fitDeck`, `deckBox`), so what the pack says lines up with what the engine draws.
 */
import { compileStage } from "../../client/deck-stage";
import { deckBox, fitDeck } from "../../client/deck-pixi";

const ZONE_COLOURS = ["#3ddc84", "#ffb020", "#ff5a5a", "#5ab0ff", "#c77dff", "#ffe066"];

window.drawOverlay = function drawOverlay(manifest) {
  const stage = compileStage(manifest);
  const deck = document.querySelector("canvas[data-firstmate-deck]");
  if (deck?.getAttribute("data-firstmate-deck-setting") !== manifest.id) throw new Error("overlay pack does not match the drawn setting");
  const box = deck.getBoundingClientRect();
  const resolution = window.devicePixelRatio;
  // As the deck draws it: a part reaching above the stage (the ship's tall mast) brings in the fit box.
  const rigTop = Math.min(0, ...manifest.stage.parts.map((part) => part.at[1]));
  const fit = fitDeck({ width: box.width, height: box.height }, deckBox(stage, rigTop, manifest.stage.motion?.rock !== undefined), resolution, stage.fit.margin);
  const overlay = document.createElement("canvas");
  overlay.width = Math.round(box.width * resolution);
  overlay.height = Math.round(box.height * resolution);
  Object.assign(overlay.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, pointerEvents: "none" });
  overlay.setAttribute("data-firstmate-deck-overlay", manifest.id);
  document.body.appendChild(overlay);
  const g = overlay.getContext("2d");
  g.scale(resolution, resolution);
  const px = (x) => fit.x + x * fit.scale;
  const py = (y) => fit.y + y * fit.scale;
  const rect = ([x, y, width, height]) => [px(x), py(y), width * fit.scale, height * fit.scale];
  const label = (text, x, y, colour) => {
    g.font = "10px Segoe UI, sans-serif";
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.8)";
    g.strokeText(text, x, y);
    g.fillStyle = colour;
    g.fillText(text, x, y);
  };

  // The fit box and the grid.
  g.setLineDash([6, 4]);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 1;
  g.strokeRect(...rect([0, stage.fit.top, stage.width, stage.fit.bottom - stage.fit.top]));
  label(`fit ${stage.fit.top}…${stage.fit.bottom} × ${stage.fit.margin}`, px(2), py(stage.fit.top) + 12, "#ffffff");
  g.strokeStyle = "rgba(255,255,255,0.4)";
  g.strokeRect(...rect(manifest.floor.grid.bounds));
  g.setLineDash([]);

  // The walkable areas: filled, and hatched where a crowd may not spill.
  for (const area of manifest.floor.areas) {
    g.beginPath();
    area.polygon.forEach(([x, y], index) => (index === 0 ? g.moveTo(px(x), py(y)) : g.lineTo(px(x), py(y))));
    g.closePath();
    g.fillStyle = area.spill === false ? "rgba(255,160,0,0.18)" : "rgba(0,200,255,0.16)";
    g.fill();
    g.strokeStyle = area.spill === false ? "#ffa000" : "#00c8ff";
    g.lineWidth = 1.5;
    g.stroke();
    if (area.spill === false) {
      g.save();
      g.clip();
      g.strokeStyle = "rgba(255,160,0,0.5)";
      for (let x = -400; x < box.width + 400; x += 8) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + box.height, box.height);
        g.stroke();
      }
      g.restore();
    }
    const [lx, ly] = area.polygon[0];
    label(area.id, px(lx) + 2, py(ly) - 3, area.spill === false ? "#ffa000" : "#00c8ff");
  }

  // Obstacles, props' included.
  for (const obstacle of stage.floor.obstacles) {
    g.fillStyle = "rgba(255,40,40,0.35)";
    g.fillRect(...rect(obstacle.rect));
    g.strokeStyle = "#ff2828";
    g.strokeRect(...rect(obstacle.rect));
  }

  // Zones: overflow areas, label floors, posts.
  [...stage.zones.values()].forEach(function (zone, index) {
    const colour = ZONE_COLOURS[index % ZONE_COLOURS.length];
    if (zone.overflow.kind === "pack") {
      g.setLineDash([3, 3]);
      g.strokeStyle = colour;
      for (const area of zone.overflow.areas) g.strokeRect(...rect(area));
      g.setLineDash([]);
    }
    if (zone.labelFloor !== null) {
      g.strokeStyle = colour;
      g.setLineDash([2, 4]);
      g.beginPath();
      g.moveTo(px(0), py(zone.labelFloor));
      g.lineTo(px(stage.width), py(zone.labelFloor));
      g.stroke();
      g.setLineDash([]);
      label(`${zone.id} labels hang from row ${zone.labelFloor}`, px(stage.width) - 190, py(zone.labelFloor) + 11, colour);
    }
    for (const post of zone.posts) {
      g.fillStyle = colour;
      g.beginPath();
      g.arc(px(post.x), py(post.y), 3.5, 0, Math.PI * 2);
      g.fill();
      const facing = post.facing === "left" ? -1 : post.facing === "right" ? 1 : 0;
      g.strokeStyle = colour;
      g.beginPath();
      g.moveTo(px(post.x), py(post.y));
      g.lineTo(px(post.x) + facing * 10, py(post.y) + (facing === 0 ? 8 : 0));
      g.stroke();
      label(post.id, px(post.x) + 5, py(post.y) - 4, colour);
      const transit = stage.transits.get(post.id);
      if (transit !== undefined) {
        g.setLineDash([5, 3]);
        g.beginPath();
        transit.points.forEach((point, index) => {
          if (index === 0) g.moveTo(px(point.x), py(point.y));
          else g.lineTo(px(point.x), py(point.y));
        });
        g.stroke();
        g.setLineDash([]);
        const end = transit.points.at(-1);
        label(`${post.id}: ${transit.settled}`, px(end.x) + 8, py(end.y) - 4, colour);
      }
    }
  });

  // The entry, and every exit's marks.
  const cross = (point, colour, text) => {
    g.strokeStyle = colour;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px(point.x) - 5, py(point.y) - 5);
    g.lineTo(px(point.x) + 5, py(point.y) + 5);
    g.moveTo(px(point.x) + 5, py(point.y) - 5);
    g.lineTo(px(point.x) - 5, py(point.y) + 5);
    g.stroke();
    label(text, px(point.x) + 6, py(point.y) + 12, colour);
  };
  cross(stage.entry, "#ffffff", "entry");
  if (stage.walkIn !== null) {
    cross(stage.walkIn.from, "#ffffff", "entry.from");
    g.beginPath();
    g.moveTo(px(stage.walkIn.from.x), py(stage.walkIn.from.y));
    g.lineTo(px(stage.entry.x), py(stage.entry.y));
    g.stroke();
  }
  for (const [id, exit] of stage.exits) {
    if (exit.kind === "sink") cross(exit.at, "#ffffff", `${id} (sink)`);
    else for (const [mark, at] of Object.entries(exit.marks)) cross(at, "#ff70d0", `${id}.${mark}`);
  }
  return { fit, posts: [...stage.zones.values()].reduce((sum, zone) => sum + zone.posts.length, 0) };
};
