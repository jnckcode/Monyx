/**
 * @file: cronManager.js
 * @description: Parser & writer crontab — CRUD cron jobs dengan backup otomatis dan pelestarian komentar/env
 * @dependencies: child_process, fs, os, path
 * @state: Stable
 * @last_updated: 2026-07-12 v0.3.0
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
   SEGMENT: DETECT TARGET CRON USER
   ========================================== */

/**
 * Mendeteksi user mana yang memiliki file crontab aktif.
 * Jika root tidak memiliki crontab aktif tetapi ada user lain (misal: 'armbian'),
 * maka kelola crontab milik user tersebut.
 */
function getCronUser() {
  if (!IS_LINUX) return 'root';

  try {
    const cronPath = '/var/spool/cron/crontabs';
    if (fs.existsSync(cronPath)) {
      const files = fs.readdirSync(cronPath);

      // Periksa apakah root memiliki crontab aktif dan berisi pekerjaan riil
      if (files.includes('root')) {
        const rootContent = fs.readFileSync(path.join(cronPath, 'root'), 'utf8').trim();
        const hasJobs = rootContent.split('\n').some(line => {
          const t = line.trim();
          return t && !t.startsWith('#') && !t.includes('=');
        });
        if (hasJobs) {
          return 'root';
        }
      }

      // Jika root kosong/tidak ada, cari user non-root aktif lainnya (seperti armbian, pi, dsb)
      const otherUsers = files.filter(f => f !== 'root' && !f.startsWith('.'));
      if (otherUsers.length > 0) {
        return otherUsers[0]; // Gunakan user aktif pertama
      }
    }
  } catch (err) {
    console.error('[Cron] Gagal mendeteksi target user crontab:', err.message);
  }

  return 'root';
}

/* ==========================================
   SEGMENT: CRONTAB BACKUP & INTERNALS
   ========================================== */

/**
 * Melakukan backup crontab saat ini sebelum dimodifikasi.
 */
function backupCrontab(user) {
  if (!IS_LINUX) return;

  try {
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `crontab-${user}-backup-${timestamp}.txt`);

    const current = execSync(`crontab -u ${user} -l 2>/dev/null`, { encoding: 'utf8' });
    fs.writeFileSync(backupFile, current);
    console.log(`[Cron] Backup disimpan untuk user ${user}: ${backupFile}`);
  } catch (_) {
    console.log(`[Cron] Tidak ada crontab yang perlu dibackup untuk user ${user}.`);
  }
}

/**
 * Membaca crontab dan mengubahnya menjadi array objek (menjaga komentar dan variabel).
 */
function readCrontabObjects(user) {
  try {
    const output = execSync(`crontab -u ${user} -l 2>/dev/null`, { encoding: 'utf8' });
    const lines = output.split('\n');
    const objects = [];
    let jobId = 1;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        objects.push({ type: 'empty', value: line });
        continue;
      }

      // Lewati baris variabel lingkungan
      if (/^[A-Za-z0-9_]+=/.test(trimmed)) {
        objects.push({ type: 'env', value: line });
        continue;
      }

      // Cek apakah komentar atau baris dinonaktifkan
      const isCommented = trimmed.startsWith('#');
      const cleanLine = isCommented ? trimmed.replace(/^#\s*/, '') : trimmed;
      const parts = cleanLine.split(/\s+/);

      // Cek apakah ada minimal 6 bagian (5 schedule + 1 command)
      if (parts.length < 6) {
        objects.push({ type: 'comment', value: line });
        continue;
      }

      // Validasi ekspresi jadwal cron
      const scheduleParts = parts.slice(0, 5);
      const isValidCronSchedule = scheduleParts.every(part => 
        /^[0-9*,\/-]+$/.test(part)
      );

      if (!isValidCronSchedule) {
        objects.push({ type: 'comment', value: line });
        continue;
      }

      // Valid cron job!
      objects.push({
        type: 'job',
        id: jobId++,
        schedule: scheduleParts.join(' '),
        command: parts.slice(5).join(' '),
        enabled: !isCommented
      });
    }

    return objects;
  } catch (_) {
    return []; // Jika tidak ada crontab
  }
}

/**
 * Menulis kembali array objek ke crontab secara aman menggunakan stdin.
 */
function writeCrontabObjects(user, objects) {
  if (!IS_LINUX) return;

  backupCrontab(user);

  const cronContent = objects
    .map(obj => {
      if (obj.type === 'job') {
        return `${obj.enabled ? '' : '# '}${obj.schedule} ${obj.command}`;
      } else {
        return obj.value;
      }
    })
    .join('\n') + '\n';

  try {
    // Menulis konten secara aman ke stdin perintah crontab untuk menghindari shell injection
    execSync(`crontab -u ${user} -`, { input: cronContent, encoding: 'utf8' });
    console.log(`[Cron] Crontab untuk user ${user} berhasil diperbarui.`);
  } catch (err) {
    throw new Error(`Gagal menulis crontab: ${err.message}`);
  }
}

/* ==========================================
   SEGMENT: CRUD OPERATIONS
   ========================================== */

/**
 * Mengambil daftar cron jobs (hanya tipe job).
 */
function listCron() {
  const user = getCronUser();
  if (!IS_LINUX) {
    return [...mockCronJobs];
  }

  const objects = readCrontabObjects(user);
  return objects.filter(obj => obj.type === 'job');
}

/**
 * Menambahkan cron job baru ke daftar.
 */
function addCron(schedule, command) {
  const user = getCronUser();
  if (!IS_LINUX) {
    const newJob = { id: mockIdCounter++, schedule, command, enabled: true };
    mockCronJobs.push(newJob);
    return newJob;
  }

  const objects = readCrontabObjects(user);
  const nextId = objects.reduce((max, obj) => {
    if (obj.type === 'job' && obj.id > max) return obj.id;
    return max;
  }, 0) + 1;

  const newJob = {
    type: 'job',
    id: nextId,
    schedule,
    command,
    enabled: true
  };
  objects.push(newJob);
  writeCrontabObjects(user, objects);
  return { id: nextId, schedule, command, enabled: true };
}

/**
 * Mengedit cron job yang sudah ada.
 */
function editCron(id, schedule, command) {
  const user = getCronUser();
  if (!IS_LINUX) {
    const idx = mockCronJobs.findIndex(j => j.id === id);
    if (idx === -1) throw new Error(`Cron job #${id} tidak ditemukan.`);
    mockCronJobs[idx] = { ...mockCronJobs[idx], schedule, command };
    return mockCronJobs[idx];
  }

  const objects = readCrontabObjects(user);
  const job = objects.find(obj => obj.type === 'job' && obj.id === id);
  if (!job) throw new Error(`Cron job #${id} tidak ditemukan.`);
  
  job.schedule = schedule;
  job.command = command;
  
  writeCrontabObjects(user, objects);
  return { id, schedule, command, enabled: job.enabled };
}

/**
 * Menghapus cron job berdasarkan ID.
 */
function deleteCron(id) {
  const user = getCronUser();
  if (!IS_LINUX) {
    const idx = mockCronJobs.findIndex(j => j.id === id);
    if (idx === -1) throw new Error(`Cron job #${id} tidak ditemukan.`);
    mockCronJobs.splice(idx, 1);
    return { deleted: true, id };
  }

  const objects = readCrontabObjects(user);
  const index = objects.findIndex(obj => obj.type === 'job' && obj.id === id);
  if (index === -1) throw new Error(`Cron job #${id} tidak ditemukan.`);
  
  objects.splice(index, 1);
  writeCrontabObjects(user, objects);
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
