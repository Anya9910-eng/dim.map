# DIM Convert — AI lead qualification for property developers & brokers

A product of [DIM](https://dim.capital) — Development Intelligence & Marketing — alongside DIM Map and DIM Invest. Served at **https://convert.dim.capital**.

DIM Convert pulls in leads from cold email campaigns (Lemlist), Meta (Facebook / Instagram), Google Ads and YouTube lead forms, and WhatsApp Business, qualifies each buyer as **hot, warm, cold or unqualified**, and drafts the reply for one-click approval in the dashboard.

## Features

- ✅ Lemlist webhook — replies to cold email / LinkedIn campaigns
- ✅ Meta Lead Ads webhook — lead-form submissions (native `leadgen` or forwarded with `field_data`)
- ✅ Google Ads & YouTube lead form webhooks — Google's lead-form webhook format (test leads are logged, not drafted)
- ✅ WhatsApp Business webhook — inbound chats (Cloud API format)
- ✅ AI lead qualification (budget, timeline, financing, purpose, unit) with a one-line reason
- ✅ Channel-aware reply drafting; approved replies go back through Lemlist or WhatsApp
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

Each client has one webhook secret, shown with ready-made URLs in the "Lead sources" card on the client's page.

- `POST /api/webhooks/lemlist/:clientId?secret=…` — Lemlist reply events
- `POST /api/webhooks/meta/:clientId?secret=…` — Meta lead-form leads
- `POST /api/webhooks/whatsapp/:clientId?secret=…` — WhatsApp messages
- `POST /api/webhooks/google/:clientId?secret=…` — Google Ads lead forms (the secret can also go in the form's "Key" field)
- `POST /api/webhooks/youtube/:clientId?secret=…` — lead forms on YouTube video campaigns
- `GET  /api/webhooks/{meta,whatsapp}/:clientId?secret=…` — Meta subscription handshake (`hub.verify_token` = the same secret)
- `GET  /api/healthz` — health check

## License

MIT
