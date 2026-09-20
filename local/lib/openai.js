'use strict';
/**
 * OpenAI 兼容协议接入层（本地版）
 *
 * 端点探测 / 超时 / 错误分类的规则集中在这一个文件里：
 *   1. 尊重用户在配置里显式写出的完整路径；
 *   2. 未显式写出版本段时，生成候选 URL 并依次探测；
 *   3. 只对「路由不存在」（404/405/501）继续探测，认证失败、参数错误、限流立即返回。
 */

function isVersionSegment(seg) {
  return /^v\d+$/.test(seg);
}

function trimSlashes(s) {
  return String(s).replace(/^\/+/, '').replace(/\/+$/, '');
}

function baseHasVersion(base) {
  const last = trimSlashes(base).split('/').pop() || '';
  return isVersionSegment(last);
}

/**
 * 路径中任意一段是版本段即视为已带版本。
 * 只看第一段是不够的：智谱的路径是 /api/paas/v4/chat/completions，
 * 版本段在第三段，判定漏了就会拼成 /v1/api/paas/v4/... 而白白浪费一次 404。
 */
function pathHasVersion(p) {
  return trimSlashes(p).split('/').some(isVersionSegment);
}

/** 生成候选 URL：base 或 path 已带 /vN 时只有一个候选，否则先试 /v1 再回退 */
function endpointCandidates(baseUrl, endpointPath) {
  const p = String(endpointPath).startsWith('/') ? endpointPath : `/${endpointPath}`;
  const b = trimSlashes(baseUrl);
  if (baseHasVersion(b) || pathHasVersion(p)) return [`${b}/${trimSlashes(p)}`];
  return [`${b}/v1/${trimSlashes(p)}`, `${b}/${trimSlashes(p)}`];
}

/** 点分路径取值，支持数组下标 */
function getByPath(obj, path) {
  return String(path)
    .split('.')
    .reduce((acc, key) => {
      if (acc == null) return undefined;
      if (Array.isArray(acc)) return acc[Number(key)];
      return acc[key];
    }, obj);
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return 'upstream_auth';
  if (status === 404) return 'upstream_not_found';
  if (status === 429) return 'upstream_rate';
  return 'upstream_error';
}

function isRetryableStatus(status) {
  return status === 404 || status === 405 || status === 501;
}

class UpstreamError extends Error {
  constructor({ errorType, status, message, attempted }) {
    super(message);
    this.name = 'UpstreamError';
    this.errorType = errorType;
    this.status = status;
    this.attempted = attempted;
  }
}

async function fetchCompat(candidates, options = {}) {
  const { method = 'POST', headers = {}, body = null, timeoutMs = 120000 } = options;
  const attempted = [];
  let lastStatus;
  let lastMessage = '';

  for (const url of candidates) {
    attempted.push(url);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      if (isTimeout && attempted.length < candidates.length) {
        lastStatus = undefined;
        lastMessage = `请求超时（${timeoutMs}ms）`;
        continue;
      }
      throw new UpstreamError({
        errorType: isTimeout ? 'timeout' : 'network',
        message: isTimeout
          ? `请求上游超时（${Math.round(timeoutMs / 1000)} 秒）。可在配置中调大超时时间。`
          : `无法连接上游服务：${e && e.message ? e.message : String(e)}`,
        attempted,
      });
    }

    if (response.ok) return { response, url };

    lastStatus = response.status;
    try {
      lastMessage = (await response.text()).slice(0, 300);
    } catch {
      lastMessage = '（无法读取响应体）';
    }

    if (isRetryableStatus(response.status) && attempted.length < candidates.length) continue;

    throw new UpstreamError({
      errorType: classifyStatus(response.status),
      status: response.status,
      message: `上游返回 ${response.status}：${lastMessage}`,
      attempted,
    });
  }

  throw new UpstreamError({
    errorType: lastStatus ? classifyStatus(lastStatus) : 'timeout',
    status: lastStatus,
    message: lastStatus ? `上游返回 ${lastStatus}：${lastMessage}` : lastMessage || '请求上游失败',
    attempted,
  });
}

async function readJson(response) {
  try {
    const data = await response.json();
    if (data === null || typeof data !== 'object') {
      throw new UpstreamError({ errorType: 'invalid_response', message: '上游返回内容不是合法的 JSON 对象' });
    }
    return data;
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError({
      errorType: 'invalid_response',
      message: `上游返回内容无法解析为 JSON：${e && e.message ? e.message : String(e)}`,
    });
  }
}

/**
 * 文本生成
 * @param {object} cfg ProviderConfig（含 baseUrl/apiKey/chatCompletionsPath/textResponsePath/timeoutMs/extraParams）
 */
async function generateText(cfg, { prompt, systemPrompt, params = {} }) {
  const body = {
    ...(cfg.extraParams || {}),
    model: cfg.modelId,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: prompt },
    ],
    stream: false,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.max_tokens ?? 4096,
    top_p: params.top_p ?? 0.95,
  };

  const { response, url } = await fetchCompat(endpointCandidates(cfg.baseUrl, cfg.chatCompletionsPath), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    timeoutMs: cfg.timeoutMs,
  });

  const data = await readJson(response);
  const embedded = data.error && data.error.message;
  if (embedded) {
    throw new UpstreamError({ errorType: 'upstream_error', message: String(embedded) });
  }

  const content = getByPath(data, cfg.textResponsePath);
  if (content === undefined || content === null || content === '') {
    const err = new UpstreamError({
      errorType: 'invalid_response',
      message: `模型返回内容为空，已按路径「${cfg.textResponsePath}」取值失败。请在模型配置中检查「文本响应字段路径」。`,
    });
    err.raw = data;
    throw err;
  }

  return { content: typeof content === 'string' ? content : String(content), raw: data, endpoint: url };
}

const IMAGE_FALLBACK_PATHS = ['data', 'images', 'output.images', 'result.images', 'data.images'];

function normalizeImageItem(item) {
  if (typeof item === 'string') {
    return item.startsWith('http') || item.startsWith('data:') ? item : null;
  }
  if (item && typeof item === 'object') {
    const url = item.url || item.image_url || item.image || item.remote_url;
    if (typeof url === 'string' && url) return url;
    const b64 = item.b64_json || item.base64 || item.b64;
    if (typeof b64 === 'string' && b64) {
      return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
    }
  }
  return null;
}

/** 图片生成 */
async function generateImage(cfg, { prompt, negativePrompt, size = '1024x1024', count = 1, style, mode, referenceImages = [], params = {} }) {
  const finalPrompt = style ? `${prompt}, ${style} style` : prompt;
  const body = {
    ...(cfg.extraParams || {}),
    model: cfg.modelId,
    prompt: finalPrompt,
    n: Math.max(1, Math.min(count, 8)),
    size,
    ...params,
  };
  if (negativePrompt) body.negative_prompt = negativePrompt;

  // 图生图 / 多图参考：不同网关字段名不同，同时给出，网关只认自己支持的那个
  if (mode && mode !== 'text2image' && referenceImages.length > 0) {
    body.image = referenceImages[0];
    body.images = referenceImages;
    body.image_url = referenceImages[0];
    body.mode = mode;
  }

  const { response, url } = await fetchCompat(endpointCandidates(cfg.baseUrl, cfg.imagesGenerationsPath), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    timeoutMs: cfg.timeoutMs,
  });

  const data = await readJson(response);
  if (data.error && data.error.message) {
    throw new UpstreamError({ errorType: 'upstream_error', message: String(data.error.message) });
  }

  const candidates = [cfg.imageResponsePath, ...IMAGE_FALLBACK_PATHS.filter(p => p !== cfg.imageResponsePath)];
  let images = [];
  for (const p of candidates) {
    const value = getByPath(data, p);
    const list = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : null;
    if (!list) continue;
    images = list.map(normalizeImageItem).filter(Boolean);
    if (images.length > 0) break;
  }

  if (images.length === 0) {
    const err = new UpstreamError({
      errorType: 'invalid_response',
      message: `未从上游响应中取到图片，已尝试路径「${cfg.imageResponsePath}」及常见结构。`,
    });
    err.raw = data;
    throw err;
  }

  return { images, count: images.length, raw: data, endpoint: url };
}

/** 拉取模型列表（GET models_path） */
async function fetchModels(cfg) {
  const { response } = await fetchCompat(endpointCandidates(cfg.baseUrl, cfg.modelsPath || '/models'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    timeoutMs: Math.min(cfg.timeoutMs, 30000),
  });
  const data = await readJson(response);
  const list = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [];
  return list
    .filter(m => m && typeof m === 'object' && m.id)
    .map(m => ({ id: String(m.id), owned_by: m.owned_by || null }));
}

module.exports = {
  endpointCandidates,
  getByPath,
  fetchCompat,
  readJson,
  generateText,
  generateImage,
  fetchModels,
  UpstreamError,
  classifyStatus,
};
