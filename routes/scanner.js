const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const HOME = os.homedir();

function runCmd(cmd, timeout = 30000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
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

// Known Apple/System prefixes to skip
const SYSTEM_PREFIXES = [
  'com.apple.', 'com.microsoft.', 'org.mozilla.', 'com.google.',
  'com.github.', 'group.com.apple.', 'MobileMeAccounts',
  'com.crashlytics', 'com.cocoapods', '.DS_Store', 'Apple',
  'CloudDocs', 'AddressBook', 'CallHistoryDB', 'FaceTime',
  'iCloud', 'Knowledge', 'StatusKit', 'SyncServices',
  'com.npm.', 'com.electron.', 'Homebrew', 'npm', 'yarn',
  'pip', 'Code', 'com.visualstudio', 'com.jetbrains'
];

// ─── Scan for app junk ──────────────────────────────────────────────────────
router.get('/app-junk', async (req, res) => {
  try {
    const appsOutput = await runCmd('ls /Applications/ 2>/dev/null');
    const installedApps = appsOutput.split('\n')
      .filter(a => a.endsWith('.app'))
      .map(a => a.replace('.app', '').toLowerCase());

    const scanDirs = [
      { name: 'Application Support', path: `${HOME}/Library/Application Support` },
      { name: 'Caches', path: `${HOME}/Library/Caches` },
      { name: 'Preferences', path: `${HOME}/Library/Preferences` },
      { name: 'Containers', path: `${HOME}/Library/Containers` },
      { name: 'Group Containers', path: `${HOME}/Library/Group Containers` },
      { name: 'Saved Application State', path: `${HOME}/Library/Saved Application State` },
    ];

    const junkApps = {};

    for (const dir of scanDirs) {
      try {
        if (!fs.existsSync(dir.path)) continue;
        const entries = fs.readdirSync(dir.path);
        for (const entry of entries) {
          const isSystem = SYSTEM_PREFIXES.some(prefix =>
            entry.toLowerCase().startsWith(prefix.toLowerCase()) || entry.startsWith('.')
          );
          if (isSystem) continue;

          const entryLower = entry.toLowerCase();
          const isInstalled = installedApps.some(app => {
            return entryLower.includes(app) || app.includes(entryLower);
          });

          if (!isInstalled) {
            const fullPath = path.join(dir.path, entry);
            try {
              const duOut = await runCmd(`du -sk "${fullPath}" 2>/dev/null | tail -1`, 5000);
              const sizeKB = parseInt(duOut.split(/\t/)[0]) || 0;
              const sizeBytes = sizeKB * 1024;
              if (sizeBytes > 0) {
                let appName = entry;
                const parts = entry.split('.');
                if (parts.length >= 3) {
                  appName = parts[parts.length - 1] || parts[parts.length - 2] || entry;
                  appName = appName.charAt(0).toUpperCase() + appName.slice(1);
                }

                if (!junkApps[appName]) {
                  junkApps[appName] = { appName, bundleIds: [], files: [], totalSize: 0, totalSizeFormatted: '' };
                }
                junkApps[appName].bundleIds.push(entry);
                junkApps[appName].files.push({
                  path: fullPath, location: dir.name, bundleId: entry,
                  size: sizeBytes, sizeFormatted: formatBytes(sizeBytes),
                  isProtected: dir.name === 'Containers' || dir.name === 'Group Containers'
                });
                junkApps[appName].totalSize += sizeBytes;
                junkApps[appName].totalSizeFormatted = formatBytes(junkApps[appName].totalSize);
              }
            } catch (e) { /* skip */ }
          }
        }
      } catch (e) { /* skip */ }
    }

    const junkList = Object.values(junkApps).sort((a, b) => b.totalSize - a.totalSize);
    const totalJunk = junkList.reduce((sum, app) => sum + app.totalSize, 0);

    res.json({
      apps: junkList,
      totalJunk,
      totalJunkFormatted: formatBytes(totalJunk),
      totalApps: junkList.length,
      scannedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Scan browser caches ────────────────────────────────────────────────────
router.get('/browser-cache', async (req, res) => {
  try {
    const browsers = [
      { name: 'Safari', paths: [`${HOME}/Library/Caches/com.apple.Safari`], icon: '🧭', color: '#3b82f6' },
      { name: 'Chrome', paths: [`${HOME}/Library/Caches/Google/Chrome`, `${HOME}/Library/Application Support/Google/Chrome/Default/Cache`], icon: '🌐', color: '#22c55e' },
      { name: 'Firefox', paths: [`${HOME}/Library/Caches/Firefox`], icon: '🦊', color: '#f97316' },
      { name: 'Arc', paths: [`${HOME}/Library/Caches/company.thebrowser.Browser`], icon: '🌈', color: '#a855f7' },
      { name: 'Edge', paths: [`${HOME}/Library/Caches/com.microsoft.edgemac`], icon: '🔷', color: '#06b6d4' },
    ];

    const results = [];
    for (const browser of browsers) {
      let totalSize = 0;
      let exists = false;
      for (const p of browser.paths) {
        if (fs.existsSync(p)) {
          exists = true;
          const duOut = await runCmd(`du -sk "${p}" 2>/dev/null | tail -1`, 5000);
          totalSize += (parseInt(duOut.split(/\t/)[0]) || 0) * 1024;
        }
      }
      if (exists) {
        results.push({ ...browser, size: totalSize, sizeFormatted: formatBytes(totalSize) });
      }
    }
    const total = results.reduce((s, r) => s + r.size, 0);
    res.json({ browsers: results, total, totalFormatted: formatBytes(total) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Scan developer junk ────────────────────────────────────────────────────
router.get('/dev-junk', async (req, res) => {
  try {
    const devPaths = [
      { name: 'Xcode DerivedData', path: `${HOME}/Library/Developer/Xcode/DerivedData`, icon: '🔨', color: '#3b82f6' },
      { name: 'Xcode Archives', path: `${HOME}/Library/Developer/Xcode/Archives`, icon: '📦', color: '#6366f1' },
      { name: 'CocoaPods Cache', path: `${HOME}/Library/Caches/CocoaPods`, icon: '🫛', color: '#ef4444' },
      { name: 'npm Cache', path: `${HOME}/.npm/_cacache`, icon: '📗', color: '#22c55e' },
      { name: 'Yarn Cache', path: `${HOME}/Library/Caches/Yarn`, icon: '🧶', color: '#06b6d4' },
      { name: 'pip Cache', path: `${HOME}/Library/Caches/pip`, icon: '🐍', color: '#eab308' },
      { name: 'Gradle Cache', path: `${HOME}/.gradle/caches`, icon: '🐘', color: '#a855f7' },
      { name: 'Homebrew Cache', path: `${HOME}/Library/Caches/Homebrew`, icon: '🍺', color: '#f97316' },
    ];

    const results = [];
    for (const dev of devPaths) {
      if (fs.existsSync(dev.path)) {
        const duOut = await runCmd(`du -sk "${dev.path}" 2>/dev/null | tail -1`, 10000);
        const size = (parseInt(duOut.split(/\t/)[0]) || 0) * 1024;
        if (size > 0) {
          results.push({ ...dev, size, sizeFormatted: formatBytes(size) });
        }
      }
    }
    const total = results.reduce((s, r) => s + r.size, 0);
    res.json({ items: results, total, totalFormatted: formatBytes(total) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Scan system logs ───────────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
  try {
    const logPaths = [
      { name: 'User Logs', path: `${HOME}/Library/Logs`, icon: '📋', color: '#6366f1' },
      { name: 'Crash Reports', path: `${HOME}/Library/Logs/DiagnosticReports`, icon: '💥', color: '#ef4444' },
      { name: 'CrashReporter', path: `${HOME}/Library/Application Support/CrashReporter`, icon: '🔴', color: '#f97316' },
    ];

    const results = [];
    for (const lp of logPaths) {
      if (fs.existsSync(lp.path)) {
        const duOut = await runCmd(`du -sk "${lp.path}" 2>/dev/null | tail -1`, 5000);
        const size = (parseInt(duOut.split(/\t/)[0]) || 0) * 1024;
        if (size > 0) {
          results.push({ ...lp, size, sizeFormatted: formatBytes(size) });
        }
      }
    }
    const total = results.reduce((s, r) => s + r.size, 0);
    res.json({ items: results, total, totalFormatted: formatBytes(total) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Scan old downloads ─────────────────────────────────────────────────────
router.get('/old-downloads', async (req, res) => {
  try {
    const downloadsPath = `${HOME}/Downloads`;
    const output = await runCmd(
      `find "${downloadsPath}" -maxdepth 1 -type f -mtime +30 2>/dev/null | head -50`,
      15000
    );

    const files = [];
    const lines = output.split('\n').filter(Boolean);
    for (const filePath of lines) {
      const duOut = await runCmd(`du -sk "${filePath}" 2>/dev/null`, 3000);
      const size = (parseInt(duOut.split(/\t/)[0]) || 0) * 1024;
      if (size > 0) {
        files.push({
          path: filePath,
          name: path.basename(filePath),
          size,
          sizeFormatted: formatBytes(size),
          extension: path.extname(filePath).toLowerCase()
        });
      }
    }
    files.sort((a, b) => b.size - a.size);
    const total = files.reduce((s, f) => s + f.size, 0);
    res.json({ files, total, totalFormatted: formatBytes(total), count: files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Trash size ─────────────────────────────────────────────────────────────
router.get('/trash', async (req, res) => {
  try {
    const trashPath = `${HOME}/.Trash`;
    const duOut = await runCmd(`du -sk "${trashPath}" 2>/dev/null | tail -1`, 5000);
    const size = (parseInt(duOut.split(/\t/)[0]) || 0) * 1024;
    const countOut = await runCmd(`ls -1 "${trashPath}" 2>/dev/null | wc -l`, 3000);
    const count = parseInt(countOut.trim()) || 0;
    res.json({ size, sizeFormatted: formatBytes(size), itemCount: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
