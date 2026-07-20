// NOT USED — kept only as a reference SQLite schema if you later want to swap
// the JSON file store (store.js) for a real database. server.js uses store.js.
// To use this instead: `npm install better-sqlite3` and swap the require in
// server.js from './store' to a wrapper around this file.
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'leads.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    zip_code TEXT NOT NULL,
    coverage_type TEXT,
    current_insurance_status TEXT,
    household_size TEXT,
    age_range TEXT,
    best_time_to_call TEXT,
    best_day_to_call TEXT,
    notes TEXT,
    consent_given INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'New',
    called_at TEXT
  )
`);

module.exports = db;
