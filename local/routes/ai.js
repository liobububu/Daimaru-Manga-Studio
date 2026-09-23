'use strict';
/**
 * AI 代理：文本生成 / 图片生成 / 模型同步 / 配置管理
 *
 * 沿用原有的端点探测 / 超时 / 错误分类策略（见 ../lib/openai.js），
 * 密钥存在本机并加密，前端永远拿不到明文。
 */

const store = require('../lib/store');
const cryptoLib = require('../lib/crypto');
const openai = require('../lib/openai');

const CONFIG_TABLE = 'api_configs';
const CATALOG_TABLE = 'model_catalog';

/** 从配置行构造 openai.js 需要的 ProviderConfig */
async function toProviderConfig(row, modelId, requiredCapability) {
  if (!row) throw Object.assign(new Error('未找到 API 配置'), { status: 404 });

  const catalog = await store.readTable(CATALOG_TABLE);
  const model = catalog.find(m => m.id === modelId);
  if (!model) throw Object.assign(new Error('未找到模型记录'), { status: 404 });

  const caps = Array.isArray(model.capabilities) ? model.capabilities : [];
  if (requiredCapability && !caps.includes(requiredCapability)) {
    throw Object.assign(
      new Error(`当前模型不具备「${requiredCapability}」能力，请在模型配置中确认该模型已开启对应能力。`),
      { status: 400 },
    );
  }

  const apiKey = await cryptoLib.decryptMaybe(row.encrypted_api_key || '');
  if (!apiKey) throw Object.assign(new Error('该配置未保存有效的 API Key，请重新填写'), { status: 400 });

  const timeoutSec = Number(row.request_timeout_seconds) || 120;

  return {
    id: row.id,
    baseUrl: String(row.base_url || '').replace(/\/+$/, ''),
    apiKey,
    modelId: model.model_id,
    extraParams: row.extra_params || {},
    chatCompletionsPath: row.chat_completions_path || '/chat/completions',
    textResponsePath: row.text_response_path || 'choices.0.message.content',
    imagesGenerationsPath: row.images_generations_path || '/images/generations',
    imageResponsePath: row.image_response_path || 'data',
    modelsPath: row.models_path || '/models',
    timeoutMs: Math.min(Math.max(timeoutSec, 1), 600) * 1000,
  };
}

async function getConfig(apiConfigId) {
  const rows = await store.readTable(CONFIG_TABLE);
  return rows.find(r => r.id === apiConfigId) || null;
}

/** 文本生成 */
async function generate(body) {
  const { apiConfigId, modelId, prompt, systemPrompt, params } = body || {};
  if (!apiConfigId || !modelId || !prompt) {
    throw Object.assign(new Error('缺少必要参数: apiConfigId, modelId, prompt'), { status: 400 });
  }
  const row = await getConfig(apiConfigId);
  const cfg = await toProviderConfig(row, modelId, 'text_generation');
  try {
    const result = await openai.generateText(cfg, { prompt, systemPrompt, params: params || {} });
    return { content: result.content, raw: result.raw, endpoint: result.endpoint };
  } catch (e) {
    throw Object.assign(new Error(e.message), {
      status: 502,
      errorType: e.errorType || 'upstream_error',
      attempted: e.attempted,
    });
  }
}

/** 图片生成 */
async function image(body) {
  const {
    apiConfigId, modelId, prompt, negativePrompt,
    size = '1024x1024', count = 1, style, mode, referenceImageUrl,
    referenceImages = [], params,
  } = body || {};
  if (!apiConfigId || !modelId || !prompt) {
    throw Object.assign(new Error('缺少必要参数: apiConfigId, modelId, prompt'), { status: 400 });
  }
  const row = await getConfig(apiConfigId);
  const cfg = await toProviderConfig(row, modelId, 'image_generation');

  const refs = [
    ...(referenceImageUrl ? [referenceImageUrl] : []),
    ...referenceImages.map(r => r && r.url).filter(Boolean),
  ];

  try {
    const result = await openai.generateImage(cfg, {
      prompt, negativePrompt, size, count, style, mode, referenceImages: refs, params: params || {},
    });
    return { images: result.images, count: result.count, endpoint: result.endpoint };
  } catch (e) {
    throw Object.assign(new Error(e.message), {
      status: 502,
      errorType: e.errorType || 'upstream_error',
      attempted: e.attempted,
    });
  }
}

/** 脱敏：不带密文返回给前端 */
function maskConfig(row) {
  const { encrypted_api_key, ...rest } = row;
  return { ...rest, masked_api_key: row.key_suffix ? `sk-****${row.key_suffix}` : undefined };
}

async function listConfigs() {
  const rows = await store.readTable(CONFIG_TABLE);
  return { data: rows.map(maskConfig) };
}

/** 保存配置：明文 Key 进来，加密后落盘 */
async function saveConfig(body) {
  const { id, name, base_url, api_key } = body || {};
  if (!name || !base_url) {
    throw Object.assign(new Error('缺少必填字段 name / base_url'), { status: 400 });
  }

  const updates = { ...body };
  delete updates.encrypted_api_key;
  delete updates.masked_api_key;

  if (api_key && String(api_key).trim()) {
    const plain = String(api_key).trim();
    if (!cryptoLib.isEncrypted(plain)) {
      updates.encrypted_api_key = await cryptoLib.encrypt(plain);
      updates.key_suffix = plain.slice(-4);
    }
  }
  delete updates.api_key;

  updates.request_timeout_seconds = Math.min(Math.max(Number(updates.request_timeout_seconds) || 120, 1), 600);

  if (id) {
    const result = await store.runQuery({
      table: CONFIG_TABLE, op: 'update', filters: [{ op: 'eq', column: 'id', value: id }],
      payload: updates, returning: true,
    });
    if (!result.data || result.data.length === 0) {
      throw Object.assign(new Error('配置不存在'), { status: 404 });
    }
    return { data: maskConfig(result.data[0]) };
  }

  if (!api_key || !String(api_key).trim()) {
    throw Object.assign(new Error('新增配置必须提供 API Key'), { status: 400 });
  }
  const result = await store.runQuery({
    table: CONFIG_TABLE, op: 'insert', payload: { ...updates, enabled: updates.enabled ?? true },
    returning: true,
  });
  return { data: maskConfig(result.data[0]) };
}

async function deleteConfig(body) {
  const { id } = body || {};
  if (!id) throw Object.assign(new Error('缺少 id'), { status: 400 });
  await store.runQuery({ table: CONFIG_TABLE, op: 'delete', filters: [{ op: 'eq', column: 'id', value: id }] });
  return { data: true };
}

/** 手动/自动写入模型目录 */
async function saveModel(body) {
  const { api_config_id, model_id, display_name, capabilities } = body || {};
  if (!api_config_id || !model_id) {
    throw Object.assign(new Error('缺少 api_config_id / model_id'), { status: 400 });
  }
  const result = await store.runQuery({
    table: CATALOG_TABLE, op: 'upsert',
    payload: {
      api_config_id,
      model_id,
      display_name: display_name || model_id,
      capabilities: capabilities || ['text_generation'],
      source: body.source || 'manual',
      enabled: body.enabled ?? true,
    },
    onConflict: 'model_id',
    returning: true,
  });
  return { data: result.data[0] };
}

async function catalog() {
  const rows = await store.readTable(CATALOG_TABLE);
  return { data: rows };
}

/**
 * 按模型名猜能力。
 *
 * 不猜的代价很大：/models 只返回 id，同步后如果一律标成 text_generation，
 * 用户同步来的图片模型就用不了图片生成，还得自己进配置页一个个改。
 * 这是猜测，猜错了用户在模型配置页改一下即可（手动改过的能力不会被覆盖）。
 */
// 能力判断与前端共用一份规则（shared/capabilities.js），
// 别在这里再写一遍 —— 两边规则不一致时，同一模型前端显示能用、服务端存的却是别的。
const { diagnoseCapabilitiesFromModel } = require('../../shared/capabilities');

/** 从上游 /models 同步模型列表 */
async function models(body) {
  const { apiConfigId, base_url, api_key, models_path, dryRun } = body || {};

  let cfg;
  if (apiConfigId) {
    const row = await getConfig(apiConfigId);
    if (!row) throw Object.assign(new Error('未找到 API 配置'), { status: 404 });
    cfg = {
      baseUrl: String(row.base_url || '').replace(/\/+$/, ''),
      apiKey: await cryptoLib.decryptMaybe(row.encrypted_api_key || ''),
      modelsPath: models_path || row.models_path || '/models',
      timeoutMs: 30000,
    };
  } else {
    // 内联测试：新建配置还没保存时用
    if (!base_url || !api_key) {
      throw Object.assign(new Error('缺少 base_url / api_key'), { status: 400 });
    }
    cfg = { baseUrl: String(base_url).replace(/\/+$/, ''), apiKey, modelsPath: models_path || '/models', timeoutMs: 30000 };
  }

  try {
    const list = await openai.fetchModels(cfg);
    if (dryRun) return { ok: true, count: list.length, models: list.slice(0, 20) };

    if (apiConfigId) {
      for (const m of list) {
        const diagnosis = diagnoseCapabilitiesFromModel(m);
        const autoCaps = diagnosis.capabilities;
        await store.runQuery({
          table: CATALOG_TABLE, op: 'upsert',
          payload: {
            api_config_id: apiConfigId,
            model_id: m.id,
            display_name: m.id,
            capabilities: autoCaps,
            auto_detected_capabilities: autoCaps,
            raw: m,
            source: 'synced',
            enabled: true,
          },
          onConflict: 'model_id',
        });
      }
    }
    return {
      ok: true,
      count: list.length,
      models: list,
      diagnostics: list.map(m => ({ id: m.id, ...diagnoseCapabilitiesFromModel(m) })),
    };
  } catch (e) {
    // 上游问题不当成本服务错误，和 Edge Function 的做法一致
    return { ok: false, errorType: e.errorType || 'network', error: e.message, attempted: e.attempted };
  }
}

module.exports = {
  generate, image, models,
  saveConfig, listConfigs, deleteConfig,
  saveModel, catalog,
};
