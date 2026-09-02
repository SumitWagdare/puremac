/* ═══════════════════════════════════════════════════════════════════════════
   CleanMyMac v2.0 — Premium Frontend Application
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────────────────────
const state = { charts: {}, monitorInterval: null, currentPage: 'dashboard' };

// ─── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initActions();
  loadDashboard();
});

// ═══ NAVIGATION ═════════════════════════════════════════════════════════════
function initNav() {
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

function navigateTo(page) {
  state.currentPage = page;
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.sidebar-btn[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page' + page.charAt(0).toUpperCase() + page.slice(1));
  if (target) target.classList.add('active');

  // Load data for page
  if (page === 'dashboard') loadDashboard();
  if (page === 'monitor') startMonitor();
  else stopMonitor();
  if (page === 'analysis') loadAnalysis();
}

function initActions() {
  // Dashboard
  document.getElementById('btnQuickScan')?.addEventListener('click', () => navigateTo('scanner'));
  document.querySelectorAll('.action-card').forEach(card => {
    card.addEventListener('click', () => navigateTo(card.dataset.goto));
  });
  // Scanner
  document.getElementById('btnScanJunk')?.addEventListener('click', scanJunk);
  document.getElementById('btnCleanJunk')?.addEventListener('click', showCleanModal);
  // Browser
  document.getElementById('btnScanBrowser')?.addEventListener('click', scanBrowser);
  // Dev
  document.getElementById('btnScanDev')?.addEventListener('click', scanDev);
  // Large
  document.getElementById('btnScanLarge')?.addEventListener('click', scanLargeFiles);
  // Modal
  document.getElementById('modalCancel')?.addEventListener('click', hideModal);
  document.getElementById('modalConfirm')?.addEventListener('click', executeClean);
}

// ═══ DASHBOARD ══════════════════════════════════════════════════════════════
async function loadDashboard() {
  try {
    // Disk usage
    const disk = await api('/api/disk/usage');
    el('qsDiskUsed').textContent = disk.usedFormatted;
    el('qsDiskFree').textContent = disk.availableFormatted;
    el('donutPct').textContent = disk.percentUsed + '%';
    el('sidebarDiskFill').style.width = disk.percentUsed + '%';
    el('sidebarDiskText').textContent = `${disk.usedFormatted} / ${disk.totalFormatted}`;
    drawDiskDonut(disk);

    // Health score
    const health = await api('/api/monitor/health');
    animateHealthGauge(health.score);
    el('healthScore').textContent = health.score;
    el('healthGrade').textContent = 'Grade ' + health.grade;
    renderHealthFactors(health.factors);

    // Memory quick stat
    el('qsMemory').textContent = health.memPercent + '%';

    // Category chart
    const cats = await api('/api/disk/analysis');
    drawCategoryBreakdown(cats);

    // Quick junk estimate
    const junk = await api('/api/scan/app-junk');
    el('qsJunk').textContent = junk.totalJunkFormatted;

  } catch (e) {
    console.error('Dashboard error:', e);
  }
}

function animateHealthGauge(score) {
  const circle = el('gaugeCircle');
  if (!circle) return;
  const circumference = 2 * Math.PI * 85; // r=85
  const offset = circumference - (score / 100) * circumference;

  // Add gradient def if missing
  const svg = circle.closest('svg');
  if (!svg.querySelector('#gaugeGrad')) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `<linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#a855f7"/></linearGradient>`;
    svg.prepend(defs);
  }

  circle.style.strokeDasharray = circumference;
  requestAnimationFrame(() => { circle.style.strokeDashoffset = offset; });
}

function renderHealthFactors(factors) {
  const container = el('healthFactors');
  container.innerHTML = factors.map(f => `
    <div class="health-factor">
      <span class="hf-dot ${f.severity}"></span>
      <span>${esc(f.name)}</span>
    </div>
  `).join('');
}

// ═══ CHARTS ═════════════════════════════════════════════════════════════════
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyle = 'circle';

const PALETTE = ['#6366f1','#a855f7','#ec4899','#3b82f6','#06b6d4','#22c55e','#eab308','#f97316','#ef4444','#8b5cf6','#14b8a6'];

function tooltipStyle() {
  return { backgroundColor:'rgba(12,12,20,0.95)', borderColor:'rgba(255,255,255,0.08)', borderWidth:1, padding:12, cornerRadius:12 };
}

function drawDiskDonut(data) {
  const ctx = el('dashDonut')?.getContext('2d');
  if (!ctx) return;
  if (state.charts.dashDonut) state.charts.dashDonut.destroy();
  state.charts.dashDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Used', 'Free'],
      datasets: [{ data: [data.used, data.available], backgroundColor: ['#6366f1', 'rgba(255,255,255,0.04)'], borderColor: ['rgba(99,102,241,0.3)', 'rgba(255,255,255,0.04)'], borderWidth: 2, borderRadius: 6, spacing: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '78%',
      plugins: { legend: { display: false }, tooltip: { ...tooltipStyle(), callbacks: { label: c => c.label + ': ' + fmtBytes(c.raw) } } },
      animation: { animateRotate: true, duration: 1200, easing: 'easeOutQuart' }
    }
  });
}

function drawCategoryBreakdown(data) {
  const ctx = el('dashCategory')?.getContext('2d');
  if (!ctx) return;
  if (state.charts.dashCat) state.charts.dashCat.destroy();
  const top8 = data.slice(0, 8);
  state.charts.dashCat = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: top8.map(c => c.name),
      datasets: [{ data: top8.map(c => c.size), backgroundColor: PALETTE, borderColor: PALETTE.map(c => c + '30'), borderWidth: 2, borderRadius: 4, spacing: 3 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '50%',
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, generateLabels: chart => chart.data.labels.map((l, i) => ({ text: `${l} — ${fmtBytes(chart.data.datasets[0].data[i])}`, fillStyle: PALETTE[i], strokeStyle: 'transparent', pointStyle: 'circle', hidden: false, index: i })) } },
        tooltip: { ...tooltipStyle(), callbacks: { label: c => c.label + ': ' + fmtBytes(c.raw) } }
      },
      animation: { animateRotate: true, duration: 1500, easing: 'easeOutQuart' }
    }
  });
}

// ═══ MONITOR ════════════════════════════════════════════════════════════════
function startMonitor() {
  stopMonitor();
  fetchMonitorData();
  state.monitorInterval = setInterval(fetchMonitorData, 3000);
}

function stopMonitor() {
  if (state.monitorInterval) { clearInterval(state.monitorInterval); state.monitorInterval = null; }
}

async function fetchMonitorData() {
  try {
    const d = await api('/api/monitor/stats');

    // CPU
    const cpuPct = d.cpu.total;
    setRing('cpuRing', cpuPct);
    el('cpuCenter').textContent = cpuPct + '%';
    el('monCpuVal').textContent = cpuPct + '%';
    el('cpuUser').textContent = d.cpu.user.toFixed(1);
    el('cpuSys').textContent = d.cpu.system.toFixed(1);

    // Memory
    setRing('memRing', d.memory.percentUsed);
    el('memCenter').textContent = d.memory.percentUsed + '%';
    el('monMemVal').textContent = d.memory.usedFormatted;
    el('memUsed').textContent = d.memory.usedFormatted;
    el('memFree').textContent = d.memory.freeFormatted;

    // Disk I/O
    const maxIO = 500;
    el('ioRead').style.width = Math.min(d.disk.readKBs / maxIO * 100, 100) + '%';
    el('ioWrite').style.width = Math.min(d.disk.writeKBs / maxIO * 100, 100) + '%';
    el('ioReadVal').textContent = d.disk.readKBs.toFixed(1) + ' KB/s';
    el('ioWriteVal').textContent = d.disk.writeKBs.toFixed(1) + ' KB/s';

    // Network
    el('netIn').style.width = '40%';
    el('netOut').style.width = '25%';
    el('netInVal').textContent = d.network.bytesInFormatted;
    el('netOutVal').textContent = d.network.bytesOutFormatted;
    el('sysUptime').textContent = d.uptime || '—';

  } catch (e) { /* silent */ }
}

function setRing(id, pct) {
  const ring = el(id);
  if (!ring) return;
  const circumference = 2 * Math.PI * 50;
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference - (pct / 100) * circumference;
}

// ═══ JUNK SCANNER ═══════════════════════════════════════════════════════════
async function scanJunk() {
  const btn = el('btnScanJunk');
  const progress = el('junkProgress');
  const results = el('junkResults');

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Scanning...';
  progress.classList.remove('hidden');
  results.classList.add('hidden');

  // Animate timeline
  const steps = document.querySelectorAll('.timeline-step');
  let stepIdx = 0;
  const stepInterval = setInterval(() => {
    if (stepIdx > 0) steps[stepIdx - 1].classList.replace('active', 'done');
    if (stepIdx < steps.length) { steps[stepIdx].classList.add('active'); stepIdx++; }
    else clearInterval(stepInterval);
  }, 600);

  try {
    const data = await api('/api/scan/app-junk');
    clearInterval(stepInterval);
    steps.forEach(s => { s.classList.remove('active'); s.classList.add('done'); });

    setTimeout(() => {
      progress.classList.add('hidden');
      results.classList.remove('hidden');
      displayJunkResults(data);
    }, 500);
  } catch (e) {
    clearInterval(stepInterval);
    toast('Scan failed', 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">🔍</span> Scan Again';
}

function displayJunkResults(data) {
  state.lastJunkData = data;
  el('junkTotalSize').textContent = data.totalJunkFormatted;
  el('junkAppCount').textContent = data.totalApps;
  el('junkFileCount').textContent = data.apps.reduce((s, a) => s + a.files.length, 0);

  // Bar chart
  drawJunkBar(data.apps);
  // List
  renderJunkList(data.apps);
  // Update dashboard
  el('qsJunk').textContent = data.totalJunkFormatted;
}

function drawJunkBar(apps) {
  const ctx = el('junkBarChart')?.getContext('2d');
  if (!ctx) return;
  if (state.charts.junkBar) state.charts.junkBar.destroy();
  const top10 = apps.slice(0, 10);
  state.charts.junkBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top10.map(a => a.appName),
      datasets: [{ label: 'Size', data: top10.map(a => a.totalSize), backgroundColor: PALETTE.map(c => c + '70'), borderColor: PALETTE, borderWidth: 2, borderRadius: 8, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { ...tooltipStyle(), callbacks: { label: c => fmtBytes(c.raw) } } },
      scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => fmtBytes(v) } }, y: { grid: { display: false }, ticks: { font: { weight: 600 } } } },
      animation: { duration: 800, easing: 'easeOutQuart' }
    }
  });
}

function renderJunkList(apps) {
  const list = el('junkAppList');
  if (!apps.length) { list.innerHTML = '<div class="glass-card" style="text-align:center;padding:48px"><div style="font-size:3rem;margin-bottom:16px">✨</div><h3>Your Mac is clean!</h3><p style="color:var(--text-3)">No leftover junk found.</p></div>'; return; }
  list.innerHTML = apps.map((app, i) => {
    const hasProt = app.files.some(f => f.isProtected);
    return `<div class="junk-item" style="animation:pageFade 0.3s ease ${i * 40}ms both">
      <div class="junk-item-header" onclick="toggleJunk(this)">
        <div class="junk-item-left"><div class="junk-item-icon">📦</div><div><div class="junk-item-name">${esc(app.appName)}</div><span class="badge ${hasProt ? 'badge-warn' : 'badge-safe'}">${hasProt ? '⚠️ Protected' : '✅ Safe'}</span></div></div>
        <div class="junk-item-right"><span class="junk-item-count">${app.files.length} file${app.files.length > 1 ? 's' : ''}</span><span class="junk-item-size">${app.totalSizeFormatted}</span><span class="junk-item-chevron">▼</span></div>
      </div>
      <div class="junk-item-body">${app.files.map(f => `<div class="junk-file"><div><div class="jf-path">${esc(f.bundleId)}</div><div class="jf-loc">📁 ${f.location}${f.isProtected ? ' 🔒' : ''}</div></div><span class="jf-size">${f.sizeFormatted}</span></div>`).join('')}</div>
    </div>`;
  }).join('');
}

// ═══ BROWSER CACHE ══════════════════════════════════════════════════════════
async function scanBrowser() {
  const btn = el('btnScanBrowser');
  btn.disabled = true; btn.innerHTML = '<span class="btn-icon">⏳</span> Scanning...';
  try {
    const data = await api('/api/scan/browser-cache');
    renderCleanupGrid('browserGrid', data.browsers, data.totalFormatted);
  } catch (e) { toast('Browser scan failed', 'error'); }
  btn.disabled = false; btn.innerHTML = '<span class="btn-icon">🌐</span> Scan Browsers';
}

// ═══ DEV JUNK ═══════════════════════════════════════════════════════════════
async function scanDev() {
  const btn = el('btnScanDev');
  btn.disabled = true; btn.innerHTML = '<span class="btn-icon">⏳</span> Scanning...';
  try {
    const data = await api('/api/scan/dev-junk');
    renderCleanupGrid('devGrid', data.items, data.totalFormatted);
  } catch (e) { toast('Dev scan failed', 'error'); }
  btn.disabled = false; btn.innerHTML = '<span class="btn-icon">💻</span> Scan Developer Data';
}

function renderCleanupGrid(containerId, items, totalFormatted) {
  const grid = el(containerId);
  if (!items.length) { grid.innerHTML = '<div class="glass-card" style="text-align:center;padding:48px;grid-column:1/-1"><div style="font-size:3rem;margin-bottom:16px">✨</div><h3>All clean!</h3><p style="color:var(--text-3)">Nothing to clean here.</p></div>'; return; }
  grid.innerHTML = items.map((item, i) => `
    <div class="cleanup-card" style="animation:pageFade 0.3s ease ${i * 60}ms both">
      <div class="cleanup-card-icon">${item.icon}</div>
      <div class="cleanup-card-name">${esc(item.name)}</div>
      <div class="cleanup-card-size" style="color:${item.color}">${item.sizeFormatted}</div>
      <div class="cleanup-card-label">cached data</div>
      <button class="btn btn-danger btn-glow" onclick="cleanPath('${esc(item.path || '')}', this)"><span class="btn-icon">🧹</span> Clean</button>
    </div>
  `).join('');
}

// ═══ DISK ANALYSIS ══════════════════════════════════════════════════════════
async function loadAnalysis() {
  try {
    const data = await api('/api/disk/analysis');

    // Pie
    const ctxPie = el('analysisPie')?.getContext('2d');
    if (ctxPie) {
      if (state.charts.aPie) state.charts.aPie.destroy();
      state.charts.aPie = new Chart(ctxPie, {
        type: 'pie',
        data: { labels: data.map(c => c.icon + ' ' + c.name), datasets: [{ data: data.map(c => c.size), backgroundColor: PALETTE, borderColor: 'rgba(6,6,10,0.8)', borderWidth: 3, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } }, tooltip: { ...tooltipStyle(), callbacks: { label: c => { const tot = c.dataset.data.reduce((a, b) => a + b, 0); return ` ${fmtBytes(c.raw)} (${((c.raw / tot) * 100).toFixed(1)}%)`; } } } }, animation: { animateRotate: true, duration: 1200 } }
      });
    }

    // Bar
    const ctxBar = el('analysisBar')?.getContext('2d');
    if (ctxBar) {
      if (state.charts.aBar) state.charts.aBar.destroy();
      const sorted = [...data].sort((a, b) => b.size - a.size);
      state.charts.aBar = new Chart(ctxBar, {
        type: 'bar',
        data: { labels: sorted.map(c => c.icon + ' ' + c.name), datasets: [{ data: sorted.map(c => c.size), backgroundColor: PALETTE.map(c => c + '60'), borderColor: PALETTE, borderWidth: 2, borderRadius: 8, borderSkipped: false }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { ...tooltipStyle(), callbacks: { label: c => fmtBytes(c.raw) } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => fmtBytes(v) } } }, animation: { duration: 1200, easing: 'easeOutQuart' } }
      });
    }

    // Grid
    const grid = el('catGrid');
    const maxSize = Math.max(...data.map(c => c.size));
    grid.innerHTML = data.map((cat, i) => {
      const pct = maxSize > 0 ? (cat.size / maxSize * 100) : 0;
      return `<div class="cat-card" style="animation:pageFade 0.3s ease ${i * 60}ms both">
        <div class="cat-header"><span class="cat-icon">${cat.icon}</span><span class="cat-name">${cat.name}</span></div>
        <div class="cat-size" style="color:${cat.color}">${cat.sizeFormatted}</div>
        <div class="cat-files">${cat.fileCount.toLocaleString()} files</div>
        <div class="cat-bar"><div class="cat-bar-fill" style="width:0%;background:${cat.color}"></div></div>
      </div>`;
    }).join('');
    // Animate bars
    setTimeout(() => {
      grid.querySelectorAll('.cat-bar-fill').forEach((bar, i) => {
        const pct = maxSize > 0 ? (data[i].size / maxSize * 100) : 0;
        setTimeout(() => { bar.style.width = pct + '%'; }, i * 80);
      });
    }, 300);
  } catch (e) { toast('Analysis failed', 'error'); }
}

// ═══ LARGE FILES ════════════════════════════════════════════════════════════
async function scanLargeFiles() {
  const btn = el('btnScanLarge');
  btn.disabled = true; btn.innerHTML = '<span class="btn-icon">⏳</span> Scanning...';
  try {
    const files = await api('/api/disk/large-files');
    const list = el('largeFilesList');
    if (!files.length) { list.innerHTML = '<div class="glass-card" style="text-align:center;padding:48px"><div style="font-size:3rem;margin-bottom:16px">📂</div><h3>No large files found</h3></div>'; }
    else {
      list.innerHTML = files.map((f, i) => `
        <div class="lf-row" id="lf-${i}" style="animation:pageFade 0.3s ease ${i * 50}ms both">
          <div class="lf-rank ${i < 3 ? 'top' : ''}">${i + 1}</div>
          <div class="lf-info"><div class="lf-name">${esc(f.name)}</div><div class="lf-dir">${esc(f.directory)}</div></div>
          <span class="lf-ext">${f.extension || '—'}</span>
          <span class="lf-size">${f.sizeFormatted}</span>
          <button class="btn btn-danger btn-sm" onclick="deleteLargeFile('${esc(f.path).replace(/'/g, "\\'")}', ${i}, this)" title="Move to Trash"><span class="btn-icon">🗑️</span></button>
        </div>
      `).join('');
    }
  } catch (e) { toast('Large file scan failed', 'error'); }
  btn.disabled = false; btn.innerHTML = '<span class="btn-icon">📁</span> Find Large Files';
}

// ═══ CLEANUP ════════════════════════════════════════════════════════════════
let pendingCleanPaths = [];

function showCleanModal() {
  const data = state.lastJunkData;
  if (!data || !data.apps.length) { toast('No junk to clean', 'info'); return; }
  pendingCleanPaths = [];
  data.apps.forEach(a => a.files.forEach(f => pendingCleanPaths.push(f.path)));
  el('modalMessage').textContent = `Clean ${data.totalJunkFormatted} of junk from ${data.totalApps} apps? Protected system files will be safely skipped.`;
  el('modalOverlay').classList.remove('hidden');
}

function hideModal() { el('modalOverlay').classList.add('hidden'); }

async function executeClean() {
  hideModal();
  if (!pendingCleanPaths.length) return;
  try {
    const result = await api('/api/clean/clean', 'POST', { paths: pendingCleanPaths });
    toast(`Freed ${result.totalFreedFormatted}!`, 'success');
    setTimeout(scanJunk, 1000);
  } catch (e) { toast('Cleanup failed', 'error'); }
}

async function cleanPath(p, btnEl) {
  if (!p) return;
  btnEl.disabled = true; btnEl.innerHTML = '⏳ Cleaning...';
  try {
    const result = await api('/api/clean/clean', 'POST', { paths: [p] });
    toast(`Freed ${result.totalFreedFormatted}!`, 'success');
    btnEl.innerHTML = '✅ Done';
    btnEl.style.background = 'var(--green)';
  } catch (e) { toast('Failed', 'error'); btnEl.disabled = false; btnEl.innerHTML = '🧹 Clean'; }
}

// ═══ UTILITIES ══════════════════════════════════════════════════════════════
function el(id) { return document.getElementById(id); }
function esc(str) { const d = document.createElement('div'); d.appendChild(document.createTextNode(str)); return d.innerHTML; }
function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
}

async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function toast(msg, type = 'info') {
  const c = el('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${esc(msg)}`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

async function deleteLargeFile(filePath, index, btnEl) {
  if (!confirm(`Are you sure you want to delete this file?\n\n${filePath}\n\nThis cannot be undone.`)) return;

  btnEl.disabled = true;
  btnEl.innerHTML = '⏳';

  try {
    const result = await api('/api/clean/delete-file', 'POST', { path: filePath });
    if (result.status === 'deleted') {
      toast(`Deleted! Freed ${result.freedFormatted}`, 'success');
      const row = el('lf-' + index);
      if (row) {
        row.style.opacity = '0.3';
        row.style.pointerEvents = 'none';
        btnEl.innerHTML = '✅';
        btnEl.style.background = 'var(--green)';
      }
    } else {
      toast('Could not delete: ' + (result.reason || 'Protected file'), 'error');
      btnEl.disabled = false;
      btnEl.innerHTML = '<span class="btn-icon">🗑️</span>';
    }
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
    btnEl.disabled = false;
    btnEl.innerHTML = '<span class="btn-icon">🗑️</span>';
  }
}

function toggleJunk(header) {
  const body = header.nextElementSibling;
  const chevron = header.querySelector('.junk-item-chevron');
  body.classList.toggle('open');
  chevron.classList.toggle('open');
}

