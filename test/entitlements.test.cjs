// Subscription lookups (createEntitlements + the platform client), with fetch stubbed.
const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');
const { createEntitlements } = require('../src/server/entitlements');
const { alphalakeGetUserEntities } = require('../src/server/platformClient');

const API = 'https://platform.example';
let calls;
let responses; // url -> { status, body } | Error

global.fetch = async (url, init) => {
  calls.push({ url, headers: init?.headers });
  const r = responses[url];
  if (r instanceof Error) throw r;
  if (!r) return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) };
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
};

const sub = (masterEntityId, entityId) => ({ entityId, paused: false, entity: { masterEntityId, type: 'hub' } });
const subsUrl = (org) => `${API}/platform/api/internal/org/${org}/subscriptions`;

const make = (opts = {}) =>
  createEntitlements({
    hubs: { repeats: 'rp-hub', cardex: 'meds-reader' },
    alphalakeInternalApiUrl: API,
    alphalakeInternalApiKey: 'k',
    ...opts,
  });

beforeEach(() => {
  calls = [];
  responses = {};
});

test('maps subscriptions onto the app hubs, ignoring other entities', async () => {
  responses[subsUrl('org-a')] = {
    status: 200,
    body: { success: true, data: [sub('pharmacy-cloud', 'c1'), sub('meds-reader', 'e-mr'), sub('pf-hub', 'e-pf')] },
  };
  const ent = make();
  assert.deepEqual([...(await ent.orgHubs('org-a'))], ['cardex']);
  assert.equal(await ent.hubEntityId('org-a', 'cardex'), 'e-mr');
  assert.equal(await ent.hubEntityId('org-a', 'repeats'), null);
  assert.equal(calls[0].headers['x-api-key'], 'k');
});

test('an unknown org (empty list) has no hubs', async () => {
  assert.equal((await make().orgHubs('nobody')).size, 0);
});

test('caches per org until the TTL passes or the org is invalidated', async () => {
  responses[subsUrl('org-a')] = { status: 200, body: { success: true, data: [sub('rp-hub', 'e-rp')] } };
  const ent = make();
  await ent.orgHubs('org-a');
  await ent.orgHubs('org-a');
  await Promise.all([ent.orgHubs('org-b'), ent.orgHubs('org-b')]); // concurrent: one request
  assert.equal(calls.length, 2);
  ent.invalidate('org-a');
  await ent.orgHubs('org-a');
  assert.equal(calls.length, 3);

  const expired = make({ ttlMs: 0 });
  await expired.orgHubs('org-a');
  await expired.orgHubs('org-a');
  assert.equal(calls.length, 5);
});

test('lookup failures are thrown and not cached', async () => {
  responses[subsUrl('org-a')] = { status: 401, body: { success: false } };
  const ent = make();
  await assert.rejects(ent.orgHubs('org-a'), /failed \(401\)/);
  responses[subsUrl('org-a')] = new Error('network down');
  await assert.rejects(ent.orgHubs('org-a'), /network down/);
  responses[subsUrl('org-a')] = { status: 200, body: { success: true, data: [sub('rp-hub', 'e')] } };
  assert.deepEqual([...(await ent.orgHubs('org-a'))], ['repeats']);
});

test('path parameters are encoded', async () => {
  await alphalakeGetUserEntities('a/b?c', { alphalakeInternalApiUrl: `${API}/`, alphalakeInternalApiKey: 'k' });
  assert.equal(calls[0].url, `${API}/platform/api/internal/user/a%2Fb%3Fc/entities`);
});

test('requires a hub map', () => {
  assert.throws(() => createEntitlements({ hubs: {} }), /hubs must map/);
});
