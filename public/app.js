/**
 * @file: app.js
 * @description: Logika frontend SPA — auth, polling metrik, chart rendering, service control, log viewer, cron CRUD
 * @dependencies: Chart.js (CDN), Lucide Icons (CDN)
 * @state: Stable
 * @last_updated: 2026-07-06 v0.2.0
 */

/* ==========================================
   SEGMENT: STATE & CONFIG
   ========================================== */

const APP = {
  token: localStorage.getItem('monyx_token') || null,
  pollInterval: null,
  pollRate: 5000, // 5 detik
  chart: null,
  chartData: {
    labels: [],
    temp: [],
    cpuUsage: [],
    ram: [],
    disk: []
  },
  maxChartPoints: 60 // 5 menit data
};

/* ==========================================
   SEGMENT: UTILITY FUNCTIONS
   ========================================== */

/**
 * Fetch wrapper dengan JWT Bearer token.
 */
async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (APP.token) {
    headers['Authorization'] = `Bearer ${APP.token}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    logout();
    throw new Error('Session expired');
  }

  return res;
}

/**
 * Format bytes ke human-readable string.
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Format bytes ke human-readable string (short, 2 decimal).
 */
function formatBytesShort(bytes) {
  if (bytes === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Toast notification.
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/**
 * Tentukan class progress bar berdasarkan persentase.
 */
function getProgressClass(percent) {
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warning';
  return 'safe';
}

/* ==========================================
   SEGMENT: AUTHENTICATION
   ========================================== */

async function login(username, password) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    APP.token = data.token;
    localStorage.setItem('monyx_token', data.token);
    showDashboard();
    showToast(`Welcome back, ${data.username}!`, 'success');
  } catch (err) {
    const errEl = document.getElementById('loginError');
    errEl.textContent = err.message;
    errEl.classList.add('show');
    setTimeout(() => errEl.classList.remove('show'), 3000);
  }
}

async function verifyToken() {
  if (!APP.token) return false;

  try {
    const res = await apiFetch('/api/auth/verify');
    const data = await res.json();
    return data.valid === true;
  } catch (_) {
    return false;
  }
}

function logout() {
  APP.token = null;
  localStorage.removeItem('monyx_token');
  stopPolling();
  document.getElementById('loginPage').style.display = '';
  document.getElementById('dashboard').classList.remove('active');
}

/* ==========================================
   SEGMENT: DASHBOARD INIT
   ========================================== */

function showDashboard() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('dashboard').classList.add('active');

  // Init Lucide icons
  if (window.lucide) lucide.createIcons();

  // Init chart
  initChart();

  // Start polling
  startPolling();

  // Load initial data
  fetchMetrics();
  fetchServices();
  fetchCronJobs();
  loadTelegramSettings();
  fetchModuleStatus();
}

/* ==========================================
   SEGMENT: METRICS POLLING
   ========================================== */

function startPolling() {
  stopPolling();
  APP.pollInterval = setInterval(fetchMetrics, APP.pollRate);
}

function stopPolling() {
  if (APP.pollInterval) {
    clearInterval(APP.pollInterval);
    APP.pollInterval = null;
  }
}

async function fetchMetrics() {
  try {
    const res = await apiFetch('/api/metrics');
    const data = await res.json();
    APP.lastMetricsData = data;
    updateMetricsUI(data);
  } catch (err) {
    console.error('[Metrics] Fetch error:', err.message);
  }
}

function updateMetricsUI(data) {
  // CPU Temperature
  const temp = data.cpu.temp;
  document.getElementById('cpuTempValue').textContent = temp.toFixed(1);
  document.getElementById('cpuTempSource').textContent = `Source: ${data.cpu.source}`;
  const tempPercent = Math.min((temp / 100) * 100, 100);
  const tempBar = document.getElementById('cpuTempBar');
  tempBar.style.width = tempPercent + '%';
  tempBar.className = `progress-fill ${getProgressClass(tempPercent)}`;

  // CPU Usage
  const cpuPct = data.cpuUsage ? data.cpuUsage.totalPercent : 0;
  const cpuEl = document.getElementById('cpuUsageValue');
  if (cpuEl) {
    cpuEl.textContent = cpuPct.toFixed(1);
    const cpuBar = document.getElementById('cpuUsageBar');
    if (cpuBar) {
      cpuBar.style.width = cpuPct + '%';
      cpuBar.className = `progress-fill ${getProgressClass(cpuPct)}`;
    }
    const cpuModel = document.getElementById('cpuModelDetail');
    if (cpuModel && data.cpuUsage) cpuModel.textContent = data.cpuUsage.model;
  }

  // RAM
  const ramPct = data.memory.percent;
  document.getElementById('ramValue').textContent = ramPct.toFixed(1);
  document.getElementById('ramDetail').textContent =
    `${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`;
  const ramBar = document.getElementById('ramBar');
  ramBar.style.width = ramPct + '%';
  ramBar.className = `progress-fill ${getProgressClass(ramPct)}`;

  // Disk (use root partition)
  const rootDisk = data.disk.root || data.disk;
  const diskPct = rootDisk.percent || 0;
  document.getElementById('diskValue').textContent = diskPct.toFixed(1);
  document.getElementById('diskDetail').textContent =
    `${rootDisk.used} / ${rootDisk.total}`;
  const diskBar = document.getElementById('diskBar');
  diskBar.style.width = diskPct + '%';
  diskBar.className = `progress-fill ${getProgressClass(diskPct)}`;

  // Render additional partitions if present
  const partListEl = document.getElementById('partitionsList');
  if (partListEl && data.disk.partitions && data.disk.partitions.length > 1) {
    partListEl.innerHTML = data.disk.partitions
      .filter(p => p.mountpoint !== '/')
      .map(p => `
        <div class="partition-item">
          <span class="part-mount">${escapeHtml(p.mountpoint)}</span>
          <span class="part-type tag-${p.type}">${p.type}</span>
          <span class="part-usage">${p.used}/${p.total} (${p.percent}%)</span>
          <div class="progress-bar" style="flex:1;min-width:60px">
            <div class="progress-fill ${getProgressClass(p.percent)}" style="width:${p.percent}%"></div>
          </div>
        </div>
      `).join('');
    const partContainer = document.getElementById('partitionsContainer');
    if (partContainer) partContainer.style.display = '';
  } else if (partListEl) {
    partListEl.innerHTML = '';
    const partContainer = document.getElementById('partitionsContainer');
    if (partContainer) partContainer.style.display = 'none';
  }

  // Network — render all interfaces
  const primaryIface = data.network.interfaces.find(i => i.status === 'up' && i.type !== 'docker' && i.type !== 'veth') || data.network.interfaces[0];
  if (primaryIface) {
    document.getElementById('netRxValue').textContent = `↓ ${formatBytesShort(primaryIface.rx_bytes_sec)}`;
    document.getElementById('netTxValue').textContent = `↑ ${formatBytesShort(primaryIface.tx_bytes_sec)}`;
    document.getElementById('netInterface').textContent = `${primaryIface.name} (${primaryIface.ip || 'No IP'})`;
  }

  // Render all network interfaces
  const netListEl = document.getElementById('networkList');
  if (netListEl && data.network.interfaces.length > 0) {
    const filterPhys = document.getElementById('filterPhysNet')?.checked;
    let interfacesToRender = data.network.interfaces;

    if (filterPhys) {
      interfacesToRender = interfacesToRender.filter(iface => {
        const name = iface.name.toLowerCase();
        return !name.startsWith('veth') && 
               !name.startsWith('br-') && 
               !name.startsWith('docker') && 
               name !== 'lo';
      });
    }

    netListEl.innerHTML = interfacesToRender.map(iface => `
      <div class="net-iface-item">
        <div class="net-iface-info">
          <span class="service-badge ${iface.status === 'up' ? 'active' : 'inactive'}"></span>
          <div>
            <div class="service-name">${escapeHtml(iface.name)} <span class="net-type-tag">${iface.type}</span></div>
            <div class="service-status">${iface.ip || 'No IP'} ${iface.mac ? '• ' + iface.mac : ''}</div>
          </div>
        </div>
        <div style="text-align:right;font-size:0.75rem;font-family:'JetBrains Mono',monospace">
          <div style="color:var(--accent-green)">↓ ${formatBytesShort(iface.rx_bytes_sec)}</div>
          <div style="color:var(--accent-cyan)">↑ ${formatBytesShort(iface.tx_bytes_sec)}</div>
        </div>
      </div>
    `).join('');
  }

  // System Info Bar
  if (data.system) {
    document.getElementById('uptimeValue').textContent = data.system.uptime.formatted;
    document.getElementById('loadValue').textContent =
      `${data.system.loadAvg['1m']} / ${data.system.loadAvg['5m']} / ${data.system.loadAvg['15m']}`;
    document.getElementById('cpuCoresValue').textContent = data.system.cpuCores;
    document.getElementById('platformValue').textContent = data.system.osRelease || `${data.system.platform} (${data.system.arch})`;
    document.getElementById('hostnameDisplay').textContent = data.system.hostname;
    // Board/kernel info
    const boardEl = document.getElementById('boardValue');
    if (boardEl) boardEl.textContent = data.system.boardName || '-';
    const kernelEl = document.getElementById('kernelValue');
    if (kernelEl) kernelEl.textContent = data.system.kernelVersion || '-';
  }

  // Update chart
  updateChart(temp, cpuPct, ramPct, diskPct);
}

/* ==========================================
   SEGMENT: CHART.JS INITIALIZATION
   ========================================== */

function initChart() {
  const ctx = document.getElementById('metricsChart');
  if (!ctx) return;

  if (APP.chart) APP.chart.destroy();

  APP.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: APP.chartData.labels,
      datasets: [
        {
          label: 'CPU Temp (°C)',
          data: APP.chartData.temp,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: true
        },
        {
          label: 'CPU Usage (%)',
          data: APP.chartData.cpuUsage,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: true
        },
        {
          label: 'RAM (%)',
          data: APP.chartData.ram,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: true
        },
        {
          label: 'Disk (%)',
          data: APP.chartData.disk,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          labels: {
            color: '#94a3b8',
            font: { family: 'Inter', size: 11 },
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(99, 102, 241, 0.2)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10
        }
      },
      scales: {
        x: {
          display: true,
          ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 10 },
          grid: { color: 'rgba(255,255,255,0.03)' }
        },
        y: {
          display: true,
          min: 0,
          max: 100,
          ticks: { color: '#64748b', font: { size: 10 }, stepSize: 25 },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

function updateChart(temp, cpuUsage, ram, disk) {
  const now = new Date();
  const label = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  APP.chartData.labels.push(label);
  APP.chartData.temp.push(temp);
  APP.chartData.cpuUsage.push(cpuUsage);
  APP.chartData.ram.push(ram);
  APP.chartData.disk.push(disk);

  // Limit data points
  if (APP.chartData.labels.length > APP.maxChartPoints) {
    APP.chartData.labels.shift();
    APP.chartData.temp.shift();
    APP.chartData.cpuUsage.shift();
    APP.chartData.ram.shift();
    APP.chartData.disk.shift();
  }

  if (APP.chart) APP.chart.update('none');
}

/* ==========================================
   SEGMENT: SERVICE MANAGEMENT
   ========================================== */

async function fetchServices() {
  try {
    const res = await apiFetch('/api/services');
    const data = await res.json();
    renderServices(data.services);
    
    if (data.whitelist) {
      populateLogServiceDropdown(data.whitelist);
    }
  } catch (err) {
    console.error('[Services] Fetch error:', err.message);
  }
}

function populateLogServiceDropdown(whitelist) {
  const dropdown = document.getElementById('logService');
  if (!dropdown) return;

  const currentValue = dropdown.value;
  dropdown.innerHTML = '<option value="">System Log</option>' +
    whitelist.map(svc => `<option value="${svc}">${escapeHtml(svc)}</option>`).join('');
  
  // Restore previous selected value if still in the whitelist
  if (whitelist.includes(currentValue)) {
    dropdown.value = currentValue;
  } else {
    dropdown.value = '';
  }
}

function renderServices(services) {
  const container = document.getElementById('serviceList');
  container.innerHTML = services.map(svc => `
    <div class="service-item">
      <div class="service-info">
        <div class="service-badge ${svc.active ? 'active' : 'inactive'}"></div>
        <div>
          <div class="service-name">${svc.name}</div>
          <div class="service-status">${svc.status}</div>
        </div>
      </div>
      <div class="service-actions">
        ${!svc.active ? `<button class="btn-sm start" onclick="controlService('${svc.name}','start')">Start</button>` : ''}
        ${svc.active ? `<button class="btn-sm stop" onclick="controlService('${svc.name}','stop')">Stop</button>` : ''}
        <button class="btn-sm restart" onclick="controlService('${svc.name}','restart')">Restart</button>
      </div>
    </div>
  `).join('');
}

async function controlService(name, action) {
  try {
    const res = await apiFetch(`/api/services/${name}/${action}`, { method: 'POST' });
    const data = await res.json();

    if (res.ok) {
      showToast(`${name}: ${action} successful`, 'success');
      setTimeout(fetchServices, 1000);
    } else {
      showToast(data.error || `Failed to ${action} ${name}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

/* ==========================================
   SEGMENT: LOG VIEWER
   ========================================== */

async function fetchLogs() {
  const service = document.getElementById('logService').value;
  const lines = document.getElementById('logLines').value || 50;
  const output = document.getElementById('logOutput');

  output.innerHTML = '<div class="spinner"></div> Loading logs...';

  try {
    const res = await apiFetch(`/api/logs?service=${service}&lines=${lines}`);
    const data = await res.json();

    if (data.logs && data.logs.length > 0) {
      output.innerHTML = data.logs
        .map(line => `<div class="log-line">${escapeHtml(line)}</div>`)
        .join('');
      // Auto-scroll to bottom
      output.scrollTop = output.scrollHeight;
    } else {
      output.innerHTML = '<span style="color:var(--text-muted)">No logs found.</span>';
    }
  } catch (err) {
    output.innerHTML = `<span style="color:var(--accent-red)">Error: ${err.message}</span>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ==========================================
   SEGMENT: CRON MANAGEMENT
   ========================================== */

async function fetchCronJobs() {
  try {
    const res = await apiFetch('/api/cron');
    const data = await res.json();
    renderCronJobs(data.jobs);
  } catch (err) {
    console.error('[Cron] Fetch error:', err.message);
  }
}

function renderCronJobs(jobs) {
  const container = document.getElementById('cronList');

  if (jobs.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No cron jobs configured.</div>';
    return;
  }

  container.innerHTML = jobs.map(job => `
    <div class="cron-item">
      <div class="cron-schedule">${escapeHtml(job.schedule)}</div>
      <div class="cron-command">${escapeHtml(job.command)}</div>
      <div class="cron-actions">
        <button class="btn-sm stop" onclick="deleteCronJob(${job.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

async function addCronJob() {
  const schedule = document.getElementById('cronSchedule').value.trim();
  const command = document.getElementById('cronCommand').value.trim();

  if (!schedule || !command) {
    showToast('Schedule and command are required.', 'error');
    return;
  }

  try {
    const res = await apiFetch('/api/cron', {
      method: 'POST',
      body: JSON.stringify({ schedule, command })
    });

    if (res.ok) {
      showToast('Cron job added successfully!', 'success');
      document.getElementById('cronSchedule').value = '';
      document.getElementById('cronCommand').value = '';
      fetchCronJobs();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to add cron job.', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function deleteCronJob(id) {
  if (!confirm('Delete this cron job?')) return;

  try {
    const res = await apiFetch(`/api/cron/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Cron job deleted.', 'success');
      fetchCronJobs();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to delete.', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

/* ==========================================
   SEGMENT: TELEGRAM SETTINGS
   ========================================== */

async function loadTelegramSettings() {
  try {
    const res = await apiFetch('/api/settings/telegram');
    const data = await res.json();
    document.getElementById('telegramChatId').value = data.chatId || '';
    document.getElementById('telegramToken').value = data.configured ? '' : '';
    document.getElementById('telegramToken').placeholder = data.configured
      ? '***configured*** (leave empty to keep)'
      : 'e.g. 123456:ABC-DEF...';
  } catch (_) {}
}

async function saveTelegramSettings() {
  const chatId = document.getElementById('telegramChatId').value.trim();
  const token = document.getElementById('telegramToken').value.trim();
  const hasPlaceholder = document.getElementById('telegramToken').placeholder.includes('configured');

  if (!chatId) {
    showToast('Chat ID is required.', 'error');
    return;
  }
  if (!token && !hasPlaceholder) {
    showToast('Bot Token is required.', 'error');
    return;
  }

  try {
    const res = await apiFetch('/api/settings/telegram', {
      method: 'PUT',
      body: JSON.stringify({ chatId, token: token || '***configured***' })
    });

    if (res.ok) {
      showToast('Telegram configuration saved!', 'success');
      loadTelegramSettings();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to save.', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

/* ==========================================
   SEGMENT: TAB NAVIGATION
   ========================================== */

function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update tab panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });

  // Load data for specific tabs
  if (tabName === 'services') fetchServices();
  if (tabName === 'cron') fetchCronJobs();
  if (tabName === 'files') fetchFiles();
}

/* ==========================================
   SEGMENT: EVENT LISTENERS
   ========================================== */

document.addEventListener('DOMContentLoaded', async () => {
  // Login form
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    login(username, password);
  });

  // Tab navigation
  document.getElementById('navTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.nav-tab');
    if (tab) switchTab(tab.dataset.tab);
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', () => {
    fetchMetrics();
    showToast('Refreshed!', 'info');
  });

  // Fetch logs
  document.getElementById('fetchLogsBtn').addEventListener('click', fetchLogs);

  // Add cron
  document.getElementById('addCronBtn').addEventListener('click', addCronJob);

  // Save Telegram
  document.getElementById('saveTelegramBtn').addEventListener('click', saveTelegramSettings);

  // Network Interfaces filter listener
  document.getElementById('filterPhysNet')?.addEventListener('change', () => {
    if (APP.lastMetricsData) {
      updateMetricsUI(APP.lastMetricsData);
    }
  });

  // Module toggle — File Manager
  document.getElementById('moduleFileManager')?.addEventListener('change', (e) => {
    toggleModule('module_filemanager', e.target.checked ? '1' : '0');
  });

  // File Manager event listeners
  document.getElementById('fileRefreshBtn')?.addEventListener('click', () => fetchFiles());
  document.getElementById('fileMkdirBtn')?.addEventListener('click', createNewFolder);
  document.getElementById('fileUploadInput')?.addEventListener('change', handleFileUpload);
  document.getElementById('fileBreadcrumb')?.addEventListener('click', (e) => {
    const item = e.target.closest('.breadcrumb-item');
    if (item && item.dataset.path) {
      APP.currentFilePath = item.dataset.path;
      fetchFiles();
    }
  });

  // Init context menu & close preview handlers
  initFileContextEvents();
  document.getElementById('closePreviewBtn')?.addEventListener('click', closeMediaPreview);

  // Check existing session
  const valid = await verifyToken();
  if (valid) {
    showDashboard();
  }
});

/* ==========================================
   SEGMENT: SYSTEM POWER ACTION
   ========================================== */

async function systemPowerAction(action) {
  if (!confirm(`Are you absolutely sure you want to ${action} the server?`)) {
    return;
  }

  try {
    const res = await apiFetch(`/api/system/power/${action}`, { method: 'POST' });
    const data = await res.json();

    if (res.ok) {
      showToast(`Server action "${action}" initiated: ${data.output}`, 'success');
    } else {
      showToast(data.error || `Failed to initiate ${action}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

/* ==========================================
   SEGMENT: MODULE MANAGEMENT
   ========================================== */

async function fetchModuleStatus() {
  try {
    const res = await apiFetch('/api/modules');
    const data = await res.json();
    const fm = data.modules?.module_filemanager === '1';

    // Update toggle checkbox
    const toggle = document.getElementById('moduleFileManager');
    if (toggle) toggle.checked = fm;

    // Show/hide Files tab
    const filesTab = document.getElementById('navTabFiles');
    if (filesTab) filesTab.style.display = fm ? '' : 'none';

    // Re-init Lucide icons for the newly visible tab
    if (fm && window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('[Modules] Fetch error:', err.message);
  }
}

async function toggleModule(key, value) {
  try {
    const res = await apiFetch(`/api/modules/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value })
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Module ${value === '1' ? 'enabled' : 'disabled'}`, 'success');
      fetchModuleStatus();
    } else {
      showToast(data.error || 'Failed to toggle module', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

/* ==========================================
   SEGMENT: FILE MANAGER
   ========================================== */

// Track current file browsing path
APP.currentFilePath = '/mnt';
APP.selectedFileContext = null;

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatFileDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleDateString('id-ID', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

async function fetchFiles() {
  const wrapper = document.querySelector('.file-table-wrapper');
  if (wrapper) wrapper.classList.add('loading');

  try {
    const res = await apiFetch(`/api/files?path=${encodeURIComponent(APP.currentFilePath)}`);

    if (res.status === 403) {
      const data = await res.json();
      const tbody = document.getElementById('fileTableBody');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted)">${escapeHtml(data.error)}</td></tr>`;
      }
      return;
    }

    const data = await res.json();
    renderFiles(data.files, data.path);
  } catch (err) {
    console.error('[Files] Fetch error:', err.message);
    showToast(`Failed to load files: ${err.message}`, 'error');
  } finally {
    if (wrapper) wrapper.classList.remove('loading');
  }
}

function renderFiles(files, currentPath) {
  APP.currentFilePath = currentPath || APP.currentFilePath;

  // Render breadcrumb
  const bc = document.getElementById('fileBreadcrumb');
  if (bc) {
    const parts = APP.currentFilePath.split('/').filter(Boolean);
    let accumulated = '';
    let html = '';

    for (let i = 0; i < parts.length; i++) {
      accumulated += '/' + parts[i];
      const isLast = i === parts.length - 1;
      if (i > 0) html += '<span class="breadcrumb-sep">/</span>';
      html += `<span class="breadcrumb-item" data-path="${escapeHtml(accumulated)}">${isLast ? '/' : ''}${escapeHtml(parts[i])}</span>`;
    }

    bc.innerHTML = html;
  }

  // Render table
  const tbody = document.getElementById('fileTableBody');
  if (!tbody) return;

  if (!files || files.length === 0) {
    let parentRow = '';
    if (APP.currentFilePath !== '/mnt') {
      const parent = APP.currentFilePath.split('/').slice(0, -1).join('/') || '/mnt';
      parentRow = `
        <tr class="file-row" data-path="${escapeHtml(parent)}" data-type="directory" data-name="..">
          <td><span class="file-name is-dir">📁 ..</span></td>
          <td class="file-size">—</td>
          <td class="file-date">—</td>
          <td></td>
        </tr>`;
    }
    tbody.innerHTML = parentRow + `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted)">Empty directory</td></tr>`;
    return;
  }

  let rows = '';
  if (APP.currentFilePath !== '/mnt') {
    const parent = APP.currentFilePath.split('/').slice(0, -1).join('/') || '/mnt';
    rows += `
      <tr class="file-row" data-path="${escapeHtml(parent)}" data-type="directory" data-name="..">
        <td><span class="file-name is-dir">📁 ..</span></td>
        <td class="file-size">—</td>
        <td class="file-date">—</td>
        <td></td>
      </tr>`;
  }

  for (const f of files) {
    const fullPath = APP.currentFilePath + '/' + f.name;
    const isDir = f.type === 'directory';
    const icon = isDir ? '📁' : getFileIcon(f.name);

    rows += `
      <tr class="file-row" data-path="${escapeHtml(fullPath)}" data-type="${isDir ? 'directory' : 'file'}" data-name="${escapeHtml(f.name)}">
        <td>
          <span class="file-name ${isDir ? 'is-dir' : ''}">
            ${icon} ${escapeHtml(f.name)}
          </span>
        </td>
        <td class="file-size">${isDir ? '—' : formatFileSize(f.size)}</td>
        <td class="file-date">${formatFileDate(f.modified)}</td>
        <td>
          <div class="file-actions">
            ${!isDir ? `<button onclick="event.stopPropagation(); downloadFile('${escapeHtml(fullPath)}')" title="Download">↓</button>` : ''}
            ${!isDir ? `<button onclick="event.stopPropagation(); previewFile('${escapeHtml(fullPath)}', '${escapeHtml(f.name)}')" title="Preview">👁️</button>` : ''}
            <button onclick="event.stopPropagation(); renameFilePrompt('${escapeHtml(fullPath)}', '${escapeHtml(f.name)}')" title="Rename">✏️</button>
            <button class="btn-delete" onclick="event.stopPropagation(); deleteFileConfirm('${escapeHtml(fullPath)}', '${escapeHtml(f.name)}')" title="Delete">✕</button>
          </div>
        </td>
      </tr>`;
  }

  tbody.innerHTML = rows;
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    pdf: '📄', doc: '📝', docx: '📝', txt: '📝', md: '📝',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵',
    zip: '📦', tar: '📦', gz: '📦', rar: '📦', '7z': '📦',
    js: '⚙️', py: '⚙️', sh: '⚙️', json: '⚙️', yml: '⚙️', yaml: '⚙️',
    sql: '🗃️', db: '🗃️', sqlite: '🗃️',
    html: '🌐', css: '🌐', xml: '🌐',
    iso: '💿', img: '💿'
  };
  return icons[ext] || '📄';
}

function navigateToDir(dirPath) {
  APP.currentFilePath = dirPath;
  fetchFiles();
}

function downloadFile(filePath) {
  const url = `/api/files/download?path=${encodeURIComponent(filePath)}`;
  const a = document.createElement('a');
  a.href = url;
  a.setAttribute('download', '');

  apiFetch(url)
    .then(res => res.blob())
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      a.href = blobUrl;
      a.download = filePath.split('/').pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    })
    .catch(err => showToast(`Download failed: ${err.message}`, 'error'));
}

async function createNewFolder() {
  const name = prompt('Enter new folder name:');
  if (!name || !name.trim()) return;

  const safeName = name.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  const fullPath = APP.currentFilePath + '/' + safeName;

  try {
    const res = await apiFetch('/api/files/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path: fullPath })
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Folder "${safeName}" created`, 'success');
      fetchFiles();
    } else {
      showToast(data.error || 'Failed to create folder', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function renameFilePrompt(filePath, oldName) {
  const newName = prompt(`Rename "${oldName}" to:`, oldName);
  if (!newName || newName.trim() === oldName) return;

  const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
  const newPath = parentDir + '/' + newName.trim();

  try {
    const res = await apiFetch('/api/files/rename', {
      method: 'POST',
      body: JSON.stringify({ oldPath: filePath, newPath })
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Renamed to "${newName.trim()}"`, 'success');
      fetchFiles();
    } else {
      showToast(data.error || 'Rename failed', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function deleteFileConfirm(filePath, name) {
  if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

  try {
    const res = await apiFetch(`/api/files?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Deleted "${name}"`, 'success');
      fetchFiles();
    } else {
      showToast(data.error || 'Delete failed', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 100 * 1024 * 1024) {
    showToast('File exceeds 100MB limit', 'error');
    e.target.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', APP.currentFilePath);

  try {
    showToast(`Uploading "${file.name}"...`, 'info');

    const headers = {};
    if (APP.token) {
      headers['Authorization'] = `Bearer ${APP.token}`;
    }

    const res = await fetch('/api/files/upload', {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Uploaded "${data.filename}" (${formatFileSize(data.size)})`, 'success');
      fetchFiles();
    } else {
      showToast(data.error || 'Upload failed', 'error');
    }
  } catch (err) {
    showToast(`Upload error: ${err.message}`, 'error');
  }

  e.target.value = '';
}

async function previewFile(filePath, name) {
  const modal = document.getElementById('mediaPreviewModal');
  const title = document.getElementById('previewTitle');
  const body = document.getElementById('previewBody');

  if (!modal || !title || !body) return;

  title.textContent = `Preview: ${name}`;
  body.innerHTML = '<div class="spinner"></div>';
  modal.style.display = 'flex';

  const ext = name.split('.').pop().toLowerCase();
  const previewUrl = `/api/files/preview?path=${encodeURIComponent(filePath)}`;

  try {
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) {
      const res = await apiFetch(previewUrl);
      if (!res.ok) throw new Error('File not accessible');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      body.innerHTML = `<img src="${blobUrl}" class="preview-image" alt="${escapeHtml(name)}">`;
      body.dataset.blobUrl = blobUrl;
    } 
    else if (['mp4', 'webm', 'mkv', 'ogg'].includes(ext)) {
      const authenticatedUrl = `${previewUrl}&token=${encodeURIComponent(APP.token)}`;
      body.innerHTML = `
        <video src="${authenticatedUrl}" controls autoplay class="preview-video">
          Browser Anda tidak mendukung tag video.
        </video>`;
    }
    else if (['mp3', 'wav', 'flac', 'ogg'].includes(ext)) {
      const authenticatedUrl = `${previewUrl}&token=${encodeURIComponent(APP.token)}`;
      body.innerHTML = `
        <audio src="${authenticatedUrl}" controls autoplay class="preview-audio">
          Browser Anda tidak mendukung tag audio.
        </audio>`;
    }
    else if (['txt', 'md', 'json', 'log', 'conf', 'sh', 'yaml', 'yml', 'js', 'xml', 'css', 'html', 'sql'].includes(ext)) {
      const res = await apiFetch(previewUrl);
      if (!res.ok) throw new Error('File not accessible');
      const text = await res.text();
      body.innerHTML = `<pre class="preview-text">${escapeHtml(text)}</pre>`;
    }
    else {
      body.innerHTML = `
        <div class="preview-unsupported">
          <i data-lucide="file-warning" style="width:48px;height:48px;color:var(--text-muted)"></i>
          <p>Preview tidak tersedia untuk file ini (${ext.toUpperCase()})</p>
          <button class="btn-sm font-semibold" style="margin-top:1rem" onclick="downloadFile('${escapeHtml(filePath)}')">
            Download File (↓)
          </button>
        </div>`;
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    body.innerHTML = `
      <div style="color:var(--accent-red);text-align:center;padding:2rem">
        <p>Gagal memuat preview: ${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function closeMediaPreview() {
  const modal = document.getElementById('mediaPreviewModal');
  const body = document.getElementById('previewBody');
  if (!modal || !body) return;

  const video = body.querySelector('video');
  const audio = body.querySelector('audio');
  if (video) video.pause();
  if (audio) audio.pause();

  if (body.dataset.blobUrl) {
    URL.revokeObjectURL(body.dataset.blobUrl);
    delete body.dataset.blobUrl;
  }

  body.innerHTML = '';
  modal.style.display = 'none';
}

function initFileContextEvents() {
  const tbody = document.getElementById('fileTableBody');
  const contextMenu = document.getElementById('fileContextMenu');

  if (!tbody || !contextMenu) return;

  tbody.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.file-row');
    if (!row) return;

    e.preventDefault();

    const path = row.getAttribute('data-path');
    const type = row.getAttribute('data-type');
    const name = row.getAttribute('data-name');

    // Skip parent directory link ".." from showing context menu
    if (name === '..') return;

    APP.selectedFileContext = { path, type, name };

    contextMenu.style.top = `${e.pageY}px`;
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.display = 'block';
  });

  document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      contextMenu.style.display = 'none';
    }
  });

  tbody.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.file-row');
    if (!row) return;

    const path = row.getAttribute('data-path');
    const type = row.getAttribute('data-type');
    const name = row.getAttribute('data-name');

    if (type === 'directory') {
      navigateToDir(path);
    } else {
      previewFile(path, name);
    }
  });

  tbody.addEventListener('click', (e) => {
    const row = e.target.closest('.file-row');
    if (!row || e.target.closest('button') || e.target.closest('.file-actions')) return;

    const path = row.getAttribute('data-path');
    const type = row.getAttribute('data-type');

    if (type === 'directory') {
      navigateToDir(path);
    }
  });

  document.getElementById('ctxOpenBtn')?.addEventListener('click', () => {
    if (!APP.selectedFileContext) return;
    const { path, type, name } = APP.selectedFileContext;
    if (type === 'directory') {
      navigateToDir(path);
    } else {
      previewFile(path, name);
    }
  });

  document.getElementById('ctxDownloadBtn')?.addEventListener('click', () => {
    if (!APP.selectedFileContext || APP.selectedFileContext.type === 'directory') return;
    downloadFile(APP.selectedFileContext.path);
  });

  document.getElementById('ctxRenameBtn')?.addEventListener('click', () => {
    if (!APP.selectedFileContext) return;
    renameFilePrompt(APP.selectedFileContext.path, APP.selectedFileContext.name);
  });

  document.getElementById('ctxDeleteBtn')?.addEventListener('click', () => {
    if (!APP.selectedFileContext) return;
    deleteFileConfirm(APP.selectedFileContext.path, APP.selectedFileContext.name);
  });
}
