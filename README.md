# Krajcara Admin

IT Infrastructure Management application. Self-hosted, runs on Ubuntu Linux on port 3000.

## Features — Phase 1 (Foundation)

- **Login** with username/password + optional TOTP (2FA) via authenticator app
- **Dashboard** with recent activity overview
- **Users** management — create, edit, deactivate users with roles (superadmin, admin, operator, viewer)
- **Audit Log** — full log of all actions with CSV export
- **Settings** — application name, SMTP email, data retention
- **Profile** — change password, enable/disable TOTP, manage personal API keys
- **Status Page** — public page at `/status` (no login required), auto-refreshes every 30 seconds
- **Update system** — pull latest from GitHub via `update.sh`

## Requirements

- Ubuntu 22.04 or 24.04
- Root access
- Internet connection (for install and updates)
- Node.js 20 LTS (installed automatically)

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

## Configuration

All configuration is done through the **Settings** page inside the application.  
The `.env` file at `/opt/krajcara-admin/.env` is generated automatically and should not be edited manually except for advanced use.

Key `.env` variables:

| Variable | Description |
|----------|-------------|
| `APP_PORT` | Port the app listens on (default: 3000) |
| `APP_SECRET` | JWT signing secret — auto-generated |
| `DB_PATH` | SQLite database path |
| `GITHUB_TOKEN` | Token for private repo access (used by updater) |
| `GITHUB_REPO` | Repository URL |

## Roles

| Role | Permissions |
|------|-------------|
| `superadmin` | Full access, can delete users |
| `admin` | Manage users, settings, audit |
| `operator` | Access to operational modules (added in later phases) |
| `viewer` | Read-only access |

## Service management

```bash
# Status
sudo systemctl status krajcara-admin

# Restart
sudo systemctl restart krajcara-admin

# View logs
sudo journalctl -u krajcara-admin -f

# Stop
sudo systemctl stop krajcara-admin
```

## Data

The SQLite database is stored at `/opt/krajcara-admin/data/krajcara-admin.db`.  
Back it up regularly — it contains all application data.

## Project structure

```
krajcara-admin/
├── client/              React + Vite frontend
│   ├── src/
│   │   ├── components/  Shared UI components
│   │   ├── pages/       Page components
│   │   ├── store/       Zustand state stores
│   │   └── lib/         Utilities and API client
│   └── public/          Static assets (favicon)
├── server/              Express.js backend
│   └── src/
│       ├── db/          SQLite database setup
│       ├── middleware/  Auth and audit middleware
│       └── routes/      API route handlers
├── install.sh           First-time installer
├── update.sh            Updater (GitHub pull + rebuild)
├── krajcara-admin.service  systemd service file
└── .env.example         Environment variables template
```

## Roadmap

- **Phase 2** — Inventory: Licences (manual + Entra ID Apps), Clients
- **Phase 3** — Network: Uptime Monitor, Routers (SNMP), DNS (Local + External)
- **Phase 4** — Infrastructure: Proxmox, Network Scanner, Scan Automation
- **Phase 5** — Advanced: Microsoft 365, Backup & Restore, Reports

## License

MIT — see [LICENSE](LICENSE)
