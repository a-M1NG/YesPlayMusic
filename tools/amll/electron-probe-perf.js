const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const target = process.argv[2] || 'http://127.0.0.1:27232';

// 把用户数据目录默认放在仓库的 .dev/amll 下，避免在系统目录里留下测试痕迹
app.setPath(
  'userData',
  process.env.DSH_PROBE_USER_DATA ||
    path.resolve(__dirname, '../../.dev/amll/electron-profile')
);

app.commandLine.appendSwitch('mute-audio');
app.commandLine.appendSwitch('remote-debugging-port', '9333');
// 窗口被遮挡或失去焦点时 Chromium 会降频 requestAnimationFrame，测量帧时间之前必须关掉这几项
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

app.on('ready', () => {
  const win = new BrowserWindow({
    width: 1470,
    height: 865,
    show: true,
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  win.loadURL(target);
  win.webContents.on('console-message', (_event, level, message) => {
    console.log(`[渲染进程 ${level}] ${message}`);
  });
});
