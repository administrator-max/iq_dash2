// db/pool.js  –  Shared pg Pool (Neon connection)
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.PGHOST,
  database: process.env.PGDATABASE,
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  port:     5432,
  ssl:      { rejectUnauthorized: false },   // Required for Neon
  max:      10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('Unexpected pg pool error', err));

module.exports = pool;