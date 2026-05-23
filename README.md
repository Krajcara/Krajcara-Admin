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
2. Install Node.js 20 LTS (via nvm) and system packages including `nmap`
3. Clone the repository to `/opt/krajcara-admin/`
4. Generate a random admin password and `.env` file (token saved for updates)
5. Install all server dependencies (including `net-snmp`, `xml2js`)
6. Install `fast-cli` globally for speed tests
6. Build the frontend
7. Install and start the systemd service

After installation, the app is available at `http://SERVER_IP:3000`.
Admin credentials are printed at the end — you will be asked to change the password on first login.

## Updating

```bash
sudo bash /opt/krajcara-admin/update.sh
```

Or from within the app: **Settings → System update → Check for updates → Install update**.

The updater:
1. Reads the GitHub token from `.env` — no token needed as argument
2. Checks GitHub for a newer release tag; if no releases exist yet, checks for new commits on `main`
3. If up to date — exits with a message, no changes made
4. If update available — pulls latest code, reinstalls dependencies, rebuilds frontend, restarts service
5. The browser page reloads automatically when the server comes back up

## Changelog

### Phase 3 — Network (update 2)
- **Net Speed** — built-in internet speed testing via fast.com (Netflix)
  - Tests run automatically every hour via cron, and on demand with "Run test" button
  - Download stats: min / avg / max in Mbps (configurable period: 7/14/30/90 days)
  - Upload stats: min / avg / max in Mbps
  - Ping stats: min / avg / max in ms
  - Ping area chart (last 40 tests)
  - Test history table with download, upload, ping, triggered by (auto/manual), status
  - Real-time status via Socket.io — running indicator while test is in progress
  - Requires: `npm install -g fast-cli` (done automatically by installer)

### Phase 7 — Network Management
- **IP Space** — VLAN and IP address management
  - VLANs: VLAN ID, name, subnet, gateway, DHCP range, purpose (production/management/dmz/guest/iot/storage), color, router link; displayed as colour-coded cards
  - IP Addresses: IP, hostname, MAC, VLAN assignment, purpose, last seen, ping on demand; search and VLAN filter
  - Import from Network Scanner — select a completed scan, pick hosts, assign to VLAN; uses INSERT OR UPDATE (no duplicates)
- **Network Scanner — detailed diff** — full rewrite of diff algorithm
  - New hosts (green), gone hosts (red), new open ports with service/version, closed ports, version changes (old → new in yellow)
  - Compares per host and per port using `product` and `version` fields from nmap results

### Phase 6 — Health & Notifications
- **Health check** — `/api/health` returns status of all services: database (response time), Proxmox (API ping), M365 (token test + expires_in), scheduler (active monitor count)
- **In-app notifications** — bell icon in header with real-time unread badge via Socket.io; dropdown with New / Earlier sections; mark as read per item, mark all, clear read
- **Notification triggers:**
  - Monitor down / recovered (immediate, triggered by monitor worker on status change)
  - Proxmox VM stopped / started (every 15 minutes via scheduler)
  - Router offline / back online (every 15 minutes via scheduler, uses ping)
  - DNS server offline / back online (every 15 minutes via scheduler, uses ping)
  - Entra ID client secret expiring ≤30 days or expired (every 15 minutes via scheduler)
- **Email notifications via M365** — configure in Settings → Notifications; requires `Mail.Send` permission on M365 App Registration; sender mailbox + recipient list; sends HTML email via Microsoft Graph `/sendMail`
- **Sidebar accordion navigation** — all groups collapsed by default; click to open/close; only one group open at a time; active route auto-opens its group; Dashboard always visible at top
- **Status Page link** — moved to header (shield icon), visible on all pages

### Phase 5 — Advanced
- **Microsoft 365** — Microsoft Graph API integration via Entra ID App Registration
  - Overview: total users, active users, licensed users, MFA enabled count
  - Users tab: list all users with MFA status, admin roles, licences; filter by Admins / No MFA / Disabled / Shared Mailboxes; search by name or email; view group memberships per user
  - Licences tab: all subscribed SKUs with total/used/available seats and usage bar
  - Service Health tab: real-time service status for all Microsoft 365 services with active incident details

  **Required API permissions** (Application type, Admin consent required):

  | Permission | Purpose |
  |---|---|
  | `User.Read.All` | List all users, email, account status |
  | `Directory.Read.All` | Admin roles per user, group memberships |
  | `Organization.Read.All` | Basic tenant information |
  | `Reports.Read.All` | Email activity, MFA statistics |
  | `ServiceHealth.Read.All` | Microsoft 365 service health status |
  | `UserAuthenticationMethod.Read.All` | MFA registration status per user |

  **Setup:** Entra ID → App registrations → your app → API permissions → Add a permission → Microsoft Graph → Application permissions → add all 6 → **Grant admin consent**
- **Backup & Restore** — superadmin only
  - Create manual backup (VACUUM INTO — clean copy without WAL)
  - Download current database as `.db` file
  - Restore from uploaded `.db` file — validates integrity, auto-creates pre-restore backup, restarts service
  - List of saved backups with download and delete per backup
  - Automatic daily backup at 03:00 — keeps last 7 auto-backups
  - Manual backups: keeps last 10

### Phase 4 — Infrastructure
- **Proxmox** — connect via API token; view nodes, VMs and LXC containers with CPU/RAM/disk usage bars; start/stop/reboot/shutdown actions with confirmation; storage overview per node; nodes, VMs and containers sorted alphabetically
- **Network Scanner** — three tabs in one page:
  - *Hosts* — manage scan targets: IP, subnet, hostname, range
  - *New Scan* — 6 nmap profiles (quick/full/service/stealth/os/custom args), real-time progress via Socket.io, live host results during scan
  - *Scan History* — paginated history, click any row to expand and see all hosts with open ports table (port, protocol, service, version), diff view comparing open ports to previous scan
- **Scan Automation** — three tabs in one page:
  - *Schedules* — cron-based automated scans with preset frequencies and enable/disable toggle
  - *Alert Rules* — trigger on new port / closed port / service change / host up/down / any change, email and webhook channels
  - *Alerts Log* — unread filter, acknowledge per alert

### Phase 3 — Network
- **Uptime Monitor** — HTTP, HTTPS, TCP, ICMP and DNS monitors; real-time status via WebSocket; latency chart per monitor (populates after 2+ checks); monitors sorted alphabetically; linked to public Status Page
- **Routers** — router inventory with brand (MikroTik, Cisco, FortiGate, Ubiquiti, Juniper, HP, Other), model, IP; SNMP v2c/v3 configuration; auto-ping on page load; expandable SNMP stats panel per router (uptime, CPU %, memory %, WAN interface traffic with RX/TX); configurable stats refresh interval (30s/1min/2min/5min)
- **DNS — Local** — primary and backup DNS server cards (Technitium, Pi-hole, AdGuard Home, BIND9, Windows DNS); online/offline status; query/blocked/client stats for Technitium and Pi-hole
- **DNS — Cloudflare** — API token configuration; automatic zone fetch on load; SPF/DKIM/DMARC/MX badges per zone; expandable record details; auto-refresh interval (1/5/15/30 min)
- **DNS — Manual check** — add domains to monitor, check SPF/DKIM/DMARC/MX/A records on demand or all at once

### Phase 2 — Inventory
- **Licences** — manual entry of software licences and subscriptions
  - Track vendor, licence name, seat count (used/total with usage bar), billing cycle (monthly/annual/perpetual)
  - Price per licence with currency (EUR, USD, RSD, GBP, CHF) and tax %
  - Automatic cost summary per currency (monthly and annual totals)
  - Free/bonus licence tracking with savings calculation
  - Access credentials per licence (URL, username, password, MFA flag)
  - Expiry tracking with visual warnings; Renew button extends by one billing cycle
  - Sort by name, vendor, expiry, cost
- **Entra ID Apps** — Azure app registration tracking
  - Application name and Client ID
  - Client secret storage (masked, reveal on demand)
  - Secret expiry countdown (green/yellow/red); warning banner and tab badge when expiring

### Phase 1 — Foundation
- **Login** — username/password with JWT tokens, rate limited
- **Two-factor authentication (TOTP)** — Google Authenticator / Authy compatible, 8 backup codes; configure under Profile
- **First login flow** — forced password change on first login
- **Dashboard** — overview with recent activity feed
- **Users** — create, edit, deactivate; roles: superadmin, admin, operator, viewer
- **Audit Log** — full log of all actions with filters (module, action, status, search) and CSV export
- **Settings** — app name, SMTP config with connection test, data retention, system update
- **Profile** — change password, enable/disable TOTP, manage personal API keys
- **API Keys** — personal tokens (`ka_...`) for programmatic access, max 10 per user; in Profile page
- **Status Page** — public page at `/status` (no login required), auto-refreshes every 30 seconds
- **Dark mode** — toggle in header, persisted
- **Update system** — check GitHub for updates, install and auto-reload from Settings page

## Configuration

All configuration is done through the **Settings** page and individual module config modals.
The `.env` file at `/opt/krajcara-admin/.env` is generated automatically.

Key `.env` variables:

| Variable | Description |
|----------|-------------|
| `APP_PORT` | Port the app listens on (default: 3000) |
| `APP_SECRET` | JWT signing secret — auto-generated |
| `DB_PATH` | SQLite database path |
| `GITHUB_TOKEN` | Token for private repo access (used by updater) |
| `ADMIN_PASSWORD` | Initial admin password (used only on first run) |

## Roles

| Role | Permissions |
|------|-------------|
| `superadmin` | Full access, can delete users and all data |
| `admin` | Manage users, settings, all modules |
| `operator` | Run scans, manage monitors, read access to modules |
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
│   │   ├── hooks/       useSocket.js
│   │   ├── pages/       Page components
│   │   ├── store/       Zustand state (auth, theme)
│   │   └── lib/         API client, utilities
│   └── public/          favicon.svg
├── server/              Express.js backend
│   └── src/
│       ├── db/          SQLite schema and initialization
│       ├── lib/         SNMP libs (MikroTik, Cisco, FortiGate, generic)
│       ├── middleware/  Auth (JWT) and audit logging
│       ├── routes/      API route handlers
│       └── services/    Monitor worker, nmap service, scan service
├── install.sh           First-time installer (pass token as argument)
├── update.sh            Updater — GitHub pull + rebuild + restart
├── krajcara-admin.service  systemd service file
└── .env.example         Environment variables template
```

## Roadmap

- ✅ **Phase 1** — Foundation: Auth, TOTP, Dashboard, Status Page, Users, Audit Log, Settings, API Keys, Update system
- ✅ **Phase 2** — Inventory: Licences (manual + Entra ID Apps)
- ✅ **Phase 3** — Network: Uptime Monitor, Routers (SNMP), DNS (Local + Cloudflare + Manual), Net Speed (MySpeed)
- ✅ **Phase 4** — Infrastructure: Proxmox, Network Scanner, Scan Automation
- ✅ **Phase 5** — Advanced: Microsoft 365, Backup & Restore
- ✅ **Phase 6** — Health & Notifications
- ✅ **Phase 7** — Network Management

## Dashboard

The dashboard provides a real-time overview of all systems:

- **Stat cards** — Uptime Monitor (up/down/degraded counts with colour), Proxmox (running VMs out of total), Licences count, Entra ID Apps count (red if secrets expiring within 30 days)
- **Proxmox nodes** — per-node CPU/RAM/Disk usage bars, uptime, and a compact grid of all VMs and LXC containers with running/stopped status
- **Last speed test** — Download / Upload / Ping from the most recent test
- **Uptime Monitor list** — all monitors sorted by status (down first), with latency and status badge; updates in real-time via Socket.io

Auto-refreshes every 60 seconds.

## Status Page

Public page at `/status` — no login required, dark theme, auto-refresh every 30 seconds.

Three tabs:

**Uptime Monitor** — all enabled monitors with sparkline latency chart, status badge (up/down/degraded), latency and type. Overall status banner at the top (green/red/yellow).

**Network** — two sections:
- Routers: online/offline indicator with ping latency for each configured router
- Internet Speed: Download / Upload / Ping cards with Min / Avg / Max values + ping history chart

**Proxmox** — node card with name, VM count, running count, CPU / RAM / Disk usage bars, uptime, and storage breakdown (name, type, usage bar, GB values)

## License

MIT — see [LICENSE](LICENSE)
