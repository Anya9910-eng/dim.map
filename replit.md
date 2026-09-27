# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Login is a one-time 6-digit code emailed to the address (`POST /api/auth/request-code` then `/api/auth/verify-code`). The role comes from the address: `OPERATOR_EMAILS` or a `client_users` row. Slack is no longer part of sign-in — only the approval cards. Without `RESEND_API_KEY` the code is written to the server log instead of emailed, which is the intended fallback.
- VPS/Docker deployment: see `DEPLOY.md` (single Node container serves API + built frontends via `STATIC_APP_DIR`/`STATIC_LANDING_DIR`, plus Postgres and Caddy in `deploy/docker-compose.yml`)
- Required env: `LEMLIST_WEBHOOK_SECRET` — shared secret verified via `X-Webhook-Secret` header on incoming Lemlist webhooks. Missing or mismatched header returns 401; unset secret returns 503 (endpoint disabled). Set in both Replit Secrets and the n8n HTTP Request node header `X-Webhook-Secret`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
