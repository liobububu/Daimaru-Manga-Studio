'use strict';
/**
 * 本地 HTTP 端到端冒烟测试。
 * 自行启动 local/server.js，使用独立数据目录，结束后清理。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'local', 'server.js');
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'donghua-api-smoke-'));
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : error}`);
  }
}

async function req(urlPath, payload, method = 'POST', headers = {}) {
  const response = await fetch(BASE + urlPath, {
    method,
    headers: { ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  return [response.status, body];
}

async function waitForServer(proc) {
  for (let i = 0; i < 40; i++) {
    if (proc.exitCode !== null) throw new Error(`服务提前退出，exit=${proc.exitCode}`);
    try {
      const [code] = await req('/api/health', undefined, 'GET');
      if (code === 200) return;
    } catch { /* 等待启动 */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('服务启动超时');
}

async function main() {
  console.log(`启动服务 (端口 ${PORT})...`);
  const proc = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DONGHUA_DATA_DIR: tmp },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  proc.stdout.on('data', chunk => { serverLog += chunk; });
  proc.stderr.on('data', chunk => { serverLog += chunk; });

  try {
    await waitForServer(proc);

    console.log('\n服务与数据层');
    await test('health 返回数据目录', async () => {
      const [code, body] = await req('/api/health', undefined, 'GET');
      assert.strictEqual(code, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.dataDir);
    });

    await test('表 CRUD 全流程', async () => {
      const [, inserted] = await req('/api/db', { table: 'projects', op: 'insert', payload: { name: '冒烟项目' }, returning: true });
      const id = inserted.data?.[0]?.id;
      assert.ok(id, '应返回新记录 id');
      const [, selected] = await req('/api/db', { table: 'projects', op: 'select', filters: [{ op: 'eq', column: 'id', value: id }] });
      assert.strictEqual(selected.data?.[0]?.name, '冒烟项目');
      const [, updated] = await req('/api/db', { table: 'projects', op: 'update', filters: [{ op: 'eq', column: 'id', value: id }], payload: { name: '改后' }, returning: true });
      assert.strictEqual(updated.data?.[0]?.name, '改后');
      await req('/api/db', { table: 'projects', op: 'delete', filters: [{ op: 'eq', column: 'id', value: id }] });
      const [, after] = await req('/api/db', { table: 'projects', op: 'select', filters: [{ op: 'eq', column: 'id', value: id }] });
      assert.strictEqual(after.data?.length, 0);
    });

    await test('非法表名被拒绝', async () => {
      const [code] = await req('/api/db', { table: 'bad;drop', op: 'select' });
      assert.ok(code >= 400);
    });

    console.log('\nAPI 配置与加密');
    await test('保存配置：脱敏返回且不泄露密钥', async () => {
      const [, saved] = await req('/api/ai/config/save', {
        name: '测试配置', base_url: 'https://api.openai.com/v1',
        api_key: 'sk-test-key-1234', api_type: 'openai_compatible',
        chat_completions_path: '/chat/completions',
      });
      const cfg = saved.data;
      assert.strictEqual(cfg.masked_api_key, 'sk-****1234');
      assert.ok(!('encrypted_api_key' in cfg));
      const tableFile = path.join(tmp, 'tables', 'api_configs.json');
      const rows = JSON.parse(fs.readFileSync(tableFile, 'utf8'));
      const hit = rows.find(row => row.id === cfg.id);
      assert.ok(hit);
      assert.ok(!JSON.stringify(hit).includes('sk-test-key-1234'));
      await req('/api/ai/config/delete', { id: cfg.id });
    });

    await test('生成接口对无效配置报错', async () => {
      const [code, body] = await req('/api/ai/generate', { apiConfigId: 'nonexistent', modelId: 'x', prompt: 'hi' });
      assert.ok(code >= 400);
      assert.ok('error' in body);
    });

    console.log('\n剪辑链路');
    const timelineId = 'tl_smoke_1';
    let firstClipId = '';
    await test('时间线：添加 / 分割 / 变速 / 静音', async () => {
      await req('/api/edit/timeline/save', {
        id: timelineId, name: '冒烟时间线',
        timeline: { id: timelineId, width: 1080, height: 1920, fps: 30, tracks: [
          { id: 'v1', type: 'video', clips: [] }, { id: 'a1', type: 'audio', clips: [] },
        ] },
      });
      const [, added] = await req('/api/edit/command', { timelineId, cmd: { type: 'addClip', clip: {
        type: 'video', src: '/api/files/video/x.mp4', duration: 10, sourceStart: 0, speed: 1, volume: 1,
      } } });
      firstClipId = added.data.timeline.tracks[0].clips[0].id;
      const [, split] = await req('/api/edit/command', { timelineId, cmd: { type: 'splitClip', clipId: firstClipId, at: 4 } });
      const clips = split.data.timeline.tracks[0].clips;
      assert.strictEqual(clips.length, 2);
      assert.strictEqual(clips[0].duration, 4);
      assert.strictEqual(clips[1].duration, 6);
      const [, speed] = await req('/api/edit/command', { timelineId, cmd: { type: 'setSpeed', clipId: clips[0].id, speed: 2 } });
      assert.strictEqual(speed.data.timeline.tracks[0].clips[0].duration, 2);
      const [, mute] = await req('/api/edit/command', { timelineId, cmd: { type: 'patchClip', clipId: clips[0].id, patch: { muted: true } } });
      assert.strictEqual(mute.data.timeline.tracks[0].clips[0].muted, true);
    });

    await test('无效剪辑命令被拒绝', async () => {
      const [code] = await req('/api/edit/command', { timelineId, cmd: { type: 'splitClip', clipId: 'nope', at: 1 } });
      assert.ok(code >= 400);
    });
    await test('NaN 数值被拒绝', async () => {
      const [code] = await req('/api/edit/command', { timelineId, cmd: { type: 'setSpeed', clipId: firstClipId || 'x', speed: 'abc' } });
      assert.ok(code >= 400);
    });
    await test('渲染：素材不存在时报错', async () => {
      const [code] = await req('/api/edit/render', { timelineId });
      assert.ok(code >= 400);
    });

    console.log('\nOpenReel 本地暂存任务');
    await test('暂存任务列表 HTTP 接口可读取', async () => {
      const [code, body] = await req('/api/media/stage-local-file/jobs', undefined, 'GET');
      assert.strictEqual(code, 200);
      assert.ok(Array.isArray(body));
    });

    console.log('\n静态资源');
    await test('根路径有响应', async () => {
      const response = await fetch(BASE + '/', { signal: AbortSignal.timeout(10_000) });
      const text = await response.text();
      assert.ok([200, 404].includes(response.status));
      assert.ok(text.length > 0);
    });
  } finally {
    if (proc.exitCode === null) proc.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (serverLog && failed) console.log('\n服务日志：\n' + serverLog.slice(-4000));
  console.log(`\n${failed === 0 ? '全部通过' : '存在失败'}：${passed} 通过 / ${failed} 失败`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
