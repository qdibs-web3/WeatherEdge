-- ============================================
-- Polymarket Bot: Wallet Auth Migration
-- WARNING: This removes private key storage!
-- ============================================

-- Step 1: Add new wallet auth columns to users table
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS nonce VARCHAR(64),
  ADD COLUMN IF NOT EXISTS signature_timestamp TIMESTAMP NULL;


-- Step 3: Drop old authentication columns
-- WARNING: This removes Google/Email OAuth data
ALTER TABLE users
  DROP COLUMN IF EXISTS openId,
  DROP COLUMN IF EXISTS google_id,
  DROP COLUMN IF EXISTS loginMethod;

-- Step 4: Remove private key storage from bot_config
-- WARNING: This permanently deletes encrypted private keys
ALTER TABLE bot_config
  DROP COLUMN IF EXISTS polymarketPrivateKey,
  DROP COLUMN IF EXISTS polymarketFunderAddress;

-- Step 5: Add new bot_config columns for smart contract integration
ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS user_wallet_address VARCHAR(42) NOT NULL,
  ADD COLUMN IF NOT EXISTS proxy_contract_address VARCHAR(42),
  ADD COLUMN IF NOT EXISTS usdc_allowance DECIMAL(20, 6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allowance_last_checked TIMESTAMP NULL;

-- Step 6: Remove old strategy columns
ALTER TABLE bot_config
  DROP COLUMN IF EXISTS arbitrageEnabled,
  DROP COLUMN IF EXISTS arbitrageMinProfitPct,
  DROP COLUMN IF EXISTS valueBettingEnabled,
  DROP COLUMN IF EXISTS highQualityMarketsEnabled,
  DROP COLUMN IF EXISTS minVolume,
  DROP COLUMN IF EXISTS minQualityScore,
  DROP COLUMN IF EXISTS maxPositionSize,
  DROP COLUMN IF EXISTS maxOpenPositions,
  DROP COLUMN IF EXISTS maxDailyLoss,
  DROP COLUMN IF EXISTS targetDailyReturn,
  DROP COLUMN IF EXISTS minEdge,
  DROP COLUMN IF EXISTS kellyFraction;

-- Step 7: Add Bitcoin 15m strategy columns
ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS btc15m_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS btc15m_edge_threshold DECIMAL(5, 4) DEFAULT 0.0500,
  ADD COLUMN IF NOT EXISTS btc15m_min_probability DECIMAL(5, 4) DEFAULT 0.5500,
  ADD COLUMN IF NOT EXISTS btc15m_early_threshold DECIMAL(5, 4) DEFAULT 0.0500,
  ADD COLUMN IF NOT EXISTS btc15m_mid_threshold DECIMAL(5, 4) DEFAULT 0.1000,
  ADD COLUMN IF NOT EXISTS btc15m_late_threshold DECIMAL(5, 4) DEFAULT 0.2000;

-- Step 8: Update trades table strategy enum
ALTER TABLE trades 
  MODIFY COLUMN strategy ENUM('btc15m_up', 'btc15m_down') NOT NULL;

-- Step 9: Update positions table strategy enum
ALTER TABLE positions 
  MODIFY COLUMN strategy ENUM('btc15m_up', 'btc15m_down') NOT NULL;

-- Step 10: Create wallet_approvals table for tracking on-chain approvals
CREATE TABLE IF NOT EXISTS wallet_approvals (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_wallet_address VARCHAR(42) NOT NULL,
  token_address VARCHAR(42) NOT NULL,
  spender_address VARCHAR(42) NOT NULL,
  approved_amount DECIMAL(20, 6) NOT NULL,
  current_spent DECIMAL(20, 6) DEFAULT 0,
  approval_tx_hash VARCHAR(66) NOT NULL,
  revocation_tx_hash VARCHAR(66) NULL,
  status ENUM('active', 'revoked', 'expired') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  
  INDEX idx_user_wallet (user_wallet_address),
  INDEX idx_status (status),
  INDEX idx_token (token_address)
);

-- Step 11: Add foreign key constraint (if users.wallet_address is unique)
-- ALTER TABLE bot_config
--   ADD CONSTRAINT fk_bot_config_wallet 
--   FOREIGN KEY (user_wallet_address) REFERENCES users(wallet_address)
--   ON DELETE CASCADE;

-- Step 12: Clean up old sessions table (if exists)
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS magicLinks;

-- Step 13: Verify migration
SELECT 
  'Users table' as table_name,
  COUNT(*) as row_count,
  COUNT(DISTINCT wallet_address) as unique_wallets
FROM users
UNION ALL
SELECT 
  'Bot configs' as table_name,
  COUNT(*) as row_count,
  COUNT(DISTINCT user_wallet_address) as unique_wallets
FROM bot_config;

-- Migration complete!
SELECT 'Migration completed successfully!' as status;