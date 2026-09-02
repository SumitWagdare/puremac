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

// ─── Overall disk usage ─────────────────────────────────────────────────────
router.get('/usage', async (req, res) => {
  try {
    const output = await runCmd("df -k / | tail -1");
    const parts = output.split(/\s+/);
    const totalKB = parseInt(parts[1]);
    const usedKB = parseInt(parts[2]);
    const availKB = parseInt(parts[3]);
    const capacityPercent = parseInt(parts[4]);

    res.json({
      total: totalKB * 1024,
      used: usedKB * 1024,
      available: availKB * 1024,
      percentUsed: capacityPercent,
      totalFormatted: formatBytes(totalKB * 1024),
      usedFormatted: formatBytes(usedKB * 1024),
      availableFormatted: formatBytes(availKB * 1024)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Category breakdown ─────────────────────────────────────────────────────
router.get('/analysis', async (req, res) => {
  try {
    const categories = [
      { name: 'Applications', path: '/Applications', icon: '📱', color: '#6366f1' },
      { name: 'Documents', path: `${HOME}/Documents`, icon: '📄', color: '#3b82f6' },
      { name: 'Downloads', path: `${HOME}/Downloads`, icon: '📥', color: '#06b6d4' },
      { name: 'Desktop', path: `${HOME}/Desktop`, icon: '🖥️', color: '#22c55e' },
      { name: 'Pictures', path: `${HOME}/Pictures`, icon: '🖼️', color: '#eab308' },
      { name: 'Music', path: `${HOME}/Music`, icon: '🎵', color: '#f97316' },
      { name: 'Movies', path: `${HOME}/Movies`, icon: '🎬', color: '#ef4444' },
      { name: 'App Support', path: `${HOME}/Library/Application Support`, icon: '⚙️', color: '#a855f7' },
      { name: 'Caches', path: `${HOME}/Library/Caches`, icon: '🗄️', color: '#ec4899' },
      { name: 'Containers', path: `${HOME}/Library/Containers`, icon: '📦', color: '#8b5cf6' },
      { name: 'Logs', path: `${HOME}/Library/Logs`, icon: '📋', color: '#14b8a6' },
    ];

    const results = [];
    for (const cat of categories) {
      try {
        if (!fs.existsSync(cat.path)) {
          results.push({ ...cat, size: 0, sizeFormatted: '0 B', fileCount: 0 });
          continue;
        }
        const duOut = await runCmd(`du -sk "${cat.path}" 2>/dev/null | tail -1`, 15000);
        const countOut = await runCmd(`find "${cat.path}" -maxdepth 3 -type f 2>/dev/null | wc -l`, 10000);
        const sizeKB = parseInt(duOut.split(/\t/)[0]) || 0;
        const fileCount = parseInt(countOut.trim()) || 0;
        results.push({ ...cat, size: sizeKB * 1024, sizeFormatted: formatBytes(sizeKB * 1024), fileCount });
      } catch (e) {
        results.push({ ...cat, size: 0, sizeFormatted: '0 B', fileCount: 0 });
      }
    }
    results.sort((a, b) => b.size - a.size);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Large files ────────────────────────────────────────────────────────────
router.get('/large-files', async (req, res) => {
  try {
    const output = await runCmd(
      `find "${HOME}" -maxdepth 5 -type f -size +50M 2>/dev/null | head -30 | xargs du -sk 2>/dev/null | sort -rn | head -15`,
      30000
    );
    const files = output.split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\t/);
      if (parts.length >= 2) {
        const filePath = parts.slice(1).join('\t');
        const ext = path.extname(filePath).toLowerCase();
        return {
          path: filePath,
          name: path.basename(filePath),
          size: parseInt(parts[0]) * 512,
          sizeFormatted: formatBytes(parseInt(parts[0]) * 512),
          extension: ext,
          directory: path.dirname(filePath)
        };
      }
      return null;
    }).filter(Boolean);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
