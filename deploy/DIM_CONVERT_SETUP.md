# Setting up DIM Convert next to DraftFly

DIM Convert runs on the same server as DraftFly (169.58.133.24) but fully
separately: its own folder, containers, database, private network and port.
DraftFly and draftfly.app are not touched by any step below.

|                  | DraftFly (already running)  | DIM Convert (new)            |
|------------------|-----------------------------|------------------------------|
| Folder           | `/opt/apps/draftfly`        | `/opt/apps/dimconvert`       |
| Compose project  | `deploy`                    | `dimconvert`                 |
| Internal address | `172.18.0.1:8080`           | `172.28.0.1:8081`            |
| nginx site       | `draftfly.conf`             | `dimconvert.conf`            |
| Address          | draftfly.app                | convert.dim.capital          |

Run everything as root on the server (`ssh root@169.58.133.24`).

## Quick way: one script

After step 0 below, this does steps 1–5 for you (and adds a catch-all so an
address the server does not know is refused instead of showing DraftFly):

```bash
git clone -b claude/sleepy-davinci-bjm5wz https://github.com/Anya9910-eng/dim.map.git /opt/apps/dimconvert
bash /opt/apps/dimconvert/deploy/setup-dimconvert.sh
```

It asks for your email, the Resend key and the Anthropic key, and is safe to
run again. The manual steps below do the same thing by hand.

## 0. Before you start

- **DNS:** `convert.dim.capital` must point to `169.58.133.24`. Check with
  `dig +short convert.dim.capital` (on the server) or dnschecker.org.
- **Resend account:** sign-in codes are only ever emailed in production, never
  written to the logs. Create a free account at resend.com with the email you
  will sign in with, and create an API key. Until `dim.capital` is verified in
  Resend, it can only send to that one address — enough to get you in.
- **Anthropic API key** for drafting (console.anthropic.com).
- **GitHub access:** the repository is private, so the server needs a GitHub
  personal access token (read access to `Anya9910-eng/dim.map`) to clone it.

## 1. Check the private network is free

```bash
docker network inspect $(docker network ls -q) --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

If anything already uses `172.28.0.0/16`, pick another free range (for example
`172.29.0.0/16`) and change `DOCKER_SUBNET`, `DOCKER_GATEWAY` and `APP_BIND` in
step 3 and `proxy_pass` in step 5 to match.

## 2. Get the code

```bash
git clone https://github.com/Anya9910-eng/dim.map.git /opt/apps/dimconvert
cd /opt/apps/dimconvert
git checkout claude/sleepy-davinci-bjm5wz
```

(When asked for a password, paste the GitHub token.)

## 3. Settings

```bash
cd /opt/apps/dimconvert/deploy
cp .env.example .env

# Generated secrets
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^CREDENTIAL_ENCRYPTION_KEY=.*/CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env

nano .env
```

In the editor, set:

- `OPERATOR_EMAILS=` your own email (the one your Resend account uses)
- `RESEND_API_KEY=` — remove the `#` in front and paste the key
- `ANTHROPIC_API_KEY=` your key
- Leave `APP_BASE_URL=https://convert.dim.capital`, `COMPOSE_PROJECT_NAME`,
  `APP_BIND`, `DOCKER_SUBNET` and `DOCKER_GATEWAY` as they are.
- Leave `EMAIL_FROM` commented out until `dim.capital` is verified in Resend.

**Copy `CREDENTIAL_ENCRYPTION_KEY` into a password manager now.** Without the
same key, a restored or moved database cannot read its saved credentials.

## 4. Build and start

```bash
cd /opt/apps/dimconvert/deploy
docker compose build
docker compose --profile setup run --rm migrate
docker compose up -d
docker compose ps
curl -s http://172.28.0.1:8081/api/healthz   # → {"status":"ok"}
```

## 5. Web address and padlock

```bash
cp /opt/apps/dimconvert/deploy/nginx-dimconvert.conf /etc/nginx/sites-available/dimconvert.conf
ln -s /etc/nginx/sites-available/dimconvert.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d convert.dim.capital
```

Open https://convert.dim.capital — the site. https://convert.dim.capital/app —
sign in with your operator email; the code arrives by email.

## Everyday commands

Always run these from `/opt/apps/dimconvert/deploy` — in DraftFly's folder the
same commands act on DraftFly.

```bash
docker compose ps                    # status
docker compose logs app --tail=50    # logs
docker compose up -d                 # apply .env changes (restart does not reload .env)
```

Updating to newer code:

```bash
cd /opt/apps/dimconvert && git pull
cd deploy && docker compose build && docker compose --profile setup run --rm migrate && docker compose up -d
```

## After it is live

1. **Email from your domain:** add `dim.capital` in Resend → Domains, add the
   DNS records it shows in GoDaddy, then set
   `EMAIL_FROM=DIM Convert <noreply@dim.capital>` and `docker compose up -d`.
   Until then sign-in emails come from Resend's shared sender and reach only
   your own address.
2. **Mailbox** for `outreach@dim.capital` (Google Workspace, Zoho, …).
3. **Lead sources:** paste the webhook addresses from Settings into Lemlist,
   Meta, Google Ads and WhatsApp.
4. **Backups:** nothing backs the database up yet. At minimum, before real
   customers:
   `docker compose exec -T db pg_dump -U draftfly draftfly | gzip > /root/dimconvert-$(date +%F).sql.gz`
