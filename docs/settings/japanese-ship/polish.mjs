/** Register commissioned art into the current pack, preserving later weather revisions. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSpiritSurface } from './coast/surface.mjs';
import { registerCrewVariety } from './crew-variety/register.mjs';
import { registerWaterInbetweens } from './water/inbetweens.mjs';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../art/settings/japanese-ship');
const path = resolve(directory, 'setting.json');
const pack = JSON.parse(readFileSync(path, 'utf8'));
if (!pack.ambience.some(element => element.id === 'umibozu-submerged')) splitSpiritSurface(pack);
registerCrewVariety(pack, directory);
registerWaterInbetweens(pack, directory);
pack.version = '1.2.1';
writeFileSync(path, JSON.stringify(pack, null, 2) + '\n');
