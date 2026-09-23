/**
 * 按模型名推断能力 —— 前端展示与服务端同步模型共用这一份实现。
 *
 * 规则数据在 ./capability-rules.js，两边都从那里读，别再写第二份。
 */

const RULES = require('./capability-rules.js');

const COMPILED = RULES.rules.map(r => ({ re: new RegExp(r.p), caps: r.caps }));
const DEFAULT_CAPS = RULES.default || ['text_generation'];

/**
 * 返回去重后的能力数组。
 * 命中规则但能力为空（如 embedding 类）时返回空数组 —— 这类模型不该被拿去生成内容。
 * 一条规则都没命中则返回默认能力。
 */
function detectCapabilities(modelId) {
  const id = String(modelId || '').toLowerCase();
  const caps = [];
  let matched = false;

  for (const { re, caps: add } of COMPILED) {
    if (!re.test(id)) continue;
    matched = true;
    for (const c of add) {
      if (!caps.includes(c)) caps.push(c);
    }
  }

  return matched ? caps : [...DEFAULT_CAPS];
}

const KNOWN_CAPS = new Set([
  'text_generation', 'image_generation', 'image_edit', 'video_generation',
  'audio_generation', 'audio_recognition', 'multimodal',
]);

function addMetadataValue(caps, value) {
  const text = String(value || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (!text) return;
  if (KNOWN_CAPS.has(String(value))) caps.add(String(value));
  if (/\b(text|chat|completion|language)\b/.test(text)) caps.add('text_generation');
  if (/\b(image|images|vision)\b/.test(text)) caps.add('image_generation');
  if (/\b(image edit|editing|inpaint|outpaint)\b/.test(text)) caps.add('image_edit');
  if (/\b(video|videos)\b/.test(text)) caps.add('video_generation');
  if (/\b(audio|speech|tts|voice)\b/.test(text)) caps.add('audio_generation');
  if (/\b(asr|transcription|speech to text|audio recognition)\b/.test(text)) caps.add('audio_recognition');
  if (/\b(multimodal|multi modal)\b/.test(text)) caps.add('multimodal');
}

function eachMetadataValue(field, fn) {
  if (Array.isArray(field)) field.forEach(fn);
  else if (field && typeof field === 'object') Object.entries(field).filter(([, v]) => v === true).forEach(([k]) => fn(k));
  else if (field != null) fn(field);
}

function addInputModality(caps, value) {
  const text = String(value || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (/\b(image|images|vision|video|videos|audio|speech)\b/.test(text)) caps.add('multimodal');
  if (/\b(asr|transcription|speech to text)\b/.test(text)) caps.add('audio_recognition');
}

function addOutputModality(caps, value) {
  const text = String(value || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (/\b(text|chat|completion|language)\b/.test(text)) caps.add('text_generation');
  if (/\b(image|images|vision)\b/.test(text)) caps.add('image_generation');
  if (/\b(video|videos)\b/.test(text)) caps.add('video_generation');
  if (/\b(audio|speech|tts|voice)\b/.test(text)) caps.add('audio_generation');
}

/** API 元数据优先；有方向的输入/输出字段严格区分理解与生成能力。 */
function detectCapabilitiesFromModel(model) {
  const caps = new Set();
  eachMetadataValue(model && model.capabilities, v => addMetadataValue(caps, v));
  eachMetadataValue(model && model.modalities, v => addMetadataValue(caps, v));
  eachMetadataValue(model && model.input_modalities, v => addInputModality(caps, v));
  eachMetadataValue(model && model.input, v => addInputModality(caps, v));
  eachMetadataValue(model && model.input_types, v => addInputModality(caps, v));
  eachMetadataValue(model && model.output_modalities, v => addOutputModality(caps, v));
  eachMetadataValue(model && model.output, v => addOutputModality(caps, v));
  eachMetadataValue(model && model.output_types, v => addOutputModality(caps, v));
  return caps.size ? [...caps] : detectCapabilities(model && model.id);
}

function diagnoseCapabilitiesFromModel(model) {
  const fields = ['capabilities', 'modalities', 'input_modalities', 'output_modalities', 'input', 'output', 'input_types', 'output_types'];
  const presentFields = fields.filter(key => model && model[key] != null);
  const explicit = new Set();
  eachMetadataValue(model && model.capabilities, v => addMetadataValue(explicit, v));
  if (explicit.size) return { capabilities: [...explicit], source: 'capabilities', presentFields };

  const directional = new Set();
  eachMetadataValue(model && model.input_modalities, v => addInputModality(directional, v));
  eachMetadataValue(model && model.input, v => addInputModality(directional, v));
  eachMetadataValue(model && model.input_types, v => addInputModality(directional, v));
  eachMetadataValue(model && model.output_modalities, v => addOutputModality(directional, v));
  eachMetadataValue(model && model.output, v => addOutputModality(directional, v));
  eachMetadataValue(model && model.output_types, v => addOutputModality(directional, v));
  if (directional.size) return { capabilities: [...directional], source: 'input_output', presentFields };

  const modalities = new Set();
  eachMetadataValue(model && model.modalities, v => addMetadataValue(modalities, v));
  if (modalities.size) return { capabilities: [...modalities], source: 'modalities', presentFields };
  return { capabilities: detectCapabilities(model && model.id), source: 'name_fallback', presentFields };
}

module.exports = { detectCapabilities, detectCapabilitiesFromModel, diagnoseCapabilitiesFromModel };
