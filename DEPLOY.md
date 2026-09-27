# Деплой DraftFly на VPS

Один Docker-стек: Node-контейнер (API + статика дашборда и лендинга) и PostgreSQL. TLS-терминацию делает либо ваш существующий nginx на хосте (см. `deploy/nginx-draftfly.conf`), либо опциональный Caddy-контейнер (`--profile caddy`), если порты 80/443 свободны.

```
Интернет ── nginx или Caddy (:80/:443, TLS) ── app (Node, 127.0.0.1:8080) ── db (Postgres 16)
                                                ├─ /api/*  — Express API
                                                ├─ /app/*  — дашборд (SPA)
                                                └─ /*      — лендинг
```

HTTPS обязателен: cookie сессии ставится с флагом `secure`, и Slack принимает только https redirect URL. Поэтому нужен домен, направленный на VPS (A-запись), — по «голому» IP без TLS логин работать не будет.

## 1. Подготовка VPS

Подойдёт любой VPS с 1–2 GB RAM (Ubuntu 22.04+/Debian 12).

```bash
# Docker + compose-плагин
curl -fsSL https://get.docker.com | sh

git clone https://github.com/Anya9910-eng/draftfly.git /opt/apps/draftfly
cd /opt/apps/draftfly
```

## 2. Конфигурация

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env
```

Обязательно заполнить:

- `DOMAIN` и `APP_BASE_URL` — ваш домен (A-запись должна уже указывать на VPS);
- `POSTGRES_PASSWORD` — любой пароль (БД наружу не открыта);
- `SESSION_SECRET` — `openssl rand -hex 32`;
- `OPERATOR_EMAILS` — адреса операторов через запятую;
- `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN` (только для карточек одобрения);
- `ANTHROPIC_API_KEY`, `LEMLIST_API_KEY`, `LEMLIST_WEBHOOK_SECRET`;
- `RESEND_API_KEY` — необязателен, см. раздел 3.

## 3. Вход по email

Вход в дашборд — по одноразовому коду на email. Slack для входа больше не
используется: адрес вводится на `/app/login`, на него приходит шестизначный код,
он живёт 10 минут и срабатывает один раз.

Роль определяется по адресу: он либо в `OPERATOR_EMAILS`, либо приглашён в
карточке клиента (Dashboard Access). Адрес, которого нет нигде, кода не получает
— при этом ответ сервера тот же самый, чтобы через эту форму нельзя было
проверять, у кого есть аккаунт.

**Отправка почты (`RESEND_API_KEY`, resend.com):** без ключа приложение
работает, но код не уходит письмом — он пишется в лог контейнера:

```bash
docker compose logs app | grep "Sign-in code"
```

Это сделано намеренно и это же аварийный вход: прочитать лог можно только имея
shell на сервере, а это и так полный доступ. Значит, проблема с почтовым
провайдером не запрёт оператора снаружи от собственного дашборда.

Для настоящих писем: ключ Resend в `RESEND_API_KEY`, домен `dim.capital`
подтверждён в Resend (SPF/DKIM записи у регистратора), и `EMAIL_FROM` на этом домене,
например `DIM Convert <noreply@dim.capital>`.

## 3a. Настройка Slack-приложения (только карточки одобрения)

1. **Bot Token Scopes**: как минимум `chat:write`, `channels:read`.
2. **Interactivity & Shortcuts**: Request URL → `https://<ваш-домен>/api/slack/actions`

`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_TEAM_ID` больше не нужны —
они обслуживали вход через Slack, которого нет.

## 3b. Самостоятельная регистрация и оплата (Stripe)

Любой человек может зарегистрироваться на `/app/signup`: создаётся клиент,
его первый пользователь и пробный период на **3 дня без карты**. По истечении
трёх дней аккаунт блокируется (API отвечает 402), пока не выбран план.
Клиенты, заведённые оператором вручную, всего этого не касаются — у них
`billing_mode = managed`, и они никогда не блокируются.

**Обязательно для регистрации:** `RESEND_API_KEY` и `EMAIL_FROM` (раздел 3).
Без них код входа пишется в лог контейнера, а не отправляется письмом — для
оператора это нормально, для незнакомого человека это тупик.

**Чтобы можно было платить**, в `deploy/.env` нужны все четыре:

- `STRIPE_SECRET_KEY` — из Stripe → Developers → API keys;
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH` — id **recurring**-цен
  (`price_...`) двух планов, созданных в Stripe → Product catalog. План
  выдаётся только по этим двум id: цена, заведённая в дашборде мимо них,
  подписку оформит, но план не сменит (в логе будет ошибка);
- `STRIPE_WEBHOOK_SECRET` — Stripe → Developers → Webhooks → Add endpoint:
  URL `https://<ваш-домен>/api/stripe/webhook`, события
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`.

`APP_BASE_URL` должен быть задан — туда Stripe возвращает после оплаты.

Без `STRIPE_SECRET_KEY` приложение работает: регистрация и пробный период
есть, а на попытке оплатить пользователь видит «платежи не включены» и адрес
почты. Что сейчас включено, видно при старте: `Stripe payments enabled` либо
`Stripe not configured`.

Проверить локально: Stripe → Developers → Webhooks → «Send test event» на
`customer.subscription.updated`; в логе появится
`Applied Stripe subscription to client` (или «for no known client», если
подписка не привязана к клиенту — так и должно быть для тестового события).

## 4. Первый запуск

```bash
cd deploy

# Собрать образы
docker compose build

# Создать/обновить схему БД (одноразово и после изменений схемы)
docker compose --profile setup run --rm migrate

# Запустить (app слушает 127.0.0.1:8080, наружу его выводит reverse-proxy)
docker compose up -d

# Логи
docker compose logs -f app
```

### 4a. Если на сервере уже работает nginx (порты 80/443 заняты)

```bash
cp deploy/nginx-draftfly.conf /etc/nginx/sites-available/draftfly.conf
ln -s /etc/nginx/sites-available/draftfly.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
# TLS-сертификат Let's Encrypt (добавит https и редирект сам):
certbot --nginx -d convert.dim.capital -d draftfly.app -d www.draftfly.app
```

### 4b. Если порты 80/443 свободны — Caddy вместо nginx

```bash
docker compose --profile caddy up -d   # авто-HTTPS по DOMAIN из .env
```

Проверка: `https://<домен>/` — лендинг, `https://<домен>/app` — дашборд (вход через Slack), `https://<домен>/api/healthz` — health-check.

## 5. Перенастроить внешние сервисы на новый домен

- **Lemlist / n8n webhook**: `https://<домен>/api/webhooks/lemlist`, заголовок `X-Webhook-Secret: <LEMLIST_WEBHOOK_SECRET>`.
- **Stripe**: webhook регистрируется автоматически при старте по `APP_BASE_URL` (если задан `STRIPE_SECRET_KEY`).

## 6. Обновление приложения

```bash
cd /opt/apps/draftfly
git pull
cd deploy
docker compose build                               # ВСЕ сервисы, не только app
docker compose --profile setup run --rm migrate    # применяет миграции БД
docker compose up -d
```

`docker compose build` (без имени сервиса) важно: `migrate` — отдельный образ,
и `build app` его не пересобирает. Устаревший образ `migrate` один раз молча
применил старую схему и уронил приложение.

### Миграции БД

Схема применяется собственным раннером (`@workspace/db` → `src/migrate.ts`,
через `pg`), а НЕ `drizzle-kit push`: push показывает интерактивные запросы
(«создать или переименовать?»), которым нужен TTY, поэтому в контейнере он
работать не может. Раннер применяет закоммиченные SQL-файлы из
`lib/db/migrations/` по порядку, идемпотентно, отмечая применённые в таблице
`schema_migrations`. Запускать его повторно безопасно.

Существующая продовая БД (построенная старым `push`) при первом запуске
раннера «усыновляется»: `0000_baseline.sql` помечается применённым без
повторного выполнения (таблицы уже есть). Пустая БД получает всё с нуля.

**Изменили схему?** Локально: поправьте Drizzle-схему в `lib/db/src/schema`,
затем `pnpm --filter @workspace/db run generate` — создаст новый
`lib/db/migrations/NNNN_*.sql` (именно здесь, за TTY, решается вопрос
переименований). Закоммитьте SQL и задеплойте. `push`/`push-force` остаются
только для локальной разработки против одноразовой БД.


## Отладка

| Симптом | Причина / решение |
|---|---|
| После входа снова кидает на /login | Проверьте, что заходите по HTTPS-домену из `APP_BASE_URL` (cookie `secure` + `sameSite`), и что `SESSION_SECRET` не менялся |
| Код не приходит на почту | Не задан `RESEND_API_KEY` — код в логе: `docker compose logs app \| grep "Sign-in code"`. Либо домен не подтверждён в Resend |
| «This address does not have access» | Адреса нет ни в `OPERATOR_EMAILS`, ни среди приглашённых пользователей клиента |
| 403 «operator access required» | Вошли клиентским адресом, а не операторским — проверьте `OPERATOR_EMAILS` |
| Карточки не приходят в Slack | Проверьте `SLACK_BOT_TOKEN` и что бот приглашён в канал клиента |
| 402 «Your free trial has ended» | Самостоятельно зарегистрированный клиент без подписки. Он должен выбрать план в Settings → Billing; если оплату вы приняли иначе — `update clients set billing_mode = \'managed\' where id = …` |
| Оплатил, а план не сменился | Вебхук не дошёл или подпись не совпала: проверьте `STRIPE_WEBHOOK_SECRET` и что endpoint в Stripe смотрит на `/api/stripe/webhook`; в логе `Stripe webhook error` |
| 401 на Lemlist webhook | Заголовок `X-Webhook-Secret` не совпадает с `LEMLIST_WEBHOOK_SECRET` |
