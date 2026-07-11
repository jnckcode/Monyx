/**
 * @file: db.js
 * @description: Inisialisasi database SQLite, schema setup, dan auto-seeder admin
 * @dependencies: better-sqlite3, bcryptjs, dotenv
 * @state: Stable
 * @last_updated: 2026-07-06 v0.1.0
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

/* ==========================================
   SEGMENT: DATABASE INITIALIZATION
   ========================================== */

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ==========================================
   SEGMENT: SCHEMA SETUP
   ========================================== */

/**
 * Buat tabel users untuk otentikasi admin tunggal.
 * Kolom telegram_chat_id & telegram_token opsional — untuk notifikasi Telegram.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    telegram_chat_id TEXT DEFAULT NULL,
    telegram_token TEXT DEFAULT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

/**
 * Tabel metrics_history untuk menyimpan data historis metrik sistem.
 * Digunakan oleh Chart.js di frontend untuk menampilkan grafik tren.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS metrics_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    cpu_temp REAL DEFAULT 0,
    ram_percent REAL DEFAULT 0,
    disk_percent REAL DEFAULT 0,
    net_rx INTEGER DEFAULT 0,
    net_tx INTEGER DEFAULT 0
  )
`);

// Index pada timestamp untuk query historis yang cepat
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics_history(timestamp)
`);

/**
 * Tabel app_settings — key-value store untuk konfigurasi modul.
 * Digunakan untuk mengaktifkan/menonaktifkan fitur opsional dari UI Settings.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// Seed default module settings
db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`).run('module_filemanager', '0');

/* ==========================================
   SEGMENT: ADMIN SEEDER
   ========================================== */

/**
 * Auto-seed admin pertama jika tabel users kosong.
 * Kredensial dibaca dari .env (ADMIN_USERNAME, ADMIN_PASSWORD).
 */
function seedAdmin() {
  const existingAdmin = db.prepare('SELECT COUNT(*) as count FROM users').get();

  if (existingAdmin.count === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'root';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    const stmt = db.prepare(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)'
    );
    stmt.run(username, hash);

    console.log(`[DB] Admin seeded: "${username}"`);
  } else {
    console.log('[DB] Admin already exists, skipping seed.');
  }
}

seedAdmin();

/* ==========================================
   SEGMENT: MODULE EXPORT
   ========================================== */

module.exports = db;
