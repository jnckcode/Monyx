/**
 * @file: apiRoutes.js
 * @description: Route API utama — metrics, services, cron, logs, settings, processes (JWT required)
 * @dependencies: express, child_process, os, services/*, middleware/auth
 * @state: Stable
 * @last_updated: 2026-07-06 v0.2.0
 */

const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const os = require('os');
const verifyToken = require('../middleware/auth');
const sysInfo = require('../services/sysInfo');
const serviceManager = require('../services/serviceManager');
const cronManager = require('../services/cronManager');
const db = require('../config/db');

const IS_LINUX = os.platform() === 'linux';

// Semua route di bawah ini memerlukan JWT
router.use(verifyToken);

/* ==========================================
   SEGMENT: METRICS ROUTES
   ========================================== */

/**
 * GET /api/metrics
 * Return semua metrik sistem saat ini.
 */
router.get('/metrics', (req, res) => {
  try {
    const metrics = sysInfo.getAllMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: 'Failed to gather metrics.', detail: err.message });
  }
});

/**
 * GET /api/metrics/history?limit=100
 * Return data historis metrik dari SQLite.
 */
router.get('/metrics/history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const rows = db.prepare(
      'SELECT * FROM metrics_history ORDER BY timestamp DESC LIMIT ?'
    ).all(limit);

    res.json({ count: rows.length, data: rows.reverse() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch metrics history.', detail: err.message });
  }
});

/**
 * GET /api/processes?sort=cpu&limit=10
 * Return top processes by CPU or RAM usage.
 */
router.get('/processes', (req, res) => {
  try {
    const sortBy = req.query.sort === 'mem' ? 'mem' : 'cpu';
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);
    const data = sysInfo.getTopProcesses(sortBy, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get process list.', detail: err.message });
  }
});

/* ==========================================
   SEGMENT: SERVICE ROUTES
   ========================================== */

/**
 * GET /api/services
 * List status semua service di whitelist.
 */
router.get('/services', async (req, res) => {
  try {
    const services = await serviceManager.getAllServiceStatus();
    res.json({ services, whitelist: serviceManager.SERVICE_WHITELIST });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get service status.', detail: err.message });
  }
});

/**
 * POST /api/services/:name/:action
 * Kontrol service (start/stop/restart/enable/disable).
 */
router.post('/services/:name/:action', async (req, res) => {
  try {
    const { name, action } = req.params;
    const result = await serviceManager.controlService(name, action);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/system/power/:action
 * Kontrol daya sistem (reboot/shutdown).
 */
router.post('/system/power/:action', async (req, res) => {
  try {
    const { action } = req.params;
    const result = await serviceManager.executePowerAction(action);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ==========================================
   SEGMENT: LOG ROUTES
   ========================================== */

/**
 * GET /api/logs?service=nginx&lines=100
 * Baca log sistem via journalctl.
 */
router.get('/logs', (req, res) => {
  const service = (req.query.service || '').replace(/[^a-zA-Z0-9._-]/g, ''); // sanitize
  const lines = Math.min(parseInt(req.query.lines) || 50, 200);

  if (!IS_LINUX) {
    // Mock log data untuk Windows development
    const mockLogs = [];
    for (let i = 0; i < lines; i++) {
      const ts = new Date(Date.now() - (lines - i) * 60000).toISOString();
      mockLogs.push(`${ts} server ${service || 'system'}: Mock log entry #${i + 1}`);
    }
    return res.json({ service: service || 'system', lines: mockLogs.length, logs: mockLogs });
  }

  const cmd = service
    ? `journalctl -u ${service} -n ${lines} --no-pager 2>&1`
    : `journalctl -n ${lines} --no-pager 2>&1`;

  exec(cmd, { timeout: 10000, maxBuffer: 1024 * 512 }, (error, stdout) => {
    const logLines = stdout.split('\n').filter(l => l.trim());
    res.json({ service: service || 'system', lines: logLines.length, logs: logLines });
  });
});

/* ==========================================
   SEGMENT: CRON ROUTES
   ========================================== */

/**
 * GET /api/cron — List all cron jobs
 */
router.get('/cron', (req, res) => {
  try {
    const jobs = cronManager.listCron();
    res.json({ count: jobs.length, jobs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list cron jobs.', detail: err.message });
  }
});

/**
 * POST /api/cron — Add new cron job
 * Body: { schedule: "0 * * * *", command: "/path/to/script" }
 */
router.post('/cron', (req, res) => {
  try {
    const { schedule, command } = req.body;
    if (!schedule || !command) {
      return res.status(400).json({ error: 'Schedule and command are required.' });
    }
    const job = cronManager.addCron(schedule, command);
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add cron job.', detail: err.message });
  }
});

/**
 * PUT /api/cron/:id — Edit cron job
 * Body: { schedule: "0 * * * *", command: "/path/to/script" }
 */
router.put('/cron/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { schedule, command } = req.body;
    if (!schedule || !command) {
      return res.status(400).json({ error: 'Schedule and command are required.' });
    }
    const job = cronManager.editCron(id, schedule, command);
    res.json({ success: true, job });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/cron/:id — Delete cron job
 */
router.delete('/cron/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = cronManager.deleteCron(id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ==========================================
   SEGMENT: SETTINGS ROUTES
   ========================================== */

/**
 * GET /api/settings/telegram — Get Telegram config (masked)
 */
router.get('/settings/telegram', (req, res) => {
  const admin = db.prepare('SELECT telegram_chat_id, telegram_token FROM users WHERE id = 1').get();
  res.json({
    chatId: admin?.telegram_chat_id || '',
    token: admin?.telegram_token ? '***configured***' : '',
    configured: !!(admin?.telegram_chat_id && admin?.telegram_token)
  });
});

/**
 * PUT /api/settings/telegram — Update Telegram config
 * Body: { chatId: "123456", token: "bot123:ABC..." }
 */
router.put('/settings/telegram', (req, res) => {
  try {
    const { chatId, token } = req.body;
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required.' });
    }

    const admin = db.prepare('SELECT telegram_token FROM users WHERE id = 1').get();
    let finalToken = token;
    if (!token || token === '***configured***' || token.startsWith('***')) {
      if (admin && admin.telegram_token) {
        finalToken = admin.telegram_token;
      } else {
        return res.status(400).json({ error: 'Bot Token is required.' });
      }
    }

    db.prepare(
      'UPDATE users SET telegram_chat_id = ?, telegram_token = ? WHERE id = 1'
    ).run(chatId, finalToken);

    res.json({ success: true, message: 'Telegram configuration updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update Telegram settings.', detail: err.message });
  }
});

/* ==========================================
   SEGMENT: MODULE SETTINGS ROUTES
   ========================================== */

/**
 * GET /api/modules — Get all module settings
 */
router.get('/modules', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM app_settings').all();
    const modules = {};
    for (const row of rows) {
      modules[row.key] = row.value;
    }
    res.json({ modules });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch module settings.', detail: err.message });
  }
});

/**
 * PUT /api/modules/:key — Toggle module on/off
 * Body: { value: "1" | "0" }
 */
router.put('/modules/:key', (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    // Only allow known module keys
    const allowedKeys = ['module_filemanager'];
    if (!allowedKeys.includes(key)) {
      return res.status(400).json({ error: `Unknown module key: ${key}` });
    }

    if (value !== '0' && value !== '1') {
      return res.status(400).json({ error: 'Value must be "0" or "1".' });
    }

    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
    res.json({ success: true, key, value });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update module setting.', detail: err.message });
  }
});

/* ==========================================
   SEGMENT: FILE MANAGER ROUTES
   ========================================== */

const fileManager = require('../services/fileManager');
const multer = require('multer');

// Multer config: upload ke /mnt/ dengan limit 100MB
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = req.body.path || '/mnt';
      try {
        const safePath = fileManager.securePath(uploadPath);
        cb(null, safePath);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      // Gunakan nama file asli, sanitize karakter berbahaya
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, safeName);
    }
  }),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max
  }
});

/**
 * Middleware: cek apakah modul file manager aktif.
 */
function requireFileManager(req, res, next) {
  const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'module_filemanager'").get();
  if (!setting || setting.value !== '1') {
    return res.status(403).json({ error: 'File Manager module is disabled. Enable it in Settings.' });
  }
  next();
}

/**
 * GET /api/files?path=/mnt/xxx — List files in directory
 */
router.get('/files', requireFileManager, async (req, res) => {
  try {
    const dirPath = req.query.path || '/mnt';
    const result = await fileManager.listFiles(dirPath);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/files/download?path=/mnt/xxx — Download a file
 */
router.get('/files/download', requireFileManager, async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required.' });
    }

    const info = await fileManager.getDownloadInfo(filePath);

    if (info.source === 'mock') {
      // Mock download untuk Windows development
      res.setHeader('Content-Disposition', `attachment; filename="${info.filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(Buffer.from('Mock file content for development testing.'));
    }

    res.download(info.safePath, info.filename);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/files/preview?path=/mnt/xxx — Preview a file inline (supports media streaming & range requests)
 */
router.get('/files/preview', requireFileManager, async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required.' });
    }

    const info = await fileManager.getDownloadInfo(filePath);

    if (info.source === 'mock') {
      // Mock preview for Windows local testing
      // Send standard text or simulate responses
      const ext = info.filename.split('.').pop().toLowerCase();
      if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) {
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
          <rect width="100%" height="100%" fill="#1a1f2e"/>
          <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="sans-serif">Mock Image Preview (${info.filename})</text>
        </svg>`);
      }
      res.setHeader('Content-Type', 'text/plain');
      return res.send(`[Mock Preview Content for ${info.filename}]\nThis is a mock preview of the file content used for local Windows development.`);
    }

    // Express automatically handles HTTP Range requests and sets Content-Type based on extension
    res.sendFile(info.safePath);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/files/mkdir — Create new directory
 */
router.post('/files/mkdir', requireFileManager, async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      return res.status(400).json({ error: 'Path is required.' });
    }
    const result = await fileManager.createFolder(dirPath);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/files/rename — Rename file/folder
 */
router.post('/files/rename', requireFileManager, async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'oldPath and newPath are required.' });
    }
    const result = await fileManager.renameFile(oldPath, newPath);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/files?path=/mnt/xxx — Delete file or empty directory
 */
router.delete('/files', requireFileManager, async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required.' });
    }
    const result = await fileManager.deleteFile(filePath);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/files/upload — Upload file to directory
 * Multipart form: file + path
 */
router.post('/files/upload', requireFileManager, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    res.json({
      success: true,
      filename: req.file.filename,
      size: req.file.size,
      path: req.file.destination
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ==========================================
   SEGMENT: MODULE EXPORT
   ========================================== */

module.exports = router;
