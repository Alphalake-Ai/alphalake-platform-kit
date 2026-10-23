// Workspace switcher list (createWorkspaces), with fetch stubbed.
const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');
const { createWorkspaces } = require('../src/server/workspaces');

const API = 'https://platform.example';
let calls;
let responses; // url -> { status, body } | Error

global.fetch = async (url) => {
  calls.push(url);
  const r = responses[url];
  if (r instanceof Error) throw r;
  if (!r) return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) };
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
};

const subsUrl = (org) => `${API}/platform/api/internal/org/${org}/subscriptions`;
const entitiesUrl = (uid) => `${API}/platform/api/internal/user/${uid}/entities`;
const ok = (data) => ({ status: 200, body: { success: true, data } });

const entity = (id, type, masterEntityId, parentId, extra = {}) =>
  ({ id, type, masterEntityId, parentId, orgId: 'org-a', name: `${id} name`, ...extra });
const cloud = entity('c1', 'cloud', 'ops-cloud', null);
const ops = entity('w-ops', 'workspace', 'ops-workspace', 'c1', { subType: 'ops', name: 'Ops Workspace' });
const finance = entity('w-fin', 'workspace', 'finance-workspace', 'c1', { subType: 'finance', name: 'Finance Workspace' });
const meds = entity('w-meds', 'workspace', 'meds-workspace', 'c1', { subType: 'meds', name: 'Meds Workspace' });
const otherCloudWs = entity('w-x', 'workspace', 'x-workspace', 'c2', { name: 'Elsewhere' });
const subs = (...entities) => entities.map(e => ({ entityId: e.id, entity: e }));

const make = () => createWorkspaces({ workspaceMasterEntityId: 'ops-workspace', alphalakeInternalApiUrl: API, alphalakeInternalApiKey: 'k' });

beforeEach(() => {
  calls = [];
  responses = {};
});

test('lists the current workspace first, then ones the user holds a hub in, same cloud only', async () => {
  responses[subsUrl('org-a')] = ok(subs(cloud, ops, finance, meds, otherCloudWs));
  responses[entitiesUrl('u1')] = ok([
    entity('h-fin', 'hub', 'fin-hub', 'w-fin'),
    entity('h-x', 'hub', 'x-hub', 'w-x'),
    { ...entity('h-meds', 'hub', 'meds-hub', 'w-meds'), orgId: 'org-b' }, // another org's hub
  ]);
  const result = await make().listForUser('org-a', 'u1');
  assert.deepEqual(result.cloud, { id: 'c1', name: 'c1 name' });
  assert.deepEqual(result.workspaces.map(w => [w.id, w.current]), [['w-ops', true], ['w-fin', false]]);
  assert.equal(result.workspaces[1].subType, 'finance');
});

test('the current workspace is listed even when the user holds no hub in it', async () => {
  responses[subsUrl('org-a')] = ok(subs(cloud, ops));
  const result = await make().listForUser('org-a', 'u1');
  assert.deepEqual(result.workspaces.map(w => w.id), ['w-ops']);
});

test('an org without this app\'s workspace gets an empty list', async () => {
  responses[subsUrl('org-a')] = ok(subs(cloud, finance));
  responses[entitiesUrl('u1')] = ok([entity('h-fin', 'hub', 'fin-hub', 'w-fin')]);
  assert.deepEqual(await make().listForUser('org-a', 'u1'), { cloud: null, workspaces: [] });
});

test('caches per org + user, and does not cache failures', async () => {
  responses[subsUrl('org-a')] = ok(subs(cloud, ops));
  const ws = make();
  await Promise.all([ws.listForUser('org-a', 'u1'), ws.listForUser('org-a', 'u1')]);
  await ws.listForUser('org-a', 'u1');
  assert.equal(calls.length, 2); // one subscriptions + one entities call

  responses[subsUrl('org-a')] = { status: 500, body: {} };
  ws.invalidate();
  await assert.rejects(ws.listForUser('org-a', 'u1'), /failed \(500\)/);
  responses[subsUrl('org-a')] = ok(subs(cloud, ops));
  assert.equal((await ws.listForUser('org-a', 'u1')).workspaces.length, 1);
});

test('missing org or user returns an empty list without calling the platform', async () => {
  assert.deepEqual(await make().listForUser(null, 'u1'), { cloud: null, workspaces: [] });
  assert.equal(calls.length, 0);
});
