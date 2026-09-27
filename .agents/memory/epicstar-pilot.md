---
name: EPICGRAM AI pilot setup
description: Production pilot configuration for epicstar@epicstarai.com — DB IDs, Lemlist campaign, Slack channel
---

## Client record
- DB client id: **4**, name: "EPICGRAM AI"
- Slack channel: **C0BK6NPBHKJ** (real, working bot token via global SLACK_BOT_TOKEN)

## Campaign
- DB campaign id: **1**, name: "SaaS Founders Outreach Q3"
- Lemlist campaign ID: **cam_JWakSXM9XmNKQbWkp** ("EPIC STAR's campaign (1)")
- Lemlist status: **"ended"** — user must create a new active campaign for live replies

## Webhook URL (production)
```
https://sales-reply-ai.replit.app/api/webhooks/lemlist
Header: X-Webhook-Secret: <LEMLIST_WEBHOOK_SECRET>
Event: emailReplied
```

## What was fixed for pilot
- Dirty drafts 7–10 had raw JSON (`{"draft":"..."}`) stored in reply_text → cleaned via SQL UPDATE
- Campaign was mapped to demo client "Axiom Sales" → reassigned to EPICGRAM AI (id=4)
- extractDraftText didn't handle code blocks → fixed in webhooks.ts and claude.ts

## Why
- Global SLACK_BOT_TOKEN is the real working token; per-client tokens are placeholders (system falls back to global automatically)
- LEMLIST_WEBHOOK_SECRET must match both Replit Secret and the n8n/Lemlist webhook header X-Webhook-Secret
