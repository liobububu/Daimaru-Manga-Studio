/**
 * 把本地服务端打包成一个 CommonJS 文件
 *
 * 为什么需要这一步：Node SEA 注入后的主脚本里，`require('./lib/xxx.js')` 会被当成
 * 内置模块名去解析，抛 ERR_UNKNOWN_BUILTIN_MODULE —— 它不按路径找文件。
 * 所以在生成 blob 之前，先把整个 require 图内联成一个文件。
 *
 * 只处理相对路径 require；内置模块（node:fs 等）和第三方包原样保留。
 * 注意 ffmpeg.js 里 `require('ffmpeg-static')` 包在 try 里，不会被内联，运行时找不到就跳过。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 把静态资源目录读成 { 相对路径: base64 }。
 * 不用 sea.getAsset：它在打包后能否取到依赖运行时细节，取不到时症状是「页面 404 但服务正常」，
 * 很难定位。直接内联成 JS 字面量，构建期就能确认内容在不在。
 */
export function collectAssets(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  const walk = (d, prefix) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else out[rel] = fs.readFileSync(full).toString('base64');
    }
  };
  walk(dir, '');
  return out;
}

export function bundle({ entry, localDir, outFile, embedAssets }) {
  const modules = new Map(); // id(相对 localDir 的 posix 路径) -> { file, src }

  const toId = (file) => path.relative(localDir, file).split(path.sep).join('/');

  function resolveDep(fromFile, spec) {
    if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // 内置 / 第三方
    let p = path.resolve(path.dirname(fromFile), spec);
    if (!path.extname(p)) p += '.js';
    return fs.existsSync(p) ? p : null;
  }

  function walk(file) {
    const id = toId(file);
    if (modules.has(id)) return;
    const src = fs.readFileSync(file, 'utf8');
    modules.set(id, { file, src });

    // 找所有 require('...')，仅递归相对路径
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const dep = resolveDep(file, m[1]);
      if (dep) walk(dep);
    }
  }

  walk(path.resolve(entry));

  // 把每个模块里的相对 require 换成 __req('<id>')
  const chunks = [];
  for (const [id, { file, src }] of modules) {
    const rewritten = src.replace(
      /require\(\s*['"]([^'"]+)['"]\s*\)/g,
      (full, spec) => {
        const dep = resolveDep(file, spec);
        if (!dep) return full; // 内置模块 / 第三方包，原样保留
        return `__req(${JSON.stringify(toId(dep))})`;
      },
    );
    chunks.push(`__mods[${JSON.stringify(id)}] = function (require, module, exports, __dirname, __filename) {\n${rewritten}\n};`);
  }

  const entryId = toId(path.resolve(entry));

  const assetsJson = embedAssets && Object.keys(embedAssets).length
    ? `global.__DH_ASSETS__ = ${JSON.stringify(embedAssets)};\n`
    : '';

  const out = `/**
 * 由 build/bundle-server.mjs 自动生成，请勿手改。
 * 源文件：${entryId} 及其 require 图（共 ${modules.size} 个模块）
 */
'use strict';
${assetsJson}
const __mods = Object.create(null);
const __cache = Object.create(null);
// 模块函数的形参就叫 require，会遮蔽外层这个。先存一份原生的，
// 内置模块（node:fs 等）与第三方包必须走它，否则会被当成内联模块去查。
const __nativeRequire = require;

function __req(id) {
  const fn = __mods[id];
  if (!fn) return __nativeRequire(id);
  const cached = __cache[id];
  if (cached) return cached.exports;
  const mod = { exports: {} };
  __cache[id] = mod;
  // __dirname 传 undefined：打包后没有真实路径可言，
  // 需要定位目录的地方（数据目录）统一走 store.appRoot() / process.execPath
  fn(__req, mod, mod.exports, undefined, undefined);
  return mod.exports;
}

${chunks.join('\n\n')}

__req(${JSON.stringify(entryId)});
`;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out, 'utf8');
  return { count: modules.size, outFile, entryId };
}

// 直接运行时：把 local/sea-entry.js 打进 build/bundled-server.cjs
if (process.argv[1] && process.argv[1].endsWith('bundle-server.mjs')) {
  const root = path.resolve(__dirname, '..');
  const result = bundle({
    entry: path.join(root, 'local', 'sea-entry.js'),
    localDir: path.join(root, 'local'),
    outFile: path.join(root, 'build', 'bundled-server.cjs'),
  });
  console.log(`已内联 ${result.count} 个模块 → ${path.relative(root, result.outFile)}`);
}
