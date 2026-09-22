'use strict';
/**
 * 业务全链路端到端（用本地 mock 的 OpenAI 兼容服务）
 *
 * 之前只测过剪辑台和基础接口，选题 / 剧本 / 分镜 / 图片生成这些页面
 * 从没真正跑过 —— 它们都依赖「配置 → 调 AI → 结果落盘」这条链子。
 * 没有真实 API Key 也能测：起一个符合 OpenAI 协议的 mock 服务顶上。
 *
 * 覆盖：建项目 → 存配置 → 同步模型 → 生成文本 → 生成图片 →
 *       图片落盘 → 进时间线 → 导出成片 → 回读校验
 *
 * 运行： node local/test/e2e-pipeline.js
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MOCK_PORT = 5300;
const APP_PORT = 5301;
const MOCK = `http://127.0.0.1:${MOCK_PORT}/v1`;
const APP = `http://127.0.0.1:${APP_PORT}`;

const { findFfmpeg } = require('../lib/ffmpeg');
const store = require('../lib/store');

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ''}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 用 FFmpeg 真实生成一张测试图。
 * 别手写 base64 PNG —— 之前那份是坏的（FFmpeg 报 "IEND without all image"），
 * 结果测试一直失败，还一度以为渲染功能有问题。
 */
function makeTestPng(bin) {
  const tmp = path.join(os.tmpdir(), `e2e-png-${process.pid}-${Date.now()}.png`);
  spawnSync(bin, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1',
    '-frames:v', '1', tmp,
  ], { windowsHide: true });
  if (!fs.existsSync(tmp)) throw new Error('测试图生成失败');
  return tmp;
}

/** 起一个符合 OpenAI 协议的假服务 */
function startMock(pngB64) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const send = (code, obj) => {
        const s = JSON.stringify(obj);
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(s);
      };
      if (req.url.startsWith('/v1/models')) {
        return send(200, { data: [{ id: 'mock-text', owned_by: 'mock' }, { id: 'mock-image', owned_by: 'mock' }] });
      }
      if (req.url.startsWith('/v1/chat/completions')) {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        const prompt = (parsed.messages || []).map(m => m.content).join('\n');
        return send(200, {
          choices: [{ message: { content: `【mock 生成】针对「${prompt.slice(0, 20)}」的结果` } }],
        });
      }
      if (req.url.startsWith('/v1/images/generations')) {
        return send(200, { data: [{ b64_json: pngB64 }] });
      }
      send(404, { error: { message: 'mock 未实现的路径 ' + req.url } });
    });
  });
  return new Promise(resolve => server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server)));
}

async function post(p, payload) {
  const r = await fetch(APP + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return r.json();
}
async function get(p) { return (await fetch(APP + p)).json(); }

(async () => {
  const bin0 = findFfmpeg();
  const haveFfmpeg = bin0 && (bin0 !== 'ffmpeg' ? fs.existsSync(bin0) : true);
  const pngPath = haveFfmpeg ? makeTestPng(bin0) : null;
  const pngB64 = pngPath ? fs.readFileSync(pngPath).toString('base64') : '';

  const mock = await startMock(pngB64);
  console.log(`mock OpenAI 服务: ${MOCK}`);

  const app = spawn(process.execPath, [path.join(ROOT, 'local', 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  // 必须消费 stdout/stderr：管道满了会阻塞子进程，表现为「渲染莫名其妙卡住」
  let srvLog = '';
  app.stdout.on('data', () => {});
  app.stderr.on('data', d => { srvLog += d.toString(); });
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${APP}/api/health`); if (r.ok) { up = true; break; } } catch { /* wait */ }
    await sleep(250);
  }
  if (!up) { console.log('本地服务未启动'); mock.close(); app.kill(); process.exit(1); }

  try {
    console.log('\n1. 建项目');
    const proj = await post('/api/db', {
      table: 'projects', op: 'insert',
      payload: { name: '全链路测试项目', description: 'e2e' }, returning: true,
    });
    const projectId = proj.data[0].id;
    check('项目已创建并可读回', !!projectId);

    const back = await post('/api/db', {
      table: 'projects', op: 'select',
      filters: [{ op: 'eq', column: 'id', value: projectId }],
    });
    check('按 id 能查回项目', back.data[0] && back.data[0].name === '全链路测试项目');

    console.log('\n2. 存 API 配置（指向 mock）');
    const cfg = await post('/api/ai/config/save', {
      name: 'mock 服务',
      base_url: MOCK,
      api_key: 'sk-mock-key-0000',
      api_type: 'openai_compatible',
      chat_completions_path: '/chat/completions',
      text_response_path: 'choices.0.message.content',
      images_generations_path: '/images/generations',
      image_response_path: 'data',
    });
    const configId = cfg.data.id;
    check('配置已保存且脱敏', cfg.data.masked_api_key === 'sk-****0000', cfg.data.masked_api_key);

    // 密钥不能明文出现在数据文件里
    const tableFile = path.join(store.resolveDataDir(), 'tables', 'api_configs.json');
    const raw = fs.readFileSync(tableFile, 'utf8');
    check('数据文件里没有明文密钥', !raw.includes('sk-mock-key-0000'));

    console.log('\n3. 同步模型');
    const synced = await post('/api/ai/models', { apiConfigId: configId });
    check('从 mock 同步到模型', synced.ok && synced.count === 2, JSON.stringify(synced).slice(0, 120));

    const catalog = await get('/api/ai/models/catalog');
    const textModel = catalog.data.find(m => m.model_id === 'mock-text');
    const imageModel = catalog.data.find(m => m.model_id === 'mock-image');
    check('模型目录里有 mock-text', !!textModel);
    check('mock-image 被识别为图片模型',
      !!(imageModel && (imageModel.capabilities || []).includes('image_generation')),
      imageModel && JSON.stringify(imageModel.capabilities));

    console.log('\n4. 生成文本（选题 / 剧本 / 分镜走的是同一条链）');
    const gen = await post('/api/ai/generate', {
      apiConfigId: configId,
      modelId: textModel.id,
      prompt: '生成 3 个爆款选题',
      systemPrompt: '你是短视频策划',
    });
    check('文本生成返回内容', !!(gen.content && gen.content.includes('mock 生成')), JSON.stringify(gen).slice(0, 150));

    console.log('\n5. 生成图片并落盘');
    const img = await post('/api/ai/image', {
      apiConfigId: configId,
      modelId: imageModel.id,
      prompt: '一张测试图',
      size: '512x512',
      count: 1,
    });
    check('图片生成返回数据', !!(img.images && img.images.length === 1), JSON.stringify(img).slice(0, 150));

    const saved = await post('/api/media/save-generated', {
      data: img.images[0],
      name: `e2e_${Date.now()}`,
    });
    check('生成结果已保存到本地', !!(saved.url && saved.url.startsWith('/api/files/')), JSON.stringify(saved));

    const diskFile = path.join(store.resolveDataDir(), 'media', saved.path);
    check('落盘文件真实存在', fs.existsSync(diskFile), diskFile);

    // 登记为素材
    const asset = await post('/api/db', {
      table: 'assets', op: 'insert',
      payload: {
        project_id: projectId,
        asset_type: 'image',
        name: 'e2e 生成图',
        file_url: saved.url,
        source_module: 'image_generation',
      },
      returning: true,
    });
    check('素材已登记', !!asset.data[0].id);

    const assets = await post('/api/db', {
      table: 'assets', op: 'select',
      filters: [{ op: 'eq', column: 'project_id', value: projectId }],
    });
    check('按项目能查回素材', assets.data.length === 1);

    console.log('\n6. 进剪辑台并导出');
    const TL = `tl_e2e_${Date.now()}`;
    await post('/api/edit/timeline/save', {
      id: TL, name: 'e2e 时间线', project_id: projectId,
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
      cmd: { type: 'addClip', clip: { type: 'video', src: saved.url, duration: 3, sourceStart: 0, speed: 1, volume: 1 } },
    });
    const tl = await post('/api/edit/timeline/get', { id: TL });
    check('时间线上有 1 个片段', tl.data.timeline.tracks[0].clips.length === 1);

    if (!haveFfmpeg) {
      console.log('  · 未找到 FFmpeg，跳过导出这一步');
    } else {
      const rr = await post('/api/edit/render', { timelineId: TL, name: 'e2e' });
      let job = null;
      for (let i = 0; i < 120; i++) {
        const j = await get(`/api/edit/job?id=${rr.data.jobId}`);
        job = j.data;
        if (job.status === 'done' || job.status === 'failed') break;
        await sleep(1000);
      }
      if (job && job.status !== 'done') console.log('  服务日志:', srvLog.slice(-600));
      if (job && job.status !== 'done') console.log('  服务日志:', srvLog.slice(-400), '| job.log:', (job.log || '(空)').slice(-400));
      check('导出成功', job && job.status === 'done', JSON.stringify(job).slice(0, 300));
      if (job && job.output) {
        const outFile = path.join(store.resolveDataDir(), 'media', job.output.replace('/api/files/', ''));
        check('成片文件存在且非空', fs.existsSync(outFile) && fs.statSync(outFile).size > 500);
      }
    }
    console.log('\n7. 损坏素材应提前报错，不能让用户干等超时');
    // 写一张内容坏的 png（有 PNG 头，但数据不完整）
    const badRel = 'image/e2e-broken.png';
    const badDir = path.join(store.resolveDataDir(), 'media', 'image');
    fs.mkdirSync(badDir, { recursive: true });
    const badPath = path.join(badDir, 'e2e-broken.png');
    fs.writeFileSync(badPath, Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 0x00),
    ]));
    const TLB = `tl_bad_${Date.now()}`;
    await post('/api/edit/timeline/save', {
      id: TLB, name: '坏素材',
      timeline: { id: TLB, width: 320, height: 240, fps: 25, tracks: [
        { id: 'v1', type: 'video', clips: [] },
        { id: 'a1', type: 'audio', clips: [] },
      ] },
    });
    await post('/api/edit/command', { timelineId: TLB,
      cmd: { type: 'addClip', clip: { type: 'video', src: '/api/files/image/e2e-broken.png', duration: 3, sourceStart: 0, speed: 1, volume: 1 } } });
    const rb = await post('/api/edit/render', { timelineId: TLB, name: 'bad' });
    if (rb.error) {
      // 同步就报错了（素材校验拦下的）
      check('损坏素材被提前拦下', /无法解码/.test(rb.error), rb.error);
    } else {
      let jobB = null;
      for (let i = 0; i < 40; i++) {
        const j = await get(`/api/edit/job?id=${rb.data.jobId}`);
        jobB = j.data;
        if (jobB.status === 'done' || jobB.status === 'failed') break;
        await sleep(500);
      }
      check('损坏素材最终报失败（不会永远 running）',
        jobB && jobB.status === 'failed',
        jobB && (`status=${jobB.status} error=${jobB.error}`));
    }

  } finally {
    app.kill();
    mock.close();
    await sleep(500);
    // 清理测试产生的数据
    try {
      await fs.promises.rm(path.join(store.resolveDataDir(), 'media', 'image'), { recursive: true, force: true });
      await fs.promises.rm(path.join(store.resolveDataDir(), 'media', 'exports'), { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  console.log(`\n${failed === 0 ? '全部通过' : '存在失败'}：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
})();
