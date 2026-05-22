const db = require('../db/database');

function writeAuditLog({ userId, username, action, module, entityId, entityName, detail, ip, userAgent, status = 'success' }) {
  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, username, action, module, entity_id, entity_name, detail, ip_address, user_agent, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId || null,
      username || 'system',
      action,
      module,
      entityId != null ? String(entityId) : null,
      entityName || null,
      detail ? (typeof detail === 'object' ? JSON.stringify(detail) : String(detail)) : null,
      ip || null,
      userAgent || null,
      status
    );
  } catch (err) {
    console.error('[Audit] Failed to write log:', err.message);
  }
}

const PATH_MODULE_MAP = [
  [/\/api\/auth\/login/,          'auth',     'login'],
  [/\/api\/auth\/logout/,         'auth',     'logout'],
  [/\/api\/auth\/change-password/,'auth',     'change_password'],
  [/\/api\/users/,                'users',    null],
  [/\/api\/settings/,             'settings', null],
  [/\/api\/audit/,                'audit',    null],
  [/\/api\/totp/,                 'totp',     null],
  [/\/api\/api-keys/,             'api_keys', null],
];

const METHOD_ACTION = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

function autoAuditMiddleware(req, res, next) {
  const action = METHOD_ACTION[req.method];
  if (!action) return next();

  let module = null, overrideAction = null;
  for (const [pattern, mod, oa] of PATH_MODULE_MAP) {
    if (pattern.test(req.path)) { module = mod; overrideAction = oa; break; }
  }
  if (!module) { module = 'other'; }

  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        const bodyClean = { ...req.body };
        ['password', 'password_hash', 'current_password', 'new_password'].forEach(k => delete bodyClean[k]);
        writeAuditLog({
          userId:     req.user?.id,
          username:   req.user?.username || req.body?.username,
          action:     overrideAction || action,
          module,
          entityId:   body?.id ?? req.params?.id ?? null,
          entityName: body?.name ?? body?.username ?? body?.label ?? null,
          detail:     Object.keys(bodyClean).length ? JSON.stringify(bodyClean).slice(0, 1000) : null,
          ip:         req.ip,
          userAgent:  req.headers?.['user-agent'],
          status:     'success',
        });
      } catch {}
    }
    return originalJson(body);
  };
  next();
}

module.exports = { writeAuditLog, autoAuditMiddleware };
