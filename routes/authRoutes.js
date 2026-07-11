/**
 * @file: authRoutes.js
 * @description: Route login & verifikasi token JWT — endpoint publik (tanpa JWT)
 * @dependencies: express, jsonwebtoken, bcryptjs, config/db
 * @state: Stable
 * @last_updated: 2026-07-06 v0.1.0
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const telegram = require('../services/telegram');

/* ==========================================
   SEGMENT: LOGIN ROUTE
   ========================================== */

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Return: { token, username } jika berhasil, atau 401 jika gagal.
 */
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    // Cari user di database
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Verifikasi password dengan bcrypt
    const isMatch = bcrypt.compareSync(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Generate JWT token (berlaku 24 jam)
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Send Telegram Notification
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    telegram.sendNotification(
      `🛡️ <b>Monyx Login Alert</b>\n` +
      `Admin successfully logged in.\n` +
      `User: <b>${user.username}</b>\n` +
      `IP: <code>${clientIp}</code>\n\n` +
      `⏰ ${new Date().toLocaleString('id-ID')}`
    ).catch(err => console.error('[Telegram] Login notification error:', err.message));

    res.json({
      token,
      username: user.username,
      message: 'Login successful.'
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

/* ==========================================
   SEGMENT: TOKEN VERIFICATION ROUTE
   ========================================== */

/**
 * GET /api/auth/verify
 * Header: Authorization: Bearer <token>
 * Cek apakah token JWT masih valid.
 */
router.get('/verify', (req, res) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ valid: false, error: 'No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({
      valid: true,
      username: decoded.username,
      expiresAt: new Date(decoded.exp * 1000).toISOString()
    });
  } catch (err) {
    res.status(401).json({ valid: false, error: 'Invalid or expired token.' });
  }
});

/* ==========================================
   SEGMENT: MODULE EXPORT
   ========================================== */

module.exports = router;
