'use strict';
/**
 * 单文件 exe 入口（Node SEA）
 *
 * 双击后：启动本地服务 → 自动打开浏览器 → 控制台打印地址。
 * 关掉窗口即退出。
 */

const { exec } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// 便携模式：exe 旁有 portable/ 目录就说明用户想带着数据走
const exeDir = path.dirname(process.execPath);
const portableFlag = path.join(exeDir, 'portable');

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  } catch {
    // 打不开就算了，地址已经打印在控制台
  }
}

function main() {
  const app = require('./server.js');
  const dataDir = app.store.resolveDataDir();

  app.server.listen(app.PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${app.PORT}`;
    console.log('');
    console.log('  动画大丸家 · 本地版');
    console.log('  ──────────────────────────────');
    console.log(`  地址：${url}`);
    console.log(`  数据：${dataDir}`);
    if (fs.existsSync(portableFlag)) {
      console.log('  模式：便携（数据存在 portable 目录，可整个文件夹带走）');
    } else {
      console.log('  提示：在 exe 旁边建一个 portable 文件夹，数据就会存进去，方便整体迁移');
    }
    console.log('  关闭本窗口即可退出。');
    console.log('');
    // NO_OPEN=1 供自动化冒烟使用，避免弹浏览器
    if (!process.env.NO_OPEN) openBrowser(url);
  });

  app.server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
      console.error(`端口 ${app.PORT} 被占用，请关闭占用该端口的程序后重试。`);
      process.exit(1);
    }
    throw e;
  });

  // Windows 下点关闭按钮时优雅退出
  if (os.platform() === 'win32') {
    process.on('SIGINT', () => process.exit(0));
  }
}

main();
