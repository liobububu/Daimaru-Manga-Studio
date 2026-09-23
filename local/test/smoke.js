'use strict';
/**
 * 本地版冒烟测试
 *
 * 覆盖三件最容易悄悄坏掉的事：
 *   1. 剪辑命令的数值正确性（分割点、裁剪边界、反转镜像、变速换算）
 *   2. OpenAI 兼容端点的 URL 拼法（/v1 探测规则）
 *   3. 数据层的 CRUD 与过滤
 *
 * 运行： node local/test/smoke.js
 */

const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const store = require('../lib/store');
const timeline = require('../lib/timeline');
const openai = require('../lib/openai');
const { buildRenderArgs } = require('../lib/ffmpeg');
const media = require('../routes/media');

// 用临时目录，不污染真实数据
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'donghua-smoke-'));
store.setDataDir(tmp);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ───────────────────────── 剪辑命令 ─────────────────────────
section('剪辑命令');

test('split 在给定时间点切成两段，时长守恒', () => {
  const tl = timeline.createTimeline();
  const clip = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 10, start: 0, sourceStart: 0 });
  const [left, right] = timeline.splitClip(tl, clip.id, 4);
  assert.strictEqual(left.duration, 4, '左段应为 4 秒');
  assert.strictEqual(right.duration, 6, '右段应为 6 秒');
  assert.strictEqual(right.start, 4, '右段起点应为 4');
  assert.strictEqual(right.sourceStart, 4, '正常速度下源偏移应等于时间偏移');
  assert.strictEqual(left.duration + right.duration, 10, '总时长守恒');
});

test('split 会按 speed 换算源偏移', () => {
  const tl = timeline.createTimeline();
  const clip = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 10, start: 0, sourceStart: 0, speed: 2 });
  const [, right] = timeline.splitClip(tl, clip.id, 5);
  // 时间线上过了 5 秒 = 源素材走了 10 秒
  assert.strictEqual(right.sourceStart, 10, '2 倍速下源偏移应为时间偏移的 2 倍');
});

test('反转片段的 split 源偏移是镜像的', () => {
  const tl = timeline.createTimeline();
  const clip = timeline.addClip(tl, {
    type: 'video', src: '/a.mp4', duration: 10, start: 0, sourceStart: 8, reversed: true,
  });
  const [, right] = timeline.splitClip(tl, clip.id, 3);
  assert.strictEqual(right.sourceStart, 5, '反转片段源偏移应减少（8 - 3 = 5）');
});

test('head trim 到头后不再推进（源偏移不为负）', () => {
  const tl = timeline.createTimeline();
  const clip = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 10, start: 0, sourceStart: 2 });
  // 源偏移只有 2 秒，砍 8 秒会把 sourceStart 推到 -6，应被夹到 0
  timeline.trimClip(tl, clip.id, 'head', 2);
  assert.strictEqual(clip.duration, 2);
  assert.ok(clip.sourceStart >= 0, `源偏移不能为负，实际 ${clip.sourceStart}`);
});

test('tail trim 不能超过原长', () => {
  const tl = timeline.createTimeline();
  const clip = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 10 });
  assert.throws(() => timeline.trimClip(tl, clip.id, 'tail', 20), /不能超过片段原有长度/);
});

test('NaN / Infinity 一律被拒绝', () => {
  const tl = timeline.createTimeline();
  const clip = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 10 });
  assert.throws(() => timeline.splitClip(tl, clip.id, Number.NaN), /不是有效数字/);
  assert.throws(() => timeline.setSpeed(tl, clip.id, Number.POSITIVE_INFINITY), /不是有效数字/);
  assert.throws(() => timeline.addClip(tl, { type: 'video', src: '/b.mp4', duration: Number.NaN }), /不是有效数字/);
});

test('新增片段会拒绝非法 sourceStart / speed / volume', () => {
  const tl = timeline.createTimeline();
  assert.throws(() => timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 2, sourceStart: 'abc' }), /有效数字/);
  assert.throws(() => timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 2, speed: 0 }), /speed 必须大于 0/);
  assert.throws(() => timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 2, volume: -1 }), /volume 不能为负/);
});

test('裁剪不能反向扩大片段，且裁剪方向必须合法', () => {
  const tl = timeline.createTimeline();
  const clip = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 4 });
  assert.throws(() => timeline.trimClip(tl, clip.id, 'head', 5), /不能超过片段原有长度/);
  assert.throws(() => timeline.trimClip(tl, clip.id, 'middle', 2), /head 或 tail/);
  assert.strictEqual(clip.duration, 4, '失败的裁剪不能修改片段');
});

test('patchClip 严格校验布尔值与转场参数', () => {
  const tl = timeline.createTimeline();
  const clip = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 4 });
  assert.throws(() => timeline.patchClip(tl, clip.id, { muted: 'false' }), /布尔值/);
  assert.throws(() => timeline.patchClip(tl, clip.id, { transitionIn: { type: 'fade', duration: 9 } }), /转场时长/);
  assert.throws(() => timeline.patchClip(tl, clip.id, { transitionIn: { type: 'spin', duration: 1 } }), /转场类型/);
});

test('setSpeed 保持源窗口不变、时间线时长按倍率缩放', () => {
  const tl = timeline.createTimeline();
  const clip = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 10, sourceStart: 0 });
  timeline.setSpeed(tl, clip.id, 2);
  assert.strictEqual(clip.duration, 5, '2 倍速后时间线时长应减半');
  timeline.setSpeed(tl, clip.id, 1);
  assert.strictEqual(clip.duration, 10, '恢复 1 倍速后时长还原');
});

test('merge 拒绝不相邻 / 方向不同的片段', () => {
  const tl = timeline.createTimeline();
  const a = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 4, start: 0 });
  const b = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 4, start: 10 });
  assert.throws(() => timeline.mergeClips(tl, a.id, b.id), /不相邻/);

  const tl2 = timeline.createTimeline();
  const c = timeline.addClip(tl2, { type: 'video', src: '/a.mp4', duration: 4, start: 0 });
  const d = timeline.addClip(tl2, { type: 'video', src: '/a.mp4', duration: 4, start: 4, reversed: true });
  assert.throws(() => timeline.mergeClips(tl2, c.id, d.id), /反转方向不同/);
});

test('merge 相邻同向片段后时长相加', () => {
  const tl = timeline.createTimeline();
  const a = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 4, start: 0 });
  const b = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 4, start: 4 });
  const merged = timeline.mergeClips(tl, a.id, b.id);
  assert.strictEqual(merged.duration, 8);
  assert.strictEqual(tl.tracks[0].clips.length, 1, '合并后应只剩一个片段');
});

test('swap 相邻片段后顺序互换、总时长不变', () => {
  const tl = timeline.createTimeline();
  const a = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 2, start: 0 });
  const b = timeline.addClip(tl, { type: 'video', src: '/b.mp4', duration: 3, start: 2 });
  timeline.swapClips(tl, a.id, b.id);
  assert.strictEqual(b.start, 0, 'b 应该换到前面');
  assert.strictEqual(a.start, 3, 'a 应该换到后面（3 = 0 + b 的时长）');
  assert.strictEqual(timeline.timelineDuration(tl), 5, '总时长不该变');
});

test('swap 拒绝不相邻的片段', () => {
  const tl = timeline.createTimeline();
  const a = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 2, start: 0 });
  const b = timeline.addClip(tl, { type: 'video', src: '/b.mp4', duration: 1, start: 2 });
  const c = timeline.addClip(tl, { type: 'video', src: '/c.mp4', duration: 1, start: 3 });
  assert.throws(() => timeline.swapClips(tl, a.id, c.id), /不相邻/);
});

// 模型能力判断：规则数据在 shared/capability-rules.json，前端与服务端共用。
// 这条测试守的是服务端这一侧；改规则时前端会跟着变，所以改完要跑一遍全链路确认同步结果。
test('能力判断按规则累加（共享规则表）', () => {
  const { detectCapabilities, detectCapabilitiesFromModel } = require('../../shared/capabilities');
  assert.deepStrictEqual(detectCapabilities('gpt-4o'), ['text_generation']);
  assert.deepStrictEqual(detectCapabilities('dall-e-3'), ['image_generation']);
  assert.deepStrictEqual(detectCapabilities('kling-v1'), ['video_generation']);
  assert.ok(detectCapabilities('qwen-image-2.1').includes('image_generation'));
  assert.ok(detectCapabilities('flux-kontext-pro').includes('image_generation'));
  assert.ok(detectCapabilities('flux-kontext-pro').includes('image_edit'));
  assert.ok(detectCapabilities('minimax-h3').includes('video_generation'));
  assert.ok(detectCapabilities('veo-3.1').includes('video_generation'));
  assert.ok(detectCapabilities('hunyuan-video').includes('video_generation'));
  assert.ok(detectCapabilities('tts-1').includes('audio_generation'));
  assert.ok(detectCapabilities('whisper-1').includes('audio_recognition'));
  // 多命中的要累加，不能只取第一条
  assert.ok(detectCapabilities('gpt-4-vision').includes('text_generation'));
  assert.ok(detectCapabilities('gpt-4-vision').includes('multimodal'));
  // 不用于生成的模型应为空，避免被误选去生成内容
  assert.deepStrictEqual(detectCapabilities('text-embedding-3-large'), []);
  // 认不出的模型退回默认，而不是空
  assert.deepStrictEqual(detectCapabilities('my-custom-model'), ['text_generation']);
  // API 明确返回能力元数据时必须优先于名称猜测
  assert.deepStrictEqual(detectCapabilitiesFromModel({ id: 'gpt-looking-name', capabilities: ['video_generation'] }), ['video_generation']);
  assert.ok(detectCapabilitiesFromModel({ id: 'unknown', modalities: ['text', 'image'] }).includes('image_generation'));
  assert.ok(detectCapabilitiesFromModel({ id: 'unknown', output_modalities: ['video'] }).includes('video_generation'));
  const visionInput = detectCapabilitiesFromModel({ id: 'unknown', input_types: { image: true }, output_types: { text: true } });
  assert.ok(visionInput.includes('text_generation'));
  assert.ok(visionInput.includes('multimodal'));
  assert.ok(!visionInput.includes('image_generation'));
  const imageOutput = detectCapabilitiesFromModel({ id: 'unknown', input_modalities: ['text', 'image'], output_modalities: ['image'] });
  assert.ok(imageOutput.includes('multimodal'));
  assert.ok(imageOutput.includes('image_generation'));
  const audioInput = detectCapabilitiesFromModel({ id: 'unknown', input_modalities: ['audio'], output_modalities: ['text'] });
  assert.ok(audioInput.includes('multimodal'));
  assert.ok(audioInput.includes('text_generation'));
  assert.ok(!audioInput.includes('audio_generation'));
  // 元数据不可识别时仍回退到名称规则
  assert.deepStrictEqual(detectCapabilitiesFromModel({ id: 'kling-v1', modalities: ['unknown'] }), ['video_generation']);
});

test('模型同步元数据保持完整并进入能力识别器', () => {
  const { detectCapabilitiesFromModel, diagnoseCapabilitiesFromModel } = require('../../shared/capabilities');
  const upstreamModel = {
    id: 'vendor-model-001',
    owned_by: 'vendor',
    capabilities: ['video_generation'],
    modalities: ['text'],
    input_modalities: ['image'],
    output_modalities: ['video'],
    input_types: { image: true },
    output_types: { video: true },
    vendor_extension: { keep_me: true },
  };
  const transported = { ...upstreamModel, id: String(upstreamModel.id), owned_by: upstreamModel.owned_by || null };
  assert.deepStrictEqual(transported.vendor_extension, { keep_me: true });
  assert.deepStrictEqual(transported.input_modalities, ['image']);
  assert.deepStrictEqual(transported.output_modalities, ['video']);
  const caps = detectCapabilitiesFromModel(transported);
  assert.ok(caps.includes('video_generation'));
  assert.ok(caps.includes('multimodal'));
  assert.ok(!caps.includes('image_generation'));
  const diagnosis = diagnoseCapabilitiesFromModel(transported);
  assert.strictEqual(diagnosis.source, 'capabilities');
  assert.ok(diagnosis.presentFields.includes('input_modalities'));
  assert.deepStrictEqual(diagnosis.capabilities, ['video_generation']);
  const fallbackDiagnosis = diagnoseCapabilitiesFromModel({ id: 'kling-v1' });
  assert.strictEqual(fallbackDiagnosis.source, 'name_fallback');
  assert.deepStrictEqual(fallbackDiagnosis.capabilities, ['video_generation']);
});

test('未知命令被拒绝', () => {
  const tl = timeline.createTimeline();
  assert.throws(() => timeline.applyCommand(tl, { type: 'bogus' }), /未知命令/);
});

// ───────────────────────── 端点解析 ─────────────────────────
section('OpenAI 兼容端点解析');

test('base 已带 /v1 → 不重复拼接', () => {
  const urls = openai.endpointCandidates('https://api.openai.com/v1', '/chat/completions');
  assert.strictEqual(urls.length, 1);
  assert.strictEqual(urls[0], 'https://api.openai.com/v1/chat/completions');
});

test('base 不带版本 → 先试 /v1 再回退', () => {
  const urls = openai.endpointCandidates('https://api.openai.com', '/chat/completions');
  assert.deepStrictEqual(urls, [
    'https://api.openai.com/v1/chat/completions',
    'https://api.openai.com/chat/completions',
  ]);
});

test('path 自带版本 → 不重复拼接（智谱形态）', () => {
  const urls = openai.endpointCandidates('https://open.bigmodel.cn', '/api/paas/v4/chat/completions');
  assert.strictEqual(urls.length, 1);
  assert.strictEqual(urls[0], 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
});

test('尾斜杠不会导致双斜杠', () => {
  const urls = openai.endpointCandidates('https://api.openai.com/', '/chat/completions/');
  assert.ok(!urls[0].includes('//chat'), `不应出现双斜杠: ${urls[0]}`);
});

test('点分路径取值支持数组下标', () => {
  const obj = { choices: [{ message: { content: 'hi' } }] };
  assert.strictEqual(openai.getByPath(obj, 'choices.0.message.content'), 'hi');
  assert.strictEqual(openai.getByPath(obj, 'choices.1.message.content'), undefined);
});

// ───────────────────────── 数据层 ─────────────────────────
section('数据层');

(async () => {
  const rows = [{ id: '1', name: '甲', kind: 'video', n: 3 }, { id: '2', name: '乙', kind: 'image', n: 1 }];
  await store.writeTable('demo', rows);

  const all = await store.runQuery({ table: 'demo', op: 'select' });
  assert.strictEqual(all.data.length, 2);

  const filtered = await store.runQuery({
    table: 'demo', op: 'select', filters: [{ op: 'eq', column: 'kind', value: 'video' }],
  });
  assert.strictEqual(filtered.data.length, 1, 'eq 过滤应命中 1 条');
  test('eq 过滤', () => {});

  const ordered = await store.runQuery({ table: 'demo', op: 'select', order: { column: 'n', ascending: false } });
  assert.strictEqual(ordered.data[0].id, '1', '降序应把 n=3 排前面');
  test('order 降序', () => {});

  const inserted = await store.runQuery({
    table: 'demo', op: 'insert', payload: { name: '丙' }, returning: true,
  });
  assert.ok(inserted.data[0].id, 'insert 应自动生成 id');
  test('insert 自动生成 id', () => {});

  const updated = await store.runQuery({
    table: 'demo', op: 'update',
    filters: [{ op: 'eq', column: 'id', value: '1' }],
    payload: { name: '甲改' }, returning: true,
  });
  assert.strictEqual(updated.data[0].name, '甲改');
  test('update', () => {});

  await store.runQuery({ table: 'demo', op: 'delete', filters: [{ op: 'eq', column: 'id', value: '2' }] });
  const after = await store.runQuery({ table: 'demo', op: 'select' });
  assert.strictEqual(after.data.length, 2, '删除后应剩 2 条');
  test('delete', () => {});

  const allIds = (await store.runQuery({ table: 'demo', op: 'select' })).data.map(r => r.id);
  const inQ = await store.runQuery({
    table: 'demo', op: 'select', filters: [{ op: 'in', column: 'id', value: allIds.slice(0, 2) }],
  });
  assert.strictEqual(inQ.data.length, 2, 'in 过滤应命中 2 条');
  test('in 过滤', () => {});

  assert.throws(() => store.safeName('bad;drop'), /非法的表名/);
  test('表名防注入', () => {});

  test('媒体磁盘路径不能越出 media 目录', () => {
    const ok = media.toDiskPath('/api/files/video/a.mp4');
    assert.ok(ok && ok.includes(path.join('media', 'video', 'a.mp4')));
    assert.strictEqual(media.toDiskPath('/api/files/../tables/projects.json'), null);
    assert.strictEqual(media.toDiskPath('../master.key'), null);
  });

  test('本地媒体只能桥接 data/media 内文件到 loopback URL', () => {
    const file = path.join(store.resolveDataDir(), 'media', 'video', 'bridge.mp4');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'test');
    assert.strictEqual(media.toLoopbackUrl('/api/files/video/bridge.mp4', 'http://127.0.0.1:5199'), 'http://127.0.0.1:5199/api/files/video/bridge.mp4');
    assert.strictEqual(media.toLoopbackUrl('../master.key', 'http://127.0.0.1:5199'), null);
    assert.strictEqual(media.toLoopbackUrl('/api/files/video/bridge.mp4', 'http://example.com:5199'), null);
  });

  test('文件名编码兼容中文、空格与百分号编码', () => {
    assert.strictEqual(media.sanitizeFileName('测试%20视频.mp4'), '测试_视频.mp4');
    assert.strictEqual(media.sanitizeFileName('测试 视频.mp4'), '测试_视频.mp4');
    assert.strictEqual(media.sanitizeFileName('../危险.mp4'), '危险.mp4');
  });

  test('绝对本地文件会暂存到受控 media 目录', async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'donghua-local-media-'));
    const source = path.join(sourceDir, '中文 大文件.mp4');
    fs.writeFileSync(source, Buffer.alloc(2 * 1024 * 1024, 7));
    const staged = await media.stageLocalFile(source, '中文 大文件.mp4');
    assert.ok(staged.url.startsWith('/api/files/video/'));
    assert.strictEqual(staged.size, 2 * 1024 * 1024);
    const disk = media.toDiskPath(staged.url);
    assert.ok(disk && fs.existsSync(disk));
    assert.strictEqual(fs.statSync(disk).size, fs.statSync(source).size);
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  test('大文件暂存任务提供进度并完成', async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'donghua-stage-progress-'));
    const source = path.join(sourceDir, 'progress.mp4');
    fs.writeFileSync(source, Buffer.alloc(8 * 1024 * 1024, 3));
    const { id } = media.createStageJob(source, 'progress.mp4');
    let job;
    for (let i = 0; i < 100; i++) {
      job = media.getStageJob(id);
      assert.ok(job.progress >= 0 && job.progress <= 100);
      if (job.status === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.strictEqual(job.status, 'completed');
    assert.strictEqual(job.progress, 100);
    assert.strictEqual(job.loaded, job.total);
    assert.ok(Number.isFinite(job.bytesPerSecond) && job.bytesPerSecond >= 0);
    assert.strictEqual(job.etaSeconds, 0);
    assert.ok(media.toDiskPath(job.url));
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  test('大文件暂存任务速度与 ETA 始终是安全数值', async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'donghua-stage-metrics-'));
    const source = path.join(sourceDir, 'metrics.mp4');
    fs.writeFileSync(source, Buffer.alloc(12 * 1024 * 1024, 9));
    const { id } = media.createStageJob(source, 'metrics.mp4');
    let job;
    for (let i = 0; i < 150; i++) {
      job = media.getStageJob(id);
      assert.ok(Number.isFinite(job.bytesPerSecond) && job.bytesPerSecond >= 0);
      assert.ok(job.etaSeconds === null || (Number.isFinite(job.etaSeconds) && job.etaSeconds >= 0));
      if (job.status === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.strictEqual(job.status, 'completed');
    assert.strictEqual(job.loaded, job.total);
    assert.strictEqual(job.etaSeconds, 0);
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  test('暂存任务可取消且不会留下完整目标文件', async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'donghua-stage-cancel-'));
    const source = path.join(sourceDir, 'cancel.mp4');
    fs.writeFileSync(source, Buffer.alloc(32 * 1024 * 1024, 5));
    const { id } = media.createStageJob(source, 'cancel.mp4');
    media.cancelStageJob(id);
    let job;
    for (let i = 0; i < 100; i++) {
      job = media.getStageJob(id);
      if (job.status === 'cancelled') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.strictEqual(job.status, 'cancelled');
    assert.strictEqual(job.url, null);
    const persisted = JSON.parse(fs.readFileSync(path.join(store.resolveDataDir(), 'openreel-stage-jobs.json'), 'utf8'));
    const persistedJob = persisted.find(item => item.id === id);
    assert.strictEqual(persistedJob.status, 'cancelled');
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  test('暂存任务终态与失败列表基础数据可从持久化文件恢复', () => {
    const persisted = JSON.parse(fs.readFileSync(path.join(store.resolveDataDir(), 'openreel-stage-jobs.json'), 'utf8'));
    assert.ok(Array.isArray(persisted) && persisted.length > 0);
    for (const job of persisted) {
      assert.ok(job.id);
      assert.ok(['completed', 'failed', 'cancelled', 'pending', 'running'].includes(job.status));
      assert.ok(Number.isFinite(job.loaded) && job.loaded >= 0);
      assert.ok(Number.isFinite(job.total) && job.total >= 0);
    }
    const listed = media.listStageJobs();
    assert.strictEqual(listed.length, persisted.length);
  });

  test('OpenReel 时间线映射保留轨道、时间、裁剪、速度和音量', () => {
    const openReel = require('../lib/openreel-desktop');
    const plan = openReel.buildTimelinePlan({
      tracks: [{ id: 'v1', type: 'video', clips: [
        { id: 'c1', type: 'video', src: '/api/files/video/a.mp4', name: 'A', start: 2, duration: 4, sourceStart: 1.5, speed: 2, reversed: true, muted: false, volume: 0.7 },
        { id: 'c2', type: 'video', src: '/api/files/image/b.png', name: 'B', start: 6, duration: 3, sourceStart: 0, speed: 1, muted: true, volume: 1, transitionIn: { type: 'fade', duration: 0.5 } },
      ] }],
    }, [
      { sourceUrl: '/api/files/video/a.mp4', mediaId: 'media-a' },
      { sourceUrl: '/api/files/image/b.png', mediaId: 'media-b' },
    ]);
    assert.strictEqual(plan.tracks.length, 1);
    const video = plan.tracks.find(t => t.trackType === 'video').clips[0];
    assert.strictEqual(video.mediaId, 'media-a');
    assert.strictEqual(video.startTime, 2);
    assert.strictEqual(video.duration, 4);
    assert.strictEqual(video.inPoint, 1.5);
    assert.strictEqual(video.outPoint, 9.5);
    assert.strictEqual(video.speed, 2);
    assert.strictEqual(video.reversed, true);
    assert.strictEqual(video.volume, 0.7);
    const second = plan.tracks[0].clips[1];
    assert.strictEqual(second.volume, 0);
    assert.strictEqual(plan.transitions.length, 1);
    assert.deepStrictEqual(plan.transitions[0], {
      clipAId: 'dh-clip-c1',
      clipBId: 'dh-clip-c2',
      transitionType: 'fade',
      duration: 0.5,
    });
    assert.strictEqual(plan.warnings.length, 0);
  });

  test('OpenReel 时间线映射会跳过不相邻片段的转场', () => {
    const openReel = require('../lib/openreel-desktop');
    const plan = openReel.buildTimelinePlan({
      tracks: [{ id: 'v1', type: 'video', clips: [
        { id: 'c1', type: 'video', src: 'a', start: 0, duration: 2, speed: 1, volume: 1 },
        { id: 'c2', type: 'video', src: 'b', start: 4, duration: 2, speed: 1, volume: 1, transitionIn: { type: 'fade', duration: 1 } },
      ] }],
    }, [{ sourceUrl: 'a', mediaId: 'ma' }, { sourceUrl: 'b', mediaId: 'mb' }]);
    assert.strictEqual(plan.transitions.length, 0);
    assert.ok(plan.warnings.some(w => w.includes('不相邻')));
  });

  // ───────────────────────── FFmpeg 命令构造 ─────────────────────────
  section('FFmpeg 命令构造');

  test('两个片段拼成一条 concat', () => {
    const tl = timeline.createTimeline();
    timeline.addClip(tl, { type: 'video', src: '/tmp/a.mp4', duration: 4 });
    timeline.addClip(tl, { type: 'video', src: '/tmp/b.mp4', duration: 6 });
    const { args } = buildRenderArgs(tl, '/tmp/out.mp4');
    const fc = args[args.indexOf('-filter_complex') + 1];
    assert.ok(fc.includes('concat=n=2:v=1:a=0'), `应拼接两个视频流: ${fc}`);
    assert.ok(args.includes('/tmp/a.mp4') && args.includes('/tmp/b.mp4'), '两个输入都应在参数里');
  });

  test('片段之间有空隙时补黑帧', () => {
    const tl = timeline.createTimeline();
    timeline.addClip(tl, { type: 'video', src: '/tmp/a.mp4', duration: 4, start: 0 });
    timeline.addClip(tl, { type: 'video', src: '/tmp/b.mp4', duration: 4, start: 8 }); // 中间空 4 秒
    const { args, duration } = buildRenderArgs(tl, '/tmp/out.mp4');
    assert.strictEqual(duration, 12, '总时长应为 12 秒');
    const fc = args[args.indexOf('-filter_complex') + 1];
    // 黑帧源在输入参数里（-f lavfi -i color=...），滤镜串里表现为一个 setsar 节点
    assert.ok(args.some(a => String(a).startsWith('color=c=black')), '应插入黑帧输入源');
    assert.ok(/\[v0\]\[gap1v\]\[v1\]concat=n=3/.test(fc), `黑帧应参与拼接: ${fc}`);
  });

  test('静音片段的音量滤镜为 0', () => {
    const tl = timeline.createTimeline();
    timeline.addClip(tl, { type: 'video', src: '/tmp/a.mp4', duration: 4, muted: true });
    const { args } = buildRenderArgs(tl, '/tmp/out.mp4');
    const fc = args[args.indexOf('-filter_complex') + 1];
    assert.ok(fc.includes('volume=0'), `静音应为 volume=0: ${fc}`);
  });

  test('空时间线拒绝渲染', () => {
    const tl = timeline.createTimeline();
    assert.throws(() => buildRenderArgs(tl, '/tmp/out.mp4'), /没有可渲染的片段/);
  });

  console.log(`\n${failed === 0 ? '全部通过' : '存在失败'}：${passed} 通过 / ${failed} 失败`);
  console.log(`临时数据目录: ${tmp}`);
  process.exit(failed === 0 ? 0 : 1);
})();
