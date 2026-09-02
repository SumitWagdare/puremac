const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const os = require('os');

function runCmd(cmd, timeout = 5000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve(stdout ? stdout.trim() : '');
    });
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ─── Real-time system stats ─────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    // CPU Usage
    const cpuOut = await runCmd(`top -l 1 -n 0 | grep "CPU usage"`, 5000);
    let cpuUser = 0, cpuSys = 0, cpuIdle = 100;
    if (cpuOut) {
      const userMatch = cpuOut.match(/([\d.]+)% user/);
      const sysMatch = cpuOut.match(/([\d.]+)% sys/);
      const idleMatch = cpuOut.match(/([\d.]+)% idle/);
      if (userMatch) cpuUser = parseFloat(userMatch[1]);
      if (sysMatch) cpuSys = parseFloat(sysMatch[1]);
      if (idleMatch) cpuIdle = parseFloat(idleMatch[1]);
    }

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Memory pressure (macOS specific)
    const memPressure = await runCmd(`memory_pressure | head -1`, 3000);
    let pressureLevel = 'normal';
    if (memPressure.includes('WARN')) pressureLevel = 'warning';
    if (memPressure.includes('CRITICAL')) pressureLevel = 'critical';

    // Disk I/O
    const diskIO = await runCmd(`iostat -c 1 -d disk0 2>/dev/null | tail -1`, 3000);
    let diskRead = 0, diskWrite = 0;
    if (diskIO) {
      const ioParts = diskIO.trim().split(/\s+/);
      if (ioParts.length >= 3) {
        diskRead = parseFloat(ioParts[1]) || 0;
        diskWrite = parseFloat(ioParts[2]) || 0;
      }
    }

    // Network
    const netOut = await runCmd(`netstat -ib | grep en0 | head -1`, 3000);
    let netIn = 0, netOut2 = 0;
    if (netOut) {
      const netParts = netOut.trim().split(/\s+/);
      if (netParts.length >= 10) {
        netIn = parseInt(netParts[6]) || 0;
        netOut2 = parseInt(netParts[9]) || 0;
      }
    }

    // Uptime
    const uptimeOut = await runCmd('uptime', 3000);
    let uptime = '';
    const uptimeMatch = uptimeOut.match(/up\s+(.+?),\s+\d+\s+user/);
    if (uptimeMatch) uptime = uptimeMatch[1].trim();

    res.json({
      cpu: {
        user: cpuUser,
        system: cpuSys,
        idle: cpuIdle,
        total: Math.round(cpuUser + cpuSys)
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        percentUsed: Math.round((usedMem / totalMem) * 100),
        totalFormatted: formatBytes(totalMem),
        usedFormatted: formatBytes(usedMem),
        freeFormatted: formatBytes(freeMem),
        pressure: pressureLevel
      },
      disk: {
        readKBs: diskRead,
        writeKBs: diskWrite
      },
      network: {
        bytesIn: netIn,
        bytesOut: netOut2,
        bytesInFormatted: formatBytes(netIn),
        bytesOutFormatted: formatBytes(netOut2)
      },
      uptime,
      timestamp: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health score ───────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    let score = 100;
    const factors = [];

    // Disk space factor (max -30 points)
    const dfOut = await runCmd("df -k / | tail -1");
    const dfParts = dfOut.split(/\s+/);
    const diskPercent = parseInt(dfParts[4]) || 0;
    if (diskPercent > 90) { score -= 30; factors.push({ name: 'Disk nearly full', impact: -30, severity: 'critical' }); }
    else if (diskPercent > 80) { score -= 20; factors.push({ name: 'Disk space low', impact: -20, severity: 'warning' }); }
    else if (diskPercent > 70) { score -= 10; factors.push({ name: 'Disk filling up', impact: -10, severity: 'info' }); }
    else { factors.push({ name: 'Disk space healthy', impact: 0, severity: 'good' }); }

    // Cache size factor (max -15 points)
    const HOME = os.homedir();
    const cacheOut = await runCmd(`du -sk "${HOME}/Library/Caches" 2>/dev/null | tail -1`, 10000);
    const cacheSizeMB = ((parseInt(cacheOut.split(/\t/)[0]) || 0) * 1024) / (1024 * 1024);
    if (cacheSizeMB > 5000) { score -= 15; factors.push({ name: 'Large cache (>' + Math.round(cacheSizeMB / 1024) + ' GB)', impact: -15, severity: 'warning' }); }
    else if (cacheSizeMB > 2000) { score -= 8; factors.push({ name: 'Moderate cache', impact: -8, severity: 'info' }); }
    else { factors.push({ name: 'Cache size normal', impact: 0, severity: 'good' }); }

    // Logs factor (max -10 points)
    const logsOut = await runCmd(`du -sk "${HOME}/Library/Logs" 2>/dev/null | tail -1`, 5000);
    const logsSizeMB = ((parseInt(logsOut.split(/\t/)[0]) || 0) * 1024) / (1024 * 1024);
    if (logsSizeMB > 1000) { score -= 10; factors.push({ name: 'Too many log files', impact: -10, severity: 'warning' }); }
    else if (logsSizeMB > 500) { score -= 5; factors.push({ name: 'Moderate log size', impact: -5, severity: 'info' }); }
    else { factors.push({ name: 'Logs are clean', impact: 0, severity: 'good' }); }

    // Trash factor (max -10 points)
    const trashOut = await runCmd(`du -sk "${HOME}/.Trash" 2>/dev/null | tail -1`, 5000);
    const trashSizeMB = ((parseInt(trashOut.split(/\t/)[0]) || 0) * 1024) / (1024 * 1024);
    if (trashSizeMB > 2000) { score -= 10; factors.push({ name: 'Trash is full (>' + Math.round(trashSizeMB / 1024) + ' GB)', impact: -10, severity: 'warning' }); }
    else if (trashSizeMB > 500) { score -= 5; factors.push({ name: 'Trash has items', impact: -5, severity: 'info' }); }
    else { factors.push({ name: 'Trash is clean', impact: 0, severity: 'good' }); }

    // RAM factor (max -15 points)
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
    if (memPercent > 90) { score -= 15; factors.push({ name: 'Memory critical', impact: -15, severity: 'critical' }); }
    else if (memPercent > 80) { score -= 8; factors.push({ name: 'Memory high usage', impact: -8, severity: 'warning' }); }
    else { factors.push({ name: 'Memory healthy', impact: 0, severity: 'good' }); }

    // Downloads folder factor (max -10 points)
    const dlOut = await runCmd(`find "${HOME}/Downloads" -maxdepth 1 -type f -mtime +30 2>/dev/null | wc -l`, 5000);
    const oldFiles = parseInt(dlOut.trim()) || 0;
    if (oldFiles > 50) { score -= 10; factors.push({ name: `${oldFiles} old files in Downloads`, impact: -10, severity: 'warning' }); }
    else if (oldFiles > 20) { score -= 5; factors.push({ name: `${oldFiles} old files in Downloads`, impact: -5, severity: 'info' }); }
    else { factors.push({ name: 'Downloads folder tidy', impact: 0, severity: 'good' }); }

    score = Math.max(0, Math.min(100, score));

    let grade = 'A+';
    if (score >= 90) grade = 'A+';
    else if (score >= 80) grade = 'A';
    else if (score >= 70) grade = 'B';
    else if (score >= 60) grade = 'C';
    else if (score >= 40) grade = 'D';
    else grade = 'F';

    res.json({ score, grade, factors, diskPercent, memPercent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
