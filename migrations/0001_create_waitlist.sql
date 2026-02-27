-- Create waitlist table for email capture
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_country TEXT DEFAULT 'unknown',
  source TEXT DEFAULT 'landing-page'
);

-- Index for quick duplicate checks
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
