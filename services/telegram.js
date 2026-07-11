/**
 * @file: telegram.js
 * @description: Modul notifikasi Telegram Bot — kirim alert, monitoring berkala, server online notification
 * @dependencies: https (built-in), config/db
 * @state: Stable
 * @last_updated: 2026-07-06 v0.1.0
 */

const https = require('https');
const db = require('../config/db');

/* ==========================================
   SEGMENT: TELEGRAM API SENDER
   ========================================== */

/**
 * Kirim pesan via Telegram Bot API.
 * @param {string} chatId - Telegram chat ID
 * @param {string} token  - Bot token
 * @param {string} message - Pesan teks (mendukung HTML parse_mode)
 * @returns {Promise<object>}
 */
function sendMessage(chatId, token, message) {
  return new Promise((resolve, reject) => {
    if (!chatId || !token) {
      return reject(new Error('Telegram chatId or token not configured.'));
    }

    const postData = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) {
            resolve(parsed);
          } else {
            reject(new Error(`Telegram API error: ${parsed.description}`));
          }
        } catch (e) {
          reject(new Error('Failed to parse Telegram response.'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/* ==========================================
   SEGMENT: NOTIFICATION HELPERS
   ========================================== */

/**
 * Ambil konfigurasi Telegram dari database.
 * @returns {{ chatId: string|null, token: string|null }}
 */
function getTelegramConfig() {
  const admin = db.prepare('SELECT telegram_chat_id, telegram_token FROM users WHERE id = 1').get();
  return {
    chatId: admin?.telegram_chat_id || null,
    token: admin?.telegram_token || null
  };
}

/**
 * Kirim notifikasi menggunakan konfigurasi dari database.
 * @param {string} message - Pesan yang akan dikirim
 */
async function sendNotification(message) {
  const config = getTelegramConfig();
  if (!config.chatId || !config.token) {
    console.log('[Telegram] Not configured, skipping notification.');
    return;
  }

  try {
    await sendMessage(config.chatId, config.token, message);
    console.log('[Telegram] Notification sent successfully.');
  } catch (err) {
    console.error('[Telegram] Failed to send:', err.message);
  }
}

/* ==========================================
   SEGMENT: ALERT FORMATTERS
   ========================================== */

function alertHighRAM(percent) {
  return `⚠️ <b>RAM KRITIS</b>\nPenggunaan RAM: <b>${percent}%</b>\nBatas aman: 90%\n\n⏰ ${new Date().toLocaleString('id-ID')}`;
}

function alertRamResolved(percent) {
  return `✅ <b>RAM KEMBALI NORMAL</b>\nPenggunaan RAM: <b>${percent}%</b>\n\n⏰ ${new Date().toLocaleString('id-ID')}`;
}

function alertHighTemp(temp) {
  return `🔥 <b>SUHU CPU KRITIS</b>\nSuhu: <b>${temp}°C</b>\nBatas aman: 80°C\n\n⏰ ${new Date().toLocaleString('id-ID')}`;
}

function alertTempResolved(temp) {
  return `✅ <b>SUHU CPU KEMBALI NORMAL</b>\nSuhu: <b>${temp}°C</b>\n\n⏰ ${new Date().toLocaleString('id-ID')}`;
}

function alertHighDisk(percent, mountpoint) {
  return `💾 <b>PENYIMPANAN HAMPIR PENUH</b>\nPartisi: <code>${mountpoint}</code>\nPenggunaan: <b>${percent}%</b>\nBatas aman: 90%\n\n⏰ ${new Date().toLocaleString('id-ID')}`;
}

function alertServiceDown(serviceName) {
  return `🔴 <b>SERVICE DOWN</b>\nService <code>${serviceName}</code> telah berhenti!\n\n⏰ ${new Date().toLocaleString('id-ID')}`;
}

function alertServiceUp(serviceName) {
  return `🟢 <b>SERVICE UP</b>\nService <code>${serviceName}</code> telah berjalan kembali.\n\n⏰ ${new Date().toLocaleString('id-ID')}`;
}

function alertServerOnline() {
  return `🟢 <b>Server Online</b>\nServer berhasil boot dan backend Monyx aktif.\n\n⏰ ${new Date().toLocaleString('id-ID')}`;
}

/* ==========================================
   SEGMENT: ANOMALY MONITORING WITH RATE LIMITS
   ========================================== */

let monitorInterval = null;
let previousServiceStates = {};
let activeAlerts = {
  ram: false,
  temp: false,
  disk: {}
};
let lastAlertTimes = {
  ram: 0,
  temp: 0,
  disk: {}
};

const ALERT_COOLDOWN = 3600000; // 1 Jam cooldown untuk RAM & Temp
const DISK_COOLDOWN = 21600000;  // 6 Jam cooldown untuk Disk

/**
 * Jalankan monitoring berkala setiap `intervalMs` milidetik.
 * Cek RAM, CPU Temp, Disk, dan status service whitelist.
 */
function startMonitoring(sysInfo, serviceManager, intervalMs = 300000) {
  // Kirim notifikasi Server Online saat pertama boot
  sendNotification(alertServerOnline());

  monitorInterval = setInterval(async () => {
    try {
      const now = Date.now();

      // 1. Cek RAM
      const mem = sysInfo.getMemoryUsage();
      if (mem.percent > 90) {
        if (!activeAlerts.ram || (now - lastAlertTimes.ram > ALERT_COOLDOWN)) {
          sendNotification(alertHighRAM(mem.percent));
          activeAlerts.ram = true;
          lastAlertTimes.ram = now;
        }
      } else if (mem.percent < 85 && activeAlerts.ram) {
        sendNotification(alertRamResolved(mem.percent));
        activeAlerts.ram = false;
        lastAlertTimes.ram = 0;
      }

      // 2. Cek CPU Temperature
      const cpu = sysInfo.getCpuTemp();
      if (cpu.temp > 80) {
        if (!activeAlerts.temp || (now - lastAlertTimes.temp > ALERT_COOLDOWN)) {
          sendNotification(alertHighTemp(cpu.temp));
          activeAlerts.temp = true;
          lastAlertTimes.temp = now;
        }
      } else if (cpu.temp < 75 && activeAlerts.temp) {
        sendNotification(alertTempResolved(cpu.temp));
        activeAlerts.temp = false;
        lastAlertTimes.temp = 0;
      }

      // 3. Cek Disk Storage utama & partisi
      const disk = sysInfo.getDiskUsage();
      if (disk.percent > 90) {
        const lastDiskAlert = lastAlertTimes.disk['root'] || 0;
        if (now - lastDiskAlert > DISK_COOLDOWN) {
          sendNotification(alertHighDisk(disk.percent, '/'));
          lastAlertTimes.disk['root'] = now;
        }
      }
      
      // Partisi tambahan
      if (disk.partitions && disk.partitions.length > 0) {
        for (const part of disk.partitions) {
          if (part.percent > 90) {
            const lastPartAlert = lastAlertTimes.disk[part.mountpoint] || 0;
            if (now - lastPartAlert > DISK_COOLDOWN) {
              sendNotification(alertHighDisk(part.percent, part.mountpoint));
              lastAlertTimes.disk[part.mountpoint] = now;
            }
          }
        }
      }

      // 4. Cek Service Status
      const services = await serviceManager.getAllServiceStatus();
      for (const svc of services) {
        const prevActive = previousServiceStates[svc.name];
        
        if (prevActive === true && svc.active === false) {
          sendNotification(alertServiceDown(svc.name));
        } else if (prevActive === false && svc.active === true) {
          sendNotification(alertServiceUp(svc.name));
        }
        
        previousServiceStates[svc.name] = svc.active;
      }
    } catch (err) {
      console.error('[Monitor] Error during anomaly check:', err.message);
    }
  }, intervalMs);

  console.log(`[Monitor] Anomaly monitoring started (interval: ${intervalMs / 1000}s)`);
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[Monitor] Anomaly monitoring stopped.');
  }
}

/* ==========================================
   SEGMENT: MODULE EXPORT
   ========================================== */

module.exports = {
  sendMessage,
  sendNotification,
  getTelegramConfig,
  alertHighRAM,
  alertHighTemp,
  alertServiceDown,
  alertServerOnline,
  startMonitoring,
  stopMonitoring
};
