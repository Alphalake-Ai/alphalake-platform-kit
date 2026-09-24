export interface AppHostConfig {
  /** Host this app's authenticated frontend is served from, e.g. 'app.example.ai'. Used for the marketing→app token handoff in goToApp(). */
  appHost: string;
  /** Hosts considered "marketing" — goToApp() does a full navigation to appHost from these, SPA routing everywhere else. */
  marketingHosts: string[];
  /** Where a logged-out visitor lands outside central-auth mode. */
  loggedOutHome: string;
  centralLoginUrl: string;
  centralLogoutUrl: string;
  centralManageUrl: string;
  /** 'central' delegates login to the Alphalake platform; anything else keeps this app's own auth. */
  mode: 'local' | 'central';
  /** Base API path, e.g. '/api' or '/app/api' behind a load balancer that strips a prefix. Default '/api'. */
  apiBase?: string;
  /** Called after a successful SSO token handoff / "My account" return, to refresh cached profile fields. */
  refreshProfile: () => Promise<void>;
  isAuthenticated: () => boolean;
  setToken: (token: string) => void;
  getToken: () => string | null;
}

const AUTH_BLOCKED_KEY = 'centralAuthBlocked';
// Session-scoped marker set just before sending the user to the platform login,
// cleared on a successful sign-in. If the app boots back up on this origin
// still unauthenticated with this flag already set, the platform bounced it
// straight back without ever hitting the callback route (e.g. it has a session
// cookie for the platform generally but won't complete SSO for this module).
const SSO_ATTEMPTED_KEY = 'centralSsoAttempted';
// Caps the logout/login recovery below (see CentralAuthGate) to one attempt
// per tab, so a persistent platform-side issue can't turn into an endless loop.
const SSO_LOGOUT_RETRIED_KEY = 'centralSsoLogoutRetried';
const CENTRAL_MANAGE_PENDING_KEY = 'centralManagePending';

// Builds the Alphalake central-auth client-side plumbing: platform login/logout
// redirects, the marketing→app token handoff, and "My account" profile refresh.
// App-specific nav (dashboard tab paths, chrome routing) is NOT part of this —
// keep that in the host app, parameterised by isCentralAuth from here.
export function createAppHost(config: AppHostConfig) {
  const isCentralAuth = config.mode === 'central';
  const apiBase = config.apiBase ?? '/api';

  const isMarketingHost = (): boolean => {
    if (typeof window === 'undefined') return false;
    return config.marketingHosts.includes(window.location.hostname);
  };

  // The base is the origin plus any deployment path prefix (e.g. a load
  // balancer that serves this app under /some-prefix and strips it before
  // proxying). Omitting it would send the platform to <origin>/api/auth/callback,
  // which never reaches this app's backend.
  const prefixFromApiBase = (): string => apiBase.replace(/\/api\/?$/, '');

  const centralLoginLink = (): string => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const continueUrl = `${origin}${prefixFromApiBase()}`;
    return `${config.centralLoginUrl}?continue=${encodeURIComponent(continueUrl)}`;
  };

  const redirectToCentralLogin = (): void => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(SSO_ATTEMPTED_KEY, '1');
    window.location.href = centralLoginLink();
  };

  // Ends the central session too. Clearing the local JWT alone isn't a logout —
  // the platform's session cookie is still valid, so a login redirect would
  // bounce the user straight back in. This hits the platform logout, which
  // clears that cookie and returns to `continue`.
  const redirectToCentralLogout = (): void => {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(AUTH_BLOCKED_KEY);
    sessionStorage.removeItem(SSO_ATTEMPTED_KEY);
    sessionStorage.removeItem(SSO_LOGOUT_RETRIED_KEY);
    const continueUrl = `${window.location.origin}${prefixFromApiBase()}`;
    window.location.href = `${config.centralLogoutUrl}?continue=${encodeURIComponent(continueUrl)}`;
  };

  const centralManageLink = (): string => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const continueUrl = `${origin}${prefixFromApiBase()}`;
    return `${config.centralManageUrl}?continue=${encodeURIComponent(continueUrl)}`;
  };

  // Call from the "My account" link's onClick (opened in a new tab) so we know
  // to pull fresh profile fields when the user comes back — see consumeCentralManageReturn/registerCentralManageRefreshListener.
  const markCentralManagePending = (): void => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(CENTRAL_MANAGE_PENDING_KEY, '1');
  };

  const pullCentralManageProfile = async (): Promise<void> => {
    if (typeof window === 'undefined') return;
    if (!sessionStorage.getItem(CENTRAL_MANAGE_PENDING_KEY)) return;
    sessionStorage.removeItem(CENTRAL_MANAGE_PENDING_KEY);
    if (!config.isAuthenticated()) return;
    try {
      await config.refreshProfile();
      window.dispatchEvent(new Event('profile_updated'));
    } catch {
      // Best-effort — worst case the profile stays stale until the next login.
    }
  };

  // Call once at boot, awaited before the app renders (covers a genuine fresh
  // page load where the pending flag survived a manual refresh).
  const consumeCentralManageReturn = (): Promise<void> => pullCentralManageProfile();

  // Call once at boot to keep listening after render. Since "My account" opens
  // in a new tab, this tab is never unloaded — the signal that the user is
  // "back" is this tab regaining focus, not a navigation event, so
  // `visibilitychange` is the primary trigger; `pageshow` is a fallback.
  const registerCentralManageRefreshListener = (): void => {
    if (typeof window === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void pullCentralManageProfile();
    });
    window.addEventListener('pageshow', () => { void pullCentralManageProfile(); });
  };

  // Full-page navigation out of the app for logged-out users.
  const redirectToLoggedOutHome = (): void => {
    if (typeof window === 'undefined') return;
    if (isCentralAuth) {
      redirectToCentralLogin();
      return;
    }
    window.location.href = config.loggedOutHome;
  };

  // Send the user into the app. On a marketing host, that means a full
  // navigation to appHost with the JWT carried in the URL hash so the new
  // origin's localStorage can pick it up (localStorage is partitioned per
  // origin). Anywhere else, fall back to SPA routing via `navigate`.
  const goToApp = (path: string, navigate: (p: string) => void): void => {
    if (!isMarketingHost()) {
      navigate(path);
      return;
    }
    const token = config.getToken();
    const normalised = path.startsWith('/') ? path : `/${path}`;
    const target = token
      ? `https://${config.appHost}/#${normalised}?_t=${encodeURIComponent(token)}`
      : `https://${config.appHost}/#${normalised}`;
    window.location.href = target;
  };

  // Consume a `_t=<token>` parameter from the URL hash and stash it via
  // setToken(). Run on app boot so a redirect from a marketing host lands the
  // user already authenticated. Cleans the token out of the URL so it doesn't
  // sit in browser history.
  const consumeTokenFromHash = (): void => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    const queryIdx = hash.indexOf('?');
    if (queryIdx === -1) return;

    const params = new URLSearchParams(hash.slice(queryIdx + 1));
    const token = params.get('_t');
    if (!token) return;

    config.setToken(token);
    // A successful sign-in clears any earlier login rejection for this tab.
    sessionStorage.removeItem(AUTH_BLOCKED_KEY);
    sessionStorage.removeItem(SSO_ATTEMPTED_KEY);
    sessionStorage.removeItem(SSO_LOGOUT_RETRIED_KEY);
    params.delete('_t');
    const cleanedQuery = params.toString();
    const cleanedHash = hash.slice(0, queryIdx) + (cleanedQuery ? `?${cleanedQuery}` : '');
    window.history.replaceState(null, '', window.location.pathname + window.location.search + cleanedHash);
  };

  return {
    isCentralAuth,
    AUTH_BLOCKED_KEY,
    SSO_ATTEMPTED_KEY,
    SSO_LOGOUT_RETRIED_KEY,
    centralLoginLink,
    redirectToCentralLogin,
    redirectToCentralLogout,
    centralManageLink,
    markCentralManagePending,
    consumeCentralManageReturn,
    registerCentralManageRefreshListener,
    redirectToLoggedOutHome,
    goToApp,
    consumeTokenFromHash,
  };
}

export type AppHost = ReturnType<typeof createAppHost>;
