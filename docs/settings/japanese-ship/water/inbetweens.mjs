/** Wire the commissioned 24-pose atlases without changing the water's geometry or clocks. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function registerWaterInbetweens(pack, directory) {
  const frames = (id, width, height) => {
    const path = `${id}-ib.png`, bytes = readFileSync(join(directory, path));
    pack.images[id] = { path, size: [width * 4, height * 6], sha256: createHash('sha256').update(bytes).digest('hex') };
    const previous = join(directory, `${id}.png`);
    if (existsSync(previous)) unlinkSync(previous);
    return Array.from({ length: 24 }, (_, index) => ({ image: id, rect: [index % 4 * width, Math.floor(index / 4) * height, width, height] }));
  };
  for (const [id, height] of [['bay-far', 32], ['bay-mid', 64]]) {
    const behaviour = pack.ambience.find(element => element.id === id).behaviour;
    const midday = frames(`${id}-midday`, 256, height);
    const dusk = frames(`${id}-dusk`, 256, height);
    const night = frames(`${id}-night`, 256, height);
    behaviour.frames.sprites = midday;
    behaviour.frames.frameMs = 80;
    behaviour.byPhase = { midday, dusk, night, dawn: dusk, morning: midday, afternoon: midday };
  }
  const near = pack.ambience.find(element => element.id === 'bay-near').behaviour;
  near.frames.sprites = frames('bay-near', 384, 96);
  near.frames.frameMs = 80;
  near.variants.find(variant => variant.id === 'rough').frames = frames('bay-near-storm', 384, 96);
}
