-- ============================================================
-- Predictive Apex — Complete Database Setup Script
-- Run this against your new TiDB Cloud database.
-- Safe to run multiple times (uses IF NOT EXISTS).
-- ============================================================

-- ─── 1. USERS TABLE ──────────────────────────────────────────
-- Core user accounts. The app registers users with email + password.
CREATE TABLE IF NOT EXISTS users (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255),
  role          VARCHAR(50) NOT NULL DEFAULT 'user',
  password_hash VARCHAR(255),
  avatar_url    VARCHAR(512),
  last_login_at TIMESTAMP NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─── 2. BOT CONFIG TABLE ─────────────────────────────────────
-- Stores each user's bot configuration: API keys, trade parameters, active cities.
-- One row per user (enforced by UNIQUE KEY on user_id).
CREATE TABLE IF NOT EXISTS bot_config_v2 (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  user_id           INT NOT NULL,
  kalshi_api_key    TEXT,
  kalshi_api_key_id VARCHAR(255),
  is_active         BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run           BOOLEAN NOT NULL DEFAULT TRUE,
  flat_bet_dollars  DECIMAL(10,2) DEFAULT 20.00,
  min_ev_cents      DECIMAL(6,2)  DEFAULT 3.00,
  max_price_cents   INT           DEFAULT 70,
  min_liquidity     INT           DEFAULT 100,
  enabled_cities    JSON,
  max_daily_trades  INT           DEFAULT 20,
  max_daily_loss    DECIMAL(10,2) DEFAULT 100.00,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bot_config_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── 3. BOT STATUS TABLE ─────────────────────────────────────
-- Tracks the live running state of each user's bot.
-- One row per user (enforced by UNIQUE KEY on user_id).
CREATE TABLE IF NOT EXISTS bot_status_v2 (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  user_id        INT NOT NULL,
  status         ENUM('stopped','running','error','paused') NOT NULL DEFAULT 'stopped',
  last_scan_at   TIMESTAMP NULL,
  signals_found  INT DEFAULT 0,
  error_message  TEXT,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bot_status_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── 4. TRADES TABLE ─────────────────────────────────────────
-- Every trade placed (or simulated in paper mode) by the bot.
CREATE TABLE IF NOT EXISTS trades_v2 (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  user_id          INT NOT NULL,
  order_id         VARCHAR(255) UNIQUE,
  ticker           VARCHAR(100) NOT NULL DEFAULT '',
  market_ticker    VARCHAR(100),
  city_code        VARCHAR(10)  NOT NULL DEFAULT '',
  city_name        VARCHAR(100) NOT NULL DEFAULT '',
  side             ENUM('yes','no') NOT NULL,
  price_cents      INT NOT NULL,
  contracts        INT NOT NULL,
  cost_basis       DECIMAL(10,2),
  ev               DECIMAL(8,4),
  our_prob         DECIMAL(6,4),
  forecast_temp    DECIMAL(5,1),
  strike_desc      VARCHAR(50),
  status           ENUM('pending','filled','cancelled','settled') NOT NULL DEFAULT 'pending',
  settled_at       TIMESTAMP NULL,
  settlement_value DECIMAL(10,2),
  pnl              DECIMAL(10,2),
  won              BOOLEAN,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── 5. BOT LOGS TABLE ───────────────────────────────────────
-- Activity log: every bot event, trade signal, and system message.
CREATE TABLE IF NOT EXISTS bot_logs_v2 (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  user_id    INT NOT NULL,
  level      ENUM('info','warn','warning','error','success','trade') NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL,
  context    JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── 6. FORECAST CACHE TABLE ─────────────────────────────────
-- Caches the latest NWS forecast data fetched by the bot for each city.
CREATE TABLE IF NOT EXISTS forecast_cache_v2 (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  city_code     VARCHAR(10)  NOT NULL,
  city_name     VARCHAR(100) NOT NULL,
  forecast_high DECIMAL(5,1),
  sigma         DECIMAL(5,2),
  fetched_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_forecast_city (city_code),
  INDEX idx_forecast_fetched (fetched_at)
);

-- ─── 7. SESSIONS TABLE ───────────────────────────────────────
-- JWT-style server-side sessions for authenticated users.
CREATE TABLE IF NOT EXISTS sessions_v2 (
  id         VARCHAR(255) PRIMARY KEY,
  user_id    INT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── 8. MAGIC LINKS TABLE ────────────────────────────────────
-- One-time login tokens (used for passwordless login flow).
CREATE TABLE IF NOT EXISTS magic_links_v2 (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  email      VARCHAR(255) NOT NULL,
  token      VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at    TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- DONE. Verify with: SHOW TABLES;
-- Expected tables:
--   users, bot_config_v2, bot_status_v2, trades_v2,
--   bot_logs_v2, forecast_cache_v2, sessions_v2, magic_links_v2
-- ============================================================
