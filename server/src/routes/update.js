const express = require('express');
const router  = express.Router();
const { execSync, exec } = require('child_process');
const path = require('path');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

const INSTALL_DIR = process.env.INSTALL_DIR || '/opt/krajcara-admin';

// GET /api/update/check
router.get('/check', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const localSha = execSync('git rev-parse --short HEAD', { cwd: INSTALL_DIR, timeout: 5000 }).toString().trim();

    let currentVersion = 'unknown';
    try {
      const pkgPath = path.join(INSTALL_DIR, 'server/package.json');
      delete require.cache[pkgPath];
      currentVersion = require(pkgPath).version || 'unknown';
    } catch {}

    // Use async exec for remote check to avoid blocking/ETIMEDOUT
    const remoteSha = await new Promise((resolve) => {
      exec('git ls-remote origin HEAD', { cwd: INSTALL_DIR, timeout: 12000 }, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        resolve(stdout.split('\t')[0].substring(0, 7));
      });
    });

    if (!remoteSha) {
      return res.json({
        up_to_date: true,
        local_sha: localSha,
        remote_sha: null,
        current_version: currentVersion,
        update_available: false,
        error: 'Could not reach GitHub — assuming up to date',
      });
    }

    res.json({
      up_to_date:       localSha === remoteSha,
      local_sha:        localSha,
      remote_sha:       remoteSha,
      current_version:  currentVersion,
      update_available: localSha !== remoteSha,
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not check for updates: ' + err.message });
  }
});

// POST /api/update/run
router.post('/run', requireAuth, requireRole('superadmin'), (req, res) => {
  const updateScript = path.join(INSTALL_DIR, 'update.sh');
  writeAuditLog({
    userId: req.user.id, username: req.user.username,
    action: 'update', module: 'settings',
    entityName: 'system update triggered', ip: req.ip, userAgent: req.headers['user-agent']
  });

  // Respond immediately
  res.json({ ok: true, message: 'Update started. Application will restart automatically.' });

  // Notify all connected clients via Socket.io, then run update
  setTimeout(() => {
    const io = global.io;
    if (io) {
      io.emit('system:updating', { message: 'System update in progress. Please wait...' });
    }

    // Run update.sh in background
    exec(`bash ${updateScript} >> /tmp/krajcara-update.log 2>&1`, { timeout: 300000 }, (err) => {
      if (err) console.error('[Update] update.sh failed:', err.message);
      // After update, service will have restarted — no further emit needed
    });
  }, 500);
});

module.exports = router;

