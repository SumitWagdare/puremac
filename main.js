const { app, BrowserWindow } = require('electron');
const { fork } = require('child_process');
const path = require('path');
const http = require('http');

let mainWindow;
let serverProcess;

const PORT = 3847;
const URL = `http://localhost:${PORT}`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#06060a',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Wait for server to be up before loading
  waitForServer(URL, () => {
    mainWindow.loadURL(URL);
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function waitForServer(url, cb) {
  const check = () => {
    http.get(url, (res) => {
      if (res.statusCode === 200) {
        cb();
      } else {
        setTimeout(check, 200);
      }
    }).on('error', () => {
      setTimeout(check, 200);
    });
  };
  check();
}

app.whenReady().then(() => {
  // Start the Express server
  serverProcess = fork(path.join(__dirname, 'server.js'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', IS_ELECTRON: 'true' }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  // Kill the server when the app quits
  if (serverProcess) {
    serverProcess.kill();
  }
});
