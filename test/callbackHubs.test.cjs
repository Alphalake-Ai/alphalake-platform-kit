// Multi-hub login check: hub assignments the platform no longer lists are
// dropped at login, ones it lists are added with loginHubRole set, and a user
// left with none is refused. Firebase, Postgres and fetch are stubbed.
const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const firebasePath = require.resolve('../src/server/firebase');
require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: {
    getFirebaseAuth: () => ({
      verifyIdToken: async (token) => ({ uid: 'fb-1', exp: Math.floor(Date.now() / 1000) + 3600, token }),
      getUser: async () => ({ displayName: 'Sam', email: 'sam@example.com' }),
    }),
    buildFirebaseCredential: () => null,
  },
};
const { createCentralAuth } = require('../src/server/centralAuth');

const USER = { id: 'u-1', email: 'sam@example.com', name: 'Sam', role: 'viewer', org_id: 'org-local', token_version: 0 };
let hubRows; // Set of hub names the user holds
let added; // [{ hub, role }] inserted at login
let accessChanged; // onUserAccessChanged calls
let bumps;
let entities; // platform response, or an Error
let tokenSeq = 0;

global.fetch = async () => {
  if (entities instanceof Error) throw entities;
  return { ok: true, status: 200, json: async () => ({ success: true, data: entities }) };
};

const pool = {
  async query(sql, params = []) {
    if (/used_login_tokens/.test(sql)) return /INSERT/.test(sql) ? { rows: [{ fresh: true }] } : { rows: [] };
    if (/^SELECT id, email, name, role, org_id FROM users/.test(sql)) return { rows: [USER] };
    if (/^SELECT external_id FROM organisations/.test(sql)) return { rows: [{ external_id: 'org-ext' }] };
    if (/^DELETE FROM user_hub_roles/.test(sql)) {
      const keep = new Set(params[1]);
      const before = hubRows.size;
      hubRows = new Set([...hubRows].filter((h) => keep.has(h)));
      return { rowCount: before - hubRows.size };
    }
    if (/^INSERT INTO user_hub_roles/.test(sql)) {
      const [, hub, role] = params;
      if (hubRows.has(hub)) return { rowCount: 0 };
      hubRows.add(hub);
      added.push({ hub, role });
      return { rowCount: 1 };
    }
    if (/^UPDATE users SET token_version/.test(sql)) {
      bumps += 1;
      return { rows: [] };
    }
    if (/^SELECT count\(\*\)::int AS n FROM user_hub_roles/.test(sql)) return { rows: [{ n: hubRows.size }] };
    if (/^\s*UPDATE users/.test(sql)) return { rows: [USER] };
    throw new Error(`unexpected query: ${sql}`);
  },
};

const config = {
  pool,
  jwtSecret: 'test-secret',
  payloadSignatureKey: 'test-key',
  roles: ['admin', 'staff', 'viewer'],
  publicAppUrl: 'https://hub.example',
  hubs: { repeats: 'rp-hub', cardex: 'meds-reader' },
  alphalakeInternalApiUrl: 'https://platform.example',
  alphalakeInternalApiKey: 'k',
  onUserAccessChanged: async (orgId) => { accessChanged.push(orgId); },
};
const auth = createCentralAuth(config);
const addingAuth = createCentralAuth({ ...config, loginHubRole: 'viewer' });

async function login(withAuth = auth) {
  let to;
  await withAuth.handlers.callback({ query: { token: `t-${++tokenSeq}` } }, { redirect: (url) => { to = url; } });
  return to;
}

const entity = (masterEntityId, orgId = 'org-ext') => ({ id: `e-${masterEntityId}`, masterEntityId, orgId, type: 'hub' });

beforeEach(() => {
  hubRows = new Set(['repeats', 'cardex']);
  added = [];
  accessChanged = [];
  bumps = 0;
  entities = [entity('rp-hub'), entity('meds-reader')];
});

test('keeps hubs the platform still lists', async () => {
  assert.match(await login(), /_t=/);
  assert.deepEqual([...hubRows], ['repeats', 'cardex']);
  assert.equal(bumps, 0);
});

test('drops a hub the platform no longer lists, ending older sessions', async () => {
  entities = [entity('meds-reader'), entity('pf-hub')];
  assert.match(await login(), /_t=/);
  assert.deepEqual([...hubRows], ['cardex']);
  assert.equal(bumps, 1);
});

test('an assignment in another org does not count', async () => {
  entities = [entity('rp-hub', 'other-org'), entity('meds-reader')];
  await login();
  assert.deepEqual([...hubRows], ['cardex']);
});

test('refuses a login with no hub left', async () => {
  entities = [];
  assert.match(await login(), /auth_error=no_hub_access/);
  assert.equal(hubRows.size, 0);
});

test('without loginHubRole, never adds a hub the user has no local role for', async () => {
  hubRows = new Set(['cardex']);
  await login();
  assert.deepEqual([...hubRows], ['cardex']);
  assert.deepEqual(added, []);
});

test('with loginHubRole, adds a hub the platform lists at that role, without ending sessions', async () => {
  hubRows = new Set(['repeats']);
  assert.match(await login(addingAuth), /_t=/);
  assert.deepEqual(added, [{ hub: 'cardex', role: 'viewer' }]);
  assert.deepEqual([...hubRows].sort(), ['cardex', 'repeats']);
  assert.equal(bumps, 0);
  assert.deepEqual(accessChanged, ['org-local']);
});

test('with loginHubRole, a user with no local hub yet is let in', async () => {
  hubRows = new Set();
  entities = [entity('meds-reader')];
  assert.match(await login(addingAuth), /_t=/);
  assert.deepEqual(added, [{ hub: 'cardex', role: 'viewer' }]);
});

test('with loginHubRole, nothing is added for another org, an unknown hub, or a hub already held', async () => {
  hubRows = new Set(['repeats']);
  entities = [entity('rp-hub'), entity('meds-reader', 'other-org'), entity('pf-hub')];
  await login(addingAuth);
  assert.deepEqual(added, []);
  assert.deepEqual(accessChanged, []);
});

test('loginHubRole must be one of the roles', () => {
  assert.throws(() => createCentralAuth({ ...config, loginHubRole: 'owner' }), /loginHubRole must be one of roles/);
});

test('if the platform cannot be reached, local assignments stand', async () => {
  entities = new Error('network down');
  assert.match(await login(), /_t=/);
  assert.deepEqual([...hubRows], ['repeats', 'cardex']);
});

test('multi-hub mode needs the platform API URL, and platformEventsFor a known hub', () => {
  assert.throws(
    () => createCentralAuth({ pool, jwtSecret: 'x', payloadSignatureKey: 'k', roles: ['admin'], publicAppUrl: 'https://x', hubs: { a: 'b' } }),
    /alphalakeInternalApiUrl is required/
  );
  assert.throws(() => auth.handlers.platformEventsFor('nope'), /unknown hub/);
  assert.equal(typeof auth.handlers.platformEventsFor('cardex'), 'function');
});
