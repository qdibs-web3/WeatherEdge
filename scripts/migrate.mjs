/**
 * WeatherEdge Database Migration Script
 * Creates all new tables required for the Kalshi weather trading bot.
 * Safe to run multiple times (uses CREATE TABLE IF NOT EXISTS).
 */

import mysql from 'mysql2/promise';
import 'dotenv/config';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const pool = mysql.createPool({
  uri: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionLimit: 5,
});

const migrations = [
  // ─── Add new columns to users table ───────────────────────────────────────
  `ALTER TABLE users
     ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
     ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(512),
     ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL`,

  // ─── Recreate bot_config with new schema ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS bot_config_v2 (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    kalshi_api_key TEXT,    
    kalshi_api_key_id VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    dry_run BOOLEAN NOT NULL DEFAULT TRUE,
    flat_bet_dollars DECIMAL(10,2) DEFAULT 20.00,
    min_ev_cents DECIMAL(6,2) DEFAULT 3.00,
    max_price_cents INT DEFAULT 70,
    min_liquidity INT DEFAULT 100,
    enabled_cities JSON,
    max_daily_trades INT DEFAULT 20,
    max_daily_loss DECIMAL(10,2) DEFAULT 100.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  // ─── Recreate bot_status with new schema ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS bot_status_v2 (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    status ENUM('stopped','running','error','paused') NOT NULL DEFAULT 'stopped',
    last_scan_at TIMESTAMP NULL,
    signals_found INT DEFAULT 0,
    error_message TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  // ─── Recreate trades with new schema ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS trades_v2 (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    order_id VARCHAR(255) UNIQUE,
    ticker VARCHAR(100) NOT NULL,
    market_ticker VARCHAR(100),
    city_code VARCHAR(10) NOT NULL,
    city_name VARCHAR(100) NOT NULL,
    side ENUM('yes','no') NOT NULL,
    price_cents INT NOT NULL,
    contracts INT NOT NULL,
    cost_basis DECIMAL(10,2),
    ev DECIMAL(8,4),
    our_prob DECIMAL(6,4),
    forecast_temp DECIMAL(5,1),
    strike_desc VARCHAR(50),
    status ENUM('pending','filled','cancelled','settled') NOT NULL DEFAULT 'pending',
    settled_at TIMESTAMP NULL,
    settlement_value DECIMAL(10,2),
    pnl DECIMAL(10,2),
    won BOOLEAN,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  // ─── Bot logs ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS bot_logs_v2 (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    level ENUM('info','warn','error','success','warning','trade') NOT NULL,
    message TEXT NOT NULL,
    context JSON,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  // ─── Forecast cache ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS forecast_cache (
    id INT PRIMARY KEY AUTO_INCREMENT,
    city_code VARCHAR(10) NOT NULL,
    city_name VARCHAR(100) NOT NULL,
    high_temp DECIMAL(5,1),
    low_temp DECIMAL(5,1),
    short_forecast VARCHAR(255),
    forecast_date VARCHAR(20),
    sigma DECIMAL(5,2),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // ─── Sessions ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(255) PRIMARY KEY,
    user_id INT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  // ─── Magic links ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS magic_links_v2 (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

// Remap table names in drizzle schema to use _v2 tables
// (The schema.ts already uses the correct column names; we just need the tables to exist)
const renames = [
  // After creating _v2 tables, rename them to replace the old ones
  { from: 'bot_config_v2', to: 'bot_config_new' },
  { from: 'bot_status_v2', to: 'bot_status_new' },
  { from: 'trades_v2', to: 'trades_new' },
  { from: 'bot_logs_v2', to: 'bot_logs_new' },
  { from: 'magic_links_v2', to: 'magic_links_new' },
];

async function run() {
  const conn = await pool.getConnection();
  try {
    console.log('Connected to database. Running migrations...\n');

    for (const sql of migrations) {
      const tableName = sql.match(/TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/i)?.[1] ?? 'unknown';
      try {
        await conn.query(sql);
        console.log(`  ✓ ${tableName}`);
      } catch (err) {
        // ALTER TABLE errors for existing columns are fine
        if (err.code === 'ER_DUP_FIELDNAME' || err.message?.includes('Duplicate column')) {
          console.log(`  ~ ${tableName} (columns already exist)`);
        } else {
          console.error(`  ✗ ${tableName}: ${err.message}`);
        }
      }
    }

    // Verify all required tables exist
    const [tables] = await conn.query("SHOW TABLES");
    const tableNames = tables.map(t => Object.values(t)[0]);
    const required = ['users', 'bot_config_v2', 'bot_status_v2', 'trades_v2', 'bot_logs_v2', 'forecast_cache', 'sessions'];
    console.log('\nVerification:');
    for (const t of required) {
      console.log(`  ${tableNames.includes(t) ? '✓' : '✗'} ${t}`);
    }

    console.log('\nMigration complete!');
    console.log('\nIMPORTANT: Update your drizzle/schema.ts table names:');
    console.log('  bot_config  → bot_config_v2');
    console.log('  bot_status  → bot_status_v2');
    console.log('  trades      → trades_v2');
    console.log('  bot_logs    → bot_logs_v2');
    console.log('  magic_links → magic_links_v2');
    console.log('\nOR rename the tables in the DB (see SETUP_GUIDE.md)');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
