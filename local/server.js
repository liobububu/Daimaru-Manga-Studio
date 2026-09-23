'use strict';
/**
 * 动画大丸家 · 本地版服务端
 *
 * 纯 node:http，不引第三方依赖 —— 单文件 exe 打包时少一层风险。
 * 职责：数据 CRUD、OpenAI 兼容代理、媒体存取、剪辑渲染、静态资源托管。
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const store = require('./lib/store');
const dbRoutes = require('./routes/db');
const aiRoutes = require('./routes/ai');
const mediaRoutes = require('./routes/media');
const editRoutes = require('./routes/edit');
const openReelDesktop = require('./lib/openreel-desktop');

const PORT = Number(process.env.PORT || 5178);
const MAX_BODY = 512 * 1024 * 1024; // 上传媒体需要较大上限

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.data': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

/**
 * 读取前端构建产物。
 * 打包成单文件 exe 后 dist 在 SEA 资源里（没有磁盘路径），开发模式下从磁盘读。
 */
function readDistAsset(rel) {
  // 打包成 exe 时前端资源以内联形式存在（build/bundle-server.mjs 注入）
  const embedded = global.__DH_ASSETS__;
  if (embedded && embedded[rel]) {
    return Buffer.from(embedded[rel], 'base64');
  }
  const file = path.join(store.appRoot(), 'dist', rel);
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

/** 生产模式下托管前端构建产物 */
async function serveStatic(req, res, pathname) {
  const rel = (pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')) || 'index.html';

  // 防目录穿越：只保留 basename 之前的合法相对路径
  const safeRel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
  let buf = readDistAsset(safeRel);

  if (buf === null) {
    // SPA 回退：非 API 路径一律返回 index.html
    buf = readDistAsset('index.html');
    if (buf === null) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('未找到前端构建产物（dist/）。请先用 npm run build 构建，或直接运行打包好的 exe。');
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(safeRel).toLowerCase()] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': safeRel.startsWith('assets/') ? 'max-age=31536000' : 'no-cache',
  });
  res.end(buf);
}

/**
 * 剪辑台（OpenReel Video）的资源。
 * 打包成 exe 后走内联资源，开发时从 editor-dist/ 读。
 */
function readEditorAsset(rel) {
  const embedded = global.__DH_ASSETS__;
  if (embedded && embedded[`editor/${rel}`]) {
    return Buffer.from(embedded[`editor/${rel}`], 'base64');
  }
  const file = path.join(store.appRoot(), 'editor-dist', rel);
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

/** 托管剪辑台，非资源路径一律回退到它的 index.html（SPA） */
async function serveEditor(req, res, pathname) {
  const rel = pathname.replace(/^\/+/, '').replace(/^editor\/?/, '') || 'index.html';
  const safeRel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');

  let buf = readEditorAsset(safeRel);
  if (buf === null) buf = readEditorAsset('index.html');

  if (buf === null) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('未找到剪辑台资源（editor-dist/）。请先按 README 构建 OpenReel Video。');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(safeRel).toLowerCase()] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': safeRel.startsWith('assets/') ? 'max-age=31536000' : 'no-cache',
  });
  res.end(buf);
}

/**
 * 本地服务的安全底线：浏览器里任何网页都能往 127.0.0.1 发请求，
 * 所以写操作必须校验 Origin —— 否则用户浏览网页时，那个网页能静默删掉他的项目数据。
 * 没有 Origin 的请求（curl、程序自身）放行。
 */
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(String(origin)).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

const routes = {
  'POST /api/db': dbRoutes.query,
  'GET /api/health': () => ({ ok: true, dataDir: store.resolveDataDir() }),
  'GET /api/openreel/desktop/status': () => openReelDesktop.status(),
  'POST /api/openreel/desktop/launch': () => openReelDesktop.launch(),
  'GET /api/openreel/desktop/tools': () => openReelDesktop.listTools(),
  'POST /api/openreel/desktop/tool': body => openReelDesktop.callTool(body?.name, body?.args || {}),
  'POST /api/openreel/desktop/create-project': (body, ctx) => openReelDesktop.createProjectWithMedia({
    ...(body || {}),
    localOrigin: `http://127.0.0.1:${ctx.req.socket.localPort}`,
  }),
  'POST /api/openreel/desktop/create-project-with-timeline': (body, ctx) => openReelDesktop.createProjectWithTimeline({
    ...(body || {}),
    localOrigin: `http://127.0.0.1:${ctx.req.socket.localPort}`,
  }),
  'POST /api/openreel/desktop/import-media': (body, ctx) => openReelDesktop.importMediaIntoCurrentProject({
    ...(body || {}),
    localOrigin: `http://127.0.0.1:${ctx.req.socket.localPort}`,
  }),

  'POST /api/ai/generate': aiRoutes.generate,
  'POST /api/ai/image': aiRoutes.image,
  'POST /api/ai/models': aiRoutes.models,
  'POST /api/ai/config/save': aiRoutes.saveConfig,
  'GET /api/ai/configs': aiRoutes.listConfigs,
  'POST /api/ai/config/delete': aiRoutes.deleteConfig,
  'POST /api/ai/model/save': aiRoutes.saveModel,
  'GET /api/ai/models/catalog': aiRoutes.catalog,

  'POST /api/media/upload': mediaRoutes.upload,
  'POST /api/media/save-generated': mediaRoutes.saveGenerated,
  'POST /api/media/stage-local-file': body => mediaRoutes.stageLocalFile(body?.path, body?.name),
  'POST /api/media/stage-local-file/start': body => mediaRoutes.createStageJob(body?.path, body?.name),
  'POST /api/media/stage-local-file/status': body => mediaRoutes.getStageJob(body?.id),
  'POST /api/media/stage-local-file/cancel': body => mediaRoutes.cancelStageJob(body?.id),
  'GET /api/media/stage-local-file/jobs': () => mediaRoutes.listStageJobs(),
  'POST /api/media/check-files': body => mediaRoutes.checkFiles(body),

  'POST /api/edit/timeline/save': editRoutes.saveTimeline,
  'GET /api/edit/timelines': editRoutes.listTimelines,
  'POST /api/edit/timeline/get': editRoutes.getTimeline,
  'POST /api/edit/timeline/delete': editRoutes.deleteTimeline,
  'POST /api/edit/command': editRoutes.command,
  'POST /api/edit/render': editRoutes.render,
  'GET /api/edit/job': editRoutes.job,
  'POST /api/edit/probe': editRoutes.probe,
};

const server = http.createServer(async (req, res) => {
  // CORS：开发模式下前端跑在 vite 的另一个端口
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, apikey');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // 剪辑台（OpenReel Video）：独立构建的前端应用，托管在 /editor/ 下
  if (pathname === '/editor' || pathname.startsWith('/editor/')) {
    return serveEditor(req, res, pathname);
  }

  // 媒体文件访问
  if (pathname.startsWith('/api/files/')) {
    return mediaRoutes.serveFile(req, res, decodeURIComponent(pathname.slice('/api/files/'.length)));
  }

  // 写操作先过 CSRF 校验
  if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')
      && pathname.startsWith('/api/') && !originOk(req)) {
    return sendJson(res, 403, { error: '跨站请求被拒绝（Origin 不合法）' });
  }

  const key = `${req.method} ${pathname}`;
  const handler = routes[key];
  if (!handler) {
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: `未实现的接口: ${key}` });
    }
    return serveStatic(req, res, pathname);
  }

  try {
    let body = null;
    if (req.method === 'POST' || req.method === 'PUT') {
      const buf = await readBody(req);
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        try {
          body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
        } catch {
          return sendJson(res, 400, { error: '请求体不是合法 JSON' });
        }
      } else {
        body = buf;
      }
    }
    const result = await handler(body, { req, res, url });
    if (result === undefined) return; // 路由自己已写响应
    if (result && result.__raw) return sendJson(res, result.status || 200, result.body);
    return sendJson(res, 200, result);
  } catch (e) {
    console.error(`[server] ${key} 失败:`, e);
    const status = e.status || (e.code === 'ENOENT' ? 404 : 500);
    return sendJson(res, status, {
      error: e.message || '服务器内部错误',
      errorType: e.errorType || e.code || 'internal',
      attempted: e.attempted,
    });
  }
});

const serverExports = { server, store, PORT };

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`动画大丸家 · 本地版已启动`);
    console.log(`  地址: http://127.0.0.1:${PORT}`);
    console.log(`  数据目录: ${store.resolveDataDir()}`);
  });
}

module.exports = serverExports;
