#!/usr/bin/env bash
set -euo pipefail

# ─── Krajcara Admin Installer ─────────────────────────────────────────────────
# Usage: sudo bash install.sh <GITHUB_TOKEN>
# Example: sudo bash install.sh ghp_xxxxxxxxxxxxxxxxxxxx
#
REPO_OWNER="krajcara"
REPO_NAME="Krajcara-Admin"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
INSTALL_DIR="/opt/krajcara-admin"
SERVICE_NAME="krajcara-admin"
NODE_VERSION="20"
APP_PORT="3000"
APP_VERSION="1.0.0"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ─── Root check ───────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash install.sh <GITHUB_TOKEN>"

# ─── Token — must be passed as argument, no prompts ──────────────────────────
GITHUB_TOKEN="${1:-}"
if [ -z "$GITHUB_TOKEN" ]; then
  # Try to extract from existing git config if re-running install
  for git_cfg in "$(pwd)/.git/config" "$INSTALL_DIR/.git/config"; do
    if [ -f "$git_cfg" ]; then
      EXTRACTED=$(grep -oP '(?<=https://)[^:]+:[^@]+(?=@)' "$git_cfg" 2>/dev/null | head -1 | cut -d: -f2 || true)
      if [ -n "$EXTRACTED" ]; then
        GITHUB_TOKEN="$EXTRACTED"
        break
      fi
    fi
  done
fi
[ -z "$GITHUB_TOKEN" ] && error "GitHub token required.\nUsage: sudo bash install.sh <GITHUB_TOKEN>\nExample: sudo bash install.sh ghp_xxxxxxxxxxxxxxxxxxxx"

echo ""
echo "  ██╗  ██╗██████╗  █████╗      █████╗ ██████╗ ███╗   ███╗██╗███╗   ██╗"
echo "  ██║ ██╔╝██╔══██╗██╔══██╗    ██╔══██╗██╔══██╗████╗ ████║██║████╗  ██║"
echo "  █████╔╝ ██████╔╝███████║    ███████║██║  ██║██╔████╔██║██║██╔██╗ ██║"
echo "  ██╔═██╗ ██╔══██╗██╔══██║    ██╔══██║██║  ██║██║╚██╔╝██║██║██║╚██╗██║"
echo "  ██║  ██╗██║  ██║██║  ██║    ██║  ██║██████╔╝██║ ╚═╝ ██║██║██║ ╚████║"
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝    ╚═╝  ╚═╝╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝"
echo ""
info "Krajcara Admin Installer v${APP_VERSION}"
echo ""

# ─── Verify token against GitHub API ─────────────────────────────────────────
info "Verifying GitHub token..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}" \
  --max-time 15 2>/dev/null || echo "000")

case "$HTTP_CODE" in
  200) success "GitHub token valid — repository accessible" ;;
  401) error "Invalid GitHub token (HTTP 401). Check your token at: https://github.com/settings/tokens" ;;
  404) error "Repository not found (HTTP 404). Token may lack 'repo' scope." ;;
  000) error "Cannot reach GitHub. Check your internet connection." ;;
  *)   warn "GitHub returned HTTP $HTTP_CODE — continuing anyway..." ;;
esac

# ─── Detect OS ────────────────────────────────────────────────────────────────
info "Detecting OS..."
[ -f /etc/os-release ] || error "Cannot detect OS"
. /etc/os-release
OS=$ID; OS_VER=$VERSION_ID
info "OS: $OS $OS_VER"
[[ "$OS" == "ubuntu" || "$OS" == "debian" ]] || error "Only Ubuntu/Debian supported"

# ─── Install system packages ──────────────────────────────────────────────────
info "Installing system packages..."
apt-get update -qq
apt-get install -y curl git ca-certificates gnupg openssl nmap 2>&1 | tail -3
success "System packages ready"

# ─── Install Node.js ──────────────────────────────────────────────────────────
install_node() {
  if command -v node &>/dev/null; then
    CURRENT_NODE=$(node --version | cut -d. -f1 | tr -d 'v')
    if [[ "$CURRENT_NODE" -ge "$NODE_VERSION" ]]; then
      success "Node.js $(node --version) already installed"
      return
    fi
  fi
  info "Installing Node.js $NODE_VERSION LTS..."
  export NVM_DIR="/root/.nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>&1 | tail -3
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install "$NODE_VERSION" --lts 2>&1 | tail -3
  nvm use "$NODE_VERSION"
  nvm alias default "$NODE_VERSION"
  NODE_BIN_PATH=$(nvm which "$NODE_VERSION")
  ln -sf "$NODE_BIN_PATH" /usr/local/bin/node
  ln -sf "$(dirname "$NODE_BIN_PATH")/npm" /usr/local/bin/npm
  success "Node.js $(node --version) installed"
}
install_node

# ─── Clone repository ─────────────────────────────────────────────────────────
info "Cloning repository..."
if [ -d "$INSTALL_DIR" ]; then
  warn "Removing existing installation at $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
fi

GIT_TERMINAL_PROMPT=0 git clone \
  "https://${GITHUB_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git" \
  "$INSTALL_DIR" 2>&1 || error "git clone failed. Check token permissions."

# Store token in git config so update.sh can use it without re-asking
git -C "$INSTALL_DIR" remote set-url origin \
  "https://${GITHUB_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git"
chmod 600 "$INSTALL_DIR/.git/config"
success "Repository cloned to $INSTALL_DIR"

# ─── Generate credentials and create .env ─────────────────────────────────────
info "Generating credentials and creating .env..."
ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -dc 'a-zA-Z0-9' | head -c 16)
APP_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)

mkdir -p "$INSTALL_DIR/data"

cat > "$INSTALL_DIR/.env" << EOF
APP_PORT=${APP_PORT}
APP_SECRET=${APP_SECRET}
NODE_ENV=production

DB_PATH=${INSTALL_DIR}/data/krajcara-admin.db

GITHUB_TOKEN=${GITHUB_TOKEN}
GITHUB_REPO=https://github.com/${REPO_OWNER}/${REPO_NAME}.git
INSTALL_DIR=${INSTALL_DIR}

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Krajcara Admin <noreply@krajcara.local>

ADMIN_EMAIL=admin@krajcara.local
ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF

chmod 600 "$INSTALL_DIR/.env"
success ".env created"

# ─── Install dependencies and build ──────────────────────────────────────────
info "Installing server dependencies..."
cd "$INSTALL_DIR/server"
unset NODE_ENV
npm install 2>&1 | tail -8

info "Installing fast-cli globally..."
npm install -g fast-cli 2>&1 | tail -3
# Ensure 'fast' is accessible system-wide regardless of nvm path
FAST_BIN=$(find /root/.nvm /usr/local/lib /usr/lib -name "fast" -type f 2>/dev/null | head -1)
if [ -n "$FAST_BIN" ]; then
  ln -sf "$FAST_BIN" /usr/local/bin/fast
  success "fast-cli installed at $FAST_BIN"
else
  warn "fast-cli binary not found after install — speed test may not work"
fi

info "Installing client dependencies..."
cd "$INSTALL_DIR/client"
npm install --silent 2>&1 | tail -3

info "Building frontend..."
npm run build 2>&1 | tail -5
[ -d "$INSTALL_DIR/client/dist" ] || error "Frontend build failed — dist directory missing"
success "Application built"

# ─── Install systemd service ──────────────────────────────────────────────────
info "Installing systemd service..."
NODE_BIN=$(find /root/.nvm/versions -name "node" -type f 2>/dev/null | sort -V | tail -1 || true)
[ -z "$NODE_BIN" ] && NODE_BIN=$(which node 2>/dev/null || true)
[ -z "$NODE_BIN" ] && error "Cannot find node binary"
info "Using node: $NODE_BIN"

cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Krajcara Admin Web Application
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}/server
ExecStart=${NODE_BIN} ${INSTALL_DIR}/server/src/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
EnvironmentFile=${INSTALL_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"
sleep 6

if systemctl is-active --quiet "$SERVICE_NAME"; then
  success "Service started"
else
  warn "Service not active immediately. Checking logs..."
  journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>/dev/null || true
fi

# ─── Health check ─────────────────────────────────────────────────────────────
info "Waiting for application to start..."
for i in $(seq 1 12); do
  if curl -sf "http://localhost:${APP_PORT}/api/health" > /dev/null 2>&1; then
    success "Application is up and running"
    break
  fi
  sleep 3
done

# ─── Summary ──────────────────────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  Krajcara Admin v${APP_VERSION} successfully installed!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "  App:        ${BLUE}http://${SERVER_IP}:${APP_PORT}${NC}"
echo -e "  Status:     ${BLUE}http://${SERVER_IP}:${APP_PORT}/status${NC}"
echo ""
echo "  ┌──────────────────────────────────────────────┐"
echo "  │  First login credentials                     │"
echo "  │                                              │"
echo "  │  Username:  admin                            │"
printf "  │  Password:  %-32s│\n" "${ADMIN_PASSWORD}"
echo "  │                                              │"
echo "  │  You will be asked to change password        │"
echo "  │  on first login.                             │"
echo "  └──────────────────────────────────────────────┘"
echo ""
echo "  Update:    sudo bash ${INSTALL_DIR}/update.sh"
echo "  Logs:      sudo journalctl -u ${SERVICE_NAME} -f"
echo "  Data:      ${INSTALL_DIR}/data/"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
