// Login callback: revocation check, single-use login tokens, login-state echo.
// Firebase and Postgres are stubbed; firebase.js is swapped out via the
// require cache before centralAuth.js loads it.
const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const firebasePath = require.resolve('../src/server/firebase');
let firebase;
require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: { getFirebaseAuth: () => firebase, buildFirebaseCredential: () => null },
};
const { createCentralAuth } = require('../src/server/centralAuth');

const USER = { id: 'u-1', email: 'a@example.com', name: 'A', role: 'admin', org_id: 'org-1', token_version: 0 };
const STATE = 'a'.repeat(48);

let usedTokens; // token_hash -> first use (ms)
let tokenTableMissing;
let verifyCalls;

const pool = {
  async query(sql, params = []) {
    if (/^\s*DELETE FROM used_login_tokens/.test(sql)) {
      if (tokenTableMissing) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      return { rows: [] };
    }
    if (/INSERT INTO used_login_tokens/.test(sql)) {
      const [hash, , graceSeconds] = params;
      if (!usedTokens.has(hash)) usedTokens.set(hash, Date.now());
      return { rows: [{ fresh: usedTokens.get(hash) > Date.now() - graceSeconds * 1000 }] };
    }
    if (/^SELECT id, email, name, role, org_id FROM users/.test(sql)) return { rows: [USER] };
    if (/^\s*UPDATE users/.test(sql)) return { rows: [USER] };
    throw new Error(`unexpected query: ${sql}`);
  },
};

const auth = createCentralAuth({
  pool,
  jwtSecret: 'test-secret',
  payloadSignatureKey: 'test-key',
  roles: ['admin', 'viewer'],
  publicAppUrl: 'https://hub.example',
  landingPath: () => 'repeats',
});

async function login(query) {
  let redirectedTo;
  await auth.handlers.callback({ query }, { redirect: (url) => { redirectedTo = url; } });
  return redirectedTo;
}

const hashParams = (url) => new URLSearchParams(url.slice(url.indexOf('?', url.indexOf('#')) + 1));

beforeEach(() => {
  usedTokens = new Map();
  tokenTableMissing = false;
  verifyCalls = [];
  firebase = {
    verifyIdToken: async (token, checkRevoked) => {
      verifyCalls.push({ token, checkRevoked });
      return { uid: 'fb-1', exp: Math.floor(Date.now() / 1000) + 3600 };
    },
    getUser: async () => ({ displayName: 'A', email: 'a@example.com' }),
  };
});

test('echoes a well-formed ls from continue next to _t', async () => {
  const url = await login({ token: 'id-1', continue: `https://hub.example/?ls=${STATE}` });
  assert.match(url, /^https:\/\/hub\.example\/#\/repeats\?_t=/);
  assert.equal(hashParams(url).get('ls'), STATE);
  assert.ok(hashParams(url).get('_t'));
});

test('no ls without one in continue, or when it is malformed', async () => {
  for (const cont of [undefined, 'https://hub.example', 'https://hub.example/?ls=short', `https://hub.example/?ls=${'a'.repeat(20)}%26x%3D1`, 'not a url']) {
    usedTokens.clear();
    const url = await login({ token: 'id-1', continue: cont });
    assert.ok(hashParams(url).get('_t'), String(cont));
    assert.equal(hashParams(url).get('ls'), null, String(cont));
  }
});

test('checks revocation by default', async () => {
  await login({ token: 'id-1' });
  assert.deepEqual(verifyCalls, [{ token: 'id-1', checkRevoked: true }]);
});

test('maps revoked / disabled / other verify failures to auth_error codes', async () => {
  for (const [fbCode, expected] of [
    ['auth/id-token-revoked', 'session_revoked'],
    ['auth/user-disabled', 'account_disabled'],
    ['auth/id-token-expired', 'invalid_token'],
  ]) {
    firebase.verifyIdToken = async () => {
      throw Object.assign(new Error(fbCode), { code: fbCode });
    };
    assert.equal(await login({ token: 'id-1' }), `https://hub.example/#/?auth_error=${expected}`);
  }
});

test('a login token may repeat within the grace window but not after it', async () => {
  assert.ok(hashParams(await login({ token: 'id-1' })).get('_t'));
  assert.ok(hashParams(await login({ token: 'id-1' })).get('_t'), 'immediate retry still logs in');

  for (const hash of usedTokens.keys()) usedTokens.set(hash, Date.now() - 61_000);
  assert.equal(await login({ token: 'id-1' }), 'https://hub.example/#/?auth_error=invalid_token');

  assert.ok(hashParams(await login({ token: 'id-2' })).get('_t'), 'a different token is unaffected');
});

test('logins still work if the used_login_tokens table is missing', async () => {
  tokenTableMissing = true;
  assert.ok(hashParams(await login({ token: 'id-1' })).get('_t'));
});
