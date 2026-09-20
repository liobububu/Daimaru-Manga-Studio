'use strict';
/**
 * 剪辑路由：时间线存取、剪辑命令、渲染导出
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const store = require('../lib/store');
const timelineLib = require('../lib/timeline');
const ffmpegLib = require('../lib/ffmpeg');
const media = require('./media');

const TABLE = 'timelines';

/** 渲染任务（单用户本地版，内存态足够；重启后旧任务状态丢失不影响数据） */
const jobs = new Map();

async function listTimelines() {
  const rows = await store.readTable(TABLE);
  return { data: rows.map(r => ({ id: r.id, name: r.name, project_id: r.project_id, updated_at: r.updated_at })) };
}

async function getTimeline(body) {
  const { id } = body || {};
  const rows = await store.readTable(TABLE);
  const row = rows.find(r => r.id === id);
  if (!row) throw Object.assign(new Error('未找到时间线'), { status: 404 });
  return { data: row };
}

async function saveTimeline(body) {
  const { id, name, project_id, timeline } = body || {};
  if (!timeline) throw Object.assign(new Error('缺少 timeline'), { status: 400 });

  const payload = {
    name: name || timeline.name || '主时间线',
    project_id: project_id || null,
    timeline,
    updated_at: new Date().toISOString(),
  };

  // upsert 语义：带了 id 但库里还没有（前端首次「保存」新建的时间线）时按插入处理，
  // 否则前端 ensureSaved 在首次调用必然拿到 404。
  if (id) {
    const rows = await store.readTable(TABLE);
    if (rows.some(r => r.id === id)) {
      const res = await store.runQuery({
        table: TABLE, op: 'update',
        filters: [{ op: 'eq', column: 'id', value: id }],
        payload, returning: true,
      });
      return { data: res.data[0] };
    }
  }

  const res = await store.runQuery({
    table: TABLE, op: 'insert',
    payload: { id: id || timeline.id || store.newId(), ...payload, created_at: new Date().toISOString() },
    returning: true,
  });
  return { data: res.data[0] };
}

async function deleteTimeline(body) {
  const { id } = body || {};
  await store.runQuery({ table: TABLE, op: 'delete', filters: [{ op: 'eq', column: 'id', value: id }] });
  return { data: true };
}

/**
 * 应用剪辑命令。
 * 命令先在内存副本上执行，成功才落盘 —— 保证「整体接受或整体拒绝」。
 */
async function command(body) {
  const { timelineId, cmd } = body || {};
  if (!timelineId || !cmd) throw Object.assign(new Error('缺少 timelineId / cmd'), { status: 400 });

  const rows = await store.readTable(TABLE);
  const row = rows.find(r => r.id === timelineId);
  if (!row) throw Object.assign(new Error('未找到时间线'), { status: 404 });

  const tl = row.timeline;
  let result;
  try {
    result = timelineLib.applyCommand(tl, cmd);
  } catch (e) {
    if (e instanceof timelineLib.EditError) {
      throw Object.assign(new Error(e.message), { status: 400, errorType: e.code });
    }
    throw e;
  }

  row.timeline = tl;
  row.updated_at = new Date().toISOString();
  await store.writeTable(TABLE, rows);

  return { data: { timeline: tl, result } };
}

/** 探测媒体时长，供添加素材时自动填充 */
async function probe(body) {
  const { url } = body || {};
  const disk = media.toDiskPath(url);
  if (!disk || !fs.existsSync(disk)) {
    return { data: { duration: null } };
  }
  const duration = await ffmpegLib.probeDuration(disk);
  return { data: { duration } };
}

/** 启动渲染，立即返回 jobId，前端轮询进度 */
async function render(body) {
  const { timelineId, name } = body || {};
  const rows = await store.readTable(TABLE);
  const row = rows.find(r => r.id === timelineId);
  if (!row) throw Object.assign(new Error('未找到时间线'), { status: 404 });

  // 深拷贝一份用于渲染，避免把磁盘绝对路径写回保存的时间线里
  const tl = JSON.parse(JSON.stringify(row.timeline));

  // 把 /api/files/ URL 换成磁盘绝对路径，FFmpeg 只认本地路径
  for (const track of tl.tracks) {
    for (const clip of track.clips) {
      const remote = /^https?:/i.test(clip.src);
      const disk = remote ? clip.src : media.toDiskPath(clip.src);
      if (!disk) throw Object.assign(new Error(`片段 ${clip.id} 的素材路径无效: ${clip.src}`), { status: 400 });
      if (!remote && !fs.existsSync(disk)) {
        throw Object.assign(new Error(`素材文件不存在: ${clip.src}`), { status: 400 });
      }
      clip.src = disk;
    }
  }

  // 探测音轨：无音轨的素材（AI 生成的片段很常见）不能生成 atrim 滤镜，
  // 否则 FFmpeg 报 "matches no streams" 导致整个导出失败
  for (const track of tl.tracks) {
    if (track.type !== 'video') continue;
    for (const clip of track.clips) {
      if (/^https?:/i.test(clip.src)) { clip.hasAudio = true; continue; } // 远端交给 FFmpeg 自己处理
      if (ffmpegLib.isImage(clip.src)) { clip.hasAudio = false; continue; }
      try {
        const info = await ffmpegLib.probeMedia(clip.src);
        clip.hasAudio = info.hasAudio !== false;
      } catch {
        clip.hasAudio = true; // 探测不了就按有音轨处理，让 FFmpeg 给出真实错误
      }
    }
  }

  // 导出目录放在 media 下，才能通过 /api/files/ 直接访问
  const outDir = path.join(store.resolveDataDir(), 'media', 'exports');
  fs.mkdirSync(outDir, { recursive: true });
  const safeName = String(name || tl.name || '成片').replace(/[\\/:*?"<>|]/g, '_');
  const outputPath = path.join(outDir, `${Date.now()}_${safeName}.mp4`);

  const jobId = `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const job = { id: jobId, status: 'running', percent: 0, output: null, error: null, startedAt: Date.now() };
  jobs.set(jobId, job);

  // 渲染是重活，放到后台跑，前端靠 jobId 轮询
  (async () => {
    try {
      console.error('[edit] 渲染开始:', jobId, '→', outputPath);
      await ffmpegLib.render(tl, outputPath, {
        onProgress: p => { job.percent = p; },
        onStderr: chunk => {
          job.log = ((job.log || '') + chunk).slice(-4000);
        },
      });
      job.status = 'done';
      job.percent = 100;
      job.output = `/api/files/exports/${path.basename(outputPath)}`;
      job.filePath = outputPath;
    } catch (e) {
      job.status = 'failed';
      job.error = e.message;
      job.errorType = e.code || e.errorType || 'render_failed';
      // 渲染失败必须留痕：这是重活，静默失败最难排查
      console.error('[edit] 渲染失败:', job.id, e && e.message);
    }
  })();

  return { data: { jobId } };
}

async function job(body, ctx) {
  const id = ctx.url.searchParams.get('id');
  if (!id) throw Object.assign(new Error('缺少 id'), { status: 400 });
  const j = jobs.get(id);
  if (!j) throw Object.assign(new Error('未找到任务'), { status: 404 });
  return { data: j };
}

module.exports = {
  listTimelines, getTimeline, saveTimeline, deleteTimeline,
  command, render, job, probe,
};
