/**
 * @file: serviceManager.js
 * @description: Wrapper systemctl — start/stop/restart/enable/disable service dengan whitelist keamanan
 * @dependencies: child_process, os
 * @state: Stable
 * @last_updated: 2026-07-06 v0.1.0
 */

const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const IS_LINUX = os.platform() === 'linux';

/* ==========================================
   SEGMENT: SERVICE WHITELIST
   ========================================== */

/**
 * Hanya service dalam whitelist yang boleh dikontrol.
 * Mencegah sabotase terhadap service sistem kritis.
 */
const STATIC_WHITELIST = [
  'nginx',
  'docker',
  'mariadb',
  'mysql',
  'ssh',
  'sshd',
  'zerotier-one',
  'smbd',
  'nmbd',
  'apache2',
  'postgresql',
  'monyx'
];

/**
 * Deteksi secara dinamis file service yang dibuat oleh administrator (user/root)
 * di /etc/systemd/system/*.service, digabung dengan default whitelist.
 * @returns {string[]}
 */
function getServiceWhitelist() {
  const whitelist = new Set(STATIC_WHITELIST);

  if (IS_LINUX) {
    const servicesDir = '/etc/systemd/system';
    try {
      if (fs.existsSync(servicesDir)) {
        const files = fs.readdirSync(servicesDir);
        for (const file of files) {
          if (file.endsWith('.service')) {
            const stat = fs.lstatSync(path.join(servicesDir, file));
            if (stat.isFile() || stat.isSymbolicLink()) {
              const serviceName = file.replace(/\.service$/, '');
              whitelist.add(serviceName);
            }
          }
        }
      }
    } catch (err) {
      console.error('[ServiceManager] Failed to read /etc/systemd/system:', err.message);
    }
  }

  return [...whitelist].sort();
}

const ALLOWED_ACTIONS = ['start', 'stop', 'restart', 'enable', 'disable', 'status'];

/* ==========================================
   SEGMENT: SERVICE CONTROL
   ========================================== */

/**
 * Eksekusi perintah systemctl pada service tertentu.
 * @param {string} service - Nama service (harus ada di whitelist)
 * @param {string} action  - Aksi: start|stop|restart|enable|disable|status
 * @returns {Promise<object>}
 */
function controlService(service, action) {
  return new Promise((resolve, reject) => {
    // Validasi whitelist
    const whitelist = getServiceWhitelist();
    if (!whitelist.includes(service)) {
      return reject(new Error(`Service "${service}" is not in the whitelist.`));
    }

    // Validasi aksi
    if (!ALLOWED_ACTIONS.includes(action)) {
      return reject(new Error(`Action "${action}" is not allowed. Use: ${ALLOWED_ACTIONS.join(', ')}`));
    }

    // Mock untuk Windows development
    if (!IS_LINUX) {
      return resolve({
        service,
        action,
        success: true,
        output: `[Mock] systemctl ${action} ${service} — executed successfully`,
        source: 'mock'
      });
    }

    const cmd = `sudo systemctl ${action} ${service} 2>&1`;
    exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error && action !== 'status') {
        return reject(new Error(`Failed to ${action} ${service}: ${stderr || error.message}`));
      }

      resolve({
        service,
        action,
        success: true,
        output: stdout.trim() || `${action} executed successfully`,
        source: 'systemctl'
      });
    });
  });
}

/* ==========================================
   SEGMENT: SERVICE STATUS CHECKER
   ========================================== */

/**
 * Ambil status semua service di whitelist.
 * Return array objek { name, active, enabled, status }.
 */
function getAllServiceStatus() {
  return new Promise((resolve) => {
    if (!IS_LINUX) {
      // Mock data untuk Windows development
      const whitelist = getServiceWhitelist();
      const mockStatuses = whitelist.map(name => {
        const isActive = Math.random() > 0.3;
        return {
          name,
          active: isActive,
          enabled: isActive || Math.random() > 0.5,
          status: isActive ? 'active (running)' : 'inactive (dead)',
          source: 'mock'
        };
      });
      return resolve(mockStatuses);
    }

    const whitelist = getServiceWhitelist();
    const promises = whitelist.map(service => {
      return new Promise((res) => {
        exec(`systemctl is-active ${service} 2>/dev/null`, (err, stdout) => {
          const isActive = stdout.trim() === 'active';
          exec(`systemctl is-enabled ${service} 2>/dev/null`, (err2, stdout2) => {
            const isEnabled = stdout2.trim() === 'enabled';
            res({
              name: service,
              active: isActive,
              enabled: isEnabled,
              status: isActive ? 'active (running)' : 'inactive (dead)',
              source: 'systemctl'
            });
          });
        });
      });
    });

    Promise.all(promises).then(resolve);
  });
}

/* ==========================================
   SEGMENT: SYSTEM POWER CONTROL
   ========================================== */

/**
 * Jalankan perintah shutdown atau reboot secara asinkron.
 * @param {string} action - reboot|shutdown
 * @returns {Promise<object>}
 */
function executePowerAction(action) {
  return new Promise((resolve, reject) => {
    if (action !== 'reboot' && action !== 'shutdown') {
      return reject(new Error('Invalid power action. Use reboot or shutdown.'));
    }

    const cmd = action === 'reboot' ? 'sudo reboot' : 'sudo poweroff';

    if (!IS_LINUX) {
      return resolve({
        success: true,
        action,
        output: `[Mock] Executed: ${cmd}`,
        source: 'mock'
      });
    }

    // Eksekusi asinkron agar server bisa merespon request HTTP sebelum mati/restart
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`[System] Power action ${action} error:`, stderr || error.message);
      }
    });

    resolve({
      success: true,
      action,
      output: `Initiating ${action}...`,
      source: 'system'
    });
  });
}

/* ==========================================
   SEGMENT: MODULE EXPORT
   ========================================== */

module.exports = {
  get SERVICE_WHITELIST() {
    return getServiceWhitelist();
  },
  ALLOWED_ACTIONS,
  controlService,
  getAllServiceStatus,
  executePowerAction
};
