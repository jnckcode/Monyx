/**
 * @file: server.js
 * @description: Entry point Express.js — load env, mount routes, serve static frontend
 * @dependencies: express, dotenv, config/db
 * @state: Under Construction
 * @last_updated: 2026-07-06 v0.1.0
 */

const express = require('express');
const path = require('path');
require('dotenv').config();

/* ==========================================
   SEGMENT: DATABASE INITIALIZATION
   ========================================== */

// Import db to trigger schema setup & admin seeder on startup
const db = require('./config/db');

/* ==========================================
   SEGMENT: EXPRESS APP SETUP
   ========================================== */

const app = express();
const PORT = process.env.PORT || 3000;

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, 'public')));

/* ==========================================
   SEGMENT: ROUTE MOUNTING
   ========================================== */

// Auth routes (login, verify) — no JWT required
const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

// API routes (metrics, services, cron, logs) — JWT required
const apiRoutes = require('./routes/apiRoutes');
app.use('/api', apiRoutes);

/* ==========================================
   SEGMENT: SPA FALLBACK
   ========================================== */

// SPA fallback — semua route non-API dikembalikan ke index.html
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ==========================================
   SEGMENT: ERROR HANDLING
   ========================================== */

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

/* ==========================================
   SEGMENT: SERVER START
   ========================================== */

app.listen(PORT, () => {
  console.log(`[Monyx] Server running on http://localhost:${PORT}`);
  console.log(`[Monyx] Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start Telegram anomaly monitoring (check every 5 minutes)
  const telegram = require('./services/telegram');
  const sysInfo = require('./services/sysInfo');
  const serviceManager = require('./services/serviceManager');
  telegram.startMonitoring(sysInfo, serviceManager, 300000);

  // Record metrics history every 30 seconds
  setInterval(() => {
    try {
      const metrics = sysInfo.getAllMetrics();
      const iface = metrics.network.interfaces[0] || { rx_bytes_sec: 0, tx_bytes_sec: 0 };
      db.prepare(
        'INSERT INTO metrics_history (cpu_temp, ram_percent, disk_percent, net_rx, net_tx) VALUES (?, ?, ?, ?, ?)'
      ).run(
        metrics.cpu.temp,
        metrics.memory.percent,
        metrics.disk.percent,
        iface.rx_bytes_sec,
        iface.tx_bytes_sec
      );

      // Auto-prune: Hapus metrik yang lebih tua dari 7 hari (7 * 24 * 3600 = 604800 detik)
      const cutoff = Math.floor(Date.now() / 1000) - 604800;
      db.prepare('DELETE FROM metrics_history WHERE timestamp < ?').run(cutoff);
    } catch (err) {
      console.error('[Metrics] History recording error:', err.message);
    }
  }, 30000);
});
