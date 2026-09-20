/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 本地服务地址。留空表示同源（打包成 exe 后前端由 Node 服务直接托管，就是同源）。
   * 仅开发模式下前端跑在 vite 自己的端口时才需要填，如 http://127.0.0.1:5178
   */
  readonly VITE_API_BASE?: string;
  /** 可选：Sentry DSN，留空则不上报 */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
