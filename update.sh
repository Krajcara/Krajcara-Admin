#!/usr/bin/env bash
set -euo pipefail

# ─── Krajcara Admin Updater ───────────────────────────────────────────────────
# Checks GitHub for a newer version tag, pulls if available, rebuilds and restarts.
# Usage: sudo bash /opt/krajcara-admin/update.sh
#
INSTALL_DIR="/opt/krajcara-admin"
SERVICE_NAME="krajcara-admin"
REPO_OWNER="krajcara"
REPO_NAME="Krajcara-Admin"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash update.sh"

echo ""
info "Krajcara Admin — Update check"
echo ""

# ─── Load .env ────────────────────────────────────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
[ -f "$ENV_FILE" ] || error ".env not found at $ENV_FILE — is the app installed?"

# Source only the vars we need
GITHUB_TOKEN=$(grep -E '^GITHUB_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
APP_PORT=$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" || echo "3000")

[ -z "$GITHUB_TOKEN" ] && error "GITHUB_TOKEN not found in .env"

# ─── Get current installed version ────────────────────────────────────────────
CURRENT_VERSION="unknown"
if [ -f "$INSTALL_DIR/server/package.json" ]; then
  CURRENT_VERSION=$(grep -oP '"version":\s*"\K[^"]+' "$INSTALL_DIR/server/package.json" 2>/dev/null | head -1 || echo "unknown")
fi
info "Installed version: $CURRENT_VERSION"

# ─── Check GitHub for latest release tag ──────────────────────────────────────
info "Checking GitHub for latest release..."
LATEST_JSON=$(curl -sf \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest" \
  --max-time 15 2>/dev/null || echo "")

if [ -z "$LATEST_JSON" ]; then
  # No releases yet — check if there are any new commits on main instead
  info "No releases found — checking for new commits on main branch..."
  REMOTE_SHA=$(git -C "$INSTALL_DIR" ls-remote origin HEAD 2>/dev/null | awk '{print $1}' | head -c 7 || echo "")
  LOCAL_SHA=$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo "")

  if [ -z "$REMOTE_SHA" ]; then
    warn "Cannot reach GitHub. Check your internet connection."
    exit 0
  fi

  if [ "$REMOTE_SHA" = "$LOCAL_SHA" ]; then
    success "Already up to date (commit: $LOCAL_SHA)"
    exit 0
  fi

  info "New commits available (local: $LOCAL_SHA → remote: $REMOTE_SHA)"
  NEEDS_UPDATE=true
  LATEST_VERSION="latest commit"
else
  LATEST_VERSION=$(echo "$LATEST_JSON" | grep -oP '"tag_name":\s*"\K[^"]+' | sed 's/^v//' || echo "")

  if [ -z "$LATEST_VERSION" ]; then
    warn "Could not parse latest release version."
    exit 0
  fi

  info "Latest release: $LATEST_VERSION"

  if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    success "Already on latest version ($CURRENT_VERSION)"
    exit 0
  fi

  NEEDS_UPDATE=true
fi

# ─── Pull latest code ──────────────────────────────────────────────────────────
info "Updating to $LATEST_VERSION..."

# Make sure remote URL has the token
git -C "$INSTALL_DIR" remote set-url origin \
  "https://${GITHUB_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git"
chmod 600 "$INSTALL_DIR/.git/config"

git -C "$INSTALL_DIR" fetch origin 2>&1 | tail -3
git -C "$INSTALL_DIR" reset --hard origin/main 2>&1 | tail -3
success "Code updated"

# ─── Reinstall dependencies ───────────────────────────────────────────────────
info "Updating server dependencies..."
cd "$INSTALL_DIR/server"
unset NODE_ENV
npm install --silent 2>&1 | tail -3

# Install fast-cli if not already present
if ! command -v fast &>/dev/null; then
  info "Installing fast-cli..."
  npm install -g fast-cli 2>&1 | tail -3
fi

info "Updating client dependencies..."
cd "$INSTALL_DIR/client"
npm install --silent 2>&1 | tail -3

# ─── Rebuild frontend ─────────────────────────────────────────────────────────
info "Rebuilding frontend..."
npm run build 2>&1 | tail -5
[ -d "$INSTALL_DIR/client/dist" ] || error "Frontend build failed"
success "Frontend rebuilt"

# ─── Restart service ──────────────────────────────────────────────────────────
info "Restarting service..."
systemctl restart "$SERVICE_NAME"
sleep 6

if systemctl is-active --quiet "$SERVICE_NAME"; then
  success "Service restarted"
else
  error "Service failed to restart. Check: journalctl -u $SERVICE_NAME -n 50"
fi

# ─── Health check ─────────────────────────────────────────────────────────────
for i in $(seq 1 10); do
  if curl -sf "http://localhost:${APP_PORT}/api/health" > /dev/null 2>&1; then
    echo ""
    success "Krajcara Admin updated and running on port ${APP_PORT}"
    echo ""
    exit 0
  fi
  sleep 3
done
warn "Health check timed out. Check: journalctl -u $SERVICE_NAME -n 30"
