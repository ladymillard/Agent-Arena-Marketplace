#!/usr/bin/env bash
#
# Stand up the Arena on a fresh Ubuntu 24.04 Oracle Cloud "Always Free" VM.
#
# Safe to run again: that is also how you update. Code is replaced only after
# the new version's tests pass; the event log and the admin token are kept.
#
#   sudo ARENA_DOMAIN=arena.chaiaininja.xyz bash deploy/oracle/bootstrap.sh
#
set -euo pipefail

ARENA_DOMAIN="${ARENA_DOMAIN:-arena.chaiaininja.xyz}"
ARENA_REPO="${ARENA_REPO:-https://github.com/ladymillard/Agent-Arena-Marketplace.git}"
ARENA_BRANCH="${ARENA_BRANCH:-main}"
NODE_MAJOR="${NODE_MAJOR:-24}"

APP_DIR=/opt/arena
DATA_DIR=/var/lib/arena
ENV_FILE=/etc/arena/arena.env

log() { printf '\n[arena-bootstrap] %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- packages

log "system packages"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl git gnupg openssl xz-utils \
  debian-keyring debian-archive-keyring apt-transport-https \
  iptables-persistent netfilter-persistent

# -------------------------------------------------------------------- node

# The Arena runs TypeScript directly, which needs a current Node. Installed
# from nodejs.org and checked against the published SHA-256 before unpacking.
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)"; exit 1 ;;
esac

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
  log "node $NODE_MAJOR ($NODE_ARCH)"
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  sums=$(curl -fsSL "$base/SHASUMS256.txt")
  tarball=$(printf '%s\n' "$sums" | awk -v want="linux-${NODE_ARCH}.tar.xz" '!found && substr($2, length($2) - length(want) + 1) == want { print $2; found = 1 }')
  [ -n "$tarball" ] || { echo "no node tarball for linux-$NODE_ARCH"; exit 1; }
  sum=$(printf '%s\n' "$sums" | awk -v t="$tarball" '!found && $2 == t { print $1; found = 1 }')
  tmp=$(mktemp -d)
  curl -fsSL "$base/$tarball" -o "$tmp/$tarball"
  echo "$sum  $tmp/$tarball" | sha256sum -c -
  rm -rf /usr/local/lib/nodejs
  mkdir -p /usr/local/lib/nodejs
  tar -xJf "$tmp/$tarball" -C /usr/local/lib/nodejs --strip-components=1
  ln -sf /usr/local/lib/nodejs/bin/node /usr/local/bin/node
  rm -rf "$tmp"
fi
log "node $(node --version)"

# ------------------------------------------------------------ user and data

id arena >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin arena
install -d -o arena -g arena -m 750 "$DATA_DIR" "$DATA_DIR/backups"

# --------------------------------------------------------------------- code

# Test the new version in a side directory; only swap it in if it passes,
# so a bad commit never replaces a working hub.
log "code from $ARENA_REPO ($ARENA_BRANCH)"
next="$APP_DIR.next"
rm -rf "$next"
git clone --depth 1 --branch "$ARENA_BRANCH" "$ARENA_REPO" "$next"
if ! (cd "$next" && node --test arena/test/*.test.ts); then
  rm -rf "$next"
  echo "tests failed on $ARENA_BRANCH; the running version was left in place"
  exit 1
fi
rm -rf "$APP_DIR.previous"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.previous"
mv "$next" "$APP_DIR"
chown -R root:root "$APP_DIR"   # the service can read the code but not change it

# ------------------------------------------------------------------- config

# Generated once. Re-running keeps the same admin token and log location.
install -d -o root -g root -m 755 /etc/arena
if [ ! -f "$ENV_FILE" ]; then
  log "config (new admin token)"
  (
    umask 077
    {
      echo "PORT=7777"
      echo "ARENA_LOG=$DATA_DIR/arena.log"
      echo "ARENA_ADMIN_TOKEN=$(openssl rand -hex 32)"
    } > "$ENV_FILE"
  )
fi

# ------------------------------------------------------------------ services

log "systemd units"
install -m 644 "$APP_DIR/deploy/oracle/arena.service" /etc/systemd/system/arena.service
install -m 644 "$APP_DIR/deploy/oracle/arena-backup.service" /etc/systemd/system/arena-backup.service
install -m 644 "$APP_DIR/deploy/oracle/arena-backup.timer" /etc/systemd/system/arena-backup.timer
systemctl daemon-reload
systemctl enable arena.service arena-backup.timer
systemctl restart arena.service
systemctl start arena-backup.timer

# --------------------------------------------------------------------- https

if ! command -v caddy >/dev/null 2>&1; then
  log "caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
log "caddy for $ARENA_DOMAIN"
sed "s/__ARENA_DOMAIN__/$ARENA_DOMAIN/g" "$APP_DIR/deploy/oracle/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

# ------------------------------------------------------------------ firewall

# Oracle's Ubuntu images reject everything except SSH at the host firewall.
# Open only 80 and 443, inserted ahead of that REJECT rule. Port 7777 stays
# closed to the internet; Caddy reaches it on localhost.
log "host firewall: 80, 443"
for port in 80 443; do
  if ! iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    reject_at=$(iptables -L INPUT --line-numbers -n | awk '!found && $2 == "REJECT" { print $1; found = 1 }')
    if [ -n "$reject_at" ]; then
      iptables -I INPUT "$reject_at" -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
    else
      iptables -A INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
    fi
  fi
done
netfilter-persistent save

# -------------------------------------------------------------------- check

log "health"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:7777/v1/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:7777/v1/health
    echo
    log "the Arena is running. Public address: https://$ARENA_DOMAIN (once DNS points here)"
    exit 0
  fi
  sleep 2
done
echo "the Arena did not answer on :7777; see: journalctl -u arena -n 50"
exit 1
