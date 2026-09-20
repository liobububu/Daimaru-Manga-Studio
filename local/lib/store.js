'use strict';
/**
 * 本地数据层
 *
 * 单用户本地版不需要 Postgres。每个表一个 JSON 文件，写入走「临时文件 + rename」，
 * 保证进程被强杀时不会留下半截文件（Concat 的做法也是先 flush 再改名）。
 *
 * 数据目录解析规则（借鉴 Concat 的便携模式）：
 *   1. 可执行文件旁的 portable/ 目录（存在则用，方便整个目录拷走）
 *   2. 可执行文件旁的 data/
 *   3. 开发模式：local/data/
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

let dataDir = null;

/** 判断是否为 Node SEA 单文件运行 */
function isSea() {
  // @ts-ignore sea 只在 SEA 构建中存在
  return typeof require('node:sea') !== 'undefined' && require('node:sea').isSea();
}

/** 应用根目录：SEA 下是可执行文件所在目录，开发下是 local/ 的上级 */
function appRoot() {
  if (isSea()) return path.dirname(process.execPath);
  if (process.env.DONGHUA_APP_ROOT) return path.resolve(process.env.DONGHUA_APP_ROOT);
  // 打包成单文件后 __dirname 不可用（bundle 时传的是 undefined），退回 cwd
  return __dirname ? path.resolve(__dirname, '..', '..') : process.cwd();
}

/**
 * 解析数据目录，首次调用时创建。
 * 便携模式优先：把整个 portable/ 带走即可迁移全部数据。
 */
function resolveDataDir() {
  if (dataDir) return dataDir;
  const root = appRoot();
  const portable = path.join(root, 'portable');

  // 优先级：portable 目录（便携模式）> exe 同级（打包后）> 项目内 local/（开发）
  if (fs.existsSync(portable)) dataDir = path.join(portable, 'data');
  else if (isSea()) dataDir = path.join(root, 'data');
  else dataDir = path.join(root, 'local', 'data');

  fs.mkdirSync(path.join(dataDir, 'tables'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  return dataDir;
}

/** 允许通过环境变量覆盖数据目录（测试用） */
function setDataDir(dir) {
  dataDir = dir;
  fs.mkdirSync(path.join(dataDir, 'tables'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  return dataDir;
}

function tableFile(table) {
  return path.join(resolveDataDir(), 'tables', `${safeName(table)}.json`);
}

/** 表名只允许安全字符，避免路径穿越 */
function safeName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(String(name))) {
    throw new Error(`非法的表名: ${name}`);
  }
  return String(name);
}

const cache = new Map();
/** 每个表一把写锁，避免并发写互相覆盖 */
const writeLocks = new Map();

async function withLock(table, fn) {
  const prev = writeLocks.get(table) || Promise.resolve();
  let release;
  const next = new Promise(r => { release = r; });
  writeLocks.set(table, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function readTable(table) {
  const cached = cache.get(table);
  if (cached) return cached;
  const file = tableFile(table);
  let rows = [];
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    rows = Array.isArray(parsed) ? parsed : (parsed.rows || []);
  } catch (e) {
    if (e && e.code !== 'ENOENT') {
      // 文件损坏：保留现场再继续，避免整个应用起不来
      console.error(`[store] 读取表 ${table} 失败，按空表处理:`, e.message);
      try {
        await fsp.rename(file, `${file}.corrupt-${Date.now()}`);
      } catch { /* 忽略 */ }
    }
    rows = [];
  }
  cache.set(table, rows);
  return rows;
}

async function writeTable(table, rows) {
  const file = tableFile(table);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(rows), 'utf8');
  await fsp.rename(tmp, file); // 原子替换
  cache.set(table, rows);
}

// ─────────────────────────── 查询求值 ───────────────────────────

const OPS = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  like: (a, b) => typeof a === 'string' && likeToRegex(b).test(a),
  ilike: (a, b) => typeof a === 'string' && likeToRegex(b, 'i').test(a),
  in: (a, b) => Array.isArray(b) && b.includes(a),
  is: (a, b) => (b === null ? a === null || a === undefined : a === b),
  contains: (a, b) => {
    if (Array.isArray(a)) return b.every ? b.every(x => a.includes(x)) : a.includes(b);
    if (a && typeof a === 'object') {
      return Object.entries(b).every(([k, v]) => a[k] === v);
    }
    return false;
  },
};

function likeToRegex(pattern, flags = '') {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, flags);
}

function applyFilters(rows, filters = []) {
  let out = rows;
  for (const f of filters) {
    const op = OPS[f.op];
    if (!op) throw new Error(`不支持的过滤操作符: ${f.op}`);
    out = out.filter(row => op(row[f.column], f.value));
  }
  return out;
}

function applyOrder(rows, order) {
  if (!order || !order.column) return rows;
  const dir = order.ascending === false ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[order.column];
    const bv = b[order.column];
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;   // 空值排最后
    if (bv === null || bv === undefined) return -1;
    return av > bv ? dir : -dir;
  });
}

/** 按 select 列表投影列；'*' 或空表示全字段 */
function project(rows, select) {
  if (!select || select === '*' || (Array.isArray(select) && select.length === 0)) return rows;
  const cols = Array.isArray(select) ? select : String(select).split(',').map(s => s.trim());
  return rows.map(row => {
    const out = {};
    for (const c of cols) if (c in row) out[c] = row[c];
    return out;
  });
}

function newId() {
  // 时间与随机混合，保证同毫秒内也不冲突
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** 行是否缺少主键，用于 upsert 判定 */
function upsertKey(row, onConflict) {
  return onConflict ? row[onConflict] : (row.id ?? row.key);
}

async function runQuery(q) {
  const table = safeName(q.table);
  return withLock(table, async () => {
    const rows = await readTable(table);

    switch (q.op) {
      case 'select': {
        let out = applyFilters(rows, q.filters);
        out = applyOrder(out, q.order);
        if (typeof q.limit === 'number') out = out.slice(0, q.limit);
        out = project(out, q.select);
        if (q.single) {
          if (out.length === 0) return { data: null, error: { message: '未找到记录' } };
          return { data: out[0], error: null };
        }
        return { data: out, error: null };
      }

      case 'insert': {
        const payloads = Array.isArray(q.payload) ? q.payload : [q.payload];
        const inserted = payloads.map(p => {
          const row = { ...p };
          if (!row.id) row.id = newId();
          if (!row.created_at) row.created_at = new Date().toISOString();
          row.updated_at = new Date().toISOString();
          rows.push(row);
          return row;
        });
        await writeTable(table, rows);
        return { data: q.returning ? inserted : null, error: null };
      }

      case 'upsert': {
        const payloads = Array.isArray(q.payload) ? q.payload : [q.payload];
        const result = [];
        for (const p of payloads) {
          const key = upsertKey(p, q.onConflict || 'id');
          const idx = rows.findIndex(r => upsertKey(r, q.onConflict || 'id') === key);
          const row = { ...p };
          row.updated_at = new Date().toISOString();
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...row };
            result.push(rows[idx]);
          } else {
            if (!row.id) row.id = newId();
            if (!row.created_at) row.created_at = new Date().toISOString();
            rows.push(row);
            result.push(row);
          }
        }
        await writeTable(table, rows);
        return { data: q.returning === false ? null : result, error: null };
      }

      case 'update': {
        const targets = applyFilters(rows, q.filters);
        const updated = [];
        for (const row of targets) {
          Object.assign(row, q.payload, { updated_at: new Date().toISOString() });
          updated.push(row);
        }
        await writeTable(table, rows);
        return { data: q.returning ? updated : null, error: null };
      }

      case 'delete': {
        const targets = applyFilters(rows, q.filters);
        const targetSet = new Set(targets);
        const rest = rows.filter(r => !targetSet.has(r));
        await writeTable(table, rest);
        return { data: q.returning ? targets : null, error: null };
      }

      default:
        return { data: null, error: { message: `不支持的操作: ${q.op}` } };
    }
  });
}

module.exports = {
  runQuery,
  readTable,
  writeTable,
  resolveDataDir,
  setDataDir,
  newId,
  safeName,
  isSea,
  appRoot,
};
