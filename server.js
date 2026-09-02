const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const { platform } = require('process');

// Route modules
const diskRoutes = require('./routes/disk');
const scannerRoutes = require('./routes/scanner');
const cleanerRoutes = require('./routes/cleaner');
const monitorRoutes = require('./routes/monitor');

const app = express();
const PORT = 3847;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/disk', diskRoutes);
app.use('/api/scan', scannerRoutes);
app.use('/api/clean', cleanerRoutes);
app.use('/api/monitor', monitorRoutes);

// ─── Serve frontend ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║     ✨  PureMac  v2.0.0             ║');
  console.log('  ║     Mac Cleanup & Optimization       ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  ➜  ${url}          ║`);
  console.log('  ║  ✅  Fully offline — no internet     ║');
  console.log('  ║  ⌃C  to stop                        ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');

  if (platform === 'darwin' && !process.env.IS_ELECTRON) {
    exec(`open ${url}`);
  }
});
