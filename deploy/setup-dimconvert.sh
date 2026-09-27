#!/usr/bin/env bash
# One-shot setup of DIM Convert at convert.dim.capital, next to DraftFly.
#
# Run as root on the server, from inside the cloned repository:
#   bash /opt/apps/dimconvert/deploy/setup-dimconvert.sh
#
# Safe to run again: every step checks what is already done. DraftFly
# (/opt/apps/draftfly, draftfly.app) is never modified.

set -euo pipefail

DOMAIN="convert.dim.capital"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$REPO_DIR/deploy"
BRANCH="claude/sleepy-davinci-bjm5wz"
SUBNET_PREFIX="172.28."
UPSTREAM="172.28.0.1:8081"
NGINX_SITES="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() { printf '\n\033[1;31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run this as root (sudo -i first)."
command -v docker >/dev/null || fail "docker is not installed."
command -v nginx >/dev/null || fail "nginx is not installed."
command -v certbot >/dev/null || fail "certbot is not installed (apt install certbot python3-certbot-nginx)."

# ── 1. Stop unknown addresses falling through to DraftFly ───────────────────
step "1/7  Catch-all for unknown addresses (so ${DOMAIN} never shows DraftFly)"
CATCHALL="$NGINX_SITES/000-catchall.conf"
if [ -e "$NGINX_ENABLED/000-catchall.conf" ]; then
  note "already in place"
elif grep -rqs "default_server" "$NGINX_ENABLED"/; then
  note "another site is already the default ($(grep -rls default_server "$NGINX_ENABLED"/ | tr '\n' ' ')) — leaving it alone"
else
  cat > "$CATCHALL" <<'EOF'
# Any request for a name no other site claims is dropped, instead of being
# answered by whichever site happens to be first (which was DraftFly).
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_reject_handshake on;
    return 444;
}
EOF
  ln -s "$CATCHALL" "$NGINX_ENABLED/000-catchall.conf"
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    note "done — unknown addresses are now refused; draftfly.app is unaffected"
  else
    rm -f "$NGINX_ENABLED/000-catchall.conf" "$CATCHALL"
    note "nginx rejected the catch-all, so it was removed again (nothing changed). Continuing."
  fi
fi

# ── 2. DNS ───────────────────────────────────────────────────────────────────
step "2/7  Checking ${DOMAIN} points at this server"
SERVER_IP="$(curl -4 -fsS -m 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
note "this server: ${SERVER_IP:-unknown}   ${DOMAIN}: ${DNS_IP:-not found}"
[ -n "$DNS_IP" ] || fail "${DOMAIN} does not resolve yet. Wait a few minutes after adding the DNS record and run this again."
[ "$DNS_IP" = "$SERVER_IP" ] || fail "${DOMAIN} points at ${DNS_IP}, not this server (${SERVER_IP}). Fix the A record in GoDaddy."

# ── 3. Code ──────────────────────────────────────────────────────────────────
step "3/7  Code (branch ${BRANCH})"
cd "$REPO_DIR"
if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
  # Only reaches GitHub (and asks for the token) when the branch is missing.
  git fetch -q origin "$BRANCH"
  git checkout -q "$BRANCH"
fi
note "at $(git log --oneline -1)   (to update later: git pull, then run this script again)"

# ── 4. Settings ──────────────────────────────────────────────────────────────
step "4/7  Settings (deploy/.env)"
cd "$DEPLOY_DIR"
if docker network inspect $(docker network ls -q) --format '{{range .IPAM.Config}}{{.Subnet}}{{end}} {{.Name}}' 2>/dev/null \
    | grep "^${SUBNET_PREFIX}" | grep -vq " dimconvert_default$"; then
  fail "the private network ${SUBNET_PREFIX}0.0/16 is already used by another project. Tell Claude and it will pick another range."
fi

setval() { # setval KEY VALUE — set or add KEY=VALUE in .env, uncommenting it if needed
  local key="$1" val="$2"
  if grep -qE "^#?${key}=" .env; then
    local esc; esc="$(printf '%s' "$val" | sed -e 's/[\/&|]/\\&/g')"
    sed -i -E "s|^#?${key}=.*|${key}=${esc}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}
getval() { grep -E "^${1}=" .env | head -1 | cut -d= -f2- || true; }

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  setval POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  setval SESSION_SECRET "$(openssl rand -hex 32)"
  setval CREDENTIAL_ENCRYPTION_KEY "$(openssl rand -hex 32)"
  note "created with freshly generated passwords"
else
  note "keeping the existing .env"
  [ -n "$(getval CREDENTIAL_ENCRYPTION_KEY)" ] || setval CREDENTIAL_ENCRYPTION_KEY "$(openssl rand -hex 32)"
fi

if [ -z "$(getval OPERATOR_EMAILS)" ] || [ "$(getval OPERATOR_EMAILS)" = "you@example.com" ]; then
  read -r -p "    Your email (you will sign in with it; use the one your Resend account is on): " OP_EMAIL
  [ -n "$OP_EMAIL" ] || fail "an email is required"
  setval OPERATOR_EMAILS "$OP_EMAIL"
fi
if [ -z "$(getval RESEND_API_KEY)" ]; then
  read -r -s -p "    Resend API key (re_…; sign-in codes are emailed with it): " RESEND; echo
  [ -n "$RESEND" ] || fail "a Resend key is required — without it nobody can receive a sign-in code"
  setval RESEND_API_KEY "$RESEND"
fi
if [ -z "$(getval ANTHROPIC_API_KEY)" ]; then
  read -r -s -p "    Anthropic API key (sk-ant-…; for qualifying leads and drafting): " ANTH; echo
  [ -n "$ANTH" ] || note "no key given — the app runs, but will not draft until you add ANTHROPIC_API_KEY to .env"
  [ -z "$ANTH" ] || setval ANTHROPIC_API_KEY "$ANTH"
fi
setval COMPOSE_PROJECT_NAME dimconvert
setval APP_BIND "$UPSTREAM"
setval DOCKER_SUBNET "${SUBNET_PREFIX}0.0/16"
setval DOCKER_GATEWAY "${SUBNET_PREFIX}0.1"
setval APP_BASE_URL "https://${DOMAIN}"
setval DOMAIN "$DOMAIN"
chmod 600 .env

# ── 5. Build and start ───────────────────────────────────────────────────────
step "5/7  Building and starting DIM Convert (a few minutes the first time)"
docker compose build
docker compose --profile setup run --rm migrate
docker compose up -d
for i in $(seq 1 30); do
  if curl -fsS -m 3 "http://${UPSTREAM}/api/healthz" >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" -lt 30 ] || { docker compose logs app --tail=40; fail "the app did not become healthy — logs above"; }
done
note "running: $(curl -fsS "http://${UPSTREAM}/api/healthz")"

# ── 6. nginx site ────────────────────────────────────────────────────────────
step "6/7  Web address ${DOMAIN}"
cp "$DEPLOY_DIR/nginx-dimconvert.conf" "$NGINX_SITES/dimconvert.conf.new"
if [ -f "$NGINX_SITES/dimconvert.conf" ] && grep -q "managed by Certbot" "$NGINX_SITES/dimconvert.conf"; then
  rm -f "$NGINX_SITES/dimconvert.conf.new"
  note "already installed (with certificate) — left as is"
else
  mv "$NGINX_SITES/dimconvert.conf.new" "$NGINX_SITES/dimconvert.conf"
  ln -sf "$NGINX_SITES/dimconvert.conf" "$NGINX_ENABLED/dimconvert.conf"
  nginx -t || fail "nginx rejected the site config — nothing was reloaded"
  systemctl reload nginx
  note "installed"
fi

# ── 7. Certificate ───────────────────────────────────────────────────────────
step "7/7  Padlock (Let's Encrypt certificate)"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
  -m "$(getval OPERATOR_EMAILS | cut -d, -f1)" --keep-until-expiring
sleep 1
CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/healthz" || true)"
[ "$CODE" = "200" ] || fail "https://${DOMAIN} answered ${CODE}. Paste this output to Claude."

step "Done — https://${DOMAIN} is live"
note "Sign in at https://${DOMAIN}/app with $(getval OPERATOR_EMAILS) — the code arrives by email."
note "DraftFly: $(curl -s -o /dev/null -w '%{http_code}' https://draftfly.app/api/healthz) at https://draftfly.app (200 = fine)"
echo
note "IMPORTANT: save this encryption key in a password manager. Without it a"
note "restored or moved database cannot read its saved credentials:"
note "  CREDENTIAL_ENCRYPTION_KEY=$(getval CREDENTIAL_ENCRYPTION_KEY)"
