'use strict';
/**
 * 渲染端到端：真的导出一个 mp4 出来
 *
 * 前面的测试只验证了「构造出的 FFmpeg 命令是对的」，没验证过一次真实渲染。
 * 这里补齐：生成两段测试视频 → 加进时间线 → 走 HTTP 接口渲染 → 检查产物。
 *
 * 需要一个可用的 FFmpeg（优先 ffmpeg-static）。没有就跳过并说明，不算失败。
 *
 * 运行： node local/test/render-e2e.js
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 5233;
const BASE = `http://127.0.0.1:${PORT}`;

const { findFfmpeg } = require('../lib/ffmpeg');
const store = require('../lib/store');

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function post(p, body) {
  const r = await fetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
async function get(p) {
  const r = await fetch(BASE + p);
  return r.json();
}

/** 用 ffmpeg 生成一段纯色测试视频 */
function makeVideo(bin, out, color, seconds) {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:r=25:d=${seconds}`,
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out,
    ], { windowsHide: true });
    let err = '';
    c.stderr.on('data', b => { err += b.toString(); });
    c.on('error', reject);
    c.on('close', code => (code === 0 ? resolve() : reject(new Error(err.slice(-300)))));
  });
}

(async () => {
  const bin = findFfmpeg();
  let usable = false;
  if (bin && bin !== 'ffmpeg') {
    usable = fs.existsSync(bin);
  } else {
    // PATH 里的 ffmpeg，探测一下
    const probe = spawn(bin, ['-version'], { windowsHide: true });
    usable = await new Promise(res => {
      probe.on('error', () => res(false));
      probe.on('close', c => res(c === 0));
    });
  }

  if (!usable) {
    console.log('未找到可用的 FFmpeg，跳过渲染端到端测试。');
    console.log('  安装方式：npm i -D ffmpeg-static，或把 ffmpeg 放到应用目录 resources/ffmpeg/ 下。');
    process.exit(0);
  }
  console.log(`FFmpeg: ${bin}\n`);

  // ── 生成测试素材 ──
  console.log('准备素材');
  const mediaDir = path.join(store.resolveDataDir(), 'media', 'video');
  await fsp.mkdir(mediaDir, { recursive: true });
  const red = path.join(mediaDir, 'test-red.mp4');
  const blue = path.join(mediaDir, 'test-blue.mp4');
  await makeVideo(bin, red, 'red', 4);
  await makeVideo(bin, blue, 'blue', 4);
  check('生成两段 4 秒测试视频', fs.existsSync(red) && fs.existsSync(blue));

  // ── 启动服务 ──
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

  try {
    console.log('\n构建时间线');
    const TL = `tl_render_${Date.now()}`;
    await post('/api/edit/timeline/save', {
      id: TL, name: '渲染测试',
      timeline: {
        id: TL, width: 320, height: 240, fps: 25,
        tracks: [
          { id: 'v1', type: 'video', clips: [] },
          { id: 'a1', type: 'audio', clips: [] },
        ],
      },
    });

    await post('/api/edit/command', {
      timelineId: TL,
      cmd: { type: 'addClip', clip: { type: 'video', src: '/api/files/video/test-red.mp4', duration: 4 } },
    });
    await post('/api/edit/command', {
      timelineId: TL,
      cmd: { type: 'addClip', clip: { type: 'video', src: '/api/files/video/test-blue.mp4', duration: 4 } },
    });
    const tlRes = await post('/api/edit/timeline/get', { id: TL });
    const clips = tlRes.data.timeline.tracks[0].clips;
    check('时间线上有两个片段', clips.length === 2, `实际 ${clips.length}`);

    console.log('\n渲染导出');
    const r = await post('/api/edit/render', { timelineId: TL, name: 'e2e' });
    const jobId = r.data && r.data.jobId;
    check('渲染任务已创建', !!jobId, JSON.stringify(r));

    let job = null;
    for (let i = 0; i < 120; i++) {
      const j = await get(`/api/edit/job?id=${jobId}`);
      job = j.data;
      if (job.status === 'done' || job.status === 'failed') break;
      await sleep(1000);
    }

    check('渲染完成（未失败）', job && job.status === 'done', job && job.error);

    if (job && job.output) {
      // 输出是 /api/files/exports/xxx.mp4，转成磁盘路径校验
      const rel = job.output.replace('/api/files/', '');
      const file = path.join(store.resolveDataDir(), 'media', rel);
      check('成片文件已生成', fs.existsSync(file), file);

      if (fs.existsSync(file)) {
        const size = fs.statSync(file).size;
        check('成片非空', size > 1000, `${size} 字节`);

        // 用 ffmpeg 读回时长：两段 4 秒 → 应约 8 秒
        const dur = await new Promise(resolve => {
          const c = spawn(bin, ['-hide_banner', '-i', file, '-f', 'null', '-'], { windowsHide: true });
          let err = '';
          c.stderr.on('data', b => { err += b.toString(); });
          c.on('close', () => {
            const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(err);
            resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null);
          });
        });
        check('成片时长约 8 秒', dur !== null && Math.abs(dur - 8) < 0.6, `实际 ${dur}`);
        console.log(`     产物: ${file}`);
        console.log(`     大小: ${(size / 1024).toFixed(1)} KB，时长: ${dur}s`);
      }
    }
  } finally {
    server.kill();
    await sleep(500);
  }

  console.log(`\n${failed === 0 ? '全部通过' : '存在失败'}：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
})();
