-- Custom Auth System Migration (TiDB Compatible)
-- Adds tables and columns needed for custom authentication

-- Create sessions table for JWT token management
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(255) PRIMARY KEY,
  user_id INT NOT NULL,
  token TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_expires_at (expires_at)
);

-- Create magic_links table for passwordless email login
CREATE TABLE IF NOT EXISTS magic_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token (token),
  INDEX idx_email (email),
  INDEX idx_expires_at (expires_at)
);

-- Add google_id column to users table (without UNIQUE constraint first)
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);

-- Add wallet_address column
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(255);

-- Add indexes
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_google_id (google_id);
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_wallet_address (wallet_address);

-- Add UNIQUE constraint to google_id (separate statement for TiDB compatibility)
ALTER TABLE users ADD UNIQUE INDEX IF NOT EXISTS uk_google_id (google_id);

-- Add UNIQUE constraint to token in magic_links
ALTER TABLE magic_links ADD UNIQUE INDEX IF NOT EXISTS uk_token (token);

-- Ensure email column is unique in users table
ALTER TABLE users ADD UNIQUE INDEX IF NOT EXISTS uk_email (email);
