---
name: Express 5 return pattern
description: In Express 5 res.json() returns void, not Response — return must be on a separate line
---

## Rule
Never use `return res.json(...)` or `return res.status(...).json(...)` in Express 5 route handlers.

## Why
Express 5 changed `res.json()` to return `void` instead of `Response`. TypeScript catches this as TS7030 "not all code paths return a value" when the enclosing async function has implicit return type.

## How to apply
```typescript
// Wrong (Express 4 style, breaks in Express 5 with TS strict):
if (!valid) return res.status(400).json({ error: "bad" });

// Correct (Express 5):
if (!valid) { res.status(400).json({ error: "bad" }); return; }
// or
if (!valid) {
  res.status(400).json({ error: "bad" });
  return;
}
```

## Affected files (fixed)
- `artifacts/api-server/src/app.ts` — Stripe webhook handler
- `artifacts/api-server/src/routes/stripe.ts` — subscription, checkout, portal routes
