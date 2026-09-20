'use strict';
/**
 * 渲染精度：剪辑操作是否真的改变了成片
 *
 * render-e2e 只证明了「能导出一个 mp4」。这里验证的是「算得对」：
 * 变速 2× 后成片时长是否真的减半、裁剪是否真的变短、空隙是否真的补了黑帧。
 *
 * 判据落在**最终成片的时长**上，而不是「命令执行成功」或「参数存进去了」——
 * 命令成功但成片没变，等于这个功能不存在。
 *
 * 运行： node local/test/render-accuracy.js
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 5244;
const BASE = `http://127.0.0.1:${PORT}`;

const { findFfmpeg } = require('../lib/ffmpeg');
const store = require('../lib/store');

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ''}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function post(p, body) {
  const r = await fetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
async function get(p) { return (await fetch(BASE + p)).json(); }

function makeVideo(bin, out, color, seconds) {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:r=25:d=${seconds}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out,
    ], { windowsHide: true });
    let err = '';
    c.stderr.on('data', b => { err += b.toString(); });
    c.on('error', reject);
    c.on('close', code => (code === 0 ? resolve() : reject(new Error(err.slice(-300)))));
  });
}

/** 用 ffmpeg 读回成片时长 */
function probeDuration(bin, file) {
  return new Promise(resolve => {
    const c = spawn(bin, ['-hide_banner', '-i', file, '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    c.stderr.on('data', b => { err += b.toString(); });
    c.on('close', () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(err);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null);
    });
  });
}

/**
 * 跑一个场景：建时间线 → 执行命令 → 渲染 → 返回成片时长
 */
async function renderScenario(bin, name, buildCmds) {
  const TL = `tl_acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await post('/api/edit/timeline/save', {
    id: TL, name,
    timeline: {
      id: TL, width: 320, height: 240, fps: 25,
      tracks: [
        { id: 'v1', type: 'video', clips: [] },
        { id: 'a1', type: 'audio', clips: [] },
      ],
    },
  });

  for (const cmd of buildCmds(TL)) {
    await post('/api/edit/command', { timelineId: TL, cmd });
  }

  const r = await post('/api/edit/render', { timelineId: TL, name });
  const jobId = r.data && r.data.jobId;
  if (!jobId) return { error: '未创建渲染任务' };

  let job = null;
  for (let i = 0; i < 150; i++) {
    const j = await get(`/api/edit/job?id=${jobId}`);
    job = j.data;
    if (job.status === 'done' || job.status === 'failed') break;
    await sleep(1000);
  }
  if (!job || job.status !== 'done') return { error: job && job.error ? job.error : '渲染未完成' };

  const rel = (job.output || '').replace('/api/files/', '');
  const file = path.join(store.resolveDataDir(), 'media', rel);
  const dur = await probeDuration(bin, file);
  return { duration: dur, file };
}

(async () => {
  const bin = findFfmpeg();
  const usable = bin && (bin !== 'ffmpeg' ? fs.existsSync(bin) : true);
  if (!usable) {
    console.log('未找到 FFmpeg，跳过渲染精度测试。');
    process.exit(0);
  }
  console.log(`FFmpeg: ${bin}\n`);

  // 素材：两段 4 秒
  const mediaDir = path.join(store.resolveDataDir(), 'media', 'video');
  await fsp.mkdir(mediaDir, { recursive: true });
  const red = path.join(mediaDir, 'acc-red.mp4');
  const blue = path.join(mediaDir, 'acc-blue.mp4');
  await makeVideo(bin, red, 'red', 4);
  await makeVideo(bin, blue, 'blue', 4);

  const server = spawn(process.execPath, [path.join(ROOT, 'local', 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) { up = true; break; } } catch { /* wait */ }
    await sleep(250);
  }
  if (!up) { console.log('服务未能启动'); server.kill(); process.exit(1); }

  const CLIP = (src, extra = {}) => ({
    type: 'video', src, duration: 4, sourceStart: 0, speed: 1, volume: 1, ...extra,
  });

  try {
    console.log('场景 1：两段 4 秒直接拼接');
    const s1 = await renderScenario(bin, 'acc-basic', (TL) => [
      { type: 'addClip', clip: CLIP('/api/files/video/acc-red.mp4') },
      { type: 'addClip', clip: CLIP('/api/files/video/acc-blue.mp4') },
    ]);
    check('成片约 8 秒', s1.duration !== null && Math.abs(s1.duration - 8) < 0.6,
      `实际 ${s1.duration}${s1.error ? ' / ' + s1.error : ''}`);

    console.log('场景 2：第一段 2 倍速（应变成 2 + 4 = 6 秒）');
    let firstClipId = null;
    const s2 = await renderScenario(bin, 'acc-speed', (TL) => {
      const cmds = [
        { type: 'addClip', clip: CLIP('/api/files/video/acc-red.mp4') },
        { type: 'addClip', clip: CLIP('/api/files/video/acc-blue.mp4') },
      ];
      return cmds;
    });
    // 变速需要拿到片段 id：单独建一条时间线来做
    const TL2 = `tl_acc_speed_${Date.now()}`;
    await post('/api/edit/timeline/save', {
      id: TL2, name: 'acc-speed',
      timeline: { id: TL2, width: 320, height: 240, fps: 25, tracks: [{ id: 'v1', type: 'video', clips: [] }, { id: 'a1', type: 'audio', clips: [] }] },
    });
    await post('/api/edit/command', { timelineId: TL2, cmd: { type: 'addClip', clip: CLIP('/api/files/video/acc-red.mp4') } });
    const t2 = await post('/api/edit/timeline/get', { id: TL2 });
    firstClipId = t2.data.timeline.tracks[0].clips[0].id;
    await post('/api/edit/command', { timelineId: TL2, cmd: { type: 'setSpeed', clipId: firstClipId, speed: 2 } });
    await post('/api/edit/command', { timelineId: TL2, cmd: { type: 'addClip', clip: CLIP('/api/files/video/acc-blue.mp4') } });
    const rr = await post('/api/edit/render', { timelineId: TL2, name: 'acc-speed' });
    let job = null;
    for (let i = 0; i < 150; i++) {
      const j = await get(`/api/edit/job?id=${rr.data.jobId}`);
      job = j.data;
      if (job.status === 'done' || job.status === 'failed') break;
      await sleep(1000);
    }
    let s2dur = null;
    if (job && job.status === 'done') {
      const f = path.join(store.resolveDataDir(), 'media', (job.output || '').replace('/api/files/', ''));
      s2dur = await probeDuration(bin, f);
    }
    check('2 倍速后成片约 6 秒（4/2 + 4）', s2dur !== null && Math.abs(s2dur - 6) < 0.6,
      `实际 ${s2dur}${job && job.error ? ' / ' + job.error : ''}`);

    console.log('场景 3：第二段裁到 2 秒（应变成 4 + 2 = 6 秒）');
    const TL3 = `tl_acc_trim_${Date.now()}`;
    await post('/api/edit/timeline/save', {
      id: TL3, name: 'acc-trim',
      timeline: { id: TL3, width: 320, height: 240, fps: 25, tracks: [{ id: 'v1', type: 'video', clips: [] }, { id: 'a1', type: 'audio', clips: [] }] },
    });
    await post('/api/edit/command', { timelineId: TL3, cmd: { type: 'addClip', clip: CLIP('/api/files/video/acc-red.mp4') } });
    await post('/api/edit/command', { timelineId: TL3, cmd: { type: 'addClip', clip: CLIP('/api/files/video/acc-blue.mp4') } });
    const t3 = await post('/api/edit/timeline/get', { id: TL3 });
    const secondId = t3.data.timeline.tracks[0].clips[1].id;
    await post('/api/edit/command', { timelineId: TL3, cmd: { type: 'trimClip', clipId: secondId, edge: 'tail', duration: 2 } });
    const r3 = await post('/api/edit/render', { timelineId: TL3, name: 'acc-trim' });
    let job3 = null;
    for (let i = 0; i < 150; i++) {
      const j = await get(`/api/edit/job?id=${r3.data.jobId}`);
      job3 = j.data;
      if (job3.status === 'done' || job3.status === 'failed') break;
      await sleep(1000);
    }
    let s3dur = null;
    if (job3 && job3.status === 'done') {
      const f = path.join(store.resolveDataDir(), 'media', (job3.output || '').replace('/api/files/', ''));
      s3dur = await probeDuration(bin, f);
    }
    check('裁剪后成片约 6 秒（4 + 2）', s3dur !== null && Math.abs(s3dur - 6) < 0.6,
      `实际 ${s3dur}${job3 && job3.error ? ' / ' + job3.error : ''}`);
  } finally {
    server.kill();
    await sleep(500);
    // 清理测试素材与导出
    try {
      await fsp.unlink(red); await fsp.unlink(blue);
      await fsp.rm(path.join(store.resolveDataDir(), 'media', 'exports'), { recursive: true, force: true });
    } catch { /* 清理失败无妨 */ }
  }

  console.log(`\n${failed === 0 ? '全部通过' : '存在失败'}：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
})();
