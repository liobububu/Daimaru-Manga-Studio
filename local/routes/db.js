'use strict';
/**
 * 通用表 CRUD
 * 前端兼容层把 Supabase 的链式调用翻译成这里的统一查询描述。
 */

const store = require('../lib/store');

/** 与 store 支持的过滤操作符保持一致，前端传别的直接拒绝 */
const ALLOWED_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is', 'contains'];

function validate(q) {
  if (!q || typeof q !== 'object') throw new Error('缺少查询体');
  if (!q.table) throw new Error('缺少 table');
  if (!['select', 'insert', 'update', 'delete', 'upsert'].includes(q.op)) {
    throw new Error(`不支持的操作: ${q.op}`);
  }
  for (const f of q.filters || []) {
    if (!ALLOWED_OPS.includes(f.op)) throw new Error(`不支持的过滤操作符: ${f.op}`);
    if (typeof f.column !== 'string' || !/^[A-Za-z0-9_.]+$/.test(f.column)) {
      throw new Error(`非法的列名: ${f.column}`);
    }
  }
}

async function query(body) {
  validate(body);
  const result = await store.runQuery(body);
  // 保持与 supabase-js 一致的返回形状
  return { data: result.data ?? null, error: result.error };
}

module.exports = { query };
