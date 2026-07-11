/**
 * @file: fileManager.js
 * @description: Service manajemen file di path /mnt/ — list, create, rename, delete, info.
 *               Dilengkapi keamanan path traversal dan mock data untuk Windows development.
 * @dependencies: fs, path, os
 * @state: Stable
 * @last_updated: 2026-07-08 v0.1.0
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_LINUX = os.platform() === 'linux';
const BASE_PATH = '/mnt';

/* ==========================================
   SEGMENT: PATH SECURITY
   ========================================== */

/**
 * Validasi dan resolve path agar selalu berada di dalam /mnt/.
 * Mencegah path traversal attack (../../etc/passwd).
 * @param {string} requestedPath - Path yang diminta oleh client
 * @returns {string} Resolved absolute path
 * @throws {Error} Jika path di luar /mnt/
 */
function securePath(requestedPath) {
  if (!requestedPath) {
    return BASE_PATH;
  }

  // Block explicit traversal patterns
  if (requestedPath.includes('..')) {
    throw new Error('Path traversal detected: ".." is not allowed.');
  }

  const resolved = path.resolve(BASE_PATH, requestedPath);

  // Normalize paths for cross-platform comparison
  const resolvedCompare = resolved.replace(/^[a-zA-Z]:/, '').replace(/\\/g, '/');
  const baseCompare = path.resolve(BASE_PATH).replace(/^[a-zA-Z]:/, '').replace(/\\/g, '/');

  // Pastikan path dimulai dengan /mnt
  if (!resolvedCompare.startsWith(baseCompare)) {
    throw new Error(`Access denied: path must be under ${BASE_PATH}/`);
  }

  return resolved;
}

/* ==========================================
   SEGMENT: MOCK DATA (WINDOWS DEVELOPMENT)
   ========================================== */

function getMockFiles() {
  const now = Date.now();
  return [
    { name: 'usb-share', type: 'directory', size: 0, modified: new Date(now - 86400000).toISOString(), permissions: 'drwxr-xr-x' },
    { name: 'backup-hdd', type: 'directory', size: 0, modified: new Date(now - 172800000).toISOString(), permissions: 'drwxr-xr-x' },
    { name: 'readme.txt', type: 'file', size: 1024, modified: new Date(now - 3600000).toISOString(), permissions: '-rw-r--r--' },
    { name: 'server-backup.tar.gz', type: 'file', size: 524288000, modified: new Date(now - 7200000).toISOString(), permissions: '-rw-r--r--' },
    { name: 'photos', type: 'directory', size: 0, modified: new Date(now - 259200000).toISOString(), permissions: 'drwxr-xr-x' },
    { name: 'database-dump.sql', type: 'file', size: 15728640, modified: new Date(now - 1800000).toISOString(), permissions: '-rw-r--r--' }
  ];
}

function getMockSubFiles() {
  const now = Date.now();
  return [
    { name: 'document.pdf', type: 'file', size: 2097152, modified: new Date(now - 600000).toISOString(), permissions: '-rw-r--r--' },
    { name: 'image.jpg', type: 'file', size: 4194304, modified: new Date(now - 1200000).toISOString(), permissions: '-rw-r--r--' },
    { name: 'subfolder', type: 'directory', size: 0, modified: new Date(now - 2400000).toISOString(), permissions: 'drwxr-xr-x' }
  ];
}

/* ==========================================
   SEGMENT: LIST FILES
   ========================================== */

/**
 * List isi direktori di path yang diberikan secara asynchronous.
 * @param {string} dirPath - Path relatif terhadap /mnt/
 * @returns {Promise<{ path: string, files: Array, source: string }>}
 */
async function listFiles(dirPath) {
  const safePath = securePath(dirPath);

  if (!IS_LINUX) {
    // Mock data untuk Windows development
    const isRoot = !dirPath || dirPath === '/' || dirPath === BASE_PATH;
    return {
      path: safePath,
      files: isRoot ? getMockFiles() : getMockSubFiles(),
      source: 'mock'
    };
  }

  try {
    const stat = await fs.promises.stat(safePath);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${safePath}`);
    }
  } catch (err) {
    throw new Error(`Directory not found: ${safePath}`);
  }

  const entries = await fs.promises.readdir(safePath, { withFileTypes: true });
  
  // Baca detail file secara paralel untuk performa maksimal
  const filePromises = entries.map(async (entry) => {
    try {
      const fullPath = path.join(safePath, entry.name);
      const entryStat = await fs.promises.stat(fullPath);
      const isDir = entry.isDirectory();

      return {
        name: entry.name,
        type: isDir ? 'directory' : 'file',
        size: isDir ? 0 : entryStat.size,
        modified: entryStat.mtime.toISOString(),
        permissions: formatPermissions(entryStat.mode, isDir)
      };
    } catch (err) {
      // Skip file yang gagal dibaca stat-nya
      return null;
    }
  });

  const resolvedFiles = await Promise.all(filePromises);
  const files = resolvedFiles.filter(f => f !== null);

  // Sort: folder dulu, baru file secara alfabetis
  files.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    path: safePath,
    files,
    source: 'fs'
  };
}

/* ==========================================
   SEGMENT: FILE INFO
   ========================================== */

/**
 * Ambil metadata detail dari sebuah file secara asynchronous.
 * @param {string} filePath - Path relatif terhadap /mnt/
 * @returns {Promise<object>}
 */
async function getFileInfo(filePath) {
  const safePath = securePath(filePath);

  if (!IS_LINUX) {
    return {
      name: path.basename(safePath),
      path: safePath,
      type: 'file',
      size: 1024,
      modified: new Date().toISOString(),
      source: 'mock'
    };
  }

  try {
    const stat = await fs.promises.stat(safePath);
    return {
      name: path.basename(safePath),
      path: safePath,
      type: stat.isDirectory() ? 'directory' : 'file',
      size: stat.size,
      modified: stat.mtime.toISOString(),
      permissions: formatPermissions(stat.mode, stat.isDirectory()),
      source: 'fs'
    };
  } catch (err) {
    throw new Error(`File not found: ${safePath}`);
  }
}

/* ==========================================
   SEGMENT: CREATE FOLDER
   ========================================== */

/**
 * Buat folder baru di dalam /mnt/.
 * @param {string} dirPath - Path folder yang akan dibuat
 * @returns {Promise<{ success: boolean, path: string }>}
 */
async function createFolder(dirPath) {
  const safePath = securePath(dirPath);

  if (!IS_LINUX) {
    return { success: true, path: safePath, source: 'mock' };
  }

  try {
    await fs.promises.access(safePath);
    throw new Error(`Already exists: ${safePath}`);
  } catch (err) {
    if (err.message.startsWith('Already exists:')) {
      throw err;
    }
  }

  await fs.promises.mkdir(safePath, { recursive: true });
  return { success: true, path: safePath, source: 'fs' };
}

/* ==========================================
   SEGMENT: RENAME FILE/FOLDER
   ========================================== */

/**
 * Rename file atau folder di dalam /mnt/.
 * @param {string} oldPath - Path lama
 * @param {string} newPath - Path baru
 * @returns {Promise<{ success: boolean, oldPath: string, newPath: string }>}
 */
async function renameFile(oldPath, newPath) {
  const safeOld = securePath(oldPath);
  const safeNew = securePath(newPath);

  if (!IS_LINUX) {
    return { success: true, oldPath: safeOld, newPath: safeNew, source: 'mock' };
  }

  try {
    await fs.promises.access(safeOld);
  } catch (err) {
    throw new Error(`Not found: ${safeOld}`);
  }

  try {
    await fs.promises.access(safeNew);
    throw new Error(`Target already exists: ${safeNew}`);
  } catch (err) {
    if (err.message.startsWith('Target already exists:')) {
      throw err;
    }
  }

  await fs.promises.rename(safeOld, safeNew);
  return { success: true, oldPath: safeOld, newPath: safeNew, source: 'fs' };
}

/* ==========================================
   SEGMENT: DELETE FILE
   ========================================== */

/**
 * Hapus file tunggal atau folder kosong di dalam /mnt/.
 * TIDAK mendukung recursive delete untuk keamanan.
 * @param {string} filePath - Path file/folder yang akan dihapus
 * @returns {Promise<{ success: boolean, path: string }>}
 */
async function deleteFile(filePath) {
  const safePath = securePath(filePath);

  // Cegah penghapusan root /mnt itu sendiri
  if (safePath === BASE_PATH) {
    throw new Error('Cannot delete the base mount path.');
  }

  if (!IS_LINUX) {
    return { success: true, path: safePath, source: 'mock' };
  }

  let stat;
  try {
    stat = await fs.promises.stat(safePath);
  } catch (err) {
    throw new Error(`Not found: ${safePath}`);
  }

  if (stat.isDirectory()) {
    // Hanya folder kosong yang bisa dihapus
    const contents = await fs.promises.readdir(safePath);
    if (contents.length > 0) {
      throw new Error('Directory is not empty. Only empty directories can be deleted.');
    }
    await fs.promises.rmdir(safePath);
  } else {
    await fs.promises.unlink(safePath);
  }

  return { success: true, path: safePath, source: 'fs' };
}

/* ==========================================
   SEGMENT: DOWNLOAD FILE STREAM
   ========================================== */

/**
 * Ambil path aman untuk streaming download secara asynchronous.
 * @param {string} filePath - Path file yang akan didownload
 * @returns {Promise<{ safePath: string, filename: string, size: number }>}
 */
async function getDownloadInfo(filePath) {
  const safePath = securePath(filePath);

  if (!IS_LINUX) {
    return {
      safePath,
      filename: path.basename(safePath),
      size: 1024,
      source: 'mock'
    };
  }

  let stat;
  try {
    stat = await fs.promises.stat(safePath);
  } catch (err) {
    throw new Error(`File not found: ${safePath}`);
  }

  if (stat.isDirectory()) {
    throw new Error('Cannot download a directory.');
  }

  return {
    safePath,
    filename: path.basename(safePath),
    size: stat.size,
    source: 'fs'
  };
}

/* ==========================================
   SEGMENT: HELPER — PERMISSION FORMATTER
   ========================================== */

/**
 * Format mode numerik Unix menjadi string rwx.
 * @param {number} mode - File mode (numeric)
 * @param {boolean} isDir - Apakah ini direktori
 * @returns {string} Misal: "drwxr-xr-x" atau "-rw-r--r--"
 */
function formatPermissions(mode, isDir) {
  const perms = [
    (mode & 0o400) ? 'r' : '-',
    (mode & 0o200) ? 'w' : '-',
    (mode & 0o100) ? 'x' : '-',
    (mode & 0o040) ? 'r' : '-',
    (mode & 0o020) ? 'w' : '-',
    (mode & 0o010) ? 'x' : '-',
    (mode & 0o004) ? 'r' : '-',
    (mode & 0o002) ? 'w' : '-',
    (mode & 0o001) ? 'x' : '-'
  ].join('');

  return (isDir ? 'd' : '-') + perms;
}

/* ==========================================
   SEGMENT: MODULE EXPORT
   ========================================== */

module.exports = {
  BASE_PATH,
  securePath,
  listFiles,
  getFileInfo,
  createFolder,
  renameFile,
  deleteFile,
  getDownloadInfo
};
