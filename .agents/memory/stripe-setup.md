---
name: Stripe billing setup
description: Stripe integration status, plan IDs, and migration quirk for DraftFly
---

## Status
Stripe fully initialized: schema ✅, webhook ✅, backfill ✅

## Plans (test mode)
| Plan    | Product ID           | Monthly Price ID                   | Yearly Price ID                    |
|---------|----------------------|------------------------------------|------------------------------------|
| Starter | prod_UvAguqsYPgvaAg  | price_1TvKLAEH1jscdt9S8TJ7c4jp     | price_1TvKLAEH1jscdt9S6lRYcV57     |
| Growth  | prod_UvAgt70pFVMmpx  | price_1TvKLBEH1jscdt9SZwtwKFlj     | price_1TvKLBEH1jscdt9SelFj59un     |
| Agency  | prod_UvAgDhvYXTyiUH  | price_1TvKLBEH1jscdt9SPyFug2li     | price_1TvKLBEH1jscdt9SCEgrbWQ5     |

## Migration quirk
`runMigrations()` from stripe-replit-sync logs "Stripe schema ready" but silently creates empty schema on first run inside the API server process. Fix: run migrations once from a standalone Node process (no bundler) before the first server start, or after installing the package fresh. The stripe schema had to be seeded manually via:
```
node --input-type=module -e "import { runMigrations } from 'stripe-replit-sync'; await runMigrations({ databaseUrl: process.env.DATABASE_URL });"
```

**Why:** `connectAndMigrate` inside the bundled esbuild output can't resolve `__dirname2` to the correct migrations path at runtime. Standalone `node` uses the real package path from node_modules.

**How to apply:** If re-deploying or resetting the DB, run the above command once before starting the API server.
