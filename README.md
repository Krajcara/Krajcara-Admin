# Krajcara Admin

Self-hosted IT Infrastructure Management application. Runs on Ubuntu Linux, port 3000.

## Installation

```bash
sudo bash install.sh <GITHUB_TOKEN>
```

The installer will:
1. Verify the token against GitHub
2. Install Node.js 20 LTS (via nvm), `nmap`, and system packages
3. Clone the repository to `/opt/krajcara-admin/`
4. Install all server dependencies
5. Build the frontend
6. Install and start the systemd service

After installation: `http://SERVER_IP:3000` — admin credentials printed at the end.

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

**Two tabs:**
- **Overview** — Uptime Monitor status + Proxmox node cards + Network (routers/DNS) + Internet Speed + Alerts
- **Proxmox** — Node summary bar + VM grid (6 per row) with CPU/RAM/Disk bars, OS, IP address

### Status Page
Public page at `/status` — no login required, dark theme, auto-refresh every 30 seconds.

**Tabs:** Uptime Monitor (sparkline charts), Network (routers ping + speed stats), Proxmox (nodes with CPU/RAM/disk + storage), M365 Health (service status with active incidents)

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

- **Backup** — superadmin only; manual + automatic daily backup at 03:00; download DB; restore from file

### Admin
- **Users** — create/edit/deactivate; roles assignment
- **Audit Log** — full action log with filters and CSV export
- **Notification Log** — full notification history (including archived); filters; purge archived
- **Reports** — infrastructure overview (online) + PDF export
- **Settings** — app name, SMTP/M365 email, per-module email controls, data retention, system update

### Account
- **Profile** — change password, TOTP (Google Authenticator), personal API keys
- **Two-factor authentication** — TOTP compatible, 8 backup codes

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
| Daily 03:00  | Cleanup (tokens, audit log retention, auto-backup) |
| Daily 03:00  | Licence + Entra ID expiry notifications |
| Daily 04:00  | Patch Management check |

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
│                        WinRM services
├── install.sh           First-time installer
├── update.sh            Updater
└── krajcara-admin.service  systemd service
```

---

## Changelog

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

## License

MIT — see [LICENSE](LICENSE)
