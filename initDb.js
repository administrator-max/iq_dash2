/**
 * initDb.js — Runs schema.sql against Neon (PgBouncer-safe).
 * PgBouncer does NOT support multi-statement queries, so we split
 * the SQL file into individual statements and execute them one by one.
 *
 * Usage:  node initDb.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

const pool = new Pool({
  host:     process.env.PGHOST,
  database: process.env.PGDATABASE,
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl:      { rejectUnauthorized: false },
});

async function initDB() {
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

    // Split on semicolons, remove comments and blanks
    const statements = sql
      .split(';')
      .map(s => s.replace(/--[^\n]*/g, '').trim())
      .filter(s => s.length > 0);

    console.log(`⏳ Running ${statements.length} SQL statements…`);
    for (const stmt of statements) {
      await client.query(stmt);
    }
    console.log('✅ Schema initialised successfully.');
  } catch (err) {
    console.error('❌ Schema init failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

initDB().catch(() => process.exit(1));