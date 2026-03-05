-- Rate limiting table for subscribe endpoint
CREATE TABLE IF NOT EXISTS rate_limit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

-- Index for quick IP lookups
CREATE INDEX IF NOT EXISTS idx_rate_limit_ip ON rate_limit(ip);

-- Index for timestamp-based cleanup
CREATE INDEX IF NOT EXISTS idx_rate_limit_timestamp ON rate_limit(timestamp);
