---
name: Claude code-block stripping
description: Claude sometimes wraps its JSON response in ```json ... ``` markdown code blocks; both parse sites must handle this
---

## Rule
Before parsing Claude's JSON output, strip markdown code blocks (` ```json ... ``` ` or ` ``` ... ``` `).

## Where applied
- `artifacts/api-server/src/lib/claude.ts` — `generateDraftReply`: strips code block before `JSON.parse`
- `artifacts/api-server/src/routes/webhooks.ts` — `extractDraftText`: also strips code blocks as safety net

## Why
Claude 3.5 Sonnet occasionally wraps the JSON in a code block even when instructed to return raw JSON. Without stripping, `JSON.parse` fails, the catch block returns the raw code block as `draft`, and the operator's Slack card and Lemlist send both receive the full ` ```json {...} ``` ` blob instead of clean text.

## How to apply
Any new site that calls Claude and parses JSON output must run:
```typescript
const codeBlockMatch = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/);
const jsonCandidate = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();
const parsed = JSON.parse(jsonCandidate);
```
