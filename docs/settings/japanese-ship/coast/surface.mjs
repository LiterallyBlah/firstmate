/** Split existing spirit pixels at the sea surface; no art generation or water patch. */
export function splitSpiritSurface(pack) {
  const body = pack.ambience.find(element => element.id === 'umibozu');
  const sea = pack.ambience.find(element => element.id === 'coast');
  const surface = 60;
  const submerged = structuredClone(body);
  submerged.id = 'umibozu-submerged';
  // The opaque day/night sea, its weather and all later water layers cover this piece.
  submerged.order = sea.order - 0.1;
  submerged.behaviour.top += surface;
  const sprites = element => new Set([
    ...element.behaviour.frames.sprites,
    ...element.behaviour.variants.flatMap(variant => variant.frames),
  ]);
  for (const sprite of sprites(submerged)) {
    sprite.rect[1] += surface;
    sprite.rect[3] -= surface;
  }
  for (const sprite of sprites(body)) sprite.rect[3] = surface;
  pack.ambience.splice(pack.ambience.indexOf(body), 0, submerged);
}
