/**
 * @file: auth.js
 * @description: Middleware verifikasi JWT — validasi token di header Authorization
 * @dependencies: jsonwebtoken
 * @state: Stable
 * @last_updated: 2026-07-06 v0.1.0
 */

const jwt = require('jsonwebtoken');

/* ==========================================
   SEGMENT: JWT VERIFICATION MIDDLEWARE
   ========================================== */

/**
 * Verifikasi Bearer token dari header Authorization.
 * Jika valid, attach decoded payload ke req.user dan lanjut ke next().
 * Jika tidak ada atau invalid, return 401 Unauthorized.
 */
function verifyToken(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/* ==========================================
   SEGMENT: MODULE EXPORT
   ========================================== */

module.exports = verifyToken;
