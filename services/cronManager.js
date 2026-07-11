/**
 * @file: cronManager.js
 * @description: Parser & writer crontab — CRUD cron jobs dengan backup otomatis
 * @dependencies: child_process, fs, os, path
 * @state: Stable
 * @last_updated: 2026-07-06 v0.1.0
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_LINUX = os.platform() === 'linux';

/* ==========================================
   SEGMENT: MOCK DATA (WINDOWS DEVELOPMENT)
   ========================================== */

let mockCronJobs = [
  { id: 1, schedule: '0 */6 * * *', command: '/usr/bin/certbot renew', enabled: true },
  { id: 2, schedule: '0 3 * * *', command: '/opt/backup.sh', enabled: true },
  { id: 3, schedule: '*/5 * * * *', command: '/usr/local/bin/health-check.sh', enabled: true }
];
let mockIdCounter = 4;

/* ==========================================
   SEGMENT: CRONTAB PARSER
   ========================================== */

/**
 * Baca dan parse crontab menjadi array objek JSON.
 * @returns {Array<{id, schedule, command, enabled}>}
 */
function listCron() {
  if (!IS_LINUX) {
    return [...mockCronJobs];
  }

  try {
    const output = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
    const lines = output.split('\n').filter(l => l.trim() && !l.startsWith('#'));

    return lines.map((line, index) => {
      const enabled = !line.startsWith('#');
      const cleanLine = enabled ? line : line.replace(/^#\s*/, '');
      const parts = cleanLine.trim().split(/\s+/);
      const schedule = parts.slice(0, 5).join(' ');
      const command = parts.slice(5).join(' ');

      return { id: index + 1, schedule, command, enabled };
    });
  } catch (_) {
    return []; // No crontab for this user
  }
}

/* ==========================================
   SEGMENT: CRONTAB BACKUP
   ========================================== */

/**
 * Backup crontab saat ini ke file temp sebelum modifikasi.
 */
function backupCrontab() {
  if (!IS_LINUX) return;

  try {
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `crontab-backup-${timestamp}.txt`);

    const current = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
    fs.writeFileSync(backupFile, current);
    console.log(`[Cron] Backup saved: ${backupFile}`);
  } catch (_) {
    console.log('[Cron] No existing crontab to backup.');
  }
}

/* ==========================================
   SEGMENT: CRONTAB WRITER
   ========================================== */

/**
 * Tulis ulang crontab dari array jobs.
 * @param {Array} jobs - Array cron job objects
 */
function writeCrontab(jobs) {
  if (!IS_LINUX) return;

  backupCrontab();

  const cronContent = jobs
    .map(j => `${j.enabled ? '' : '# '}${j.schedule} ${j.command}`)
    .join('\n') + '\n';

  try {
    execSync(`echo "${cronContent}" | crontab -`, { encoding: 'utf8' });
    console.log('[Cron] Crontab updated successfully.');
  } catch (err) {
    throw new Error(`Failed to write crontab: ${err.message}`);
  }
}

/* ==========================================
   SEGMENT: CRUD OPERATIONS
   ========================================== */

/**
 * Tambah cron job baru.
 * @param {string} schedule - Cron expression (e.g. "0 * * * *")
 * @param {string} command  - Command to execute
 */
function addCron(schedule, command) {
  if (!IS_LINUX) {
    const newJob = { id: mockIdCounter++, schedule, command, enabled: true };
    mockCronJobs.push(newJob);
    return newJob;
  }

  const jobs = listCron();
  const newJob = { id: jobs.length + 1, schedule, command, enabled: true };
  jobs.push(newJob);
  writeCrontab(jobs);
  return newJob;
}

/**
 * Edit cron job berdasarkan ID.
 * @param {number} id - Job ID
 * @param {string} schedule - New cron expression
 * @param {string} command  - New command
 */
function editCron(id, schedule, command) {
  if (!IS_LINUX) {
    const idx = mockCronJobs.findIndex(j => j.id === id);
    if (idx === -1) throw new Error(`Cron job #${id} not found.`);
    mockCronJobs[idx] = { ...mockCronJobs[idx], schedule, command };
    return mockCronJobs[idx];
  }

  const jobs = listCron();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx === -1) throw new Error(`Cron job #${id} not found.`);
  jobs[idx] = { ...jobs[idx], schedule, command };
  writeCrontab(jobs);
  return jobs[idx];
}

/**
 * Hapus cron job berdasarkan ID.
 * @param {number} id - Job ID
 */
function deleteCron(id) {
  if (!IS_LINUX) {
    const idx = mockCronJobs.findIndex(j => j.id === id);
    if (idx === -1) throw new Error(`Cron job #${id} not found.`);
    mockCronJobs.splice(idx, 1);
    return { deleted: true, id };
  }

  const jobs = listCron();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx === -1) throw new Error(`Cron job #${id} not found.`);
  jobs.splice(idx, 1);
  writeCrontab(jobs);
  return { deleted: true, id };
}

/* ==========================================
   SEGMENT: MODULE EXPORT
   ========================================== */

module.exports = {
  listCron,
  addCron,
  editCron,
  deleteCron
};
