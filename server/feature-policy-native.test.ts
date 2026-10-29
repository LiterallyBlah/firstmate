// Production receiver regression from the independent PR 171 review; disposable homes only.
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FEATURES_OFF, DEFAULT_FEATURE_CAPACITY } from '../shared/feature-settings';
import { FirstmateConfigSchema } from '../shared/fleet';
import { FeaturePolicyRuntime } from './feature-policy-runtime';
import { FeatureSettingsService, registerFeatureSettingsRpc } from './feature-settings-rpc';
import { SupervisionRuntime } from './supervision-runtime';
import { MaintenanceRuntime, registerMaintenanceRuntime } from './maintenance-runtime';
import { admitMaintenanceFromUi } from '../shared/maintenance-runtime';
import contribute from '../index.server';
import { updateFirstmateConfig } from './config';
import { pluginDir } from './data-dir';
import { SupervisionStore } from './supervision-store';
import { SupervisionGateway, stableId } from './supervision-effects';
import { SupervisionWorkerReceiver } from './supervision-worker-receiver';
import { s04Fixture } from '../test/supervision-s04-fixture';
import type { PaseoApi } from './host-types';

// Pause only real receiver filesystem preparation; every store/policy operation still uses real IO.
const gate = vi.hoisted(() => ({ wait: null as Promise<void> | null, entered: null as (() => void) | null,
  project: null as string | null, realpathWait: null as Promise<void> | null, realpathEntered: null as (() => void) | null }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, mkdir: vi.fn(async (...args: Parameters<typeof actual.mkdir>) => {
    if (String(args[0]).includes('supervisor-workspaces') && gate.wait) {
      gate.entered?.(); await gate.wait;
    }
    return actual.mkdir(...args);
  }), realpath: vi.fn(async (...args: Parameters<typeof actual.realpath>) => {
    if (String(args[0]) === gate.project && gate.realpathWait) {
      gate.realpathEntered?.(); await gate.realpathWait;
    }
    return actual.realpath(...args);
  }) };
});

it('production contribution hot-applies two-client RPC policy without re-registering clock, acquiring coordinator or waking model', async () => {
  const home = join(process.env.PASEO_HOME!, 'contributed-home');
  await mkdir(join(home, 'data'), { recursive: true });
  await writeFile(join(process.env.PASEO_HOME!, 'server-id'), 'isolated-review-host');
  await updateFirstmateConfig({ home, mateAgentId: '' });
  await updateFirstmateConfig({ mateAgentId: 'general' });
  const handlers = new Map<string, (input: any, context?: any) => Promise<any>>();
  const timers: { callback: () => unknown; delay: number }[] = [];
  const clock = vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => unknown, delay: number) => {
    timers.push({ callback, delay }); return { unref() {} } as any;
  }) as any);
  const coordinator = vi.spyOn(SupervisionStore.prototype, 'acquireCoordinator');
  const server = { handle: (rpc: any, fn: any) => handlers.set(rpc.name, fn), on: () => () => {},
    before: () => () => {}, registerSettings: () => {} } as any;
  const cleanup = contribute(server), timerCount = timers.length;
  const generalSend = vi.fn(async () => {});
  const api = { agents: { ref: (id: string) => ({ refresh: async () => ({ agent: { id, status: 'idle', archivedAt: null } }), send: generalSend }) } };
  const call = (name: string, input: any = {}) => handlers.get(name)!(input, { paseo: api });
  const save = (revision: number, requested: any) => call('firstmate.features.set', { home, expectedRevision: revision,
    requestId: randomUUID(), change: { requested: { ...FEATURES_OFF, ...requested }, capacity: DEFAULT_FEATURE_CAPACITY } });
  try {
    expect((await call('firstmate.features.read', { home })).effective).toEqual(FEATURES_OFF);
    await save(0, { projectMates: true });
    expect((await call('firstmate.projects.read')).enabled).toBe(true);
    expect((await call('firstmate.maintenance.read')).enabled).toBe(false);
    const secondClient = await call('firstmate.features.read', { home });
    await save(secondClient.revision, {});
    expect((await call('firstmate.projects.read')).enabled).toBe(false);
    await expect(save(secondClient.revision, { maintenance: true })).rejects.toMatchObject({ code: 'STALE' });
    await save(2, { scopeUi: true, scopeExecution: true, maintenance: true });
    expect((await call('firstmate.scope.read')).executionEnabled).toBe(true);
    expect((await call('firstmate.maintenance.read')).enabled).toBe(true);
    expect((await call('firstmate.projects.read')).enabled).toBe(false);
    await save(3, {});
    expect((await call('firstmate.scope.read')).executionEnabled).toBe(false);
    const homeId = (await call('firstmate.features.read', { home })).homeId;
    await expect(call('firstmate.projects.provision-ui', { homeId, requestId: randomUUID(), projectId: randomUUID(), projectVersion: 1 })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(call('firstmate.maintenance.admit-ui', { homeId, requestId: randomUUID(), scopeId: randomUUID(), name: 'Checks',
      profile: { provider: 'codex/test', modeId: 'full-access' }, limits: { supervisorSessions: 1, supervisorTurns: 4 } })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(call('firstmate.supervision.attach-ui', { homeId, requestId: randomUUID(), resume: true })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect([...handlers.keys()].filter(k => k.includes('attach'))).toEqual(['firstmate.supervision.attach-ui']);
    expect(await call('firstmate.mate.ask', { text: 'General remains available while help is off.' })).toEqual({ agentId: 'general' });
    expect(generalSend).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(timerCount);
    expect(coordinator).not.toHaveBeenCalled();
    await expect(readdir(join(pluginDir(), 'supervision'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await cleanup(); coordinator.mockRestore(); clock.mockRestore(); }
});

it('off completed before native workspace creation must refuse that still-undispatched effect', async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, 'home');
  await mkdir(join(home, 'data'), { recursive: true });
  const policy = new FeaturePolicyRuntime(root), runtime = new SupervisionRuntime(root, undefined, policy);
  const config = async () => FirstmateConfigSchema.parse({ home, mateAgentId: 'general' });
  const maintenance = new MaintenanceRuntime(runtime, { config, inventory: vi.fn() });
  const handlers = new Map<string, (input: any, context?: any) => Promise<any>>();
  const server = { handle: (rpc: any, fn: any) => handlers.set(rpc.name, fn), on: () => () => {} } as any;
  registerFeatureSettingsRpc(server, new FeatureSettingsService(root, { home: async () => home, runtime: policy }));
  const stop = registerMaintenanceRuntime(server, maintenance);
  const set = (revision: number, maintenance: boolean) => handlers.get('firstmate.features.set')!({
    home, expectedRevision: revision, requestId: randomUUID(),
    change: { requested: { ...FEATURES_OFF, maintenance }, capacity: DEFAULT_FEATURE_CAPACITY },
  });
  const nativeOpen = vi.fn(async () => ({ id: 'native-workspace' }));
  const api = { workspaces: { open: nativeOpen } };
  let release!: () => void, enter!: () => void;
  gate.wait = new Promise<void>(r => { release = r; });
  const entered = new Promise<void>(r => { enter = r; }); gate.entered = enter;
  try {
    await set(0, true);
    const input = { homeId: (await policy.read(home)).homeId, requestId: randomUUID(), scopeId: randomUUID(),
      name: 'Routine checks', profile: { provider: 'codex/test', modeId: 'full-access' },
      limits: { supervisorSessions: 1, supervisorTurns: 4 } };
    const result = handlers.get(admitMaintenanceFromUi.name)!(input, { paseo: api }).then(value => ({ value }), error => ({ error }));
    await entered;
    expect(nativeOpen).not.toHaveBeenCalled();
    await set(1, false);
    expect((await policy.read(home)).effective.maintenance).toBe(false);
    expect(nativeOpen).not.toHaveBeenCalled();
    release();
    const outcome = await result, status = await runtime.read(home);
    expect(nativeOpen, 'No workspace RPC had begun when off was durably saved').not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ error: { code: 'UNSUPPORTED' } });
    expect(status.effects.map(e => e.state)).toEqual(['reserved', 'reserved', 'reserved']);
    expect(status.effects.every(e => !status.commands.some(c => c.id === stableId('dispatch-claim', e.id)))).toBe(true);
    expect(status.bindings).toHaveLength(1);
    expect(status.bindings[0]!.state).toBe('prepared');
    expect((await maintenance.read()).owners[0]).toMatchObject({ sessions: 1, turns: 1 });
  } finally { release(); gate.wait = null; gate.entered = null; stop(); await runtime.stop(); }
});

it.each(['project lookup', 'realpath'])('off completed during worker %s refuses native worktree creation and retains the original attempt', async phase => {
  const f = await s04Fixture(), owner = await f.addScope(1, 'native-policy', ['probe']);
  await f.draft(owner, [{ id: 'probe' }]);
  const started = await f.start(owner, 'probe'), before = await f.store.read();
  const root = join(f.home, 'store'), project = join(f.home, 'project'), policy = new FeaturePolicyRuntime(root);
  await mkdir(project);
  const set = (revision: number, enabled: boolean) => policy.set({ home: f.home, expectedRevision: revision, requestId: randomUUID(),
    change: { requested: { ...FEATURES_OFF, planSupervisors: enabled }, capacity: DEFAULT_FEATURE_CAPACITY } });
  await set(0, true);
  let release!: () => void, enter!: () => void;
  const wait = new Promise<void>(r => { release = r; }), entered = new Promise<void>(r => { enter = r; });
  if (phase === 'realpath') { gate.project = project; gate.realpathWait = wait; gate.realpathEntered = enter; }
  const create = vi.fn(async () => { throw new Error('Native reply lost after invocation'); });
  const receiver = new SupervisionWorkerReceiver({ workspaces: { create } } as unknown as PaseoApi, root, async () => {
    if (phase === 'project lookup') { enter(); await wait; }
    return project;
  });
  const gateway = new SupervisionGateway(f.store, f.commands, f.home, receiver, { enabled: true,
    policyFence: policy.gateway(f.home, 'planSupervisors', () => f.store.read()) });
  try {
    const pending = gateway.dispatch(started.effects!.workspace); void pending.catch(() => {});
    await entered;
    expect(create).not.toHaveBeenCalled();
    await set(1, false);
    expect((await policy.read(f.home)).effective.planSupervisors).toBe(false);
    release();
    await expect(pending).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(create).not.toHaveBeenCalled();
    const paused = await f.store.read();
    expect(paused.effects).toEqual(before.effects);
    expect(paused.attempts).toEqual(before.attempts);
    // Re-enable retries only this still-unclaimed effect. Once the native API is invoked,
    // a lost reply remains uncertain and cannot be retried or reset by another on/off cycle.
    await set(2, true);
    await expect(gateway.dispatch(started.effects!.workspace)).resolves.toMatchObject({ state: 'uncertain' });
    expect(create).toHaveBeenCalledTimes(1);
    await expect(gateway.dispatch(started.effects!.workspace)).rejects.toMatchObject({ code: 'UNCERTAIN' });
    expect((await f.store.read()).attempts).toEqual(before.attempts);
  } finally {
    release(); gate.project = null; gate.realpathWait = null; gate.realpathEntered = null;
    await f.store.releaseCoordinator();
  }
});

it.each([false, true])('production RPC in-flight maintenance opening settles across off/reload once; lost=%s', async lost => {
  const home = join(process.env.PASEO_HOME!, `rpc-flight-${randomUUID()}`);
  await mkdir(join(home, 'data'), { recursive: true });
  await writeFile(join(process.env.PASEO_HOME!, 'server-id'), 'isolated-review-host');
  await updateFirstmateConfig({ home, mateAgentId: '' });
  await updateFirstmateConfig({ mateAgentId: 'general' });
  const clock = vi.spyOn(globalThis, 'setInterval').mockImplementation((() => ({ unref() {} })) as any);
  const handlers = new Map<string, (input: any, context?: any) => Promise<any>>();
  const server = { handle: (rpc: any, fn: any) => handlers.set(rpc.name, async (input: any, context: any) =>
    rpc.output.parse(await fn(rpc.input.parse(input), context))), on: () => () => {},
    before: () => () => {}, registerSettings: () => {} } as any;
  const agents = new Map<string, any>(); let workspaceDirectory = '';
  let release!: () => void, enter!: () => void;
  const sendGate = new Promise<void>(r => { release = r; });
  const entered = new Promise<void>(r => { enter = r; });
  const send = vi.fn(async () => { enter(); await sendGate; if (lost) throw new Error('lost native reply'); });
  const create = vi.fn(async (intent: any) => {
    const [provider, model] = intent.config.provider.split('/');
    const agent = { id: intent.agentId, cwd: workspaceDirectory, workspaceId: 'rpc-workspace', labels: intent.labels,
      provider, model, currentModeId: intent.config.modeId, thinkingOptionId: null,
      status: 'idle', pendingPermissions: [], archivedAt: null };
    agents.set(agent.id, agent); return { id: agent.id };
  });
  const api = { workspaces: {
    open: vi.fn(async (path: string) => { workspaceDirectory = path; return { id: 'rpc-workspace' }; }),
    ref: () => ({ agents: { create } }),
  }, agents: { ref: (id: string) => ({ refresh: async () => ({ agent: agents.get(id) }), send }) } };
  const call = (name: string, input: any = {}) => handlers.get(name)!(input, { paseo: api });
  let cleanup = contribute(server);
  try {
    const save = (revision: number, maintenance: boolean) => call('firstmate.features.set', { home, expectedRevision: revision,
      requestId: randomUUID(), change: { requested: { ...FEATURES_OFF, maintenance }, capacity: DEFAULT_FEATURE_CAPACITY } });
    await save(0, true);
    const input = { homeId: (await call('firstmate.features.read', { home })).homeId, requestId: randomUUID(), scopeId: randomUUID(),
      name: 'Routine checks', profile: { provider: 'codex/test', modeId: 'full-access' },
      limits: { supervisorSessions: 1, supervisorTurns: 4 } };
    const pending = call('firstmate.maintenance.admit-ui', input);
    await entered;
    await save(1, false);
    expect((await call('firstmate.features.read', { home })).effective.maintenance).toBe(false);
    release(); await pending;
    const settled = await call('firstmate.maintenance.read');
    expect(settled.owners[0]).toMatchObject({ scopeId: input.scopeId, sessions: 1, turns: 1, opening: lost ? 'uncertain' : 'succeeded' });
    await cleanup(); cleanup = contribute(server);
    const reloaded = await call('firstmate.maintenance.read');
    expect(reloaded.enabled).toBe(false); expect(reloaded.owners).toEqual(settled.owners);
    await expect(call('firstmate.maintenance.admit-ui', { homeId: input.homeId, requestId: input.requestId, resume: true })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(send).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  } finally { release(); await cleanup(); clock.mockRestore(); }
});
