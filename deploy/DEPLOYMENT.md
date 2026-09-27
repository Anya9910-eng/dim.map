# DraftFly — Production Deployment

Live at **https://draftfly.app**. Last verified 2026-08-13 22:30 CEST.

All timestamps in this document are **CEST (UTC+02:00)** — the server's local
timezone, matching `date` and every log on the box.

---

## Infrastructure

| | |
|---|---|
| Host | `169.58.133.24` (Contabo), hostname `vmi3489695` |
| OS | Ubuntu 24.04.4 LTS, kernel 6.8.0-137 |
| Docker | 29.7.2, Compose 5.4.0 |
| Reverse proxy | nginx 1.24.0 (host-level, not containerised) |
| TLS | Let's Encrypt via certbot, expires 2026-11-08, auto-renew `certbot.timer` |
| Project root | `/opt/apps/draftfly` (git `d59f124`) |
| Compose dir | `/opt/apps/draftfly/deploy` |

### Containers

```
deploy-app-1   built from deploy/Dockerfile   172.18.0.1:8080->8080/tcp
deploy-db-1    postgres:16-alpine             5432/tcp (internal only)
```

Database: 10 tables in `public` (`activity`, `campaigns`, `clients`, `drafts`,
`epicgram_drafts`, `logs`, `operator_billing`, `personas`, `setup_items`,
`user_sessions`), volume `deploy_pgdata`.

### Request path

```
internet → nginx :443 (TLS) → 172.18.0.1:8080 → container 172.18.0.3:8080
```

`/etc/nginx/sites-available/draftfly.conf`, symlinked into `sites-enabled/`.

---

## Port binding — read this before changing it

The app publishes on **`172.18.0.1:8080`**, the docker bridge gateway. This is
deliberate and non-obvious.

**Why not `127.0.0.1:8080`:** a loopback publication cannot use iptables DNAT
(`net.ipv4.conf.all.route_localnet = 0`, and the nat `OUTPUT` chain jumps to
`DOCKER` only for `! -d 127.0.0.0/8`). Docker therefore serves it through a
userland `docker-proxy` process — a single point of failure. When that process
died on 2026-08-13, the site returned 502 for 85 minutes while
`docker compose ps` still reported the container `Up` and healthy.

Binding to the bridge gateway is served by DNAT:

```
-A DOCKER -d 172.18.0.1/32 ! -i br-<id> -p tcp --dport 8080 -j DNAT --to 172.18.0.3:8080
```

Verified by experiment: killing `docker-proxy` no longer takes the site down.

**Why not `0.0.0.0:8080`:** that also survives `docker-proxy` dying, but exposes
the app to the internet on plain HTTP, bypassing nginx, TLS and the dotfile
rules. Docker's iptables chain runs before ufw, so a host firewall would not
stop it. `172.18.0.1` gives the same resilience and stays unroutable from
outside.

**The subnet pin is part of the fix, not decoration.** `docker compose down`
deletes the auto-created network; on the next `up` Docker picks whatever subnet
is free, which may not be `172.18.0.0/16`. The gateway address would then not
exist and the container would fail to start at all. Hence, in
`docker-compose.yml`:

```yaml
networks:
  default:
    ipam:
      config:
        - subnet: 172.18.0.0/16
          gateway: 172.18.0.1
```

Change the subnet and you must change the port binding **and** nginx's
`proxy_pass` to match.

---

## Monitoring

`/root/check-docker-proxy.sh`, run by cron every 5 minutes.

It probes `https://draftfly.app/api/healthz` end-to-end through nginx rather
than grepping for a process, so it also catches a hung app, a dead container or
a broken vhost. Three probes 5s apart before acting, so a normal ~10s boot is
not mistaken for an outage. `flock` prevents overlapping runs. On failure it
logs the cause (no docker-proxy / nothing listening / gateway missing /
container not running), runs `docker compose restart app`, re-probes, and logs
`RECOVERED` or `STILL DOWN … manual action needed`.

Silent when healthy. Log: `/var/log/docker-proxy-alert.log`, rotated daily ×7 by
`/etc/logrotate.d/docker-proxy-alert` (needs `su root root` — `/var/log` is
group-writable, and logrotate refuses to touch it otherwise).

Proven in production on 2026-08-13: detected a 502, restarted, recovered — 23
seconds unattended.

---

## Operational gotchas

**`docker compose restart` does not reload `.env`.** Environment variables are
fixed when the container is *created*. After editing `.env` you need
`docker compose up -d`, which recreates it. A `restart` will silently keep the
old values.

**`docker compose down` deletes the network.** Safe now that the subnet is
pinned, but never add `-v` unless you intend to destroy `deploy_pgdata`.

**Health endpoint is `/api/healthz` on port 8080.** There is no `/api/db-check`
— that path 404s. The app does not listen on 3000.

**No `curl` or `wget` inside the app container.** Probe from inside with:
```bash
docker exec deploy-app-1 node -e 'fetch("http://localhost:8080/api/healthz").then(r=>r.text().then(console.log))'
```

**Testing the vhost from the host needs the right Host header.** `curl
http://localhost/…` does not match `server_name draftfly.app` and tells you
nothing. Use:
```bash
curl -sk --resolve draftfly.app:443:127.0.0.1 https://draftfly.app/api/healthz
```

**The SPA answers 200 for unknown paths.** Scanners probing `/.env`,
`/.git/config`, `/wp-admin/…` were getting 200 (the SPA fallback — no actual
leak, verified by reading the response body). nginx now returns 404 for
dotfiles:
```nginx
location ~ /\.(env|git|config|htaccess) { return 404; }
location ~ /\.(env|git|config)/         { return 404; }
```
Non-dotfile probes such as `/wp-admin/install.php` still get the SPA fallback.

**Watch out for self-matching patterns in ops scripts.** `ps aux | grep -c
'docker-proxy.*8080'` counts its own grep and never reaches zero;
`pkill -f 'docker-proxy.*8080'` kills the shell that runs it. Use `'[d]ocker-proxy'`
or match the exact process name.

**`grep -r` under Claude Code respects `.gitignore`** and will skip `.env` —
exactly the file a secret scan needs to read. Use `/usr/bin/grep` explicitly.

---

## Secrets (`/opt/apps/draftfly/deploy/.env`)

Mode `0600 root:root`, listed in `.gitignore`, not tracked by git. Backups of
prior versions sit beside it as `.env.bak.<epoch>`.

| Variable | State |
|---|---|
| `DATABASE_URL` | live |
| `SESSION_SECRET` | live |
| `SLACK_BOT_TOKEN`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | live |
| `SLACK_TEAM_ID` | `T0BG996J8UA` — the only workspace allowed to act as operator |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY` | **commented out** — only ever held the placeholder `sk_live_xxx` |
| `LEMLIST_WEBHOOK_SECRET`, `AWS_SECRET_ACCESS_KEY` | placeholders |

### Stripe is disabled, on purpose

No real key has ever been present on this host — not in `.env`, not in the
backups, not in git. The keys are commented out so the logs carry one honest
line (`Stripe not connected. Set STRIPE_SECRET_KEY …`) instead of a
`StripeAuthenticationError` stack trace on every boot.

`initStripe()` (`artifacts/api-server/src/index.ts:23`) runs regardless of the
Stripe keys — its only guard is `DATABASE_URL` — and its `try/catch` turns the
missing key into a level-40 warning. So `Stripe initialization skipped` remains
in the log by design; suppressing it entirely would need a code change and an
image rebuild.

The `stripe` schema exists but is **empty**. `runMigrations` creates the schema
(`Stripe schema ready`); the `stripe.*` tables are written by
`stripe-replit-sync` only after it authenticates successfully. The compose
`migrate` profile does **not** create them — it runs `drizzle-kit push --force`
over `lib/db/src/schema/`, which defines no `stripe` schema.

**To enable payments:** uncomment both keys in `.env`, set real values, then
`docker compose up -d` (**not** `restart`). Tables appear on their own.

---

## Runbook

```bash
cd /opt/apps/draftfly/deploy

docker compose ps                      # status
docker compose logs app --tail=50      # logs (-f follows; it will not return)
docker compose up -d                   # apply .env or compose changes
docker compose restart app             # code-free bounce, keeps old env

# health, end to end
curl -sk --resolve draftfly.app:443:127.0.0.1 https://draftfly.app/api/healthz

# is the publication alive?
ss -tuln | grep 8080                   # expect 172.18.0.1:8080
pgrep -a docker-proxy

# database
docker exec deploy-db-1 psql -U draftfly -d draftfly -c '\dt'

# nginx
nginx -t && systemctl reload nginx     # never restart on an untested config
tail -f /var/log/nginx/error.log

# watchdog
/root/check-docker-proxy.sh; echo $?   # 0 and silent = healthy
tail /var/log/docker-proxy-alert.log
```

**Backups on the box:** `docker-compose.yml.bak.<epoch>`, `.env.bak.<epoch>`,
`/etc/nginx/sites-available/draftfly.conf.bak.<epoch>`.

---

## Incident log

### 2026-08-13 — 502 for 85 minutes

**20:22** — nginx begins logging `connect() failed (111: Connection refused)`
to `127.0.0.1:8080`. The site is down; `docker compose ps` shows both
containers `Up`, the db `healthy`, and the app answering `200` on `/api/healthz`
from inside the container. Nothing in the app logs.

**Cause** — the `docker-proxy` process publishing `127.0.0.1:8080` was gone. It
coincides with a duplicate stack at `/root/draftfly-deploy` (compose file
written 20:18) competing for port 8080. That stack was a stub: `node:18-alpine`
with no build context, no volumes and no command — it could never have served
anything, and its database was empty.

**21:47** — `docker compose restart app` respawns `docker-proxy`; service
restored. Duplicate stack and its empty volume removed.

**22:00** — root cause addressed: port rebound from `127.0.0.1:8080` to
`172.18.0.1:8080` with the subnet pinned, so the failure mode cannot recur.
Verified by killing `docker-proxy` — the site stayed up on DNAT.

**Lesson:** `docker compose ps` reported perfect health throughout an 85-minute
outage. Container-level checks cannot see a broken port publication; only an
end-to-end probe through nginx can. That is why the watchdog probes the public
URL.

---

## Known issues

1. **Payments disabled** — no Stripe key exists. See above.
2. **`LEMLIST_WEBHOOK_SECRET`, `AWS_SECRET_ACCESS_KEY`** are placeholders;
   whatever depends on them does not work.
3. **Slack operator rejections** — `requireOperator: rejecting operator from a
   different Slack workspace`, `userTeam T06RQ2F78KF` vs allowed
   `T0BG996J8UA`. The config is correct; someone from another workspace is
   trying to reach operator functions. Worth knowing who.
4. **No off-host alerting.** The watchdog self-heals and writes to a local log
   that nobody is paged about. If the host itself goes down, nothing notices.
5. **No database backups.** `deploy_pgdata` has no dump schedule.
