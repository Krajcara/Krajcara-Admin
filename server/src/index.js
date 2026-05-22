require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const compression = require('compression');
const path       = require('path');
const { Server } = require('socket.io');
const rateLimit  = require('express-rate-limit');

const db         = require('./db/database');
const { requireAuth } = require('./middleware/auth');
const { autoAuditMiddleware } = require('./middleware/audit');
const scheduler  = require('./scheduler');

const authRoutes    = require('./routes/auth');
const totpRoutes    = require('./routes/totp');
const usersRoutes   = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const auditRoutes   = require('./routes/audit');
const apiKeyRoutes  = require('./routes/api-keys');
const statusRoutes  = require('./routes/status');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : false, credentials: true }
});
app.set('io', io);

// ── Security & middleware ─────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : false,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('short'));

const apiLimiter  = rateLimit({ windowMs: 60000, max: 200, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 60000, max: 15,  standardHeaders: true, legacyHeaders: false });

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/', autoAuditMiddleware);

// ── Public routes ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() }));
app.use('/api/auth',        authRoutes);
app.use('/api/totp',        totpRoutes);
app.get('/api/settings/app', settingsRoutes);
app.use('/api/status',      statusRoutes);

// ── Protected routes ──────────────────────────────────────────────
app.use('/api/users',       requireAuth, usersRoutes);
app.use('/api/settings',    requireAuth, settingsRoutes);
app.use('/api/audit',       requireAuth, auditRoutes);
app.use('/api/api-keys',    requireAuth, apiKeyRoutes);

// ── Socket.io ─────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

// ── Frontend SPA (production) ─────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '../../client/dist');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ── Error handler ─────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────────────
const PORT = parseInt(process.env.APP_PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Krajcara Admin v1.0.0 started on port ${PORT}`);
  scheduler.start();
});

module.exports = { app, server };
