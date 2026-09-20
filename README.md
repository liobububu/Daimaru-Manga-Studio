# 动画大丸家 3.0（本地版）

面向短视频、AI 漫剧、条漫创作者的 AI 辅助创作工作台。覆盖从选题策划、剧本生成、分镜脚本、图片 / 视频素材生成、配音、内部剪辑到条漫排版导出的完整流程。

**一句话：双击即用、零依赖、数据全在本机、可接任意 OpenAI 兼容 API。**

## 下载

不想自己构建的话，到 [Releases](https://github.com/liobububu/Daimaru-Manga-Studio/releases) 下载
`DaimaruMangaStudio-vX.Y.Z-win-x64.zip`（当前版本 **v1.0.0**），解压后双击
`DaimaruMangaStudio.exe` 即可 —— 不需要安装 Node 或其它运行时，FFmpeg 也已内置。

> 压缩包内的文件名是 ASCII。中文文件名在 zip 里依赖系统编码，部分解压工具会解成乱码；
> 解压后你可以自行把 exe 改成中文名，不影响运行。

---

## 与 Concat 的关系（先说清楚许可）

剪辑能力的设计参考了 [Concat](https://github.com/jub0t/Concat)（开源 CapCut 替代品）的剪辑语义与工程原则，例如：

- 编辑是**命令 + 文档**：一条命令要么整体生效、要么整体拒绝
- 数值含 `NaN` / `Infinity` 一律拒绝
- 头部裁剪止于源素材起点，画面不会继续滑动
- 反转片段上的剪切按**镜像**处理
- 合并前校验方向、类型、音频流是否一致

**但本项目不含 Concat 的任何代码**，剪辑层是用 FFmpeg 独立实现的，接口与数据结构都是自己设计的。Concat 采用 **AGPL-3.0**，若把它的源码并入，本项目就必须同样以 AGPL 开源；这里只借鉴理念、不合并代码，因此保持 **MIT**。

---

## 功能

| 模块 | 说明 |
| --- | --- |
| 工作台 | 项目管理与进度总览 |
| 爆款选题 / 剧本 / 分镜 | 由模型批量生成，提示词模板可复用 |
| 图片生成 | 文生图 / 图生图 / 多图参考 |
| 视频生成 | 异步任务提交与状态轮询，配置驱动，不绑定厂商 |
| 音频制作 | 声音库 + TTS，支持自定义 TTS 接口 |
| **剪辑台** | 成片输出后的内部剪辑：分割、裁剪、变速、静音、反转、淡入、导出 |
| 素材库 | 图片 / 视频 / 音频 / 文本统一管理 |
| 条漫编辑器 | 分镜排版为长图并导出 |
| 模型配置 | 接入任意 OpenAI 兼容接口，逐项可配 |

**没有的东西**：没有登录、没有注册、没有管理员后台。本地单用户，打开即用。

---

## 快速开始

### 方式一：直接运行打包好的 exe（推荐给使用者）

```
npm run build && npm run build:exe
```

产物在 `dist-exe/动画大丸家.exe`，双击即可（约 84 MB，内含 Node 运行时与前端页面，不需要装 Node）。

- 启动后会自动打开浏览器；关闭控制台窗口即退出
- 数据默认存在 exe 同级目录
- **便携模式**：在 exe 旁边建一个 `portable` 文件夹，数据就会存进去，整个目录拷走即可迁移

### 方式二：开发模式

```bash
npm install
npm run build        # 构建前端
npm run server       # 启动本地服务（默认 http://127.0.0.1:5178）
```

开发时想让前端热更新，另开一个终端跑 `npm run dev`，并在 `.env` 里写：

```
VITE_API_BASE=http://127.0.0.1:5178
```

---

## 接入任意 OpenAI 兼容 API

在「模型配置」里新增一条配置即可，不用改代码。

**最简单：选预设。** 内置 OpenAI、DeepSeek、月之暗面 Kimi、智谱 GLM、硅基流动、火山方舟、通义千问、混元、Ollama、LM Studio、vLLM 等常用端点，选中后自动填好 Base URL 与各端点路径，只需填 API Key。

预设只是省去查文档的起点，各家端点可能调整，请以服务商官方文档为准。

### 完全自定义

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| Base URL | — | 如 `https://api.openai.com/v1` |
| 模型获取方式 | `auto_then_manual` | 自动同步 `/models`，失败则允许手动添加 |
| 模型列表路径 | `/models` | 拼接在 Base URL 后 |
| Chat Completions 路径 | `/chat/completions` | 拼接在 Base URL 后 |
| 文本响应字段路径 | `choices.0.message.content` | 点分路径，从响应 JSON 中取文本 |
| 图片生成路径 | `/images/generations` | 拼接在 Base URL 后 |
| 图片响应列表路径 | `data` | 取不到时按 `data` / `images` / `output.images` 等兜底 |
| 请求超时（秒） | `120` | 范围 1–600 |
| 自定义请求参数 | `{}` | JSON，合并进请求体（优先级低于标准字段） |

### 关于 `/v1` 的自动处理

各家 Base URL 是否带版本段并不统一（OpenAI 官方需要 `/v1`，DeepSeek 官方不带）。规则：

- Base URL 已以 `/vN` 结尾，或路径中已含版本段 → 直接拼，不会拼出 `/v1/v1`
- 都没有 → 先请求 `BaseURL/v1/端点`，返回 404 / 405 / 501 才回退 `BaseURL/端点`

认证失败、参数错误、限流不重试 —— 换地址重试对这些没意义。

---

## 剪辑台

成片输出后，在「剪辑台」做内部剪辑：

- **添加**：从素材库把视频 / 图片 / 音频加进时间线，本地素材会自动探测真实时长
- **分割 / 裁剪**：按时间点分割；裁开头 / 裁结尾
- **变速**：0.25×–3×，时间线时长按倍率缩放
- **音频**：静音、音量、淡入
- **反转**：倒放（剪切会按镜像处理）
- **导出**：H.264 MP4，带进度条

导出在本机完成，不上传任何内容。成片存在数据目录的 `media/exports/` 下。

**需要 FFmpeg。** 程序按以下顺序查找：

1. 环境变量 `DONGHUA_FFMPEG`
2. `ffmpeg-static` 包（开发模式）
3. 应用目录 `resources/ffmpeg/ffmpeg.exe`
4. 系统 PATH

没有 FFmpeg 时，其它功能照常可用，只有导出会失败。

---

## 数据与隐私

- 数据存本机 JSON 文件（每个表一个文件，写入走「临时文件 + rename」，强杀进程不会留下半截文件）
- API Key 用本机随机主密钥 AES-256-GCM 加密存储，**明文不会出现在数据文件里**
- 素材与成片存在数据目录的 `media/` 下

**关于这层加密，说明它的边界**：本地版没有登录密码，无法用口令派生密钥，主密钥是一个存在数据目录下的文件。它能防止密钥明文被误传、误粘贴、误提交，但**防不住本机上的其他程序读取**。真正的安全边界是操作系统账户权限。

本地服务还做了两件必要的事：

- 写操作校验 `Origin`，挡住「浏览任意网页时被静默删数据」这类跨站请求
- 上传文件名一律 `path.basename()`，挡路径穿越

---

## 目录结构

```
├── src/                 前端（React + Vite）
│   ├── db/              client.ts / local-client.ts：本地数据客户端，底层走本地 HTTP
│   └── pages/           页面（含新增的 EditorPage 剪辑台）
├── local/               本地服务端（Node，无任何第三方依赖）
│   ├── server.js        HTTP 服务 + 静态托管
│   ├── lib/
│   │   ├── store.js     JSON 数据层
│   │   ├── crypto.js    API Key 加密
│   │   ├── openai.js    OpenAI 兼容接入（端点探测 / 超时 / 错误分类）
│   │   ├── timeline.js  剪辑命令模型
│   │   └── ffmpeg.js    FFmpeg 渲染
│   ├── routes/          db / ai / media / edit
│   ├── sea-entry.js     单文件 exe 入口
│   └── test/            冒烟测试
├── build/               打包脚本（bundle + SEA + 冒烟）
└── docs/                历史需求与设计文档（部分内容仍描述已移除的登录/管理员，仅供参考）
```

### 关于云端版

这个项目原本有一套云端后端（Supabase：Postgres + Auth + Edge Functions），
本地版**完全不需要它**，相关代码已全部清除。

前端 `src/db/client.ts` 提供的 `db.from(...).select(...)` 写法形状上类似 supabase-js，
是为了让原有页面不用重写——底下走的是本地 HTTP，与云端无关。

---

## 命令

```bash
npm run dev          # 前端开发服务器
npm run build        # 构建前端
npm run server       # 启动本地服务
npm run build:exe    # 打包单文件 exe
npm run typecheck    # 类型检查
npm run lint         # Biome 检查
npm run test:local   # 本地版冒烟测试（逻辑 + HTTP 端到端）
```

## 许可

[MIT](./LICENSE)
