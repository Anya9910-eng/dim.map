# DRAFTFLY — Email Automation Platform

Платформа для автоматизации email кампаний с интеграцией Slack и Lemlist.

## Фичи

- ✅ Slack OAuth интеграция
- ✅ Lemlist webhook обработка
- ✅ PostgreSQL база данных
- ✅ Redis очередь
- ✅ PM2 процесс менеджер

## Требования

- Node.js 18+
- PostgreSQL 12+
- Redis 6+

## Установка

```bash
npm install
cp .env.example .env
npm run migrate
npm start
```

## API Endpoints

- `POST /api/webhooks/lemlist` — Lemlist webhook
- `GET /api/health` — Health check

## Лицензия

MIT
