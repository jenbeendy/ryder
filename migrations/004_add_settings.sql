-- Migration: Add settings table for dashboard visibility config
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('visibility_singles', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('visibility_foursome', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('visibility_texas_scramble', 'true');
