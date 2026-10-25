/** Versioned, data-only handle-lifetime checks. No native or process operations. */
import { isDeepStrictEqual as equal } from 'node:util';
import { diagnosticAssessment } from './diagnostic-capture.mjs';
import { membershipSnapshot } from './capture.mjs';
const uint = n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
const good = q => q?.ok === true && (q.win32Error === undefined || q.win32Error === 0);
const handle = h => /^0x[1-9a-f][0-9a-f]*$/i.test(h);
export function phaseAssessment(input, n) {
  if (n?.captureVersion === 2 && n?.diagnosticVersion === 1) return diagnosticAssessment(input, n);
  const errors = new Set(), require = (ok, why) => { if (!ok) errors.add(why); };
  const schema = n?.captureVersion === 3 && n?.diagnosticVersion === 2 && n?.scenario === 'root-gate';
  require(schema, 'phase-schema-unsupported');
  const lives = Array.isArray(n?.lifetimes) && n.lifetimes.length > 0 && n.lifetimes.length <= 8 ? n.lifetimes : [];
  require(lives.length > 0 && n?.lifetimeOverflow === 0 && n?.replacementDetected === false, 'lifetime-inventory-unknown');
  const pids = new Set(), handles = new Set(), refs = new Map(), boundPids = new Set();
  const rawQuery = q => q?.attempted === true && good(q);
  const waitExit = v => good(v?.wait) && [0,258].includes(v.wait.result) && good(v?.exit) && uint(v.exit.code);
  const initialValid = life => {
    const v = life?.initial, id = v?.identity, r = life?.bindingRef;
    return v?.phase === 'initial' && equal(v.bindingRef, r) && v.role === r?.role && v.state === 'acquired' &&
      Number.isSafeInteger(id?.pid) && id.pid > 0 && /^\d{16,20}$/.test(id.creationFileTime) &&
      typeof id.image === 'string' && id.image.length > 0 && id.image.length <= 1024 && id.member === true &&
      ['pid','creation','image','membership'].every(k => rawQuery(v.queries?.[k])) && waitExit(v) && v.wait.result === 258;
  };
  for (const [i, life] of lives.entries()) {
    const r = life?.bindingRef, id = life?.initial?.identity;
    const refValid = r && typeof r.role === 'string' && r.role.length <= 40 && r.sequence === i+1 && handle(r.handle) && !refs.has(r.role) && !handles.has(r.handle);
    require(refValid && life?.bindingComplete === true && life.continuous === true && initialValid(life), 'initial-binding-or-continuity-unknown');
    require(Number.isSafeInteger(id?.pid) && !pids.has(id.pid), 'PID-lifetime-replacement-or-missing');
    pids.add(id?.pid); handles.add(r?.handle); refs.set(r?.role, life);
    const inventory = n?.handleInventory?.[r?.role];
    require(inventory?.acquisition === 'acquired' && inventory.handle === r?.handle && equal(inventory.bindingRef,r), 'inventory-binding-mismatch');
    if(refValid && life?.bindingComplete===true && life.continuous===true && initialValid(life) && inventory?.acquisition==='acquired' &&
      inventory.handle===r.handle && equal(inventory.bindingRef,r)) boundPids.add(id.pid);
  }
  const observe = v => {
    const life = refs.get(v?.role), ref = life?.bindingRef, initial = life?.initial?.identity;
    if (!life || !equal(v?.bindingRef, ref) || !waitExit(v)) return false;
    if (v.phase === 'initial') return initialValid({ ...life, initial:v }) && equal(v.identity,initial);
    const q = v.queries?.image;
    return v.phase === 'terminal' && v.state === 'acquired' && ['pid','creation','membership'].every(k => rawQuery(v.queries?.[k])) &&
      q?.attempted === false && q.reason === 'terminal-retains-initial-binding' && equal(q.bindingRef,ref) &&
      !('ok' in q) && !('win32Error' in q) && !('value' in q) && !('image' in (v.identity ?? {})) &&
      v.identity?.pid === initial?.pid && v.identity.creationFileTime === initial?.creationFileTime && v.identity.member === true;
  };
  const samples = Array.isArray(n?.terminalSamples) ? n.terminalSamples : [];
  const events = Array.isArray(n?.events) ? n.events : [];
  require(samples.length > 0 && samples.length <= 8 && events.length <= 64, 'terminal-or-event-bound');
  require(lives.every(l=>events.some(e=>e.kind==='handle-observation' && equal(e.data,l.initial))), 'initial-acquisition-event-missing');
  const observations = lives.flatMap(l => [l.initial,l.terminal]);
  for (const s of [...samples,n?.terminalEvidence]) {
    const processes = s?.processes;
    require(Array.isArray(processes) && processes.length > 0 && processes.length <= 8 && new Set(processes.map(v=>v.role)).size === processes.length,
      'terminal-process-inventory-missing');
    if (Array.isArray(processes)) {
      observations.push(...processes);
      require(processes.length === s?.members?.total, 'terminal-accounting-lifetime-gap');
    }
  }
  for (const e of events) if (['handle-observation','gate-handle-observation'].includes(e.kind)) observations.push(e.data);
  for (const entry of Object.values(n?.handleInventory ?? {})) if (entry.observation) observations.push(entry.observation);
  require(observations.every(observe), 'recorded-required-query-or-reference-failure');
  const inventories = [n?.freshOwner,n?.beforeResume,n?.gateSnapshot,n?.lastObservation,...samples.map(s=>s.members),n?.terminalEvidence?.members,
    ...events.filter(e=>e.kind === 'membership').map(e=>e.data),...events.filter(e=>e.kind==='owner-acquired').map(e=>e.data?.members)];
  require(inventories.every(Boolean), 'missing-membership-inventory');
  let maxTotal = 0;
  for (const raw of inventories) {
    const m = membershipSnapshot(raw);
    require(m.complete && raw?.complete === true && raw?.queryError === 0 && raw?.accountingError === 0 && m.total <= 8, 'membership-partial-query-or-overflow');
    if (m.complete) { maxTotal=Math.max(maxTotal,m.total); require(m.pids.every(pid=>pids.has(pid)), 'observed-member-not-acquired'); }
  }
  require(maxTotal === lives.length, 'cumulative-total-unacquired-lifetime');
  let previous = 0;
  for (const e of events.filter(e=>e.kind === 'membership')) { require(uint(e.data?.total) && e.data.total >= previous,'accounting-total-decreased'); previous=e.data?.total ?? previous; }
  const acquisitions = Array.isArray(n?.memberAcquisitions) ? n.memberAcquisitions : [];
  require(acquisitions.length === Math.max(0,lives.length-1) && acquisitions.length <= 7 &&
    acquisitions.every(a=>a.acquisition === 'acquired' && refs.get(a.role)?.initial?.identity?.pid === a.pid && equal(a.bindingRef,refs.get(a.role)?.bindingRef)) &&
    new Set(acquisitions.map(a=>a.role)).size === acquisitions.length, 'failed-or-omitted-member-acquisition');
  const counter = n?.observation;
  require(counter?.failures === 0 && counter.dropped === 0 && Array.isArray(counter.errors) && counter.errors.length === 0, 'observation-failure-or-loss');
  const root = refs.get('root'); require(root?.bindingRef?.sequence === 1 && initialValid(root), 'root-initial-binding-missing');
  const last = n?.terminalEvidence, lastRows = last?.processes;
  const lastValid = Array.isArray(lastRows) && lastRows.length === lives.length && lives.every(l=>lastRows.some(v=>equal(v.bindingRef,l.bindingRef) && observe(v) && v.wait.result===0 &&
    equal(v,l.terminal) && equal(v,n?.handleInventory?.[l.bindingRef?.role]?.observation)));
  require(lastValid && equal(last,samples.at(-1)), 'missing-final-liveness-evidence');
  const disposed = lives.every(l=>l.closed === true && n?.handleInventory?.[l.bindingRef?.role]?.disposition === 'closed');
  require(disposed, 'process-disposal-unknown');
  const finalMembers = membershipSnapshot(last?.members);
  const complete = errors.size === 0;
  return { complete, reasons:[...errors], rootBinding:root?.initial?.identity ?? null,
    rootBound:schema && boundPids.has(root?.initial?.identity?.pid) && n?.replacementDetected===false,boundPids:[...boundPids],
    extraMemberBound: schema && lives.some(l=>l.bindingRef?.role!=='root' && boundPids.has(l.initial?.identity?.pid)),
    closed:complete && disposed && finalMembers.complete && finalMembers.active===0 && finalMembers.total===lives.length };
}
