const express = require('express');
const router  = express.Router();
const { execSync } = require('child_process');
const path = require('path');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

const INSTALL_DIR = process.env.INSTALL_DIR || '/opt/krajcara-admin';

// GET /api/update/check — check if update is available
router.get('/check', requireAuth, requireRole('superadmin', 'admin'), (req, res) => {
  try {
    const localSha  = execSync('git rev-parse --short HEAD', { cwd: INSTALL_DIR, timeout: 10000 }).toString().trim();
    const remoteSha = execSync('git ls-remote origin HEAD', { cwd: INSTALL_DIR, timeout: 15000 }).toString().split('\t')[0].substring(0, 7);

    let currentVersion = 'unknown';
    try {
      const pkg = require(path.join(INSTALL_DIR, 'server/package.json'));
      currentVersion = pkg.version || 'unknown';
    } catch {}

    // Try to get latest release tag
    let latestTag = null;
    try {
      latestTag = execSync('git describe --tags --abbrev=0 origin/main 2>/dev/null || true', { cwd: INSTALL_DIR, timeout: 10000 }).toString().trim();
    } catch {}

    const upToDate = localSha === remoteSha;

    res.json({
      up_to_date:      upToDate,
      local_sha:       localSha,
      remote_sha:      remoteSha,
      current_version: currentVersion,
      latest_tag:      latestTag || null,
      update_available: !upToDate
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not check for updates: ' + err.message });
  }
});

// POST /api/update/run — run update.sh
router.post('/run', requireAuth, requireRole('superadmin'), (req, res) => {
  const updateScript = path.join(INSTALL_DIR, 'update.sh');
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'settings', entityName: 'system update triggered', ip: req.ip, userAgent: req.headers['user-agent'] });

  // Respond immediately — update runs in background and restarts the service
  res.json({ ok: true, message: 'Update started. The application will restart in ~30 seconds.' });

  // Run in background after response is sent
  setTimeout(() => {
    try {
      execSync(`bash ${updateScript} >> /tmp/krajcara-update.log 2>&1`, { timeout: 300000 });
    } catch (e) {
      console.error('[Update] update.sh failed:', e.message);
    }
  }, 500);
});

module.exports = router;
