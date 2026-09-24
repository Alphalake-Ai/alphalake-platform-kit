# AGENTS.md — guidance for AI coding agents using @alphalake/platform-kit

You are working on (or building) an Alphalake platform module. This kit is the
shared plumbing that makes every Alphalake app authenticate the same way, look
the same, and be structured the same. Read this before writing code. Detailed
reference: `README.md` (APIs, env vars, code samples), `docs/backend-layout.md`
(required backend structure).

## The three subpaths

| Subpath | What it gives you | Runtime |
|---|---|---|
| `@alphalake/platform-kit/server` | `createCentralAuth`, `createReviewLink`, `requireRole`, `postModuleEvent`, webhook signature helpers | Node/Express, **CommonJS, unbuilt** — require it directly, no build step |
| `@alphalake/platform-kit/client` | `CentralAuthGate`, `AuthErrorToast`, `appHost` (login/logout redirect + token consumption) | Prebuilt ESM, React 18 + react-router-dom v6 |
| `@alphalake/platform-kit/ui` (+ `.../ui/theme.css`) | Brand token layer, `cn()`, `Button`, `AppTopBar`/`AppSidebar`/`SidebarProvider` dashboard chrome | Prebuilt ESM, Tailwind v4 + shadcn conventions |

No `peerDependencies` on purpose — install the deps your subpaths need in the
consuming app (`firebase-admin`, `jsonwebtoken`, `express`, `pg` for server;
`react`, `react-dom`, `react-router-dom`, `lucide-react`, `clsx`,
`class-variance-authority`, `tailwind-merge`, `radix-ui` for client/ui).
Install the kit pinned to a git tag, never `main`.

## How authentication works (central-auth mode)

Every Alphalake module is **not** a standalone login app. Identity lives in the
platform (Firebase-backed, managed at `myaccount.alphalake.ai`); your app mints
its own session JWTs after the platform vouches for the user.

**Login flow, end to end:**
1. Unauthenticated visitor hits any page → `CentralAuthGate` (client) redirects
   to the platform login (`appHost.redirectToCentralLogin()`).
2. Platform authenticates via Firebase and redirects to your backend callback:
   `app.get('/api/auth/callback', centralAuth.handlers.callback)` with a
   Firebase ID token as `?token=...`.
3. `handlers.callback` verifies the ID token, upserts the user's profile from
   Firebase, checks they are provisioned (`users` row with an `org_id` — that
   happens via the `user.added` webhook, not at login), and mints a session
   JWT containing `{ id, email, role, org_id, tv }` (7-day expiry).
4. The JWT is handed to the SPA through the URL hash
   (`${publicAppUrl}/#/<landing>?_t=<jwt>`); `appHost.consumeTokenFromHash()`
   on the client picks it up and stores it for `Authorization: Bearer` calls.

**Session validation is not just JWT verification.** `centralAuth.authenticate`
also compares the token's `tv` (token_version) against the `users` row on every
request. Role changes and removals bump `token_version`, so demoted/removed
users are cut off immediately even mid-token. Use this as `authenticate` for
all routes; add `requireRole('admin', ...)` for role gates.

**Provisioning is webhook-driven, not login-driven.** The platform POSTs
lifecycle events to `app.post('/api/internal/platform-events',
centralAuth.handlers.platformEvents)`, HMAC-signed (`x-payload-signature`,
verified against `PAYLOAD_SIGNATURE_KEY`) and replay-guarded via
`processed_webhook_events` (call `centralAuth.ensureSchema()` once at startup).
Actions: `org.added/updated/removed`, `user.added/updated/removed`,
`subscription.*` (acknowledged, enforcement is yours). Handlers are idempotent.
`user.removed` soft-detaches (`org_id = NULL`) rather than deleting. Role
mapping: you pass a `roles` array (most- to least-privileged); unknown inbound
platform roles fall back to the least-privileged one — never invent roles not
in your array. Fire app-specific side effects via the `onUserAccessChanged`
hook, never by editing kit behaviour.

**Outbound events** back to the platform use
`postModuleEvent({ org, action, payload, ... })` (e.g. `user.added` when your
app adds a member) — signed with the same `PAYLOAD_SIGNATURE_KEY`.

**Passwordless review links** (share a record with a non-user) come from
`createReviewLink` — see README. Mount `/api/auth/set-review-password` routes
on **public paths** in the client (`publicPaths`).

**Frontend wiring:** set `VITE_AUTH_MODE=central`; mount `CentralAuthGate` and
`AuthErrorToast` once near the router root; gate passes `publicPaths` regexes
for anything reachable while logged out. `?auth_error=<code>` on the URL
signals login failure — the toast shows a human message and the gate stops
redirect-looping. Do not hand-roll redirects to the platform; go through
`appHost`.

**Local/dev mode:** `VITE_AUTH_MODE=local` bypasses all of the above for
development. Keep both modes working.

## How the theme looks (do not re-derive it)

The brand identity lives in `@alphalake/platform-kit/ui/theme.css` — the one
place Alphalake colors and type are defined:

- **Chrome:** dark teal top bar + sidebar (`--topbar`, `--sidebar` tokens),
  bright teal accent as `--primary`/`--ring`. Canonical across all Alphalake
  apps.
- **Typography:** Inter (`--font-sans`, weights 300–800). The font files load
  via a `<link>` to Google Fonts in the app's `index.html` with the exact
  weight set `Inter:wght@300;400;500;600;700;800` — a CSS `@import` is
  silently stripped by Tailwind v4's bundler, so it must be the HTML link.
- **Usage rules:** import `theme.css` AFTER `@import "tailwindcss"` (and any
  shadcn/`tw-animate-css` base). Never hardcode brand hex values in
  components — use the tokens (`bg-primary`, `text-muted-foreground`,
  `bg-sidebar`, etc.). The neutral tokens (background/card/border/muted…) are
  placeholders you may override per app; the brand tokens (primary, ring,
  sidebar, topbar, font) are canonical — don't override them.
- **Chrome components:** build dashboards on `AppTopBar` + `AppSidebar` +
  `SidebarProvider` from `.../ui` rather than rolling your own shell — pass
  your nav `sections`, get the Alphalake look, mobile drawer, and collapse
  behaviour for free. Use `Content sidebarAware` so main content offsets the
  sidebar.

## How the backend should be laid out

Follow `docs/backend-layout.md` (modelled on
`Alphalake-Ai/alphalake-platform-backend`). Non-negotiables:

- `src/app.ts` (express app: cors, body parsing, request logger, `/health`,
  mount api router at `/api`, 404, global error handler) + separate
  `src/index.ts` (listen only).
- One folder per domain under `src/modules/<domain>/` with exactly four files:
  `router.ts`, `controller.ts`, `schema.ts` (zod), `service.ts`. Mount
  everything in `src/modules/index.ts`; public/internal routes BEFORE the
  global `authenticate`.
- zod-validated `env.ts` singleton in `src/config/` — fail fast at boot.
- Errors as `ApiError` (src/lib), handled by one global error middleware.
- Prisma (or the kit's raw `pg` pool if the app is simple) in `src/config/`,
  `db:*` npm scripts, `.env.example` kept in sync.

## Env vars you must wire

See the "Required environment variables" table in README.md. The fatal ones:
`JWT_SECRET`, `PAYLOAD_SIGNATURE_KEY` (refuses to start without it — that is
deliberate: an empty key means forgeable webhooks), `INTERNAL_API_KEY`,
`PLATFORM_BACKEND_URL`, Firebase credentials (prefer
`FIREBASE_SERVICE_ACCOUNT_FILE` — systemd corrupts `\n` escapes in literal
keys).

## When asked to build a new module app

1. Scaffold the backend per `docs/backend-layout.md`.
2. Wire `createCentralAuth` exactly as the README's server section shows
   (`ensureSchema()` at startup; callback / refresh-profile / platform-events
   routes; `authenticate` on everything else).
3. Scaffold the frontend with the kit's client + ui subpaths: `CentralAuthGate`,
   `AuthErrorToast`, `AppTopBar`/`AppSidebar`, `theme.css`, Inter `<link>`.
4. Choose your own `roles` array and `onUserAccessChanged` implementation —
   these are app-specific by design.
5. Typecheck (`npm run typecheck` in this repo) and keep both
   `VITE_AUTH_MODE=local` and `central` working.
