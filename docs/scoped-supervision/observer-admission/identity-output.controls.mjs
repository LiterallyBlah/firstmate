/** Synthetic R02-O1 boundaries only; no actual process/probe is launched. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createSession } from './session.mjs';
import { observeExistingExec } from './adapters.mjs';

for (const rejected of [false, true]) for (const stream of ['stdout', 'stderr']) for (const length of [1023, 1024, 1025, 2048]) {
  test(`${rejected ? 'rejected' : 'fulfilled'} ${stream} ${length}: bounded output and aggregate loss agree`, async () => {
    const payload = 'x'.repeat(length), value = { stdout: '', stderr: '', [stream]: payload };
    const failure = Object.assign(Error('original synthetic rejection'), value, { code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true });
    const child = Object.assign(new EventEmitter(), { pid: 1234, killed: rejected, spawnfile: 'existing-probe', spawnargs: ['unchanged'] });
    const promise = Object.assign(rejected ? Promise.reject(failure) : Promise.resolve(value), { child });
    promise.catch(() => {});
    const options = { timeout: 5000, maxBuffer: 4096, windowsHide: true }, args = ['unchanged'], receipts = [];
    let delegated = 0;
    const session = createSession({ name: 'synthetic-output-boundary', sink: receipt => receipts.push(receipt) });
    const exec = observeExistingExec(session, (file, received, opts) => {
      delegated++; assert.equal(file, 'existing-probe'); assert.equal(received, args); assert.equal(opts, options); return promise;
    });
    const result = session.run(() => exec('existing-probe', args, options));
    assert.equal(result, promise);
    child.emit('exit', rejected ? null : 0, rejected ? 'SIGTERM' : null);
    child.emit('close', rejected ? null : 0, rejected ? 'SIGTERM' : null);
    if (rejected) await assert.rejects(result, error => error === failure);
    else assert.equal(await result, value);
    assert.equal(delegated, 1);
    assert.equal((rejected ? failure : value)[stream], payload, 'original output must remain intact');
    const receipt = session.snapshot('boundary'), retained = receipt.rows.find(row => row.name === `identity.exec.${stream}`);
    const lengths = JSON.parse(receipt.rows.find(row => row.name === 'identity.exec.output-lengths').data);
    const truncated = length > 1024;
    assert.equal(retained.data, payload.slice(0, 1024));
    assert.equal(lengths[stream], length); assert.equal(lengths.truncated, truncated);
    assert.equal(receipt.observerErrors, 0); assert.equal(receipt.dropped, 0);
    console.log(JSON.stringify({ rejected, stream, length, retained: retained.data.length,
      fieldTruncations: receipt.fieldTruncations, incomplete: receipt.incomplete, delegated }));
    // Assert aggregate classification first: the original implementation fails here.
    assert.equal(receipt.incomplete, truncated, 'aggregate capture completeness must include output loss');
    assert.equal(receipt.fieldTruncations, truncated ? 1 : 0);
    const persisted = receipts.find(row => row.label === 'identity-result');
    assert.equal(persisted.incomplete, truncated); assert.equal(persisted.fieldTruncations, truncated ? 1 : 0);
    session.dispose();
  });
}
