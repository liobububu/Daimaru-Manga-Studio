'use strict';
/**
 * 媒体存取：上传本地素材、保存生成结果、提供文件访问
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const store = require('../lib/store');

const MEDIA_TYPES = {
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'],
  video: ['.mp4', '.mov', '.webm', '.mkv', '.avi'],
  audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'],
};

const ALLOWED_EXT = new Set([...MEDIA_TYPES.image, ...MEDIA_TYPES.video, ...MEDIA_TYPES.audio]);

/** 文件名清洗：去掉目录部分与危险字符，防路径穿越 */
function sanitizeFileName(name) {
  const base = path.basename(String(name || 'unnamed'));
  const cleaned = base.replace(/[^\w.\-一-龥]/g, '_').replace(/^\.+/, '');
  return cleaned || 'unnamed';
}

function extOf(name) {
  return path.extname(String(name)).toLowerCase();
}

/** 目标路径：data/media/<type>/<时间戳>_<随机>_<文件名> */
function targetPath(fileName) {
  const ext = extOf(fileName);
  const type = [...MEDIA_TYPES.image].includes(ext) ? 'image'
    : [...MEDIA_TYPES.video].includes(ext) ? 'video'
      : [...MEDIA_TYPES.audio].includes(ext) ? 'audio' : 'other';
  const dir = path.join(store.resolveDataDir(), 'media', type);
  fs.mkdirSync(dir, { recursive: true });
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rel = path.posix.join(type, `${unique}_${sanitizeFileName(fileName)}`);
  return { abs: path.join(dir, `${unique}_${sanitizeFileName(fileName)}`), rel };
}

/**
 * 上传（请求体即二进制，文件名走 x-file-name 头）
 * 不用 multipart 是为了避免引入解析依赖 —— 单文件 exe 里少一个依赖少一处风险。
 */
async function upload(body, ctx) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  if (buf.length === 0) throw Object.assign(new Error('上传内容为空'), { status: 400 });

  const rawName = ctx.req.headers['x-file-name'] || 'upload';
  const name = Buffer.from(String(rawName), 'latin1').toString('utf8'); // 处理 URL 编码的中文名
  const ext = extOf(name);
  if (!ALLOWED_EXT.has(ext)) {
    throw Object.assign(new Error(`不支持的文件类型: ${ext || '未知'}`), { status: 400 });
  }

  const { abs, rel } = targetPath(name);
  await fsp.writeFile(abs, buf);
  return { url: `/api/files/${rel}`, path: rel, size: buf.length };
}

/** 把生成结果（data URI 或远端 URL）落到本地，返回可访问的本地地址 */
async function saveGenerated(body) {
  const { data: dataUri, url: remoteUrl, name = 'generated', ext = 'png' } = body || {};
  let buf = null;
  let fileName = `${name}.${String(ext).replace(/^\./, '')}`;

  if (typeof dataUri === 'string' && dataUri.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri);
    if (!m) throw Object.assign(new Error('不是合法的 data URI'), { status: 400 });
    buf = Buffer.from(m[2], 'base64');
    const mimeExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[m[1]];
    if (mimeExt) fileName = `${name}.${mimeExt}`;
  } else if (typeof remoteUrl === 'string' && /^https?:/i.test(remoteUrl)) {
    const resp = await fetch(remoteUrl);
    if (!resp.ok) throw Object.assign(new Error(`下载生成结果失败: ${resp.status}`), { status: 502 });
    buf = Buffer.from(await resp.arrayBuffer());
    const urlExt = extOf(new URL(remoteUrl).pathname);
    if (urlExt) fileName = `${name}${urlExt}`;
  } else {
    throw Object.assign(new Error('缺少 data 或 url'), { status: 400 });
  }

  const { abs, rel } = targetPath(fileName);
  await fsp.writeFile(abs, buf);
  return { url: `/api/files/${rel}`, path: rel, size: buf.length };
}

/** 文件访问：只允许读 data/media 下的文件 */
async function serveFile(req, res, relPath) {
  const mediaDir = path.join(store.resolveDataDir(), 'media');
  const filePath = path.join(mediaDir, path.normalize(relPath));
  if (!filePath.startsWith(mediaDir)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const stat = await fsp.stat(filePath);
    const ext = extOf(filePath);
    const type = [...MEDIA_TYPES.video].includes(ext) ? 'video'
      : [...MEDIA_TYPES.audio].includes(ext) ? 'audio' : 'image';
    const mimeMap = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
      '.gif': 'image/gif', '.bmp': 'image/bmp',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
      '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    };
    res.writeHead(200, {
      'Content-Type': mimeMap[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'max-age=86400',
    });
    // 支持 Range 请求，否则浏览器无法拖动视频进度条
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
        'Content-Type': mimeMap[ext] || 'application/octet-stream',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('文件不存在');
  }
}

/** 把 /api/files/xxx 转成磁盘绝对路径（渲染时需要喂给 FFmpeg） */
function toDiskPath(urlOrPath) {
  if (!urlOrPath) return null;
  let rel = String(urlOrPath);
  if (rel.startsWith('/api/files/')) rel = rel.slice('/api/files/'.length);
  if (rel.startsWith('http')) return rel; // 远端地址直接交给 FFmpeg
  const mediaDir = path.join(store.resolveDataDir(), 'media');
  const full = path.join(mediaDir, path.normalize(rel));
  return full.startsWith(mediaDir) ? full : null;
}

module.exports = { upload, saveGenerated, serveFile, toDiskPath, MEDIA_TYPES, ALLOWED_EXT };
