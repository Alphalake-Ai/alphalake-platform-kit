# Backend layout convention for platform-kit consumers

Every backend that consumes `@alphalake/platform-kit/server` should follow the
layout of
[`Alphalake-Ai/alphalake-platform-backend`](https://github.com/Alphalake-Ai/alphalake-platform-backend).
The kit centralises auth plumbing (`createCentralAuth`, webhook verification,
`postModuleEvent`, review links) — it does **not** own your routers,
middleware, or business structure. That's what this convention covers.

## Canonical tree

```
.
├── .env.example
├── ecosystem.config.js          # pm2
├── prisma/
│   ├── migrations/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── app.ts                   # express app (exported, no listen)
│   ├── index.ts                 # bootstrap entry: app.listen
│   ├── config/
│   │   ├── env.ts               # zod-validated process.env via dotenv
│   │   ├── constants.ts
│   │   ├── prisma.ts            # Prisma client singleton
│   │   ├── redis.ts
│   │   └── firebase.ts
│   ├── lib/                     # cross-cutting helpers
│   │   ├── api-error.ts         # ApiError class (unauthorized(), etc.)
│   │   ├── api-response.ts
│   │   ├── logger.ts
│   │   ├── token.ts             # access/refresh token sign+verify
│   │   ├── password.ts
│   │   └── utils.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts   # authenticate + role/org guards
│   │   ├── error.middleware.ts  # global errorHandler
│   │   ├── request-logger.middleware.ts
│   │   └── validator.middleware.ts  # validate / validateQuery (zod)
│   ├── modules/
│   │   ├── index.ts             # single Router mounting all domains under /api
│   │   └── <domain>/            # one folder per domain, exactly four files:
│   │       ├── <domain>.router.ts
│   │       ├── <domain>.controller.ts
│   │       ├── <domain>.schema.ts   # zod request schemas
│   │       └── <domain>.service.ts
│   ├── services/                # infra services (cache, email, pubsub, storage)
│   ├── queues/                  # background job producers (BullMQ-style)
│   ├── workers/                 # worker processes + index.ts entrypoint
│   ├── types/
│   │   ├── auth.types.ts
│   │   └── express.d.ts         # augment Request with req.user
│   └── mail-templates/          # handlebars templates + layout
└── temp/                        # one-off scripts, not shipped
```

## Key rules

**`src/app.ts`** builds the express app and default-exports it: cors, json +
urlencoded body parsing, request logger, a `GET /health` endpoint, `app.use('/api', apiRouter)`,
a 404 handler, then the global error handler. `src/index.ts` only imports and
listens — keeping them separate makes the app testable without a port.

**Env validation** lives in `src/config/env.ts`: a zod schema over
`dotenv.config()`, exported as a typed `env` singleton. Required variables fail
fast at boot, not at first use.

**One module per domain** under `src/modules/<domain>/`, always the same four
files: `router` (wiring + guards), `controller` (request/response handling,
thin), `schema` (zod request bodies/params/queries), `service` (business
logic). The router applies middleware per route:

```ts
router.get('/', requireOrgAdmin, validateQuery(listUsersSchema), UserController.list);
router.post('/', requireOrgAdmin, validate(createUserSchema), UserController.create);
```

**`src/modules/index.ts`** is the single place routers are mounted. Route
ordering matters: anything that must be reachable without a session token
(`/auth`, `/health-adjacent`) or that uses its own auth scheme
(`/internal` behind `requireInternalAccess`) is mounted **before** the global
`router.use(authenticate)`; everything after is authenticated by default.

**Auth flow**: `authenticate` verifies the Bearer JWT with the token lib,
attaches the decoded payload to `req.user`, and rejects with
`ApiError.unauthorized` otherwise. Role and resource guards
(`requireOrgAdmin`, `requireOrgUserAccess({ type: 'params', key: 'id' })`,
`requireInternalAccess`) are separate, composable middlewares. When the backend
is a platform-kit module, `createCentralAuth` from the kit handles inbound
platform webhooks and user provisioning on top of this; your own session/token
middleware stays per-project.

**Background work** is split into `src/queues/` (producers) and
`src/workers/` (consumers) with a dedicated worker entrypoint — the API and
worker processes deploy separately (`start` / `start:workers`).

## Scripts

```json
{
  "dev": "ts-node-dev --respawn --transpile-only --exit-child src/index.ts",
  "dev:workers": "ts-node-dev --respawn --transpile-only --exit-child src/workers/index.ts",
  "build": "tsc",
  "start": "node dist/index.js",
  "start:workers": "node dist/workers/index.js",
  "db:generate": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:seed": "prisma db seed"
}
```

## What the kit contributes vs. what you write

| Concern | Owner |
|---|---|
| Central-auth webhooks, user provisioning, `postModuleEvent`, review links | `@alphalake/platform-kit/server` |
| Frontend auth gate, dashboard chrome, theme | `@alphalake/platform-kit/client` / `ui` |
| Domain routers/controllers/schemas/services | You — following this layout |
| Role vocabulary (`roles` array) and `onUserAccessChanged` hook | You — app-specific |
| Env schema, token lib, guards, queues/workers, Prisma schema | You — following this layout |
