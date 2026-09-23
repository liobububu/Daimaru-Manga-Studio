# WorkBuddy 提交 / 发布交接（v3.0.0）

更新时间：2026-09-23

## 当前状态

本轮优化暂时中止，代码已进入准备提交状态。请不要重做功能设计，也不要清理或回退现有工作区中的功能修改。

本轮重点完成：

- 多集项目按真实集号恢复正确集数与生产阶段。
- 项目重新打开覆盖剧本、分镜、图片、视频、音频、剪辑断点续作。
- 任务中心按当前集生成真实待办队列。
- 图片生产支持一键整集缺图队列、进度、失败重试、停止后续和离开/刷新恢复。
- 视频异步任务固定原始 project / storyboard / API 上下文并支持刷新恢复。
- 音频批量生产支持进度、停止后续、失败重试并冻结批次上下文。
- 剪辑方案按 storyboardId + mediaRole 稳定重绑最新媒体，保留人工剪辑参数。
- 增加跨集、乱序响应、任务并发、项目重开、剪辑重绑等主链回归。

## 提交前必须执行

```powershell
npm.cmd run typecheck
npm.cmd run test:local
npm.cmd run build
```

预期：

- 分集 / 主链专项：44/44
- 本地核心：43/43
- FFmpeg E2E：7/7
- 渲染精度：3/3
- API Smoke：11/11
- TypeScript typecheck 通过
- Production Build 通过

## 打包

```powershell
npm.cmd run build:exe
```

正式发布包应包含：

- `DaimaruMangaStudio.exe`（由 `dist-exe/动画大丸家.exe` 复制并改为 ASCII 文件名）
- `resources/ffmpeg/ffmpeg.exe`

最终 ZIP：

`dist-release/DaimaruMangaStudio-v3.0.0-win-x64.zip`

`dist-exe/`、`dist-release/`、`.openreel-schema-check/` 均不应提交到 Git。

## WorkBuddy 提交要求

1. 先执行 `git status --short`，确认没有真实密钥、local/data、构建产物或临时 OpenReel schema 进入提交。
2. 不要执行 `git reset --hard`、`git clean -fd`，不要丢弃当前工作区修改。
3. 完成上面的 typecheck / test / build 验证；若失败，先修复后再提交。
4. 检查 README、CHANGELOG 与实际能力一致，不要把尚未完成的视频一键整集连续提交写成已完成。
5. 提交当前源码与测试；不要提交 `dist-exe` / `dist-release` 二进制产物。
6. 建议提交信息：

```text
feat: complete multi-episode production resume and batch workflows
```

7. 提交后再次执行 `git status --short`，确认只剩明确不应入库的本地产物，或工作区已干净。
8. 推送前核对 remote 与 branch；不要擅自改 remote、force push 或改写历史。

## 已知后续项（本次不继续优化）

- 视频生产尚未做成与图片完全一致的一键整集连续提交交互。
- 条漫长图真实渲染导出仍待完善。
- OpenReel Desktop 普通前端提交路径仍可继续完善幂等 requestId 与失败片段恢复。
