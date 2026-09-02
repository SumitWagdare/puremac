const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');

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

// ─── Clean selected paths ───────────────────────────────────────────────────
router.post('/clean', async (req, res) => {
  const { paths } = req.body;
  if (!paths || !Array.isArray(paths)) {
    return res.status(400).json({ error: 'paths array required' });
  }

  const results = [];
  let freedBytes = 0;

  for (const filePath of paths) {
    if (!filePath.startsWith(`${HOME}/Library/`) && !filePath.startsWith(`${HOME}/Downloads/`) && !filePath.startsWith(`${HOME}/.Trash`)) {
      results.push({ path: filePath, status: 'skipped', reason: 'Not in allowed folder' });
      continue;
    }

    try {
      const duOut = await runCmd(`du -sk "${filePath}" 2>/dev/null | tail -1`, 5000);
      const sizeKB = parseInt(duOut.split(/\t/)[0]) || 0;
      const sizeBytes = sizeKB * 1024;

      await runCmd(`rm -rf "${filePath}"/* 2>/dev/null`, 10000);
      await runCmd(`rm -rf "${filePath}" 2>/dev/null`, 10000);

      if (fs.existsSync(filePath)) {
        const duOutAfter = await runCmd(`du -sk "${filePath}" 2>/dev/null | tail -1`, 5000);
        const sizeAfter = (parseInt(duOutAfter.split(/\t/)[0]) || 0) * 1024;
        const cleaned = sizeBytes - sizeAfter;
        freedBytes += cleaned;
        results.push({
          path: filePath, status: cleaned > 0 ? 'partial' : 'protected',
          freedFormatted: formatBytes(cleaned),
          reason: 'Protected by macOS — contents cleaned where possible'
        });
      } else {
        freedBytes += sizeBytes;
        results.push({ path: filePath, status: 'deleted', freedFormatted: formatBytes(sizeBytes) });
      }
    } catch (e) {
      results.push({ path: filePath, status: 'error', reason: e.message });
    }
  }

  res.json({ results, totalFreed: freedBytes, totalFreedFormatted: formatBytes(freedBytes) });
});

// ─── Empty Trash ────────────────────────────────────────────────────────────
router.post('/empty-trash', async (req, res) => {
  try {
    const duBefore = await runCmd(`du -sk "${HOME}/.Trash" 2>/dev/null | tail -1`, 5000);
    const sizeBefore = (parseInt(duBefore.split(/\t/)[0]) || 0) * 1024;

    await runCmd(`rm -rf "${HOME}/.Trash"/* 2>/dev/null`, 15000);

    const duAfter = await runCmd(`du -sk "${HOME}/.Trash" 2>/dev/null | tail -1`, 5000);
    const sizeAfter = (parseInt(duAfter.split(/\t/)[0]) || 0) * 1024;
    const freed = sizeBefore - sizeAfter;

    res.json({ freed, freedFormatted: formatBytes(freed), status: 'success' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete single file ───────────────────────────────────────────────────────
router.post('/delete-file', async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  try {
    const duOut = await runCmd(`du -sk "${filePath}" 2>/dev/null | tail -1`, 5000);
    const sizeKB = parseInt(duOut.split(/\t/)[0]) || 0;
    const sizeBytes = sizeKB * 1024;

    await runCmd(`rm -rf "${filePath}" 2>/dev/null`, 10000);

    if (fs.existsSync(filePath)) {
      res.json({ status: 'error', reason: 'Protected file or permission denied' });
    } else {
      res.json({ status: 'deleted', freed: sizeBytes, freedFormatted: formatBytes(sizeBytes) });
    }
  } catch (err) {
    res.status(500).json({ status: 'error', reason: err.message });
  }
});

module.exports = router;
