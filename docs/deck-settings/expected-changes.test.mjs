import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import { expectedChange } from './expected-changes.mjs';
const entries = { 'storm-shot': { main: 'old', branch: 'reviewed', reason: 'Original creature art in the sea.' } };
test('accepts only both reviewed screenshot hashes, with an explanation', () => {
  assert.equal(expectedChange(entries, 'storm-shot', { identical: false, sha: ['old','reviewed'] }), entries['storm-shot'].reason);
  for (const sha of [['changed-main','reviewed'],['old','unexpected'],['reviewed','old'],['old']]) {
    assert.equal(expectedChange(entries,'storm-shot',{ identical:false,sha }),null);
  }
  assert.equal(expectedChange(entries,'unlisted',{ identical:false,sha:['old','reviewed'] }),null);
  assert.equal(expectedChange(entries,'storm-shot',{ identical:true,sha:'old' }),null);
  assert.equal(expectedChange({ 'storm-shot': { ...entries['storm-shot'],reason:'' } },'storm-shot',{ identical:false,sha:['old','reviewed'] }),null);
});
