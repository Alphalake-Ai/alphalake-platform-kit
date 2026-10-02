// Client login-state checks. Imports the TypeScript source directly (Node's
// built-in type stripping, Node >= 22.18), with a minimal window/sessionStorage.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createAppHost } from '../src/client/appHost.ts';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

let navigatedTo;
let storedToken;

function setLocation(hash) {
  const location = {
    origin: 'https://hub.example',
    hostname: 'hub.example',
    pathname: '/',
    search: '',
    hash,
    get href() {
      return `${this.origin}${this.pathname}${this.search}${this.hash}`;
    },
    set href(url) {
      navigatedTo = url;
    },
  };
  globalThis.window = {
    location,
    history: {
      replaceState: (_s, _t, url) => {
        const i = url.indexOf('#');
        location.hash = i === -1 ? '' : url.slice(i);
        const beforeHash = i === -1 ? url : url.slice(0, i);
        const q = beforeHash.indexOf('?');
        location.search = q === -1 ? '' : beforeHash.slice(q);
      },
    },
  };
}

function host(loginState = true) {
  return createAppHost({
    mode: 'central',
    loginState,
    appHost: '',
    marketingHosts: [],
    loggedOutHome: '/',
    centralLoginUrl: 'https://myaccount.example/login',
    centralLogoutUrl: 'https://myaccount.example/logout',
    centralManageUrl: 'https://myaccount.example/manage',
    isAuthenticated: () => storedToken !== undefined,
    setToken: (t) => {
      storedToken = t;
    },
    getToken: () => storedToken ?? null,
    refreshProfile: async () => {},
  });
}

const stateIn = (loginUrl) => new URL(new URL(loginUrl).searchParams.get('continue')).searchParams.get('ls');

beforeEach(() => {
  globalThis.sessionStorage = memoryStorage();
  navigatedTo = undefined;
  storedToken = undefined;
  setLocation('');
});

test('the login link carries a login-state value inside continue, reused until sign-in', () => {
  const h = host();
  const link = h.centralLoginLink();
  const state = stateIn(link);
  assert.match(state, /^[0-9a-f]{48}$/);
  assert.equal(new URL(new URL(link).searchParams.get('continue')).origin, 'https://hub.example');
  assert.equal(stateIn(h.centralLoginLink()), state);
});

test('a _t with this tab\'s login state is accepted and cleaned from the URL', () => {
  const h = host();
  const state = stateIn(h.centralLoginLink());
  h.redirectToCentralLogin();
  setLocation(`#/repeats?_t=jwt-1&ls=${state}`);

  assert.equal(h.consumeTokenFromHash(), 'accepted');
  assert.equal(storedToken, 'jwt-1');
  assert.equal(window.location.hash, '#/repeats');
  assert.equal(sessionStorage.getItem(h.SSO_ATTEMPTED_KEY), null);
  // A new login gets a fresh value.
  assert.notEqual(stateIn(h.centralLoginLink()), state);
});

test('a _t without (or with another) login state is refused; the second refusal is an auth_error', () => {
  const h = host();
  stateIn(h.centralLoginLink());
  h.redirectToCentralLogin();

  setLocation('#/?_t=attacker-jwt');
  assert.equal(h.consumeTokenFromHash(), 'refused');
  assert.equal(storedToken, undefined);
  assert.equal(window.location.hash, '#/');
  // Cleared so the gate starts a normal login rather than the logout recovery.
  assert.equal(sessionStorage.getItem(h.SSO_ATTEMPTED_KEY), null);

  setLocation('#/?_t=attacker-jwt&ls=0123456789abcdef0123');
  assert.equal(h.consumeTokenFromHash(), 'refused');
  assert.equal(storedToken, undefined);
  assert.equal(window.location.hash, '#/?auth_error=login_state_mismatch');
});

test('a tab that never started a login refuses a _t it is handed', () => {
  const h = host();
  setLocation('#/?_t=attacker-jwt&ls=0123456789abcdef0123');
  assert.equal(h.consumeTokenFromHash(), 'refused');
  assert.equal(storedToken, undefined);
});

test('without loginState, behaviour is unchanged (and a stray ls is stripped)', () => {
  const h = host(false);
  assert.equal(new URL(h.centralLoginLink()).searchParams.get('continue'), 'https://hub.example');
  setLocation('#/?_t=jwt-2&ls=0123456789abcdef0123');
  assert.equal(h.consumeTokenFromHash(), 'accepted');
  assert.equal(storedToken, 'jwt-2');
  assert.equal(window.location.hash, '#/');
});

test('no _t in the hash is a no-op', () => {
  const h = host();
  setLocation('#/repeats?auth_error=not_provisioned');
  assert.equal(h.consumeTokenFromHash(), 'none');
  assert.equal(window.location.hash, '#/repeats?auth_error=not_provisioned');
});

test('the logout link carries the same login state, so the sign-in after it is accepted', () => {
  const h = host();
  h.redirectToCentralLogout();
  // myaccount signs out, then shows its sign-in page with this same `continue`.
  const state = stateIn(navigatedTo);
  assert.match(state, /^[0-9a-f]{48}$/);
  assert.equal(stateIn(h.centralLoginLink()), state);

  setLocation(`#/?_t=jwt-3&ls=${state}`);
  assert.equal(h.consumeTokenFromHash(), 'accepted');
  assert.equal(storedToken, 'jwt-3');
});

test('without loginState the logout link is unchanged', () => {
  host(false).redirectToCentralLogout();
  assert.equal(new URL(navigatedTo).searchParams.get('continue'), 'https://hub.example');
});

test('a ?ls= left in the address bar by the platform redirect is removed', () => {
  const h = host();
  setLocation('#/repeats');
  window.location.search = '?ls=abc&keep=1';
  assert.equal(h.consumeTokenFromHash(), 'none');
  assert.equal(window.location.search, '?keep=1');
  assert.equal(window.location.hash, '#/repeats');
});

test('a revoked session is sent through the platform logout once per tab', () => {
  const h = host();
  assert.equal(h.recoverFromAuthError('session_revoked'), true);
  assert.match(navigatedTo, /^https:\/\/myaccount\.example\/logout\?continue=/);
  assert.equal(h.recoverFromAuthError('session_revoked'), false);
  assert.equal(h.recoverFromAuthError('not_provisioned'), false);
});
