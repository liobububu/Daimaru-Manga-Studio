/**
 * 数据客户端入口
 *
 * 本地版：连的是本机 Node 服务（见 ./local-client.ts），不连任何云端。
 *
 * `local-client` 复刻了 supabase-js 用得到的那部分链式 API，
 * 所以写法仍是 `db.from('projects').select('*').eq(...)` ——
 * 形状看着像 supabase，底下走的是本地 HTTP。
 * 这样是为了让原有页面不用重写，与云端无关。
 */

export { localSupabase as db, localSupabase } from './local-client';
export type { QueryBuilder, QueryError, QueryResult } from './local-client';
