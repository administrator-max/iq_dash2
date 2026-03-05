// ============================================================
//  server.js  –  Import Quota Monitor 2026
//  Express + PostgreSQL (Neon) API server
// ============================================================
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const compression = require('compression');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(cors());
app.use(express.json());

// ── Serve static frontend ──────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ─────────────────────────────────────────────
app.use('/api/companies',   require('./routes/companies'));
app.use('/api/spi',         require('./routes/spi'));
app.use('/api/ra',          require('./routes/ra'));
app.use('/api/shipments',   require('./routes/shipments'));
app.use('/api/pending',     require('./routes/pending'));
app.use('/api/charts',      require('./routes/charts'));
app.use('/api/save',        require('./routes/save'));

// ── Health check ───────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ── SPA fallback ───────────────────────────────────────────
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.listen(PORT, () => console.log(`IQ Dash running on port ${PORT}`));