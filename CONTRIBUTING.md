# 贡献指南

本项目是**本地版**：单文件 exe、数据存本机、可接任意 OpenAI 兼容 API、没有登录与管理员。

## 开发流程

```bash
npm install
npm run build        # 构建前端到 dist/
npm run server       # 启动本地服务 http://127.0.0.1:5178
```

前端热更新另开终端跑 `npm run dev`，并在 `.env` 写 `VITE_API_BASE=http://127.0.0.1:5178`。

提交前：

```bash
npm run typecheck
npm run lint
npm run test:local   # 逻辑冒烟 + HTTP 端到端
```

## 分支与提交

- 分支：`feat/xxx`、`fix/xxx`、`docs/xxx`
- 提交信息写清「改了什么」和「为什么」，不要只写「修复 bug」

## 代码约定

### 前端（`src/`）

- **不要引任何云端 SDK**（项目已移除 supabase-js）。数据访问统一走 `@/db/client`，它导出的 `db` 是本地客户端——复刻了原本用得到的链式 API（from/select/insert/update/delete/eq/order/limit/single …），底层走本地 HTTP。
- `local-client` 只实现了项目真正用到的那部分 PostgREST 语义。要加新的查询能力（比如 `.or()`、嵌套 select），**先确认服务端 `local/lib/store.js` 支持**，两边对齐了再加。
- 环境变量要同步三处：`src/vite-env.d.ts`、`.env.example`、`README.md` 的表格。

### 服务端（`local/`）

- **纯 Node，不引第三方依赖**。单文件 exe 打包时少一个依赖就少一处风险；`ffmpeg-static` 是唯一的可选依赖（找不到就降级到系统 PATH）。
- 新接口加在 `local/routes/` 下，再到 `local/server.js` 的路由表注册。
- 写操作（POST/PUT/DELETE）已统一校验 `Origin`，别绕过。
- 响应统一走 `sendJson`，它对 JSON 接口带了 `no-store`（状态类接口被浏览器启发式缓存时，症状是「数据已更新但界面还是旧的」）。

### OpenAI 兼容规则只有一份实现

端点解析（`/v1` 探测、超时、错误分类）集中在 `local/lib/openai.js`。
云端版已移除，不再需要同步两份。

已有测试覆盖关键形态：OpenAI 带 `/v1`、DeepSeek 不带、智谱版本段在第三段
（`/api/paas/v4/...` 这种最容易漏判——只看路径第一段会被错误地加上 `/v1`）。

### 剪辑层（`local/lib/timeline.js` + `ffmpeg.js`）

改动前先跑 `npm run test:local`，里面有针对这些语义的断言：

- 分割点的时长守恒、按 speed 换算源偏移
- 反转片段的源偏移镜像
- head trim 不越过源素材起点
- NaN / Infinity 一律拒绝

这些行为是在参考 Concat 的剪辑语义后独立实现的，改动前先想清楚会不会破坏上述不变式。

## 打包

```bash
npm run build && npm run build:exe
```

产物 `dist-exe/动画大丸家.exe`。打包脚本会自动做一次冒烟自检（真启动 exe 请求 health 与首页）。

关于打包的已知约束见 `build/build-exe.mjs` 顶部注释，其中几条是踩过的坑（SEA 里 `require` 不解析相对路径、sentinel fuse 要从二进制挖、postject 要用 Node API）。

## 安全红线

- 不要把 `.env` 或任何真实密钥提交进仓库
- 不要新增「不校验用户身份就读配置」的接口（本地版没有用户体系，但远端部署时这类洞会直接导致密钥被盗用）
- 上传文件名一律 `path.basename()`，不要只过滤特殊字符
- 前端永远不要 select 或打印 `encrypted_api_key`
