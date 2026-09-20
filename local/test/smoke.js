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
  assert.throws(() => timeline.trimClip(tl, clip.id, 'tail', 20), /tail 裁剪不能超过片段原有长度/);
});

test('NaN / Infinity 一律被拒绝', () => {
  const tl = timeline.createTimeline();
  const clip = timeline.addClip(tl, { type: 'video', src: '/a.mp4', duration: 10 });
  assert.throws(() => timeline.splitClip(tl, clip.id, Number.NaN), /不是有效数字/);
  assert.throws(() => timeline.setSpeed(tl, clip.id, Number.POSITIVE_INFINITY), /不是有效数字/);
  assert.throws(() => timeline.addClip(tl, { type: 'video', src: '/b.mp4', duration: Number.NaN }), /不是有效数字/);
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
