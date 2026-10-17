/** Register the commissioned sheets; their source pixels and indigo pose rectangles stay untouched. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function registerCrewVariety(pack, directory) {
  const added = ['kasa', 'cook', 'elder', 'rigger', 'fisher', 'padded'];
  const retained = pack.cast.looks.filter(look => ['moss', 'ochre'].includes(look.id));
  pack.cast.looks = [
    ...added.map(id => ({ id, image: `crew-${id}`, lane: 'indigo', optional: false })),
    ...retained,
  ];
  for (const id of added) {
    const path = `crew-${id}.png`, bytes = readFileSync(join(directory, path));
    pack.images[`crew-${id}`] = { path, size: [480, 36], sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const lanes = new Set(pack.cast.looks.map(look => look.lane));
  for (const lane of Object.keys(pack.cast.lanes)) if (!lanes.has(lane)) delete pack.cast.lanes[lane];
  const { images, ...content } = pack;
  const references = new Set();
  const visit = value => {
    if (typeof value === 'string') references.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(content);
  for (const id of ['crew-indigo', 'crew-russet', 'crew-plum', 'crew-teal']) {
    if (!images[id] || references.has(id)) continue;
    const path = join(directory, images[id].path);
    if (existsSync(path)) unlinkSync(path);
    delete images[id];
  }
}
