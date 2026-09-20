/**
 * 本地版数据客户端
 *
 * 目的：让现有的 1.6 万行前端页面**不用改**，就能从 Supabase 云端切到本地 Node 服务。
 * 做法是复刻 supabase-js 用得到的那部分链式 API，底层换成 fetch 到本地服务。
 *
 * 与 supabase-js 的语义差异（都是刻意简化，不是遗漏）：
 *   - 没有 Realtime、没有 RLS、没有嵌套 select（本项目没用到）
 *   - 没有真实用户体系：本地版打开即用，auth 相关一律返回空用户
 *   - 不支持跨表 join，select('table(col)') 这种写法不会返回关联数据
 */

const API_BASE = (import.meta.env?.VITE_API_BASE as string | undefined) || '';

export interface QueryError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface QueryResult<T> {
  data: T | null;
  error: QueryError | null;
}

/** Edge Function 调用失败时前端会 `await error.context.text()`，这里保持同样形状 */
export class InvokeError extends Error {
  context: { text: () => Promise<string> };
  status?: number;
  errorType?: string;

  constructor(message: string, status?: number, errorType?: string) {
    super(message);
    this.name = 'InvokeError';
    this.status = status;
    this.errorType = errorType;
    this.context = { text: async () => message };
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: text || `请求失败 (${resp.status})` };
  }
  if (!resp.ok) {
    const obj = (parsed || {}) as { error?: string; errorType?: string };
    throw new InvokeError(obj.error || `请求失败 (${resp.status})`, resp.status, obj.errorType);
  }
  return parsed as T;
}

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`);
  const parsed = (await resp.json()) as T & { error?: string };
  if (!resp.ok) throw new InvokeError(parsed.error || `请求失败 (${resp.status})`, resp.status);
  return parsed;
}

type Op = 'select' | 'insert' | 'update' | 'delete' | 'upsert';
type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in' | 'is' | 'contains';

interface Filter {
  op: FilterOp;
  column: string;
  value: unknown;
}

interface Order {
  column: string;
  ascending?: boolean;
}

/**
 * 链式查询构造器。
 * 关键约定：select() 在 insert/update/delete **之后**调用表示「返回受影响的行」，
 * 这与 supabase-js 一致 —— 很多页面靠 `insert(x).select().single()` 拿回新记录。
 */
class QueryBuilder<T = unknown> implements PromiseLike<QueryResult<T>> {
  private table: string;
  private op: Op = 'select';
  private selectCols: string = '*';
  private filters: Filter[] = [];
  private orderBy: Order | null = null;
  private limitCount: number | null = null;
  private singleMode: 'none' | 'single' | 'maybeSingle' = 'none';
  private returning: boolean = false;
  private payload: unknown = null;
  private onConflictCol: string | null = null;

  constructor(table: string) {
    this.table = table;
  }

  select(cols: string = '*'): this {
    if (this.op === 'select') {
      this.selectCols = cols;
    } else {
      // insert/update/delete 之后 → 表示要返回受影响行
      this.returning = true;
      if (cols) this.selectCols = cols;
    }
    return this;
  }

  insert(payload: unknown): this {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }

  upsert(payload: unknown, opts?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.payload = payload;
    this.onConflictCol = opts?.onConflict || null;
    return this;
  }

  update(payload: unknown): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this { return this.filter('eq', column, value); }
  neq(column: string, value: unknown): this { return this.filter('neq', column, value); }
  gt(column: string, value: unknown): this { return this.filter('gt', column, value); }
  gte(column: string, value: unknown): this { return this.filter('gte', column, value); }
  lt(column: string, value: unknown): this { return this.filter('lt', column, value); }
  lte(column: string, value: unknown): this { return this.filter('lte', column, value); }
  like(column: string, value: unknown): this { return this.filter('like', column, value); }
  ilike(column: string, value: unknown): this { return this.filter('ilike', column, value); }
  in(column: string, value: unknown): this { return this.filter('in', column, value); }
  is(column: string, value: unknown): this { return this.filter('is', column, value); }
  contains(column: string, value: unknown): this { return this.filter('contains', column, value); }

  private filter(op: FilterOp, column: string, value: unknown): this {
    this.filters.push({ op, column, value });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending ?? true };
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  single(): this {
    this.singleMode = 'single';
    return this;
  }

  maybeSingle(): this {
    this.singleMode = 'maybeSingle';
    return this;
  }

  /** 真正发请求。返回形状与 supabase-js 一致：{ data, error }，永不抛异常 */
  async execute(): Promise<QueryResult<T>> {
    try {
      const result = await postJson<{ data: unknown; error: QueryError | null }>('/api/db', {
        table: this.table,
        op: this.op,
        select: this.selectCols,
        filters: this.filters,
        order: this.orderBy,
        limit: this.limitCount,
        single: this.singleMode === 'single',
        payload: this.payload,
        returning: this.returning,
        onConflict: this.onConflictCol,
      });
      // single() 在无结果时 supabase 会置 error，maybeSingle 则 data=null 不报错
      if (this.singleMode === 'single' && result.data == null && !result.error) {
        return { data: null, error: { message: '未找到记录' } };
      }
      return { data: result.data as T, error: result.error };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  then<R1 = QueryResult<T>, R2 = never>(
    onFulfilled?: ((value: QueryResult<T>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onFulfilled, onRejected);
  }
}

/** Edge Function 名 → 本地路由 */
const FUNCTION_ROUTES: Record<string, string> = {
  'ai-generate': '/api/ai/generate',
  'ai-generate-image': '/api/ai/image',
  'sync-models': '/api/ai/models',
  'save-api-config': '/api/ai/config/save',
};

interface StorageBucket {
  upload(path: string, file: Blob | File, _opts?: Record<string, unknown>): Promise<{ data: { path: string } | null; error: QueryError | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
  remove(paths: string[]): Promise<{ data: unknown; error: QueryError | null }>;
}

function makeBucket(): StorageBucket {
  return {
    async upload(path, file) {
      try {
        const name = path.includes('/') ? path.split('/').pop() || path : path;
        const resp = await fetch(`${API_BASE}/api/media/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            // 中文文件名经过 latin1 编码，服务端按 utf8 解回来
            'x-file-name': encodeURIComponent(name),
          },
          body: file,
        });
        const parsed = (await resp.json()) as { url?: string; path?: string; error?: string };
        if (!resp.ok || parsed.error) {
          return { data: null, error: { message: parsed.error || '上传失败' } };
        }
        return { data: { path: parsed.path || '' }, error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
    getPublicUrl(path: string) {
      return { data: { publicUrl: `${API_BASE}/api/files/${path}` } };
    },
    async remove() {
      // 本地版不实际删除文件，只返回成功，避免误删素材
      return { data: [], error: null };
    },
  };
}

/** 本地版没有用户体系，auth 一律返回空会话 */
const auth = {
  async getUser() {
    return { data: { user: null }, error: null };
  },
  async getSession() {
    return { data: { session: null }, error: null };
  },
  async signInWithPassword() {
    return { data: { user: null, session: null }, error: null };
  },
  async signUp() {
    return { data: { user: null, session: null }, error: null };
  },
  async signOut() {
    return { error: null };
  },
  async updateUser() {
    return { data: { user: null }, error: null };
  },
  onAuthStateChange(_cb: (event: string, session: unknown) => void) {
    // 立即回调一次（未登录），保持与 supabase 行为一致
    Promise.resolve().then(() => _cb('INITIAL_SESSION', null));
    return { data: { subscription: { unsubscribe() { /* noop */ } } } };
  },
};

export const localSupabase = {
  // 默认 any：与 supabase-js 一致，页面普遍直接访问 data.id / data.error 等属性
  from<T = any>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table);
  },
  functions: {
    async invoke<T = any>(name: string, opts?: { body?: unknown }): Promise<{ data: T | null; error: InvokeError | null }> {
      const route = FUNCTION_ROUTES[name];
      if (!route) {
        return { data: null, error: new InvokeError(`本地版未实现的接口: ${name}`, 404) };
      }
      try {
        const data = await postJson<{ data?: unknown; error?: string }>(route, opts?.body || {});
        return { data: (data.data ?? data) as T, error: null };
      } catch (e) {
        if (e instanceof InvokeError) return { data: null, error: e };
        return { data: null, error: new InvokeError(e instanceof Error ? e.message : String(e)) };
      }
    },
  },
  storage: {
    from(_bucket: string): StorageBucket {
      return makeBucket();
    },
  },
  auth,
  /** 本地版扩展：直接访问本地 HTTP 接口 */
  api: {
    get: getJson,
    post: postJson,
    base: API_BASE,
  },
};

export type { QueryBuilder };
export default localSupabase;
