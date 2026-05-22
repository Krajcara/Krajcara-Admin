const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// GET /api/status/public — no auth required
// Returns configured status items for the public status page
router.get('/public', (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM status_items WHERE visible = 1 ORDER BY sort_order ASC, name ASC').all();
    res.json(items);
  } catch {
    // Table may not exist yet in Phase 1 — return empty
    res.json([]);
  }
});

// GET /api/status — protected, returns all items including hidden
router.get('/', (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM status_items ORDER BY sort_order ASC, name ASC').all();
    res.json(items);
  } catch {
    res.json([]);
  }
});

module.exports = router;
