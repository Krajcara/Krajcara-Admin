const cron = require('node-cron');
const { cleanupRevokedTokens } = require('./middleware/auth');
const db = require('./db/database');

function runRetentionCleanup() {
  try {
    const auditDays = Math.max(30, parseInt(db.prepare("SELECT value FROM settings WHERE key='audit_retention_days'").get()?.value || '365'));
    const r = db.prepare(`DELETE FROM audit_log WHERE created_at < datetime('now', '-${auditDays} days')`).run();
    if (r.changes > 0) console.log(`[Retention] Deleted ${r.changes} old audit log entries`);
  } catch (e) {
    console.error('[Retention] Error:', e.message);
  }
}

function start() {
  // Init monitor worker
  try {
    const { initMonitorWorker } = require('./services/monitorWorker');
    initMonitorWorker();
  } catch (e) {
    console.error('[Scheduler] Monitor worker init failed:', e.message);
  }

  // Init scan schedules
  try {
    const { initSchedules } = require('./routes/scanner');
    initSchedules();
  } catch (e) {
    console.error('[Scheduler] Scan schedules init failed:', e.message);
  }

  // Daily 03:00 — cleanup revoked tokens + audit retention + auto-backup
  cron.schedule('0 3 * * *', () => {
    console.log('[Scheduler] Daily cleanup...');
    cleanupRevokedTokens();
    runRetentionCleanup();
    try {
      const { runAutoBackup } = require('./routes/backup');
      runAutoBackup();
    } catch (e) { console.error('[Scheduler] Auto-backup failed:', e.message); }
  });

  // Every 15 minutes — notification checks
  cron.schedule('*/15 * * * *', () => {
    try {
      const { runNotificationChecks } = require('./services/notificationService');
      runNotificationChecks();
    } catch (e) { console.error('[Scheduler] Notification check error:', e.message); }
  });
  cron.schedule('0 * * * *', () => {
    try {
      const { runScheduledTest } = require('./routes/netspeed');
      runScheduledTest();
    } catch (e) {
      console.error('[Scheduler] Speed test error:', e.message);
    }
  });

  // Daily 04:00 — patch check
  cron.schedule('0 4 * * *', () => {
    try {
      const { runPatchCheck } = require('./services/patchService');
      runPatchCheck().catch(e => console.error('[Scheduler] Patch check error:', e.message));
    } catch (e) { console.error('[Scheduler] Patch check init error:', e.message); }
  });

  console.log('[Scheduler] Started');
}

module.exports = { start };
