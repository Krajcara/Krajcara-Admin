#!/usr/bin/env bash
set -euo pipefail

# ─── Krajcara Admin Installer ─────────────────────────────────────────────────
# Usage: sudo bash install.sh <GITHUB_TOKEN>
#
REPO_OWNER="krajcara"
REPO_NAME="Krajcara-Admin"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
INSTALL_DIR="/opt/krajcara-admin"
SERVICE_NAME="krajcara-admin"
NODE_VERSION="20"
APP_PORT="3000"
APP_VERSION="1.0.0"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
prompt()  { echo -e "${CYAN}[?]${NC} $1"; }

# ─── Root check ───────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash install.sh <GITHUB_TOKEN>"

# ─── Token ────────────────────────────────────────────────────────────────────
GITHUB_TOKEN="${1:-}"
if [ -z "$GITHUB_TOKEN" ]; then
  for git_cfg in "$(pwd)/.git/config" "$INSTALL_DIR/.git/config"; do
    if [ -f "$git_cfg" ]; then
      EXTRACTED=$(grep -oP '(?<=https://)[^:]+:[^@]+(?=@)' "$git_cfg" 2>/dev/null | head -1 | cut -d: -f2 || true)
      if [ -n "$EXTRACTED" ]; then GITHUB_TOKEN="$EXTRACTED"; break; fi
    fi
  done
fi
[ -z "$GITHUB_TOKEN" ] && error "GitHub token required.\nUsage: sudo bash install.sh <GITHUB_TOKEN>"

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

# ─── Verify token ─────────────────────────────────────────────────────────────
info "Verifying GitHub token..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}" \
  --max-time 15 2>/dev/null || echo "000")

case "$HTTP_CODE" in
  200) success "GitHub token valid — repository accessible" ;;
  401) error "Invalid GitHub token (HTTP 401)." ;;
  404) error "Repository not found (HTTP 404)." ;;
  000) error "Cannot reach GitHub. Check internet connection." ;;
  *)   warn "GitHub returned HTTP $HTTP_CODE — continuing..." ;;
esac

# ─── Ask about Nginx ──────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
prompt "Do you want to install Nginx as a reverse proxy with HTTPS? (y/n)"
prompt "  - Yes: App accessible via https://YOUR_IP (port 443, self-signed cert)"
prompt "  - No:  App accessible via http://YOUR_IP:3000 (default)"
echo ""
read -r -p "    Install Nginx? [y/N]: " INSTALL_NGINX
INSTALL_NGINX="${INSTALL_NGINX,,}"  # lowercase

NGINX_DOMAIN=""
if [[ "$INSTALL_NGINX" == "y" || "$INSTALL_NGINX" == "yes" ]]; then
  echo ""
  prompt "Enter your domain or IP address for the SSL certificate:"
  prompt "  Examples: admin.comdata.rs  or  10.1.0.50  or  leave blank for auto-detect"
  read -r -p "    Domain/IP [auto]: " NGINX_DOMAIN
  NGINX_DOMAIN="${NGINX_DOMAIN:-$(hostname -I | awk '{print $1}')}"
  info "Will configure Nginx for: ${NGINX_DOMAIN}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── Detect OS ────────────────────────────────────────────────────────────────
info "Detecting OS..."
[ -f /etc/os-release ] || error "Cannot detect OS"
. /etc/os-release
OS=$ID; OS_VER=$VERSION_ID
info "OS: $OS $OS_VER"
[[ "$OS" == "ubuntu" || "$OS" == "debian" ]] || error "Only Ubuntu/Debian supported"

# ─── Install system packages ──────────────────────────────────────────────────
info "Installing system packages..."
PKGS="curl git ca-certificates gnupg openssl nmap"
[[ "$INSTALL_NGINX" == "y" || "$INSTALL_NGINX" == "yes" ]] && PKGS="$PKGS nginx"
apt-get update -qq
apt-get install -y $PKGS 2>&1 | tail -3
success "System packages ready"

# ─── Install Node.js ──────────────────────────────────────────────────────────
install_node() {
  if command -v node &>/dev/null; then
    CURRENT_NODE=$(node --version | cut -d. -f1 | tr -d 'v')
    if [[ "$CURRENT_NODE" -ge "$NODE_VERSION" ]]; then
      success "Node.js $(node --version) already installed"; return
    fi
  fi
  info "Installing Node.js $NODE_VERSION LTS..."
  export NVM_DIR="/root/.nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>&1 | tail -3
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install "$NODE_VERSION" --lts 2>&1 | tail -3
  nvm use "$NODE_VERSION"; nvm alias default "$NODE_VERSION"
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
  "$INSTALL_DIR" 2>&1 || error "git clone failed."
git -C "$INSTALL_DIR" remote set-url origin \
  "https://${GITHUB_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git"
chmod 600 "$INSTALL_DIR/.git/config"
success "Repository cloned to $INSTALL_DIR"

# ─── Generate credentials and .env ────────────────────────────────────────────
info "Generating credentials..."
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
cd "$INSTALL_DIR/server"; unset NODE_ENV
npm install 2>&1 | tail -8

info "Installing client dependencies..."
cd "$INSTALL_DIR/client"
npm install --silent 2>&1 | tail -3

info "Building frontend..."
npm run build 2>&1 | tail -5
[ -d "$INSTALL_DIR/client/dist" ] || error "Frontend build failed"
success "Application built"

# ─── Install systemd service ──────────────────────────────────────────────────
info "Installing systemd service..."
NODE_BIN=$(find /root/.nvm/versions -name "node" -type f 2>/dev/null | sort -V | tail -1 || true)
[ -z "$NODE_BIN" ] && NODE_BIN=$(which node 2>/dev/null || true)
[ -z "$NODE_BIN" ] && error "Cannot find node binary"

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
  warn "Service not active. Checking logs..."
  journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>/dev/null || true
fi

# ─── Nginx + HTTPS setup (optional) ──────────────────────────────────────────
NGINX_INSTALLED=false
if [[ "$INSTALL_NGINX" == "y" || "$INSTALL_NGINX" == "yes" ]]; then
  info "Configuring Nginx with self-signed SSL..."

  SSL_DIR="/etc/nginx/ssl/krajcara-admin"
  mkdir -p "$SSL_DIR"

  # Generate self-signed certificate (10 years)
  openssl req -x509 -nodes -days 3650 \
    -newkey rsa:2048 \
    -keyout "$SSL_DIR/server.key" \
    -out    "$SSL_DIR/server.crt" \
    -subj   "/C=RS/ST=Serbia/L=Belgrade/O=Krajcara/CN=${NGINX_DOMAIN}" \
    -addext "subjectAltName=IP:${NGINX_DOMAIN},DNS:${NGINX_DOMAIN}" \
    2>/dev/null
  chmod 600 "$SSL_DIR/server.key"
  success "Self-signed SSL certificate generated for ${NGINX_DOMAIN}"

  # Nginx config
  cat > /etc/nginx/sites-available/krajcara-admin << EOF
# Krajcara Admin — Nginx reverse proxy
server {
    listen 80;
    server_name ${NGINX_DOMAIN} _;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${NGINX_DOMAIN} _;

    ssl_certificate     ${SSL_DIR}/server.crt;
    ssl_certificate_key ${SSL_DIR}/server.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;

    client_max_body_size 100M;

    # Proxy to Node.js app
    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # WebSocket terminal
    location /ws/ {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;
    }
}
EOF

  # Enable site
  ln -sf /etc/nginx/sites-available/krajcara-admin /etc/nginx/sites-enabled/krajcara-admin
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

  # Test and reload Nginx
  nginx -t 2>/dev/null && systemctl restart nginx && NGINX_INSTALLED=true
  if $NGINX_INSTALLED; then
    success "Nginx configured and started"
    systemctl enable nginx
  else
    warn "Nginx config test failed — check /etc/nginx/sites-available/krajcara-admin"
  fi
fi

# ─── Health check ─────────────────────────────────────────────────────────────
info "Waiting for application to start..."
for i in $(seq 1 12); do
  if curl -sf "http://localhost:${APP_PORT}/api/health" > /dev/null 2>&1; then
    success "Application is up and running"; break
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
if $NGINX_INSTALLED; then
  echo -e "  App (HTTPS): ${BLUE}https://${NGINX_DOMAIN}${NC}"
  echo -e "  App (HTTP):  ${BLUE}http://${SERVER_IP}:${APP_PORT}${NC} (direct)"
  echo -e "  Status:      ${BLUE}https://${NGINX_DOMAIN}/status${NC}"
  echo ""
  echo -e "  ${YELLOW}Note: Browser will show SSL warning (self-signed cert).${NC}"
  echo -e "  ${YELLOW}Click 'Advanced' → 'Proceed' to accept.${NC}"
  echo -e "  ${YELLOW}To use a trusted cert, replace:${NC}"
  echo -e "  ${YELLOW}  ${SSL_DIR}/server.crt${NC}"
  echo -e "  ${YELLOW}  ${SSL_DIR}/server.key${NC}"
else
  echo -e "  App:    ${BLUE}http://${SERVER_IP}:${APP_PORT}${NC}"
  echo -e "  Status: ${BLUE}http://${SERVER_IP}:${APP_PORT}/status${NC}"
fi
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
if $NGINX_INSTALLED; then
  echo "  SSL cert:  ${SSL_DIR}/"
  echo "  Nginx cfg: /etc/nginx/sites-available/krajcara-admin"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
