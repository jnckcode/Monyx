/**
 * @file: sysInfo.js
 * @description: Pembaca metrik sistem Armbian — CPU temp/usage, RAM, Disk (semua partisi + USB),
 *               Network (semua interface + IP), Uptime, Load, dan info OS detail.
 *               Dioptimalkan untuk pembacaan langsung dari /proc & /sys tanpa dependensi eksternal.
 * @dependencies: fs, child_process, os
 * @state: Stable
 * @last_updated: 2026-07-06 v0.2.0
 */

const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

/* ==========================================
   SEGMENT: PLATFORM DETECTION
   ========================================== */

const IS_LINUX = os.platform() === 'linux';

/* ==========================================
   SEGMENT: CPU TEMPERATURE (MULTI-ZONE)
   ========================================== */

/**
 * Ambil suhu CPU dari semua thermal zone yang tersedia.
 * Armbian SBC biasanya punya beberapa zone: cpu-thermal, gpu-thermal, dll.
 * Return zona utama (tertinggi) sebagai .temp dan semua zona sebagai .zones[]
 */
function getCpuTemp() {
  if (!IS_LINUX) return { temp: 45.0, unit: '°C', source: 'mock', zones: [] };

  const zones = [];

  try {
    // Scan semua thermal zones
    const thermalBase = '/sys/class/thermal';
    if (fs.existsSync(thermalBase)) {
      const entries = fs.readdirSync(thermalBase).filter(e => e.startsWith('thermal_zone'));
      for (const entry of entries) {
        try {
          const tempPath = `${thermalBase}/${entry}/temp`;
          const typePath = `${thermalBase}/${entry}/type`;
          const raw = fs.readFileSync(tempPath, 'utf8').trim();
          const temp = parseFloat(raw) / 1000;
          let type = entry;
          try { type = fs.readFileSync(typePath, 'utf8').trim(); } catch (_) {}
          zones.push({ zone: entry, type, temp });
        } catch (_) { continue; }
      }
    }
  } catch (_) {}

  // Fallback: coba command `sensors`
  if (zones.length === 0) {
    try {
      const output = execSync('sensors 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
      const match = output.match(/(?:Core 0|CPU|Tdie):\s+\+([\d.]+)°C/i);
      if (match) {
        zones.push({ zone: 'sensors', type: 'cpu-thermal', temp: parseFloat(match[1]) });
      }
    } catch (_) {}
  }

  if (zones.length === 0) {
    return { temp: 0, unit: '°C', source: 'unavailable', zones: [] };
  }

  // Return suhu tertinggi sebagai utama
  const maxZone = zones.reduce((a, b) => (a.temp > b.temp ? a : b));
  return { temp: maxZone.temp, unit: '°C', source: maxZone.zone, zones };
}

/* ==========================================
   SEGMENT: CPU USAGE (PER-CORE + TOTAL)
   ========================================== */

// Previous CPU tick readings for delta calculation
let prevCpuTicks = null;

/**
 * Baca /proc/stat untuk kalkulasi CPU usage real-time.
 * Return: total %, per-core %, frequency info.
 */
function getCpuUsage() {
  if (!IS_LINUX) {
    const cpus = os.cpus();
    return {
      totalPercent: 35.0 + Math.random() * 15,
      cores: cpus.map((c, i) => ({ core: i, percent: 20 + Math.random() * 30, mhz: c.speed })),
      model: cpus[0]?.model || 'Unknown',
      count: cpus.length,
      source: 'mock'
    };
  }

  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8');
    const lines = stat.split('\n');
    const currentTicks = {};

    for (const line of lines) {
      if (!line.startsWith('cpu')) continue;
      const parts = line.trim().split(/\s+/);
      const name = parts[0]; // 'cpu' (total) or 'cpu0', 'cpu1', etc.
      const values = parts.slice(1).map(Number);
      // user, nice, system, idle, iowait, irq, softirq, steal
      const idle = values[3] + (values[4] || 0);
      const total = values.reduce((a, b) => a + b, 0);
      currentTicks[name] = { idle, total };
    }

    const cores = [];
    let totalPercent = 0;

    if (prevCpuTicks) {
      for (const [name, ticks] of Object.entries(currentTicks)) {
        const prev = prevCpuTicks[name];
        if (!prev) continue;
        const totalDelta = ticks.total - prev.total;
        const idleDelta = ticks.idle - prev.idle;
        const percent = totalDelta > 0 ? parseFloat(((1 - idleDelta / totalDelta) * 100).toFixed(1)) : 0;

        if (name === 'cpu') {
          totalPercent = percent;
        } else {
          const coreNum = parseInt(name.replace('cpu', ''));
          // Read per-core frequency
          let mhz = 0;
          try {
            mhz = parseInt(fs.readFileSync(`/sys/devices/system/cpu/${name}/cpufreq/scaling_cur_freq`, 'utf8').trim()) / 1000;
          } catch (_) {
            try { mhz = os.cpus()[coreNum]?.speed || 0; } catch (_) {}
          }
          cores.push({ core: coreNum, percent, mhz: Math.round(mhz) });
        }
      }
    }

    prevCpuTicks = currentTicks;

    // CPU model
    let model = 'Unknown';
    try {
      const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
      const modelMatch = cpuinfo.match(/model name\s*:\s*(.+)/i) || cpuinfo.match(/Hardware\s*:\s*(.+)/i);
      if (modelMatch) model = modelMatch[1].trim();
    } catch (_) {}

    return {
      totalPercent,
      cores,
      model,
      count: cores.length || os.cpus().length,
      source: '/proc/stat'
    };
  } catch (_) {
    return { totalPercent: 0, cores: [], model: 'Unknown', count: os.cpus().length, source: 'error' };
  }
}

/* ==========================================
   SEGMENT: MEMORY (RAM) USAGE
   ========================================== */

/**
 * Baca /proc/meminfo untuk kalkulasi penggunaan RAM lengkap.
 * Termasuk buffers/cached untuk perhitungan yang akurat di Armbian.
 */
function getMemoryUsage() {
  if (!IS_LINUX) {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      total, used, free,
      buffers: 0, cached: 0,
      percent: parseFloat(((used / total) * 100).toFixed(1)),
      source: 'os-module'
    };
  }

  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const getValue = (key) => {
      const match = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return match ? parseInt(match[1]) * 1024 : 0; // kB to bytes
    };

    const total = getValue('MemTotal');
    const free = getValue('MemFree');
    const available = getValue('MemAvailable') || free;
    const buffers = getValue('Buffers');
    const cached = getValue('Cached');
    const swapTotal = getValue('SwapTotal');
    const swapFree = getValue('SwapFree');
    const used = total - available;

    return {
      total, used, free, available, buffers, cached,
      swap: { total: swapTotal, free: swapFree, used: swapTotal - swapFree },
      percent: parseFloat(((used / total) * 100).toFixed(1)),
      source: '/proc/meminfo'
    };
  } catch (_) {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      total, used, free,
      buffers: 0, cached: 0,
      percent: parseFloat(((used / total) * 100).toFixed(1)),
      source: 'os-module-fallback'
    };
  }
}

/* ==========================================
   SEGMENT: DISK USAGE (SEMUA PARTISI + USB)
   ========================================== */

/**
 * Ambil penggunaan semua disk/partisi termasuk USB & attached storage.
 * Menggunakan df dan deteksi mount dari /proc/mounts.
 */
function getDiskUsage() {
  if (!IS_LINUX) {
    return {
      root: { filesystem: 'C:', total: '50G', used: '25G', available: '25G', percent: 50.0, mountpoint: '/' },
      partitions: [
        { filesystem: 'C:', total: '50G', used: '25G', available: '25G', percent: 50.0, mountpoint: '/' },
        { filesystem: '/dev/sdb1', total: '16G', used: '4G', available: '12G', percent: 25.0, mountpoint: '/mnt/usb-share', type: 'usb' }
      ],
      source: 'mock'
    };
  }

  try {
    // Ambil semua partisi yang terpasang (filter tmpfs, devtmpfs, dll)
    const output = execSync(
      "df -h --output=source,size,used,avail,pcent,target 2>/dev/null | tail -n +2",
      { encoding: 'utf8', timeout: 5000 }
    ).trim();

    const partitions = [];
    let root = null;

    for (const line of output.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;

      const [filesystem, total, used, available, pctStr, mountpoint] = parts;

      // Skip virtual/temp filesystems
      if (['tmpfs', 'devtmpfs', 'udev', 'overlay', 'shm'].some(v => filesystem.includes(v))) continue;
      if (mountpoint.startsWith('/sys') || mountpoint.startsWith('/proc') || mountpoint.startsWith('/run')) continue;
      if (mountpoint === '/dev') continue;

      const percent = parseFloat(pctStr.replace('%', '')) || 0;
      
      // Deteksi otomatis USB/Penyimpanan Tambahan di path /mnt atau /media
      const isUSB = (filesystem.startsWith('/dev/sd') && mountpoint !== '/') || 
                    filesystem.includes('usb') || 
                    mountpoint.startsWith('/mnt/') || 
                    mountpoint.startsWith('/media/');
      const isNVMe = filesystem.startsWith('/dev/nvme') && mountpoint !== '/';
      const isMMC = filesystem.startsWith('/dev/mmcblk') && mountpoint !== '/';

      const entry = {
        filesystem, total, used, available, percent, mountpoint,
        type: isUSB ? 'usb' : isNVMe ? 'nvme' : isMMC ? 'emmc' : 'disk'
      };

      if (mountpoint === '/') {
        root = entry;
      }
      partitions.push(entry);
    }

    return {
      root: root || { filesystem: '-', total: '-', used: '-', available: '-', percent: 0, mountpoint: '/' },
      partitions,
      source: 'df'
    };
  } catch (_) {
    return {
      root: { filesystem: '-', total: '-', used: '-', available: '-', percent: 0, mountpoint: '/' },
      partitions: [],
      source: 'error'
    };
  }
}

/* ==========================================
   SEGMENT: NETWORK (SEMUA INTERFACE + IP)
   ========================================== */

// Store previous readings for delta calculation
let prevNetStats = null;
let prevNetTimestamp = null;

/**
 * Baca /proc/net/dev dan ip addr untuk semua network interface.
 * Return: bandwidth per detik, IP address, MAC, status per interface.
 */
function getNetworkStats() {
  if (!IS_LINUX) {
    return {
      interfaces: [
        { name: 'eth0', rx_bytes_sec: 1024 + Math.floor(Math.random() * 2048), tx_bytes_sec: 512 + Math.floor(Math.random() * 1024), ip: '192.168.1.100', mac: 'AA:BB:CC:DD:EE:FF', status: 'up', type: 'ethernet' }
      ],
      source: 'mock'
    };
  }

  try {
    // 1. Baca traffic data dari /proc/net/dev
    const raw = fs.readFileSync('/proc/net/dev', 'utf8');
    const lines = raw.split('\n').slice(2);
    const now = Date.now();
    const currentStats = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('lo:')) continue;

      const [ifacePart, ...dataParts] = trimmed.split(':');
      const iface = ifacePart.trim();
      const values = dataParts.join('').trim().split(/\s+/);

      currentStats[iface] = {
        rx_bytes: parseInt(values[0]) || 0,
        tx_bytes: parseInt(values[8]) || 0,
        rx_packets: parseInt(values[1]) || 0,
        tx_packets: parseInt(values[9]) || 0
      };
    }

    // 2. Ambil IP, MAC, dan status dari /sys/class/net dan ip command
    const ipInfo = {};
    try {
      const ipOutput = execSync('ip -4 addr show 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
      const blocks = ipOutput.split(/^\d+:/m).filter(Boolean);
      for (const block of blocks) {
        const nameMatch = block.match(/^\s*(\S+)/);
        const ipMatch = block.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
        if (nameMatch) {
          const name = nameMatch[1].replace(':', '');
          ipInfo[name] = { ip: ipMatch ? ipMatch[1] : 'No IP' };
        }
      }
    } catch (_) {}

    // 3. Kalkulasi bandwidth delta
    const result = [];
    const elapsed = prevNetTimestamp ? (now - prevNetTimestamp) / 1000 : 1;

    for (const [name, stats] of Object.entries(currentStats)) {
      const prev = prevNetStats ? prevNetStats[name] : null;
      
      // Detect interface type
      let type = 'other';
      if (name.startsWith('eth') || name.startsWith('en')) type = 'ethernet';
      else if (name.startsWith('wlan') || name.startsWith('wl')) type = 'wifi';
      else if (name.startsWith('zt') || name.startsWith('ztk')) type = 'zerotier';
      else if (name.startsWith('tun') || name.startsWith('tap')) type = 'vpn';
      else if (name.startsWith('docker') || name.startsWith('br-')) type = 'docker';
      else if (name.startsWith('veth')) type = 'veth';

      // Read MAC address
      let mac = '';
      try { mac = fs.readFileSync(`/sys/class/net/${name}/address`, 'utf8').trim(); } catch (_) {}

      // Read interface status
      let status = 'unknown';
      try { status = fs.readFileSync(`/sys/class/net/${name}/operstate`, 'utf8').trim(); } catch (_) {}

      result.push({
        name,
        rx_bytes_sec: prev ? Math.max(0, Math.round((stats.rx_bytes - prev.rx_bytes) / elapsed)) : 0,
        tx_bytes_sec: prev ? Math.max(0, Math.round((stats.tx_bytes - prev.tx_bytes) / elapsed)) : 0,
        rx_total: stats.rx_bytes,
        tx_total: stats.tx_bytes,
        ip: ipInfo[name]?.ip || 'No IP',
        mac,
        status,
        type
      });
    }

    prevNetStats = currentStats;
    prevNetTimestamp = now;

    return { interfaces: result, source: '/proc/net/dev' };
  } catch (_) {
    return { interfaces: [], source: 'error' };
  }
}

/* ==========================================
   SEGMENT: UPTIME, LOAD, & OS INFO
   ========================================== */

/**
 * Baca uptime, load average, dan informasi OS detail.
 * Termasuk Armbian-specific info (versi board, kernel).
 */
function getSystemInfo() {
  let uptime, loadAvg;

  if (!IS_LINUX) {
    uptime = os.uptime();
    loadAvg = os.loadavg();
  } else {
    try {
      uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
    } catch (_) {
      uptime = os.uptime();
    }
    try {
      const raw = fs.readFileSync('/proc/loadavg', 'utf8').trim();
      const parts = raw.split(' ');
      loadAvg = [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
    } catch (_) {
      loadAvg = os.loadavg();
    }
  }

  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  // OS-specific info
  let osRelease = '';
  let kernelVersion = '';
  let boardName = '';

  if (IS_LINUX) {
    try { osRelease = execSync('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'', { encoding: 'utf8', timeout: 2000 }).trim(); } catch (_) {}
    try { kernelVersion = execSync('uname -r 2>/dev/null', { encoding: 'utf8', timeout: 2000 }).trim(); } catch (_) {}
    try { boardName = fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim(); } catch (_) {
      try { boardName = execSync('cat /etc/armbian-release 2>/dev/null | grep BOARD_NAME | cut -d= -f2 | tr -d \'"\'', { encoding: 'utf8', timeout: 2000 }).trim(); } catch (_) {}
    }
  }

  return {
    uptime: { seconds: uptime, formatted: `${days}d ${hours}h ${minutes}m` },
    loadAvg: { '1m': loadAvg[0], '5m': loadAvg[1], '15m': loadAvg[2] },
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpuCores: os.cpus().length,
    osRelease: osRelease || `${os.type()} ${os.release()}`,
    kernelVersion: kernelVersion || os.release(),
    boardName: boardName || os.hostname(),
    totalMemory: os.totalmem(),
    nodeVersion: process.version
  };
}

/* ==========================================
   SEGMENT: PROCESS LIST (TOP CPU/RAM)
   ========================================== */

/**
 * Ambil top 10 proses berdasarkan CPU/RAM usage.
 */
function getTopProcesses(sortBy = 'cpu', limit = 10) {
  if (!IS_LINUX) {
    return {
      processes: [
        { pid: 1, user: 'root', cpu: 2.5, mem: 1.2, command: 'systemd' },
        { pid: 100, user: 'node', cpu: 5.1, mem: 3.4, command: 'node server.js' },
      ],
      source: 'mock'
    };
  }

  try {
    const sortCol = sortBy === 'mem' ? '-k4' : '-k3';
    const output = execSync(
      `ps aux --sort=${sortCol}r 2>/dev/null | head -n ${limit + 1}`,
      { encoding: 'utf8', timeout: 5000 }
    );
    const lines = output.split('\n').filter(l => l.trim());
    const processes = lines.slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[1]),
        user: parts[0],
        cpu: parseFloat(parts[2]),
        mem: parseFloat(parts[3]),
        command: parts.slice(10).join(' ').substring(0, 80)
      };
    });

    return { processes, source: 'ps' };
  } catch (_) {
    return { processes: [], source: 'error' };
  }
}

/* ==========================================
   SEGMENT: AGGREGATED METRICS
   ========================================== */

/**
 * Kumpulkan semua metrik dalam satu panggilan.
 */
function getAllMetrics() {
  return {
    timestamp: Date.now(),
    cpu: getCpuTemp(),
    cpuUsage: getCpuUsage(),
    memory: getMemoryUsage(),
    disk: getDiskUsage(),
    network: getNetworkStats(),
    system: getSystemInfo()
  };
}

/* ==========================================
   SEGMENT: MODULE EXPORT
   ========================================== */

module.exports = {
  getCpuTemp,
  getCpuUsage,
  getMemoryUsage,
  getDiskUsage,
  getNetworkStats,
  getSystemInfo,
  getTopProcesses,
  getAllMetrics
};
