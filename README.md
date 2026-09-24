# @alphalake/platform-kit

Shared Alphalake central-auth backend/frontend plumbing and UI theme tokens,
for reuse across Alphalake
platform modules. Install as a git dependency (no registry needed for
internal use):

```bash
npm install "git+https://github.com/Alphalake-Ai/alphalake-platform-kit.git#v0.1.3"
```

Pin to a tag (`#v0.1.3`), not `main`, for reproducible builds.

> **License:** proprietary — see [`LICENSE`](LICENSE). Use is restricted to
> Alphalake and its projects; the repo is public so deployments can install
> it without git credentials.

> **AI coding agents:** read [`AGENTS.md`](AGENTS.md) first — it explains the
> central-auth architecture, the brand theme rules, and the required backend
> layout in one place.

## Runtime dependencies

The kit declares **no `peerDependencies`** on purpose — its server and client
subpaths need disjoint sets of deps, and npm's peer resolution chokes on that.
Install what the subpaths you use need in your own app:

- **`/server`** — `firebase-admin`, `jsonwebtoken` (imported by the kit); your app
  also supplies its own `express` app and `pg` pool to `createCentralAuth`.
- **`/client`** / **`/ui`** — `react`, `react-dom`, `react-router-dom`, `lucide-react`,
  `clsx`, `class-variance-authority`, `tailwind-merge`, `radix-ui`.

The kit's own build (`prepare` → `tsup`) uses its `devDependencies`, which npm
installs automatically while building a git dependency.

Three subpath exports, used independently:

- **`@alphalake/platform-kit/server`** — Node/Express, CommonJS, ships unbuilt (no build step, same as this repo's own backend convention).
- **`@alphalake/platform-kit/client`** — React/Vite frontend plumbing, prebuilt ESM + types.
- **`@alphalake/platform-kit/ui`** + **`@alphalake/platform-kit/ui/theme.css`** — the shadcn/Tailwind v4 token layer (now carrying the actual Alphalake brand colors, not a neutral placeholder), `cn()`/avatar helpers, a Button primitive, and the shared dashboard chrome (`AppTopBar`, `AppSidebar`, `SidebarProvider`).

## What's genuinely reusable vs. what isn't

This kit only contains the generic platform plumbing, not business
logic. Two things are still yours to write per app:

- **Role names.** Pass your own `roles` array (most- to least-privileged,
  e.g. `['admin', 'editor', 'viewer']`) into `createCentralAuth`. Whatever
  you pass becomes the vocabulary this kit validates inbound platform roles
  against.
- **App-specific access hooks.** Any derived-access logic in your app (e.g.
  resyncing a derived permissions table whenever a user is
  provisioned/updated/removed) is NOT part of this kit —
  it's exactly the kind of business logic that doesn't belong in a shared
  package. Wire your own equivalent (or a no-op) into the `onUserAccessChanged`
  hook.
- **Nav content.** `AppTopBar`/`AppSidebar` (below) own the *look* of the
  dashboard chrome — dark teal header/sidebar, collapse behavior, the
  Alphalake wordmark — but not its *content*. Your app's title text, sidebar
  sections/items, active-route logic, and dropdown menu items are all passed
  in as props; this kit has no opinion on your routing.

## `@alphalake/platform-kit/server`

> **New backends:** follow our shared backend layout convention —
> [`docs/backend-layout.md`](docs/backend-layout.md) — modelled on
> [`Alphalake-Ai/alphalake-platform-backend`](https://github.com/Alphalake-Ai/alphalake-platform-backend).
> The kit owns auth plumbing; your repo owns routers, middleware, and modules.

```js
const { createCentralAuth, createReviewLink, requireRole, postModuleEvent } = require('@alphalake/platform-kit/server');

const centralAuth = createCentralAuth({
  pool,                                    // pg Pool — see required schema below
  jwtSecret: process.env.JWT_SECRET,
  payloadSignatureKey: process.env.PAYLOAD_SIGNATURE_KEY,
  roles: ['owner', 'manager', 'staff'],    // yours, most- to least-privileged
  publicAppUrl: PUBLIC_APP_URL,
  landingPath: (user) => user.role === 'staff' ? 'my-tasks' : 'overview',
  onUserAccessChanged: async (localOrgId) => {
    await syncYourAppsDerivedAccessTable(localOrgId); // your own hook, or omit for a no-op
  },
  fileLog,                                 // optional (category, entry) => void
});

await centralAuth.ensureSchema();          // once at startup — creates processed_webhook_events

app.get('/api/auth/callback', centralAuth.handlers.callback);
app.post('/api/auth/refresh-profile', centralAuth.authenticate, centralAuth.handlers.refreshProfile);
app.post('/api/internal/platform-events', centralAuth.handlers.platformEvents);

// Elsewhere:
app.get('/api/whatever', centralAuth.authenticate, requireRole('owner', 'manager'), handler);
```

Optional passwordless "review this" magic-link flow (only if your app needs
it — it lets a non-user open a shared record after setting a password,
without visiting the Alphalake account portal first):

```js
const reviewLink = createReviewLink({
  pool, jwtSecret: process.env.JWT_SECRET, publicAppUrl: PUBLIC_APP_URL,
  alphalakeInternalApiUrl: process.env.ALPHALAKE_INTERNAL_API_URL,
  alphalakeInternalApiKey: process.env.ALPHALAKE_INTERNAL_API_KEY,
  resourcePath: (resourceId) => `/review/${resourceId}`,
});

app.get('/api/check', reviewLink.handlers.check);
app.get('/api/auth/review-link/:token', reviewLink.handlers.validate);
app.post('/api/auth/set-review-password', reviewLink.handlers.setPassword);

// When emailing a link:
const url = `${PUBLIC_APP_URL}/api/check?token=${encodeURIComponent(
  reviewLink.signReviewLinkToken({ email, resourceId: record.id, tv: user.token_version })
)}`;
```

Outbound member-change notifications back to the platform:

```js
await postModuleEvent({
  org,                                     // { external_id, platform_entity_id }
  action: 'user.added',
  payload: { userId, email, role: toPlatformRole(localRole) },
  platformBackendUrl: process.env.PLATFORM_BACKEND_URL,
  internalApiKey: process.env.INTERNAL_API_KEY,
  payloadSignatureKey: process.env.PAYLOAD_SIGNATURE_KEY,
  fileLog,
});
```

### Required Postgres schema

```sql
-- users: minimum columns the server package touches directly
--   id, email UNIQUE NOT NULL, name, role, org_id, firebase_uid,
--   image_url, phone, token_version INT DEFAULT 0, last_login_at
-- add password_set BOOLEAN DEFAULT false if you use createReviewLink

-- organisations:
--   id, name, description, external_id UNIQUE, platform_entity_id

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  signature TEXT PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

`createCentralAuth().ensureSchema()` creates/prunes `processed_webhook_events`
for you; the `users`/`organisations` columns are assumed to already exist in
your schema (the DDL block above shows the full reference shape).

## `@alphalake/platform-kit/client`

```ts
// appHost.ts
import { createAppHost } from '@alphalake/platform-kit/client';
import { api } from './api'; // your own API client

export const appHost = createAppHost({
  appHost: 'app.yourapp.ai',
  marketingHosts: ['yourapp.ai', 'www.yourapp.ai'],
  loggedOutHome: 'https://yourapp.ai',
  mode: (import.meta.env.VITE_AUTH_MODE ?? 'local') === 'central' ? 'central' : 'local',
  centralLoginUrl: import.meta.env.VITE_CENTRAL_LOGIN_URL ?? 'https://myaccount.alphalake.ai/login',
  centralLogoutUrl: import.meta.env.VITE_CENTRAL_LOGOUT_URL ?? 'https://myaccount.alphalake.ai/logout',
  centralManageUrl: import.meta.env.VITE_CENTRAL_MANAGE_URL ?? 'https://myaccount.alphalake.ai/manage',
  apiBase: import.meta.env.VITE_API_BASE || '/api',
  isAuthenticated: () => api.isAuthenticated(),
  setToken: (t) => api.setToken(t),
  getToken: () => localStorage.getItem('authToken'),
  refreshProfile: () => api.refreshProfile(),
});
export const isCentralAuth = appHost.isCentralAuth;
```

```tsx
// App.tsx
import { CentralAuthGate, AuthErrorToast } from '@alphalake/platform-kit/client';
import { appHost } from './appHost';
import { api } from './services/api';
import { useToast } from './contexts/ToastContext';

const PUBLIC_PATHS = [/^\/review(\/|$)/, /^\/set-password/];

function AppContent() {
  const { showToast } = useToast();
  return (
    <>
      <AuthErrorToast appHost={appHost} showToast={showToast} />
      <CentralAuthGate appHost={appHost} isAuthenticated={api.isAuthenticated} publicPaths={PUBLIC_PATHS} />
      {/* ...your routes... */}
    </>
  );
}
```

`SetPasswordPage` pairs with the server's `createReviewLink` — see its JSDoc
in `src/client/SetPasswordPage.tsx` for the full prop list (`validateLink`,
`setPassword`, `onDone`, `onGoHome`, `showToast`, `copy`).

Consuming apps keep their own dashboard-tab-path/label helpers and
`isAppPath()`-style chrome routing — those are app nav concepts, not auth
concepts, and were intentionally left out of this kit.

## `@alphalake/platform-kit/ui`

```ts
// index.css (after your own tailwindcss/shadcn base imports)
@import "@alphalake/platform-kit/ui/theme.css";
```

```tsx
import { Button, cn, getAvatarColor, getInitials } from '@alphalake/platform-kit/ui';
```

`--primary`/`--ring`/`--sidebar-*` are the real Alphalake brand (dark teal +
bright teal accent) — don't override these unless you have a specific reason
to diverge from the shared look. The same goes for the typography: `theme.css`
sets `--font-sans: 'Inter'` and the base font size (`html { font-size: 16px }`)
so the whole rem-based scale derives from one place. The Inter **font files**
are loaded by the consuming app's own `<link>` in `index.html`, from Google
Fonts with the exact weights the Alphalake brand uses — add this to `<head>`:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
```

This is deliberate: the `@fontsource` builds of Inter render slightly
lighter/thinner than the Google Fonts build at small sizes, and a CSS
`@import url(...)` of the Google Fonts stylesheet is silently stripped by
Tailwind v4's bundler — so the HTML `<link>` is the only path that renders
pixel-identically. The
remaining neutral tokens (background/card/border/etc.) are still generic
placeholders — override those freely to taste.

### Dashboard chrome — `AppTopBar` / `AppSidebar` / `SidebarProvider`

The collapsible sidebar + top bar, carrying the shared Alphalake look. Content
(title text, nav sections, dropdown items, active-route logic) is all yours —
these components render it, they don't decide it.

```tsx
import { SidebarProvider, AppTopBar, AppSidebar, useSidebar } from '@alphalake/platform-kit/ui';
import { LayoutDashboard, Users, Settings, LogOut } from 'lucide-react';

function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <SidebarProvider>
      <AppTopBar
        titleLines={['Enterprise Cloud', 'Ops Workspace']}  // differs per app
        user={{ name: user.name, email: user.email, imageUrl: user.image_url, roleLabel: 'Admin' }}
        menuItems={[
          { key: 'account', label: 'My Account', icon: Settings, href: appHost.centralManageLink(), external: true },
        ]}
        onLogout={() => appHost.redirectToCentralLogout()}
      />
      <AppSidebar
        sections={[{
          title: 'Workspace',
          items: [
            { key: 'overview', label: 'Dashboard', icon: LayoutDashboard, isActive: location.pathname === '/overview', onClick: () => navigate('/overview') },
            { key: 'team', label: 'Team', icon: Users, isActive: location.pathname === '/team', onClick: () => navigate('/team') },
          ],
        }]}
      />
      <Content sidebarAware>{children}</Content>  {/* useSidebar().open to offset margin-left 220px/48px */}
    </SidebarProvider>
  );
}
```

`AppTopBar` always shows the Alphalake wordmark + hamburger toggle; pass
`notifications={{ count, onClick }}` to add the bell, omit it to leave it out
entirely. `AppSidebar` handles its own mobile drawer/backdrop and collapsed-
state tooltips — you only supply `sections`.

## Required environment variables

| Variable | Used by | Notes |
|---|---|---|
| `JWT_SECRET` | server | Session JWT signing |
| `DATABASE_URL` / your `pg.Pool` | server | Passed in as `pool` |
| `PAYLOAD_SIGNATURE_KEY` | server | Inbound/outbound webhook HMAC key — fatal if unset, `createCentralAuth` throws |
| `INTERNAL_API_KEY` | server | `postModuleEvent` outbound auth |
| `PLATFORM_BACKEND_URL` | server | Outbound `postModuleEvent` target |
| `FIREBASE_SERVICE_ACCOUNT_FILE` or `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` | server | Prefer the file path — `EnvironmentFile` parsing under systemd corrupts `\n` escapes in a literal private key |
| `ALPHALAKE_INTERNAL_API_URL` / `ALPHALAKE_INTERNAL_API_KEY` | server (review-link only) | Separate host/auth (plain `x-api-key`) from `PLATFORM_BACKEND_URL` above |
| `VITE_AUTH_MODE` | client | `local` \| `central` |
| `VITE_CENTRAL_LOGIN_URL` / `VITE_CENTRAL_LOGOUT_URL` / `VITE_CENTRAL_MANAGE_URL` | client | Default to `myaccount.alphalake.ai` if unset |
| `VITE_API_BASE` | client | Default `/api` |

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit over src/client + src/ui
npm run build        # tsup -> dist/{client,ui}/index.{mjs,d.mts}
```

`src/server` ships unbuilt as plain CommonJS — no build step, run directly by
Node in the consuming app.
