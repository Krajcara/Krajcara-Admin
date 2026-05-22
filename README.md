# Krajcara Admin

IT Infrastructure Management application. Self-hosted, runs on Ubuntu Linux on port 3000.

## Installation

The installer requires a GitHub Personal Access Token with `repo` scope to clone the private repository. Pass it as an argument — no prompts, fully automated.

```bash
sudo bash install.sh <GITHUB_TOKEN>
```

Example:
```bash
sudo bash install.sh ghp_xxxxxxxxxxxxxxxxxxxx
```

Or clone first, then run:
```bash
git clone https://TOKEN@github.com/krajcara/Krajcara-Admin.git
cd Krajcara-Admin
sudo bash install.sh TOKEN
```

The installer will:
1. Verify the token against GitHub
2. Install Node.js 20 LTS (via nvm)
3. Clone the repository to `/opt/krajcara-admin/`
4. Generate a random admin password and `.env` file (token saved for updates)
5. Build the frontend
6. Install and start the systemd service

After installation, the app is available at `http://SERVER_IP:3000`.  
Admin credentials are printed at the end — you will be asked to change the password on first login.

## Updating

```bash
sudo bash /opt/krajcara-admin/update.sh
```

The updater:
1. Reads the GitHub token from `.env` — no token needed as argument
2. Checks GitHub for a newer release tag; if no releases exist yet, checks for new commits on `main`
3. If up to date — exits with a message, no changes made
4. If update available — pulls latest code, reinstalls dependencies, rebuilds frontend, restarts service

## Changelog

### Phase 3 — Network
- **Uptime Monitor** — HTTP, HTTPS, TCP, ICMP and DNS monitors with real-time status via WebSocket; latency sparkline chart per monitor; status badges (up/down/degraded); linked to public Status Page
- **Routers** — router inventory with brand (MikroTik, Cisco, FortiGate, Ubiquiti, Juniper, HP, Other), model, IP, SNMP v2c/v3 configuration; ping check per router
- **DNS — Local** — primary and backup DNS server cards (Technitium, Pi-hole, AdGuard Home, BIND9, Windows DNS, Other); online/offline status check; query/blocked/client stats for Technitium and Pi-hole
- **DNS — External** — domain list with SPF, DMARC, DKIM, MX and A record checks; check individual domain or all at once

### Phase 2 — Inventory
- **Licences** — manual entry of software licences and subscriptions
  - Track vendor, licence name, seat count, billing cycle (monthly/annual/perpetual)
  - Price per licence with currency (EUR, USD, RSD, GBP, CHF) and tax %
  - Automatic cost summary per currency (monthly and annual totals)
  - Free/bonus licence tracking with savings calculation
  - Access credentials per licence (URL, username, password, MFA flag)
  - Expiry tracking with visual warnings (expired / expiring within 30 days)
  - Renew button — extends expiry by one billing cycle
  - Sort by name, vendor, expiry, cost
- **Entra ID Apps** — Azure app registration tracking
  - Application name and Client ID
  - Client secret storage (masked by default, reveal on demand)
  - Secret expiry date with colour-coded countdown (green/yellow/red)
  - Warning banner and tab badge when secrets are expiring or expired
  - Assigned to (person/team) and project fields

### Phase 1 — Foundation
- **Login** — username/password authentication with JWT tokens
- **Two-factor authentication (TOTP)** — Google Authenticator / Authy compatible, with 8 backup codes
- **First login flow** — forced password change on first login
- **Dashboard** — overview with recent activity feed
- **Users** — create, edit, deactivate users; roles: superadmin, admin, operator, viewer
- **Audit Log** — full log of all actions (create/update/delete/login/logout) with filters and CSV export
- **Settings** — application name, SMTP email configuration with connection test, data retention days
- **Profile page** — change password, enable/disable TOTP, manage personal API keys
- **API Keys** — generate personal tokens (`ka_...`) for programmatic API access (max 10 per user)
- **Status Page** — public page at `/status` (no login required), auto-refreshes every 30 seconds
- **Dark mode** — toggle in header, persisted per browser
- **Update system** — `update.sh` checks GitHub for new commits/releases, pulls and rebuilds automatically
- **Systemd service** — auto-start on boot, restart on failure

## Configuration

All configuration is done through the **Settings** page inside the application.  
The `.env` file at `/opt/krajcara-admin/.env` is generated automatically.

Key `.env` variables:

| Variable | Description |
|----------|-------------|
| `APP_PORT` | Port the app listens on (default: 3000) |
| `APP_SECRET` | JWT signing secret — auto-generated |
| `DB_PATH` | SQLite database path |
| `GITHUB_TOKEN` | Token for private repo access (used by updater) |

## Roles

| Role | Permissions |
|------|-------------|
| `superadmin` | Full access, can delete users |
| `admin` | Manage users, settings, audit |
| `operator` | Access to operational modules (added in later phases) |
| `viewer` | Read-only access |

## Service management

```bash
sudo systemctl status krajcara-admin
sudo systemctl restart krajcara-admin
sudo journalctl -u krajcara-admin -f
```

## Data

SQLite database: `/opt/krajcara-admin/data/krajcara-admin.db`  
Back it up regularly — it contains all application data.

## Project structure

```
krajcara-admin/
├── client/              React + Vite frontend
│   ├── src/
│   │   ├── components/  Shared UI components (UI.jsx, Layout.jsx)
│   │   ├── pages/       Page components
│   │   ├── store/       Zustand state (auth, theme)
│   │   └── lib/         API client, utilities
│   └── public/          favicon.svg
├── server/              Express.js backend
│   └── src/
│       ├── db/          SQLite schema and initialization
│       ├── middleware/  Auth (JWT) and audit logging
│       └── routes/      API route handlers
├── install.sh           First-time installer (pass token as argument)
├── update.sh            Updater — GitHub pull + rebuild + restart
├── krajcara-admin.service  systemd service file
└── .env.example         Environment variables template
```

## Roadmap

- ✅ **Phase 1** — Foundation: Auth, TOTP, Dashboard, Status Page, Users, Audit Log, Settings, API Keys, Update system
- ✅ **Phase 2** — Inventory: Licences (manual + Entra ID Apps)
- ✅ **Phase 3** — Network: Uptime Monitor, Routers (SNMP), DNS (Local + External)
- **Phase 4** — Infrastructure: Proxmox, Network Scanner, Scan Automation
- **Phase 5** — Advanced: Microsoft 365, Backup & Restore, Reports

## License

MIT — see [LICENSE](LICENSE)
