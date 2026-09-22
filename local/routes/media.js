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
const stageJobs = new Map();
const stageJobsFile = () => path.join(store.resolveDataDir(), 'openreel-stage-jobs.json');
const STAGE_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
let persistTimer = null;

function persistStageJobs() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  const cutoff = Date.now() - STAGE_JOB_RETENTION_MS;
  for (const [id, job] of stageJobs) {
    const terminal = ['completed', 'failed', 'cancelled'].includes(job.status);
    const touchedAt = Number(job.updatedAt || job.startedAt || 0);
    if (terminal && touchedAt && touchedAt < cutoff) stageJobs.delete(id);
  }
  const payload = [...stageJobs.values()].map(job => ({ ...job }));
  const target = stageJobsFile();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

function schedulePersistStageJobs() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => persistStageJobs(), 350);
  persistTimer.unref?.();
}

function loadStageJobs() {
  try {
    const rows = JSON.parse(fs.readFileSync(stageJobsFile(), 'utf8'));
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row?.id) continue;
      if (row.status === 'pending' || row.status === 'running') {
        row.status = 'failed';
        row.error = '应用在文件导入完成前退出，请重试该素材';
        row.etaSeconds = null;
      }
      stageJobs.set(row.id, row);
    }
    persistStageJobs();
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[media] 读取 OpenReel 暂存任务失败:', error?.message || error);
  }
}

loadStageJobs();

/** 文件名清洗：去掉目录部分与危险字符，防路径穿越 */
function sanitizeFileName(name) {
  const raw = String(name || 'unnamed');
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* 保留原始文件名 */ }
  const base = path.basename(decoded);
  const cleaned = base.replace(/[^\w.\-一-龥]/g, '_').replace(/^\.+/, '');
  return cleaned || 'unnamed';
}

async function stageLocalFile(filePath, preferredName) {
  const source = path.resolve(String(filePath || ''));
  if (!path.isAbsolute(source)) throw Object.assign(new Error('本地素材必须是绝对路径'), { status: 400 });
  const stat = await fsp.stat(source).catch(() => null);
  if (!stat?.isFile()) throw Object.assign(new Error('本地素材文件不存在'), { status: 404 });
  const sourceExt = extOf(source);
  if (!ALLOWED_EXT.has(sourceExt)) throw Object.assign(new Error(`不支持的文件类型: ${sourceExt || '未知'}`), { status: 400 });
  const requested = sanitizeFileName(preferredName || path.basename(source));
  const fileName = extOf(requested) ? requested : `${requested}${sourceExt}`;
  const { abs, rel } = targetPath(fileName);
  try {
    await fsp.link(source, abs);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    await fsp.copyFile(source, abs);
  }
  return { url: `/api/files/${rel}`, path: rel, size: stat.size, source: 'local-file' };
}

function createStageJob(filePath, preferredName) {
  const id = `stage_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const job = { id, status: 'pending', loaded: 0, total: 0, progress: 0, bytesPerSecond: 0, etaSeconds: null, startedAt: null, updatedAt: Date.now(), url: null, path: null, error: null, cancelled: false };
  stageJobs.set(id, job);
  persistStageJobs();
  void runStageJob(job, filePath, preferredName);
  return { id };
}

async function runStageJob(job, filePath, preferredName) {
  let abs = null;
  try {
    const source = path.resolve(String(filePath || ''));
    if (!path.isAbsolute(source)) throw new Error('本地素材必须是绝对路径');
    const stat = await fsp.stat(source);
    if (!stat.isFile()) throw new Error('本地素材不是文件');
    const sourceExt = extOf(source);
    if (!ALLOWED_EXT.has(sourceExt)) throw new Error(`不支持的文件类型: ${sourceExt || '未知'}`);
    job.total = stat.size;
    job.status = 'running';
    job.startedAt = Date.now();
    job.updatedAt = Date.now();
    persistStageJobs();
    const requested = sanitizeFileName(preferredName || path.basename(source));
    const target = targetPath(extOf(requested) ? requested : `${requested}${sourceExt}`);
    abs = target.abs;
    await new Promise((resolve, reject) => {
      const input = fs.createReadStream(source, { highWaterMark: 1024 * 1024 });
      const output = fs.createWriteStream(abs, { flags: 'wx' });
      input.on('data', chunk => {
        job.loaded += chunk.length;
        job.progress = job.total ? Math.min(100, Math.round(job.loaded / job.total * 100)) : 0;
        const elapsedSeconds = Math.max((Date.now() - job.startedAt) / 1000, 0.001);
        job.bytesPerSecond = Math.max(0, Math.round(job.loaded / elapsedSeconds));
        job.etaSeconds = job.bytesPerSecond > 0 ? Math.max(0, Math.ceil((job.total - job.loaded) / job.bytesPerSecond)) : null;
        job.updatedAt = Date.now();
        schedulePersistStageJobs();
        if (job.cancelled) input.destroy(Object.assign(new Error('已取消'), { code: 'CANCELLED' }));
      });
      input.on('error', reject);
      output.on('error', reject);
      output.on('finish', resolve);
      input.pipe(output);
    });
    if (job.cancelled) throw Object.assign(new Error('已取消'), { code: 'CANCELLED' });
    job.status = 'completed';
    job.progress = 100;
    job.etaSeconds = 0;
    job.url = `/api/files/${target.rel}`;
    job.path = target.rel;
    job.updatedAt = Date.now();
    persistStageJobs();
  } catch (error) {
    if (abs) await fsp.rm(abs, { force: true }).catch(() => {});
    job.status = job.cancelled || error?.code === 'CANCELLED' ? 'cancelled' : 'failed';
    job.error = error instanceof Error ? error.message : String(error);
    job.updatedAt = Date.now();
    persistStageJobs();
  }
}

function getStageJob(id) {
  const job = stageJobs.get(String(id || ''));
  if (!job) throw Object.assign(new Error('暂存任务不存在'), { status: 404 });
  return { ...job };
}

function cancelStageJob(id) {
  const job = stageJobs.get(String(id || ''));
  if (!job) throw Object.assign(new Error('暂存任务不存在'), { status: 404 });
  if (job.status === 'pending' || job.status === 'running') { job.cancelled = true; job.updatedAt = Date.now(); }
  persistStageJobs();
  return { ...job };
}

function listStageJobs() {
  return [...stageJobs.values()].map(job => ({ ...job }));
}

function extOf(name) {
  return path.extname(String(name)).toLowerCase();
}

function resolveInside(baseDir, relPath) {
  const base = path.resolve(baseDir);
  const full = path.resolve(base, String(relPath || ''));
  const relative = path.relative(base, full);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return full;
  return null;
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
  const filePath = resolveInside(mediaDir, relPath);
  if (!filePath) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('文件不存在');
      return;
    }
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
    // 支持 Range 请求，否则浏览器无法拖动视频进度条
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
      let start;
      let end;
      if (!m || (!m[1] && !m[2])) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      if (!m[1]) {
        const suffix = Number(m[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
          return;
        }
        start = Math.max(0, stat.size - suffix);
        end = stat.size - 1;
      } else {
        start = Number(m[1]);
        end = m[2] ? Number(m[2]) : stat.size - 1;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
        'Content-Type': mimeMap[ext] || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'max-age=86400',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeMap[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'max-age=86400',
    });
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
  return resolveInside(mediaDir, rel);
}

/** 将本地媒体引用转换成 OpenReel Desktop 可访问的 loopback URL。
 * 只允许 data/media 下的文件；绝不把任意磁盘路径暴露给 HTTP 服务。
 */
function toLoopbackUrl(urlOrPath, origin) {
  if (!urlOrPath) return null;
  const value = String(urlOrPath);
  if (/^https?:\/\//i.test(value)) return value;
  const disk = toDiskPath(value);
  if (!disk || !fs.existsSync(disk)) return null;
  const mediaDir = path.resolve(store.resolveDataDir(), 'media');
  const rel = path.relative(mediaDir, disk);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const base = String(origin || '').replace(/\/$/, '');
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(base)) return null;
  return `${base}/api/files/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
}

module.exports = { upload, saveGenerated, stageLocalFile, createStageJob, getStageJob, cancelStageJob, listStageJobs, serveFile, toDiskPath, toLoopbackUrl, sanitizeFileName, MEDIA_TYPES, ALLOWED_EXT };
