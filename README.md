# DIM map — AI lead qualification for property developers & brokers

DIM map pulls in leads from cold email campaigns (Lemlist), Meta (Facebook / Instagram) lead ads and WhatsApp Business, qualifies each buyer as **hot, warm, cold or unqualified**, and drafts the reply for one-click approval in the dashboard or Slack.

## Features

- ✅ Lemlist webhook — replies to cold email / LinkedIn campaigns
- ✅ Meta Lead Ads webhook — lead-form submissions (native `leadgen` or forwarded with `field_data`)
- ✅ WhatsApp Business webhook — inbound chats (Cloud API format)
- ✅ AI lead qualification (budget, timeline, financing, purpose, unit) with a one-line reason
- ✅ Channel-aware reply drafting; approved replies go back through Lemlist or WhatsApp
- ✅ Optional Slack approval cards
- ✅ PostgreSQL database, email sign-in codes, Stripe billing

## Requirements

- Node.js 18+
- pnpm
- PostgreSQL 12+

## Setup

```bash
pnpm install
cp .env.example .env
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/api-server run dev
```

## Lead webhooks

Each client has one webhook secret, shown with ready-made URLs on the Settings page.

- `POST /api/webhooks/lemlist/:clientId?secret=…` — Lemlist reply events
- `POST /api/webhooks/meta/:clientId?secret=…` — Meta lead-form leads
- `POST /api/webhooks/whatsapp/:clientId?secret=…` — WhatsApp messages
- `GET  /api/webhooks/{meta,whatsapp}/:clientId?secret=…` — Meta subscription handshake (`hub.verify_token` = the same secret)
- `GET  /api/healthz` — health check

## License

MIT
