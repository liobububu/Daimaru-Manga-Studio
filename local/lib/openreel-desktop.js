'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const timelineCreationLocks = new Map();
const TIMELINE_REQUEST_TTL_MS = 30_000;

function candidates() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const programs = process.env.ProgramFiles || 'C:\\Program Files';
  return [process.env.OPENREEL_DESKTOP_EXE, path.join(local, 'Programs', 'OpenReel', 'OpenReel.exe'), path.join(local, 'OpenReel', 'OpenReel.exe'), path.join(programs, 'OpenReel', 'OpenReel.exe')].filter(Boolean);
}
function findExecutable() {
  return candidates().find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || null;
}
function status() {
  const executable = findExecutable();
  const mcp = readMcpEndpoint();
  return { available: Boolean(executable), executable, configured: Boolean(process.env.OPENREEL_DESKTOP_EXE), connected: Boolean(mcp), mcpUrl: mcp?.url || null };
}
function launch() {
  const executable = findExecutable();
  if (!executable) {
    const error = new Error('未检测到 OpenReel Desktop。请安装桌面版，或设置 OPENREEL_DESKTOP_EXE 指向 OpenReel.exe。');
    error.status = 404;
    error.errorType = 'openreel_desktop_not_found';
    throw error;
  }
  // 上游目前没有稳定公开的 CLI/deep-link 项目打开契约；不要猜测启动参数。
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { ok: true, executable };
}

function mcpEndpointFile() {
  return process.env.OPENREEL_MCP_ENDPOINT_FILE || path.join(os.homedir(), '.openreel', 'mcp-endpoint.json');
}

function readMcpEndpoint() {
  try {
    const parsed = JSON.parse(fs.readFileSync(mcpEndpointFile(), 'utf8'));
    if (typeof parsed.url !== 'string' || typeof parsed.token !== 'string' || !parsed.url.startsWith('http://127.0.0.1:')) return null;
    return { url: parsed.url, token: parsed.token };
  } catch { return null; }
}

async function mcpRpc(method, params = {}) {
  const endpoint = readMcpEndpoint();
  if (!endpoint) {
    const error = new Error('OpenReel Desktop 尚未就绪，请先启动桌面版。');
    error.status = 503;
    error.errorType = 'openreel_mcp_not_ready';
    throw error;
  }
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message || `OpenReel MCP 请求失败（HTTP ${response.status}）`);
    error.status = 502;
    error.errorType = 'openreel_mcp_error';
    throw error;
  }
  return body.result;
}

async function listTools() {
  const result = await mcpRpc('tools/list');
  return { tools: Array.isArray(result?.tools) ? result.tools : [] };
}

async function callTool(name, args = {}) {
  if (typeof name !== 'string' || !name) {
    const error = new Error('缺少 OpenReel 工具名');
    error.status = 400;
    throw error;
  }
  return mcpRpc('tools/call', { name, arguments: args });
}

function toolText(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks.filter(block => block?.type === 'text').map(block => String(block.text || '')).join('\n');
}

function toolData(result) {
  const text = toolText(result);
  const marker = text.indexOf('\n\n');
  if (marker < 0) return null;
  try { return JSON.parse(text.slice(marker + 2)); } catch { return null; }
}

function toolFailed(result) {
  return Boolean(result?.isError);
}

async function callToolChecked(name, args = {}) {
  const result = await callTool(name, args);
  if (toolFailed(result)) {
    const error = new Error(toolText(result) || `OpenReel 工具 ${name} 执行失败`);
    error.status = 502;
    error.errorType = 'openreel_tool_error';
    throw error;
  }
  return result;
}

async function createProjectWithMedia({ name, width, height, frameRate, media = [], localOrigin }) {
  const mediaRoutes = require('../routes/media');
  const tools = await listTools();
  const names = new Set(tools.tools.map(tool => tool?.name).filter(Boolean));
  for (const required of ['create_project', 'import_media_from_url', 'save_project']) {
    if (!names.has(required)) {
      const error = new Error(`当前 OpenReel Desktop 缺少必要 MCP 工具：${required}。请升级 OpenReel Desktop。`);
      error.status = 409;
      error.errorType = 'openreel_tool_missing';
      throw error;
    }
  }

  const created = await callToolChecked('create_project', {
    name: String(name || '动画项目'),
    width: Number(width) || 1920,
    height: Number(height) || 1080,
    frameRate: Number(frameRate) || 30,
  });
  const imported = [];
  const failed = [];
  for (const item of media) {
    if (!item || typeof item.url !== 'string') {
      failed.push({ name: item?.name || '未命名素材', type: item?.type || 'unknown', error: '素材地址为空' });
      continue;
    }
    const importUrl = /^https?:\/\//i.test(item.url) ? item.url : mediaRoutes.toLoopbackUrl(item.url, localOrigin);
    if (!importUrl) {
      failed.push({ name: item?.name || '未命名素材', type: item?.type || 'unknown', error: '本地素材不在应用媒体目录中，无法安全共享给 OpenReel' });
      continue;
    }
    try {
      const result = await callToolChecked('import_media_from_url', {
        url: importUrl,
        name: typeof item.name === 'string' && item.name ? item.name : undefined,
      });
      imported.push({ name: item.name, type: item.type, url: item.url, result });
    } catch (error) {
      failed.push({ name: item.name, type: item.type, url: item.url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const saved = await callToolChecked('save_project');
  return {
    ok: true,
    created,
    saved,
    total: media.length,
    importedCount: imported.length,
    failedCount: failed.length,
    imported,
    failed,
  };
}

async function importMediaIntoCurrentProject({ media = [], localOrigin }) {
  const mediaRoutes = require('../routes/media');
  const tools = await listTools();
  const names = new Set(tools.tools.map(tool => tool?.name).filter(Boolean));
  for (const required of ['import_media_from_url', 'save_project']) {
    if (!names.has(required)) {
      const error = new Error(`当前 OpenReel Desktop 缺少必要 MCP 工具：${required}。请升级 OpenReel Desktop。`);
      error.status = 409;
      error.errorType = 'openreel_tool_missing';
      throw error;
    }
  }
  const imported = [];
  const failed = [];
  for (const item of media) {
    const importUrl = typeof item?.url === 'string'
      ? (/^https?:\/\//i.test(item.url) ? item.url : mediaRoutes.toLoopbackUrl(item.url, localOrigin))
      : null;
    if (!importUrl) {
      failed.push({ id: item?.id, name: item?.name || '未命名素材', type: item?.type || 'unknown', error: '素材地址无法安全提供给 OpenReel' });
      continue;
    }
    try {
      await callToolChecked('import_media_from_url', { url: importUrl, name: item.name || undefined });
      imported.push({ id: item.id, name: item.name, type: item.type });
    } catch (error) {
      failed.push({ id: item.id, name: item.name, type: item.type, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await callToolChecked('save_project');
  return { ok: true, importedCount: imported.length, failedCount: failed.length, imported, failed };
}

function safeOpenReelId(prefix, value) {
  return `${prefix}-${String(value || 'item').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80)}`;
}

function buildTimelinePlan(timeline, mediaRefs) {
  const warnings = [];
  const tracks = [];
  const transitions = [];
  const refsByUrl = new Map((mediaRefs || []).filter(ref => ref?.sourceUrl && ref?.mediaId).map(ref => [ref.sourceUrl, ref]));
  for (const [trackIndex, sourceTrack] of (timeline?.tracks || []).entries()) {
    const groups = new Map();
    for (const clip of sourceTrack.clips || []) {
      const ref = refsByUrl.get(clip.src);
      if (!ref) { warnings.push(`片段“${clip.name || clip.id}”未找到已导入素材，已跳过`); continue; }
      const type = clip.type === 'audio' ? 'audio' : clip.type === 'image' ? 'image' : 'video';
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push({ clip, ref });
    }
    let groupIndex = 0;
    for (const [type, items] of groups) {
      const trackId = safeOpenReelId('dh-track', `${sourceTrack.id}-${type}-${groupIndex++}`);
      const clips = items.map(({ clip, ref }) => {
        const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
        const duration = Math.max(0.001, Number(clip.duration) || 0.001);
        const inPoint = Math.max(0, Number(clip.sourceStart) || 0);
        return { trackId, mediaId: ref.mediaId, startTime: Math.max(0, Number(clip.start) || 0), duration, inPoint, outPoint: inPoint + duration * speed, speed, reversed: Boolean(clip.reversed), volume: clip.muted ? 0 : Math.max(0, Number(clip.volume) || 0), clipId: safeOpenReelId('dh-clip', clip.id) };
      });
      tracks.push({ trackId, trackType: type, position: trackIndex + tracks.length, clips });
      for (let index = 1; index < items.length; index += 1) {
        const current = items[index].clip;
        const previous = items[index - 1].clip;
        const transition = current.transitionIn;
        if (!transition || !transition.type || transition.type === 'none') continue;
        const prevEnd = (Number(previous.start) || 0) + (Number(previous.duration) || 0);
        const currentStart = Number(current.start) || 0;
        if (Math.abs(prevEnd - currentStart) > 0.001) {
          warnings.push(`片段“${current.name || current.id}”与前一片段不相邻，转场已跳过`);
          continue;
        }
        transitions.push({
          clipAId: safeOpenReelId('dh-clip', previous.id),
          clipBId: safeOpenReelId('dh-clip', current.id),
          transitionType: String(transition.type),
          duration: Math.max(0.01, Math.min(Number(transition.duration) || 0.5, Number(previous.duration) || 0.5, Number(current.duration) || 0.5)),
        });
      }
    }
  }
  return { tracks, transitions, warnings };
}

async function createProjectWithTimelineImpl({ name, width, height, frameRate, media = [], timeline, localOrigin }) {
  const mediaRoutes = require('../routes/media');
  const tools = await listTools();
  const names = new Set(tools.tools.map(tool => tool?.name).filter(Boolean));
  for (const required of ['create_project', 'import_media_from_url', 'add_track', 'add_clip', 'save_project']) {
    if (!names.has(required)) {
      const error = new Error(`当前 OpenReel Desktop 缺少必要 MCP 工具：${required}。请升级 OpenReel Desktop。`);
      error.status = 409; error.errorType = 'openreel_tool_missing'; throw error;
    }
  }
  await callToolChecked('create_project', { name: String(name || '动画项目'), width: Number(width) || 1920, height: Number(height) || 1080, frameRate: Number(frameRate) || 30 });
  const mediaRefs = [];
  const failed = [];
  for (const item of media) {
    const importUrl = typeof item?.url === 'string' ? (/^https?:\/\//i.test(item.url) ? item.url : mediaRoutes.toLoopbackUrl(item.url, localOrigin)) : null;
    if (!importUrl) { failed.push({ id: item?.id, name: item?.name, error: '素材地址无法安全提供给 OpenReel' }); continue; }
    try {
      const result = await callToolChecked('import_media_from_url', { url: importUrl, name: item.name || undefined });
      const data = toolData(result);
      if (!data?.id) throw new Error('OpenReel 导入素材后未返回 mediaId');
      mediaRefs.push({ id: item.id, name: item.name, sourceUrl: item.sourceUrl || item.url, mediaId: data.id });
    } catch (error) { failed.push({ id: item?.id, name: item?.name, error: error instanceof Error ? error.message : String(error) }); }
  }
  const plan = buildTimelinePlan(timeline, mediaRefs);
  let createdTrackCount = 0;
  let createdClipCount = 0;
  for (const track of plan.tracks) {
    try {
      await callToolChecked('add_track', { trackType: track.trackType, position: track.position, trackId: track.trackId });
      createdTrackCount += 1;
    } catch (error) {
      plan.warnings.push(`轨道 ${track.trackId} 创建失败：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const clip of track.clips) {
      try { await callToolChecked('add_clip', clip); createdClipCount += 1; }
      catch (error) { plan.warnings.push(`片段 ${clip.clipId} 创建失败：${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  if (plan.transitions.length && !names.has('add_transition')) {
    plan.warnings.push(`当前 OpenReel Desktop 不支持 add_transition，已跳过 ${plan.transitions.length} 个转场`);
  } else {
    for (const transition of plan.transitions) {
      try { await callToolChecked('add_transition', transition); }
      catch (error) { plan.warnings.push(`转场 ${transition.transitionType} 导入失败：${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  await callToolChecked('save_project');
  const expectedClipCount = plan.tracks.reduce((n, t) => n + t.clips.length, 0);
  const partial = failed.length > 0 || createdTrackCount !== plan.tracks.length || createdClipCount !== expectedClipCount || plan.warnings.length > 0;
  return { ok: true, partial, importedCount: mediaRefs.length, failedCount: failed.length, failed, trackCount: createdTrackCount, expectedTrackCount: plan.tracks.length, clipCount: createdClipCount, expectedClipCount, transitionCount: plan.transitions.length, warnings: plan.warnings };
}

async function createProjectWithTimeline(args) {
  const key = String(args?.requestId || '');
  const cached = key ? timelineCreationLocks.get(key) : null;
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) timelineCreationLocks.delete(key);
  const promise = createProjectWithTimelineImpl(args);
  if (key) {
    timelineCreationLocks.set(key, { promise, expiresAt: Date.now() + TIMELINE_REQUEST_TTL_MS });
    const timer = setTimeout(() => {
      const current = timelineCreationLocks.get(key);
      if (current?.promise === promise) timelineCreationLocks.delete(key);
    }, TIMELINE_REQUEST_TTL_MS);
    timer.unref?.();
  }
  return promise;
}

module.exports = { candidates, findExecutable, status, launch, mcpEndpointFile, readMcpEndpoint, mcpRpc, listTools, callTool, createProjectWithMedia, createProjectWithTimeline, importMediaIntoCurrentProject, buildTimelinePlan, toolData };
