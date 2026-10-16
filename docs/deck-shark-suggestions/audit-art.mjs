/** Prove the shark placement/crop changes leave both approved scenes intact. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const { mainRevision } = JSON.parse(readFileSync(resolve(root, 'docs/ship-deck-canvas/.generated/compiled-inputs.json'), 'utf8'));
const audit = { base: mainRevision, settings: [] };
for (const id of ['ship', 'japanese-ship']) {
  const file = `art/settings/${id}/setting.json`;
  const before = JSON.parse(execFileSync('git', ['show', `${mainRevision}:${file}`], { cwd: root, encoding: 'utf8' }));
  const after = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  const changes = { id, before: before.attentionCarrier.at, after: after.attentionCarrier.at, bubbleHeight: after.attentionCarrier.bubbleHeight, surface: after.attentionCarrier.surface ?? null, unchangedImages: 0 };
  for (const image of Object.values(after.images)) {
    const hash = createHash('sha256').update(readFileSync(resolve(root, `art/settings/${id}/${image.path}`))).digest('hex');
    assert.equal(hash, image.sha256);
    changes.unchangedImages++;
  }
  after.version = before.version;
  delete after.attentionCarrier.bubbleHeight;
  if (id === 'japanese-ship') {
    after.attentionCarrier.at = before.attentionCarrier.at;
    delete after.attentionCarrier.surface;
    after.requires = after.requires.filter(capability => capability !== 'carrier-surface@1');
  }
  assert.deepEqual(after, before, `${id}: all other pack data and image hashes are identical`);
  audit.settings.push(changes);
}
writeFileSync(resolve(here, 'art-audit.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify(audit));
