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

module.exports = { detectCapabilities };
