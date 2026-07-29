# Krajcara Admin

Self-hosted IT Infrastructure Management application. Runs on Ubuntu Linux, port 3000.

## Installation

```bash
sudo bash install.sh <GITHUB_TOKEN>
```

The installer will:
1. Verify the token against GitHub
2. Ask whether to install **Nginx as a reverse proxy with HTTPS** (optional)
3. Install Node.js 20 LTS (via nvm), `nmap`, and system packages
4. Clone the repository to `/opt/krajcara-admin/`
5. Install all server dependencies
6. Build the frontend
7. Install and start the systemd service

After installation: `http://SERVER_IP:3000` — admin credentials printed at the end.

### Nginx / HTTPS (optional)

During installation you will be asked:

```
Install Nginx? [y/N]:
```

If you choose **Y**, the installer will:
- Ask for your domain or IP address
- Install Nginx
- Generate a self-signed SSL certificate (10 years)
- Configure Nginx as a reverse proxy with HTTP → HTTPS redirect
- WebSocket support for the web terminal included

App will be accessible at `https://YOUR_DOMAIN` (port 443).

> **Note:** Browser will show an SSL warning for self-signed certificates.  
> Click Advanced → Proceed to accept.  
> To use a trusted certificate, replace the files at `/etc/nginx/ssl/krajcara-admin/`.

## Updating

```bash
sudo bash /opt/krajcara-admin/update.sh
```

Or from within the app: **Settings → System update → Check for updates → Install update**.  
The browser reloads automatically when the server comes back up.

## Service management

```bash
sudo systemctl status krajcara-admin
sudo systemctl restart krajcara-admin
sudo journalctl -u krajcara-admin -f
```

## Configuration

All configuration is done through the **Settings** page and individual module config modals.

Key `.env` variables:

| Variable | Description |
|---|---|
| `APP_PORT` | Port (default: 3000) |
| `APP_SECRET` | JWT signing secret — auto-generated |
| `DB_PATH` | SQLite database path |
| `GITHUB_TOKEN` | Token for private repo access (used by updater) |

## Roles

| Role | Permissions |
|---|---|
| `superadmin` | Full access, can delete users and all data |
| `admin` | Manage users, settings, all modules |
| `operator` | Run scans, manage monitors, read access |
| `viewer` | Read-only access |

## Data

SQLite database: `/opt/krajcara-admin/data/krajcara-admin.db`

---

## Modules

### Dashboard
Stat cards (monitors up/down, Proxmox nodes), VM grid, DNS status, last speed test, uptime monitor list, notifications panel.

### TV Monitor
Public fullscreen dashboard at `/tv` — no login required, dark theme, auto-refresh every 30 seconds.
Accessible via the monitor icon in the header.

Proxmox-only view. Three display modes selectable from **Settings → TV Monitor**:

- **Cards** (default) — node summary bars + VM/LXC grid, 6 per row, with CPU/RAM/Disk bars, OS, IP
- **Table** — compact table with all VMs: Node / Name / Type / Status / CPU / RAM / Disk / OS / IP
- **NOC / Wallboard** — card background colour changes by status: green = OK, yellow ≥70%, red ≥90%, gray = stopped

Setting is stored in the database (`tv_proxmox_view`) and read by the TV page without login.

### Status Page
Public page at `/status` — no login required, dark theme, auto-refresh every 30 seconds.

Single page, no tabs. Live clock in the top-right corner. Sections shown only if the relevant module is configured:

- **Banner** — green "All systems operational", red with down count, or yellow for degraded
- **Summary boxes** — Operational / Degraded / Down / Total count across all services
- **Uptime monitors** — single summary row: `X / Y online`, all-up or down count badge
- **Routers** — one row per router with ping status
- **DNS servers** — one row per local DNS server (from `dns_local` table), Online/Offline badge
- **External domains** — summary: `X / Y fully configured`, checks SPF / DKIM / DMARC / MX per domain
- **Internet speed** — last measured Download / Upload / Ping with timestamp
- **Proxmox** — one row per node with CPU% and RAM% bars, plus VMs/LXC running/stopped/total summary

### Inventory
- **Licences** — vendor, seats (used/total), billing cycle, price/currency/tax, cost summary by currency, credentials (URL/user/pass/MFA), expiry warnings, Renew modal with suggested date
- **Entra ID Apps** — Client ID, secret (masked, reveal on demand), expiry countdown, warning badge

### Network
- **Uptime Monitor** — HTTP/HTTPS/TCP/ICMP/DNS monitors; real-time via Socket.io; sparkline charts
- **Routers** — inventory with SNMP v2c/v3; auto-ping; expandable stats panel (uptime, CPU%, RAM%, WAN traffic, interface list); refresh interval selector
- **DNS** — Local servers (Technitium, Pi-hole, AdGuard, BIND9, Windows DNS), Cloudflare zones (SPF/DKIM/DMARC/MX), Manual domain check
- **Net Speed** — built-in speed testing via Cloudflare; Download/Upload/Ping with Min/Avg/Max; hourly auto-test

### Infrastructure
- **Proxmox** — API token auth; nodes, VMs and LXC with CPU/RAM/disk; start/stop/reboot/shutdown; disk usage via guest agent fsinfo (Pulse-style deduplication); storage overview
- **Network Scanner** — Hosts CRUD, 6 nmap profiles + custom, real-time progress, detailed diff (new hosts, gone hosts, new/closed ports, version changes)
- **Scan Automation** — Cron schedules, alert rules (triggers + email/webhook), alerts log
- **IP Space** — VLANs (colour-coded cards) + IP addresses; import from Network Scanner
- **Patch Management** — software update tracking via Proxmox Guest Agent; Linux (apt/dnf/apk) and Windows (PSWindowsUpdate); OS detection via Proxmox config `ostype`; daily auto-check at 04:00
- **Servers & Scripts** — SSH server management with web terminal and remote script execution (see below)
- **Metrics History** — CPU/RAM/disk trends per VM and Proxmox node (see below)
- **Windows Servers** — WinRM management for Windows servers with PowerShell script execution (see below)

### Servers & Scripts

Manage SSH servers and execute scripts remotely — all from the browser.

**Servers tab:**
- Add SSH servers (IP, port, user, password or SSH key, OS type, group)
- Test connection — verifies SSH access on demand
- Group servers (e.g. Web servers, Database, Backup)
- Open web terminal directly from server card

**Scripts tab:**
- Create Bash (Linux) or PowerShell (Windows) scripts
- Run script on one or multiple servers simultaneously — parallel execution with live output
- Execution history with per-server results and exit codes

**Web terminal:**
- Opens in a new browser window at `/terminal/:serverId`
- Full interactive SSH session via WebSocket + xterm.js
- GitHub dark theme, 5000 line scrollback, automatic resize
- Keepalive ping every 30 seconds

**SSH setup requirements:**

For non-interactive script execution (apt, systemctl etc.), the SSH user needs passwordless sudo:
```bash
echo "YOUR_SSH_USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/krajcara-admin
```

Or connect directly as `root`.

**Required npm packages (installed automatically on update):**
```
ssh2, ws (server) | @xterm/xterm, @xterm/addon-fit, @xterm/addon-web-links (client)
```

### Metrics History

Historical CPU, RAM and disk metrics for all running Proxmox VMs and nodes.

- Collected every **5 minutes** automatically by the scheduler
- Retained for **7 days**, then auto-deleted
- **VMs view** — list of all VMs grouped by node; click any VM to expand a line chart showing CPU/RAM/Disk trends
  - Period filter: 1h / 6h / 24h / 7d / 30d
  - Summary stats: avg CPU, avg RAM, peak CPU for period
  - Disk used/max GB displayed below chart
- **Nodes view** — one chart per Proxmox node with CPU and RAM trends
- **New DB tables:** `vm_metrics`, `node_metrics`
- **New route:** `/api/metrics`

### Windows Servers (WinRM)

Manage Windows servers via WinRM (Windows Remote Management) — no agent required.

**Servers tab:**
- Add Windows servers (IP, WinRM port, user, password, HTTP or HTTPS)
- Test connection — verifies WinRM access and returns hostname + response time
- Live metrics — dohvata CPU%, RAM%, Disk% per drive, uptime, process count directly via PowerShell
- Group servers by function (e.g. Domain Controllers, File Servers)

**Scripts tab:**
- Create PowerShell scripts
- Run on one or multiple Windows servers simultaneously — parallel execution
- Execution history with per-server output and exit codes

**WinRM setup — run once on each Windows server as Administrator:**
```powershell
Enable-PSRemoting -Force
Set-Item WSMan:\localhost\Service\Auth\Basic $true
Set-Item WSMan:\localhost\Service\AllowUnencrypted $true
```

**Implementation:** pure SOAP/HTTP, no external WinRM libraries — ported from Python (server-manager project).
Supports Basic auth over HTTP (suitable for internal VPN/intranet networks only).

**New DB tables:** `winrm_servers`, `winrm_scripts`, `winrm_executions`, `winrm_metrics`
**New route:** `/api/winrm`

### Advanced
- **Microsoft 365** — Microsoft Graph API integration
  - Overview, Users (MFA/roles/groups), Licences, Storage, Mail Flow (monthly trend + by domain), Service Health
  - **Required API permissions** (Application, Admin consent):

  | Permission | Purpose |
  |---|---|
  | `User.Read.All` | List all users |
  | `Directory.Read.All` | Admin roles, group memberships |
  | `Organization.Read.All` | Tenant information |
  | `Reports.Read.All` | MFA statistics, storage, mail flow |
  | `ServiceHealth.Read.All` | Service health status |
  | `UserAuthenticationMethod.Read.All` | MFA registration per user |
  | `Mail.Send` | Email notifications (optional) |

- **Backup** — superadmin only; full backup as ZIP containing database + encrypted `.env`; restore from ZIP or legacy `.db` file; automatic pre-restore backup; daily auto-backup at 03:00

**Backup workflow for server migration:**
1. Download a ZIP backup with encrypted `.env` (enter a password)
2. On new server: run `install.sh`, then Backup → Restore → select ZIP → enter password
3. Server restarts automatically with all data and configuration restored

### Admin
- **Users** — create/edit/deactivate; roles assignment
- **Audit Log** — full action log with filters and CSV export
- **Notification Log** — full notification history (including archived); filters; purge archived
- **Reports** — infrastructure overview (online) + PDF export
- **Settings** — app name, SMTP/M365 email, per-module email controls, data retention, system update

### Account
- **Profile** — change password, TOTP (Google Authenticator), personal API keys, **active sessions**
- **Two-factor authentication** — TOTP compatible, 8 backup codes
- **Active sessions** — list of all active login sessions with device type, IP address and last seen timestamp; terminate any session individually or sign out all other devices at once

---

## Notifications

### Triggers

| Module | Event | Frequency |
|---|---|---|
| Monitors | Down / recovered | Immediate |
| Proxmox | VM stopped / started | Every 15 min |
| Routers | Offline / back online | Every 15 min |
| DNS | Offline / back online | Every 15 min |
| Proxmox | VM possibly frozen (CPU ≥ 80% + dark console) | Every 3 min |
| Licences | Expiring / expired | Daily at 03:00 |
| Entra ID | Secret expiring / expired | Daily at 03:00 |
| Monitors | SSL certificate expiring (≤30 days) | Daily at 02:00 |
| Monitors | SSL certificate expiring (≤7 days) | Daily at 02:00 |
| Monitors | SSL certificate expired | Daily at 02:00 |

### VM Health Monitoring (Frozen VM Detection)

Every 3 minutes the scheduler checks all running QEMU VMs:
1. If CPU ≥ 80% → takes a console screenshot via Proxmox API
2. Analyses the screenshot — if ≥ 95% black pixels = dark console
3. CPU high + dark console → starts tracking
4. After **5 minutes** → in-app warning notification
5. After **15 minutes** → error notification + email
6. When VM recovers → success notification, tracking reset

Requires `VM.Console` permission on the Proxmox token (Administrator role covers this).

### Per-module email control

Settings → Notifications allows enabling/disabling email per module:
- Monitors, Proxmox, Routers, DNS — **enabled by default**
- Licences, Entra ID — **disabled by default** (daily check, in-app only unless enabled)

Email sent via M365 (Microsoft Graph) or SMTP fallback.

---

## Scheduler

| Time | Job |
|---|---|
| Every 3 min  | VM health check (frozen VM detection) |
| Every 5 min  | Collect VM/node metrics (CPU/RAM/disk) |
| Every 15 min | Notification checks (monitors/routers/DNS/Proxmox) |
| Every hour   | Net speed test |
| Daily 02:00  | SSL certificate expiry check for all HTTPS monitors |
| Daily 03:00  | Cleanup (tokens, audit log retention, auto-backup) |
| Daily 03:00  | Licence + Entra ID expiry notifications |
| Daily 04:00  | Patch Management check |

> DNS domain checks (SPF/DKIM/DMARC/MX) run on-demand when `/status` page loads — not on a schedule.

---

## Project structure

```
krajcara-admin/
├── client/              React + Vite frontend
│   └── src/
│       ├── components/  UI.jsx, Layout.jsx, NotificationBell.jsx
│       ├── hooks/       useSocket.js
│       ├── pages/       Page components
│       ├── store/       Zustand state (auth, theme)
│       └── lib/         API client, utilities
├── server/              Express.js backend
│   └── src/
│       ├── db/          SQLite schema
│       ├── lib/         SNMP libs (MikroTik, Cisco, FortiGate, generic)
│       ├── middleware/  Auth (JWT), audit logging
│       ├── routes/      API handlers
│       └── services/    Monitor worker, nmap, scan, notification, patch,
│                        terminal, script runner, VM health, metrics,
│                        WinRM, SSL checker, encryption services
├── install.sh           First-time installer
├── update.sh            Updater
└── krajcara-admin.service  systemd service
```

---

## Changelog

### Phase 18 — Faza B: Nginx / HTTPS
- `install.sh` updated — interactive prompt to install Nginx as reverse proxy
- Self-signed SSL certificate generated automatically (10 years, RSA 2048)
- Nginx config: HTTP → HTTPS redirect, WebSocket support for terminal, security headers
- SSL cert path: `/etc/nginx/ssl/krajcara-admin/` (replaceable with trusted cert)

### Phase 17 — Faza G: SSL monitoring, Dashboard widgets, PWA
- **SSL certificate monitoring** — daily check of all HTTPS monitors; warning ≤30 days, error ≤7 days
- **Dashboard widgets** — Expiring licences widget + SSL certificates widget (auto-shown when relevant)
- **PWA** — `manifest.json`, service worker (`sw.js`), installable on desktop and mobile
- New service: `sslService.js`; new DB columns: `ssl_days`, `ssl_expiry`, `ssl_error` on `monitors`

### Phase 16 — Faza D: Session management
- New `sessions` DB table — tracks active login sessions per user
- Sessions created on login, deleted on logout, last_seen updated on every request
- **Profile → Active sessions** — device type, IP, last seen, terminate individual or all other sessions
- Expired sessions cleaned up hourly

### Phase 15 — Faza A: Encryption of sensitive fields
- New `encryptionService.js` — AES-256-GCM, key derived from `APP_SECRET`
- Auto-migration on startup encrypts all existing plain-text values
- Encrypted fields: SSH passwords/keys, WinRM passwords, licence passwords, Entra client secrets, SNMP passwords, DNS API keys, Proxmox/Cloudflare/M365/SMTP tokens in settings
- Format in DB: `enc:v1:<base64>` — backward compatible with plain-text values

### Phase 14 — Faza C: Backup v2
- Backup now downloads a **ZIP** file containing `krajcara-admin.db` + `env.enc` (AES-256-GCM encrypted `.env`)
- Restore supports ZIP (with optional `.env` decryption) and legacy `.db` files
- Pre-restore auto-backup always created before any restore
- Server auto-restarts after restore (exit code 1 triggers systemd restart)
- Download uses `fetch` with JWT auth token (fixes "Needs authorization" error)

### Phase 13 — Status Page redesign
- Status page completely rewritten — single page, no tabs
- Live clock (top-right), overall banner, 4 summary stat boxes
- Sections: Uptime monitors summary, Routers, DNS servers, External domains (SPF/DKIM/DMARC/MX check), Internet speed (last test), Proxmox nodes with CPU/RAM bars
- New public endpoints: `/api/dns/servers/public` (pings `dns_local`), `/api/dns/domains/public` (SPF/DKIM/DMARC/MX check)
- Fixed duplicate DNS section bug

### Phase 12 — TV Monitor redesign
- TV page completely rewritten — Proxmox only, no tabs
- Three view modes switchable from Settings → TV Monitor: Cards (default), Table, NOC/Wallboard
- Setting stored as `tv_proxmox_view` in settings table, read via public `/api/settings/app` endpoint
- Wallboard: card background colour reflects VM health (green/yellow/red/gray)
- Fixed disk display for QEMU VMs in TV endpoint (uses `agent/get-fsinfo`, skips virtual filesystems)
- `/api/settings/app` now also returns `tv_proxmox_view` (registered before `requireAuth` in `index.js`)

### Phase 11 — Windows Servers / WinRM
- **Windows Servers** module added to Infrastructure group
- WinRM service — pure Node.js SOAP/HTTP implementation, no external WinRM libraries
- Live metrics via PowerShell: CPU%, RAM%, per-drive disk%, uptime, process count
- PowerShell script management — save, run on multiple servers in parallel, execution history
- Test connection — verifies WinRM access, returns hostname and response time
- New backend service: `winrmService.js`
- New route: `/api/winrm`
- New DB tables: `winrm_servers`, `winrm_scripts`, `winrm_executions`, `winrm_metrics`

### Phase 10 — Metrics History
- **Metrics History** module added to Infrastructure group (below Proxmox)
- Automatic collection every 5 minutes for all running VMs and Proxmox nodes
- 7-day retention with automatic cleanup
- VMs view: expandable line charts per VM — CPU/RAM/Disk trends, summary stats (avg/peak)
- Nodes view: CPU and RAM trend charts per node
- Period filter: 1h / 6h / 24h / 7d / 30d
- New backend service: `metricsService.js`
- New route: `/api/metrics`
- New DB tables: `vm_metrics`, `node_metrics`

### Phase 9 — Servers & Scripts
- **Servers & Scripts** module added to Infrastructure group
- SSH server management — add servers with password or key auth, test connection, group by name
- **Web terminal** — full interactive SSH in browser via xterm.js + WebSocket (`/terminal/:serverId`)
- **Script runner** — save Bash/PowerShell scripts, run on multiple servers in parallel, live output, execution history
- New backend services: `terminalService.js`, `scriptRunner.js`
- New routes: `/api/servers`, `/api/terminal`, `/ws/terminal` (WebSocket)
- New DB tables: `ssh_servers`, `ssh_scripts`, `script_executions`
- New npm dependencies: `ssh2`, `ws` (server); `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links` (client)

### Phase 8 — Patch Management
- Patch Management — software update tracking via Proxmox Guest Agent
- Three groups: Linux VMs (apt/dnf/apk), Windows VMs (PSWindowsUpdate), LXC (listed only)
- OS detection via Proxmox config `ostype` field
- Deleted VMs automatically removed from patch data on next check
- Daily auto-check at 04:00

### Phase 7 — Network Management
- IP Space — VLANs and IP addresses management; import from Network Scanner
- Network Scanner diff rewrite — new/gone hosts, new/closed ports, version changes

### Phase 6 — Health & Notifications
- In-app notifications with real-time bell icon via Socket.io
- Email notifications via M365 or SMTP fallback
- Per-module email control in Settings
- Notification Log page (Admin section)
- VM health monitoring — frozen VM detection via Proxmox console screenshot analysis
- Sidebar accordion navigation

### Phase 5 — Advanced
- Microsoft 365 integration (Graph API) — Users, Licences, Storage, Mail Flow, Service Health
- Backup & Restore (superadmin only) — manual + automatic daily

### Phase 4 — Infrastructure
- Proxmox — VMs, LXC, storage; start/stop/reboot/shutdown; disk usage via guest agent
- Network Scanner — nmap profiles, real-time progress, diff
- Scan Automation — cron schedules, alert rules

### Phase 3 — Network
- Uptime Monitor — HTTP/HTTPS/TCP/ICMP/DNS; Socket.io; sparkline charts
- Routers — SNMP v2c/v3; traffic counters
- DNS — local servers, Cloudflare zones, manual domain check
- Net Speed — Cloudflare speed test; hourly auto-test

### Phase 2 — Inventory
- Licences — full lifecycle management with cost tracking
- Entra ID Apps — secret expiry monitoring

### Phase 1 — Foundation
- JWT authentication, TOTP 2FA, first login flow
- Dashboard, Users, Audit Log, Settings, Profile, API Keys
- Dark mode, update system

---

## Roadmap

- ✅ **Phase 1** — Foundation
- ✅ **Phase 2** — Inventory
- ✅ **Phase 3** — Network
- ✅ **Phase 4** — Infrastructure
- ✅ **Phase 5** — Advanced (Microsoft 365, Backup)
- ✅ **Phase 6** — Health & Notifications
- ✅ **Phase 7** — Network Management
- ✅ **Phase 8** — Patch Management
- ✅ **Phase 9**  — Servers & Scripts (web terminal, script runner)
- ✅ **Phase 10** — Metrics history (CPU/RAM/disk trends per VM and node)
- ✅ **Phase 11** — Windows Servers / WinRM (PowerShell, live metrics, script runner)
- ✅ **Phase 12** — TV Monitor redesign (Proxmox only, 3 view modes, Settings-controlled)
- ✅ **Phase 13** — Status Page redesign (single page, clock, DNS/domain checks, speed)
- ✅ **Phase 14** — Backup v2 (ZIP + encrypted .env, pre-restore backup, auto-restart)
- ✅ **Phase 15** — Encryption of sensitive fields (AES-256-GCM, auto-migration)
- ✅ **Phase 16** — Session management (active sessions, terminate, sign out all)
- ✅ **Phase 17** — SSL monitoring, Dashboard widgets, PWA
- ✅ **Phase 18** — Nginx / HTTPS optional install

## License

MIT — see [LICENSE](LICENSE)
