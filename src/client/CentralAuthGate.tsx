import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AppHost } from './appHost';

export interface CentralAuthGateProps {
  appHost: AppHost;
  isAuthenticated: () => boolean;
  /** Routes that must stay reachable while logged out (e.g. magic-link flows). */
  publicPaths?: RegExp[];
}

// In central-auth mode this app is a module, not a marketing site — a logged-out
// visitor to any page lands at the platform login rather than a homepage.
// Mount once near the root, alongside the router.
export const CentralAuthGate: React.FC<CentralAuthGateProps> = ({ appHost, isAuthenticated, publicPaths = [] }) => {
  const location = useLocation();
  useEffect(() => {
    if (!appHost.isCentralAuth || isAuthenticated()) return;
    if (sessionStorage.getItem(appHost.AUTH_BLOCKED_KEY)) return;
    if (new URLSearchParams(location.search).get('auth_error')) return;
    if (publicPaths.some(re => re.test(location.pathname))) return;
    // Already sent this tab to the platform once and landed back here still
    // unauthenticated — the platform declined the SSO handoff silently (no
    // auth_error, the callback route was never hit). This happens when the
    // platform holds a session cookie scoped to a different module and won't
    // hand it to this one. Straight back to login would just replay the same
    // silent bounce, so force a real platform logout first — that clears the
    // stale cookie server-side and the next login attempt has to be a real one.
    if (sessionStorage.getItem(appHost.SSO_ATTEMPTED_KEY)) {
      if (sessionStorage.getItem(appHost.SSO_LOGOUT_RETRIED_KEY)) return;
      sessionStorage.setItem(appHost.SSO_LOGOUT_RETRIED_KEY, '1');
      appHost.redirectToCentralLogout();
      return;
    }
    appHost.redirectToCentralLogin();
  }, [location.pathname, location.search]);
  return null;
};

export interface AuthErrorToastProps {
  appHost: AppHost;
  showToast: (message: string, kind?: 'error' | 'success') => void;
  /** Overrides/extends the default auth_error → message mapping. */
  messages?: Record<string, string>;
}

const DEFAULT_AUTH_ERROR_MESSAGES: Record<string, string> = {
  not_provisioned: "Your account isn't set up for this workspace yet. Please contact your administrator.",
  invalid_token: 'Sign-in failed. Please try signing in again.',
  missing_token: 'Sign-in failed. Please try signing in again.',
  invalid_link: 'This link is invalid or has expired.',
};

// Surfaces central-auth failures the callback route signals via ?auth_error=<code>,
// then strips the param so a refresh doesn't re-toast. Mount once near the root.
export const AuthErrorToast: React.FC<AuthErrorToastProps> = ({ appHost, showToast, messages }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const resolvedMessages = { ...DEFAULT_AUTH_ERROR_MESSAGES, ...messages };
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('auth_error');
    if (!code) return;
    // Remember the failure for this tab so CentralAuthGate stops bouncing the
    // user back to login — a rejected account would otherwise loop forever.
    sessionStorage.setItem(appHost.AUTH_BLOCKED_KEY, code);
    showToast(resolvedMessages[code] || 'Sign-in failed. Please try again.', 'error');
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.pathname]);
  return null;
};
