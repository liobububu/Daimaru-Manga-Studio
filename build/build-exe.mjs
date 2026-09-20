/**
 * 打包成 Windows 单文件 exe（Node SEA）
 *
 * 流程：bundle 服务端 → 生成 blob（含前端 dist 资源）→ 复制 node.exe → postject 注入 → 冒烟自检
 *
 * 几个已经踩过的坑，都在这里绕开了：
 *   - SEA 主脚本里 require('./lib/x') 不按路径解析 → 先 bundle 成单文件
 *   - sentinel fuse 不是文档里那个值 → 从 node.exe 二进制里挖
 *   - postject 的 CLI 在部分 shell 下读不到资源文件 → 直接用它的 Node API
 *   - 装构建工具用 --no-save 会让 npm 互相清理 → 单独目录 + 写进 package.json + 进目录装
 *   - 冒烟端口写死会撞上别的软件 → 动态取
 *
 * 运行： node build/build-exe.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle, collectAssets } from './bundle-server.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const OUT = path.join(ROOT, 'dist-exe');
const TOOLS = path.join(ROOT, '.build-tools');

const APP_NAME = '动画大丸家';
const POSTJECT_VERSION = '1.0.0-alpha.6';

function step(msg) {
  console.log(`\n▶ ${msg}`);
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// ───────────────────────── 1. bundle ─────────────────────────
step('内联服务端模块');
const DIST = path.join(ROOT, 'dist');
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  fail('未找到 dist/index.html，请先运行 npm run build');
}
const embeddedAssets = collectAssets(DIST);

const bundled = bundle({
  entry: path.join(ROOT, 'local', 'sea-entry.js'),
  localDir: path.join(ROOT, 'local'),
  outFile: path.join(BUILD, 'bundled-server.cjs'),
  embedAssets: embeddedAssets,
});
console.log(`  已内联 ${bundled.count} 个模块、${Object.keys(embeddedAssets).length} 个前端文件`);

// ───────────────────────── 2. 生成 blob ─────────────────────────
step('生成 SEA blob');
fs.mkdirSync(OUT, { recursive: true });
const seaConfig = {
  main: path.relative(ROOT, bundled.outFile),
  output: path.relative(ROOT, path.join(BUILD, 'sea-prep.blob')),
  disableExperimentalSEAWarning: true,
};
const configPath = path.join(BUILD, 'sea-config.json');
fs.writeFileSync(configPath, JSON.stringify(seaConfig, null, 2), 'utf8');

const nodeExe = process.execPath;
const gen = spawnSync(nodeExe, ['--experimental-sea-config', configPath], { cwd: ROOT, encoding: 'utf8' });
if (gen.status !== 0) {
  console.error(gen.stdout || '');
  console.error(gen.stderr || '');
  fail('生成 blob 失败');
}
const blobPath = path.join(BUILD, 'sea-prep.blob');
console.log(`  blob: ${(fs.statSync(blobPath).size / 1024 / 1024).toFixed(2)} MB`);

// ───────────────────────── 4. 挖 sentinel fuse ─────────────────────────
step('从 node.exe 中读取 sentinel fuse');
function findFuse(exePath) {
  const buf = fs.readFileSync(exePath);
  // 只要 NODE_SEA_FUSE_<hash> 这一段，不能带后面的 ":0"，
  // postject 会自己按长度定位冒号，带上了会报 charCodeAt is not a function
  const m = /NODE_SEA_FUSE_[0-9a-f]+/.exec(buf.toString('latin1'));
  if (!m) throw new Error('这个 node.exe 不含 SEA fuse，请换用官方 Node 20+ 构建');
  return m[0];
}
let FUSE;
try {
  FUSE = findFuse(nodeExe);
  console.log(`  ${FUSE}`);
} catch (e) {
  fail(e.message);
}

// ───────────────────────── 5. 安装 postject ─────────────────────────
step('准备 postject');
let postject;
try {
  postject = await import(pathToFileURL(path.join(TOOLS, 'node_modules', 'postject', 'dist', 'api.js')).href);
} catch {
  // 单独目录 + 显式写进 package.json，避免 --no-save 让 npm 互相清理
  fs.mkdirSync(TOOLS, { recursive: true });
  fs.writeFileSync(
    path.join(TOOLS, 'package.json'),
    JSON.stringify({ name: 'donghua-build-tools', private: true, dependencies: { postject: POSTJECT_VERSION } }, null, 2),
    'utf8',
  );
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  console.log('  安装 postject（首次会慢一些）...');
  const r = spawnSync(process.execPath, [npmCli, 'install', '--registry=https://registry.npmmirror.com'], {
    cwd: TOOLS, encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(r.stdout || '');
    console.error(r.stderr || '');
    fail('安装 postject 失败。可手动执行：cd .build-tools && npm install');
  }
  postject = await import(pathToFileURL(path.join(TOOLS, 'node_modules', 'postject', 'dist', 'api.js')).href);
}

// ───────────────────────── 6. 复制 node.exe 并注入 ─────────────────────────
step('注入 blob 到 exe');
const exePath = path.join(OUT, `${APP_NAME}.exe`);
fs.copyFileSync(nodeExe, exePath);
await postject.inject(exePath, 'NODE_SEA_BLOB', fs.readFileSync(blobPath), { sentinelFuse: FUSE });
const sizeMB = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(`  ${path.relative(ROOT, exePath)}  ${sizeMB} MB`);

// ───────────────────────── 6.5 附带 FFmpeg ─────────────────────────
// exe 是单文件，node_modules 不会跟着走。想让「导出」开箱可用，
// 就得把 ffmpeg 放在 exe 旁的 resources/ffmpeg/ 下 —— 这正是 findFfmpeg 会找的位置。
step('附带 FFmpeg');
const ffmpegCandidates = [
  path.join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
  path.join(ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe'),
];
let ffmpegSrc = ffmpegCandidates.find(p => fs.existsSync(p));
if (!ffmpegSrc) {
  const which = spawnSync('where', ['ffmpeg'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout) ffmpegSrc = which.stdout.split('\n')[0].trim();
}
if (ffmpegSrc && fs.existsSync(ffmpegSrc)) {
  const destDir = path.join(OUT, 'resources', 'ffmpeg');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(ffmpegSrc, path.join(destDir, 'ffmpeg.exe'));
  console.log(`  已附带 ${(fs.statSync(path.join(destDir, 'ffmpeg.exe')).size / 1024 / 1024).toFixed(1)} MB → resources/ffmpeg/ffmpeg.exe`);
} else {
  console.log('  未找到 FFmpeg，跳过。此时 exe 可用，但「导出成片」需要用户自备 FFmpeg。');
  console.log('  安装 ffmpeg-static 后重新打包即可自动附带。');
}

// ───────────────────────── 7. 冒烟自检 ─────────────────────────
step('冒烟自检（真的启动一次 exe）');
const smokePort = 20000 + (process.pid % 10000); // 动态端口，避免撞上别的软件
const tmpExe = path.join(BUILD, `smoke-${process.pid}-${Date.now()}.exe`);
fs.copyFileSync(exePath, tmpExe);

// 必须异步启动：exe 是常驻服务，spawnSync 会一直阻塞到超时，请求根本发不出去
const child = spawn(tmpExe, [], {
  cwd: BUILD,
  env: { ...process.env, PORT: String(smokePort), NO_OPEN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let exeOut = '';
let exeErr = '';
child.stdout.on('data', b => { exeOut += b.toString(); });
child.stderr.on('data', b => { exeErr += b.toString(); });

const base = `http://127.0.0.1:${smokePort}`;
let up = false;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${base}/api/health`);
    if (r.ok) { up = true; break; }
  } catch { /* 还没起来 */ }
  await sleep(300);
}

let smokeOk = false;
try {
  if (!up) throw new Error(`exe 未能在 18 秒内启动（端口 ${smokePort}）`);

  const health = await fetch(`${base}/api/health`);
  const body = await health.json();
  console.log(`  health 正常，数据目录: ${body.dataDir}`);
  // 关键：数据目录必须落在 exe 同级，而不是某个临时目录
  if (!String(body.dataDir).startsWith(path.dirname(tmpExe))) {
    console.log(`  ⚠ 数据目录不在 exe 同级：${body.dataDir}`);
  }

  // 前端资源是否真的进了 exe
  const idx = await fetch(`${base}/`);
  const html = await idx.text();
  if (idx.status === 200 && html.includes('id="root"')) {
    console.log('  前端页面可访问');
    smokeOk = true;
  } else {
    console.log(`  ✗ 前端页面异常: ${idx.status}`);
  }
} catch (e) {
  console.log(`  ✗ ${e.message}`);
  if (exeOut) console.log(`  exe 输出: ${exeOut.slice(0, 400)}`);
  if (exeErr) console.log(`  exe 错误: ${exeErr.slice(0, 400)}`);
} finally {
  child.kill();
  // 等 Windows 释放文件锁，否则下面的清理会失败、副本留在 build/ 里
  await sleep(2000);
}

// 清理冒烟副本：删不掉要出声，别让它留在 build/ 里
try { fs.rmSync(tmpExe, { force: true }); } catch { /* 下面统一核对 */ }
if (fs.existsSync(tmpExe)) {
  await new Promise(r => setTimeout(r, 1500));
  try { fs.rmSync(tmpExe, { force: true }); } catch { /* 仍失败就提示 */ }
}
if (fs.existsSync(tmpExe)) {
  console.log(`\n  ⚠ 冒烟临时副本没能删除：${path.relative(ROOT, tmpExe)}`);
  console.log('    它只是自检用的副本，可以手动删掉。');
}

console.log(`\n${smokeOk ? '✓ 打包完成' : '⚠ 打包完成，但冒烟自检未通过，请确认 exe 能否正常使用'}`);
console.log(`  产物：${exePath}`);
console.log(`  提示：把 exe 单独拷走也能用；若想让数据跟着目录走，在 exe 旁建一个 portable 文件夹。`);
console.log(`  注意：剪辑导出需要 FFmpeg，程序会依次查找 ffmpeg-static → 应用目录 resources/ffmpeg/ → 系统 PATH。`);
