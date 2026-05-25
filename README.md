# Krajcara Admin

IT Infrastructure Management application. Self-hosted, runs on Ubuntu Linux on port 3000.

## Installation

```bash
sudo bash install.sh <GITHUB_TOKEN>
```

The installer will:
1. Verify the token against GitHub
2. Install Node.js 20 LTS (via nvm), `nmap`, and system packages
3. Clone the repository to `/opt/krajcara-admin/`
4. Install all server dependencies (net-snmp, xml2js, csv-parse)
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

## Status Page

Public page at `/status` — no login required, dark theme, auto-refresh every 30 seconds.
Accessible via the shield icon in the header.

**Tabs:** Uptime Monitor (sparkline charts), Network (routers ping + speed stats), Proxmox (nodes with CPU/RAM/disk + storage), M365 Health (service status with active incidents)

---

## Changelog

### Phase 8 — Patch Management
- **Patch Management** — software update tracking via Proxmox Guest Agent
  - Checks all running VMs automatically at 04:00 daily; manual "Check all VMs" button
  - Real-time progress via Socket.io
  - **Three groups:** Linux VMs, Windows VMs, LXC Containers (listed only — no patch check)
  - **Linux (Debian/Ubuntu)** — `apt list --upgradable`
  - **Linux (RHEL/CentOS/Rocky)** — `dnf check-update`
  - **Linux (Alpine)** — `apk list --upgradable`
  - **Windows** — PowerShell `Get-WindowsUpdate` (requires PSWindowsUpdate module + QEMU Guest Agent)
  - OS detection uses Proxmox VM config `ostype` field first (reliable, no guest agent needed for Windows detection)
  - Deleted VMs are automatically removed from patch data on next check
  - VM cards: green (up to date), yellow (updates), orange (security updates), LXC shown in neutral grey
  - Click card to expand: package list with current → available version and severity badge
  - Summary counts exclude LXC containers
  - Filter: All / Updates / Security / OK / LXC

  **Windows VM setup (one time per VM):**
  ```powershell
  Install-Module -Name PSWindowsUpdate -Force -Scope AllUsers
  Set-ExecutionPolicy RemoteSigned -Force
  ```

  **Proxmox token permission required:** `VM.Monitor` or admin role on the token

### Phase 7 — Network Management
- **IP Space** — VLAN and IP address management
  - VLANs: VLAN ID, name, subnet, gateway, DHCP range, purpose, colour, router link — displayed as colour-coded cards
  - IP Addresses: IP, hostname, MAC, VLAN assignment, purpose, last seen, ping on demand; search and VLAN filter
  - Import from Network Scanner — select completed scan, pick hosts, assign to VLAN (INSERT OR UPDATE — no duplicates)
- **Network Scanner — detailed diff** — full rewrite of diff algorithm
  - New hosts (green), gone hosts (red), new open ports with service/version info, closed ports, version changes (old → new in yellow)

### Phase 6 — Health & Notifications
- **Health check** — `/api/health` returns status of all services: database, Proxmox, M365, scheduler
- **In-app notifications** — bell icon in header with real-time unread badge via Socket.io
  - Dropdown with New / Earlier sections; mark as read, mark all, clear read
- **Notification triggers:**
  - Monitor down / recovered (immediate)
  - Proxmox VM stopped / started (every 15 minutes)
  - Router offline / back online (every 15 minutes, ping)
  - DNS server offline / back online (every 15 minutes, ping)
  - Entra ID client secret expiring ≤30 days or expired (every 15 minutes)
  - Licence expiring — annual: 60/30/7 days before; monthly: 7/3 days before; expired: every 3 days
- **Email notifications** — M365 (Microsoft Graph) or SMTP fallback (Gmail etc); configure in Settings → Notifications; M365 requires `Mail.Send` permission
- **Sidebar accordion navigation** — groups collapsed by default; one group open at a time; active route auto-opens its group
- **Status Page link** — moved to header (shield icon)

### Phase 5 — Advanced
- **Microsoft 365** — Microsoft Graph API integration via Entra ID App Registration
  - Overview: total users, active users, licensed users, MFA enabled count
  - Users tab: filter by Admins / No MFA / Disabled / Shared Mailboxes; MFA status; admin roles; group memberships
  - Licences tab: all SKUs with total/used/available seats and usage bar
  - Storage tab: OneDrive and Mailbox usage per user, sorted by size (largest first); period filter 7/30/90/180 days
  - Service Health tab: real-time service status with active incident details

  **Required API permissions** (Application type, Admin consent required):

  | Permission | Purpose |
  |---|---|
  | `User.Read.All` | List all users |
  | `Directory.Read.All` | Admin roles, group memberships |
  | `Organization.Read.All` | Tenant information |
  | `Reports.Read.All` | MFA statistics, storage reports |
  | `ServiceHealth.Read.All` | Service health status |
  | `UserAuthenticationMethod.Read.All` | MFA registration per user |
  | `Mail.Send` | Email notifications (optional) |

  **Setup:** Entra ID → App registrations → API permissions → Add → Microsoft Graph → Application permissions → Grant admin consent

- **Backup & Restore** — superadmin only
  - Create manual backup (VACUUM INTO), download current DB, restore from file (validates integrity, auto pre-restore backup, restarts service)
  - Automatic daily backup at 03:00 — keeps last 7 auto-backups, 10 manual

### Phase 4 — Infrastructure
- **Proxmox** — API token auth; nodes, VMs and LXC with CPU/RAM/disk; start/stop/reboot/shutdown; storage overview; all sorted alphabetically; VM/LXC type badge next to each name
- **Network Scanner** — Hosts (CRUD), New Scan (6 nmap profiles + custom, real-time progress), Scan History (expandable port table, detailed diff)
- **Scan Automation** — Schedules (cron-based), Alert Rules (triggers + email/webhook), Alerts Log

### Phase 3 — Network
- **Uptime Monitor** — HTTP/HTTPS/TCP/ICMP/DNS monitors; real-time via Socket.io; sparkline charts; sorted alphabetically
- **Routers** — inventory with SNMP v2c/v3; auto-ping on load; expandable stats panel (uptime, CPU%, RAM%, WAN traffic); refresh interval selector
- **DNS — Local** — primary/backup cards (Technitium, Pi-hole, AdGuard, BIND9, Windows DNS); query/blocked/client stats
- **DNS — Cloudflare** — API token; auto-fetch zones; SPF/DKIM/DMARC/MX badges; auto-refresh interval
- **DNS — Manual check** — add domains, check email security records on demand
- **Net Speed** — built-in speed testing via Cloudflare; Download/Upload/Ping with Min/Avg/Max; ping chart; hourly auto-test

### Phase 2 — Inventory
- **Licences** — vendor, seats (used/total with bar), billing cycle, price/currency/tax, cost summary, credentials (URL/user/pass/MFA), expiry warnings, Renew button
- **Entra ID Apps** — Client ID, secret (masked, reveal on demand), expiry countdown, warning badge

### Phase 1 — Foundation
- **Login** — JWT authentication, rate limited
- **Two-factor authentication (TOTP)** — Google Authenticator compatible, 8 backup codes (Profile page)
- **First login flow** — forced password change
- **Dashboard** — monitors (up/down), Proxmox nodes with VM grid, DNS status, last speed test, uptime monitor list
- **Users** — create/edit/deactivate; roles: superadmin, admin, operator, viewer
- **Audit Log** — full action log with filters and CSV export
- **Settings** — app name, SMTP, data retention, notifications, system update
- **Profile** — change password, TOTP, personal API keys
- **API Keys** — personal tokens (`ka_...`), max 10 per user
- **Dark mode** — toggle in header
- **Update system** — check GitHub, install, auto-reload browser

## Roadmap

- ✅ **Phase 1** — Foundation
- ✅ **Phase 2** — Inventory
- ✅ **Phase 3** — Network
- ✅ **Phase 4** — Infrastructure
- ✅ **Phase 5** — Advanced (Microsoft 365, Backup)
- ✅ **Phase 6** — Health & Notifications
- ✅ **Phase 7** — Network Management (IP Space, Scanner Diff)
- ✅ **Phase 8** — Patch Management

## TV Monitor

Public fullscreen dashboard at `/tv` — no login required, dark theme, auto-refresh every 30 seconds.
Accessible via the monitor icon in the header.

**Two tabs:**

**Overview** — three columns:
- Uptime Monitor: overall status banner + all monitors with status dot, latency, UP/DOWN badge
- Middle: Proxmox node cards (CPU/RAM/Disk bars) + Network (routers and DNS online/offline) + Internet Speed (Download/Upload/Ping)
- Alerts: last 8 notifications with type icon and time

**Proxmox** — optimized for many VMs:
- Node summary bar: CPU/RAM/Disk bars, uptime, VM count per node
- VM grid (6 per row) grouped by node: Name, Type badge (VM/LXC), VMID, Status, CPU/RAM/Disk bars, OS, IP address
- Stopped VMs shown faded

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
│       └── services/    Monitor worker, nmap, scan, notification, patch services
├── install.sh           First-time installer
├── update.sh            Updater
└── krajcara-admin.service  systemd service
```

## License

MIT — see [LICENSE](LICENSE)
