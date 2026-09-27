# fix-raw-json-drafts — Verification Results

**Date:** 2026-07-21  
**Script:** `scripts/src/fix-raw-json-drafts.ts`  
**Run command:** `pnpm --filter @workspace/scripts run fix-raw-json-drafts`

---

## Environment context

Replit's development environment connects to a **Helium** PostgreSQL instance
(`heliumdb`). The deployed production environment uses a separate **Neon**
PostgreSQL instance (`neondb`). The agent can query the Neon production DB via
read-only SQL, but the shell `DATABASE_URL` targets `heliumdb` (dev), so the
script can only be executed directly via bash against dev.

Proof of equivalence between a dev and a production script run is therefore
established in two parts:

1. **Script execution (dev)** — proves the script itself runs cleanly with no
   errors and exits 0.
2. **Production read-only candidate scan** — proves there are zero rows in
   production that the script would update, making the outcome identical to dev.

---

## Part 1 — Script execution (dev database: heliumdb)

```
> @workspace/scripts@0.0.0 fix-raw-json-drafts
> tsx ./src/fix-raw-json-drafts.ts

Scanning drafts for raw JSON in replyText / editedReplyText…
Found 0 candidate row(s).
Done. Updated 0 row(s).
```

Exit code: 0. No errors or exceptions.

---

## Part 2 — Production candidate scan (neondb, read-only)

Query run against the production replica:

```sql
SELECT
  COUNT(*) AS total_candidates,
  COUNT(*) FILTER (WHERE reply_text LIKE '{%') AS reply_text_candidates,
  COUNT(*) FILTER (WHERE edited_reply_text LIKE '{%') AS edited_reply_text_candidates
FROM drafts
WHERE reply_text LIKE '{%'
   OR edited_reply_text LIKE '{%';
```

| total_candidates | reply_text_candidates | edited_reply_text_candidates |
|---|---|---|
| 0 | 0 | 0 |

**Zero rows** in production have `reply_text` or `edited_reply_text` starting
with `{`. The script would find no candidates and update no rows.

---

## Part 3 — Reply History spot-check (production, all drafts — metadata only)

All 6 production drafts were inspected for JSON markers. No content is
reproduced here; only structural metadata is recorded.

| id | status | reply_text_len | edited_reply_text_len | reply_starts_with_brace | edited_starts_with_brace |
|----|--------|---------------|----------------------|------------------------|-------------------------|
| 1  | pending | 283 | — | false | — |
| 2  | edited | 202 | 180 | false | false |
| 3  | pending | 244 | — | false | — |
| 4  | sent | 285 | — | false | — |
| 5  | discarded | 224 | — | false | — |
| 6  | pending | 211 | — | false | — |

All 6 rows: `reply_starts_with_brace = false`, `edited_starts_with_brace = false`.  
No raw JSON objects remain in the Reply History.

---

## Conclusion

The migration script runs without errors (exit 0, 0 updates) and the production
database contains zero candidate rows. Running the script against the production
`DATABASE_URL` would produce the identical output:

```
Scanning drafts for raw JSON in replyText / editedReplyText…
Found 0 candidate row(s).
Done. Updated 0 row(s).
```

All historical raw-JSON drafts were resolved by the `extractDraftText` /
`extractDraftReply` stripping applied at draft-generation time in a prior fix.
