# Overleaf Astra Bot

当前源码／本机版本：**1.0.1**；最新正式发布为 **v1.0**。本次段落范围与单一工作面板改动已在 `main`，尚未包含在旧的 v1.0 安装包中。从 [GitHub Releases](https://github.com/shx2005/overleaf-astra-bot/releases/tag/v1.0) 下载完整安装包，解压后在目录内执行以下安装步骤。安装包包含源码与预构建的 `dist/extension`，本机仍需安装 Node.js 依赖并注册 Native Messaging 宿主。

在 Overleaf 评论或聊天里发送 `@bot 指令`，按需唤醒本机 Codex。每个项目维护一个持久会话；首次先读取整篇论文编译后的 PDF，后续指令延续同一上下文。修改正文前必须点击接受。

A lightweight, local Overleaf assistant using Codex and MCP. One persistent conversation per project, full-PDF initialization, and human-reviewed edits. No always-on model process.

## 使用

```text
@bot 阅读引言，先提出精简第一段的修改建议，保留 LaTeX 命令和引用。
@bot 继续上次讨论，第二个论点应该如何调整？
@bot 更新PDF，然后重新检查结果部分与图表是否一致。
```

- 首次调用：编译整个项目，下载 PDF，渲染所有页面图像，分批送入同一 Codex 会话；不提取或附带 PDF 全文文字，仅附简短的页序／初始化说明。不会只截取前几页。
- 后续调用：恢复项目对应的 `threadId`，保留之前的讨论；不重复导入同一 PDF。通过 `@bot 更新PDF` 显式更新论文快照。
- 审阅框提供 **接受修改**、**拒绝**、**拒绝并继续修改**。第三个操作可以输入下一步指令，在同一个项目会话里生成新建议。
- 接受／拒绝决定按项目保存在本机，下一次 `@bot` 会自动带入同一会话；只有模型成功处理后才清除待同步记录。单独接受或拒绝不会启动模型进程。
- 评论中的 `@bot` 将用户选中的 TeX 原文作为独立文字项发送，并附带前后段落、文件、章节和同线程讨论。子目录路径先校验唯一文件名再访问编辑器；文件读取失败时仍保留捕获的选区文字供讨论，但不能应用未校验的修改。锚点与实时源码不一致、已脱离正文或无法识别时，会明确标记不可用，不拿当前光标猜测。
- 评论选中的词或短语标记修改关注点，允许修改范围是其所在的完整 TeX 段落。bot 可为解决用词问题调整整句句式，但不能改到相邻段落；若你明确要求只改一个词／一句，仍遵守该限制。段落按空行、`\par` 和章节／环境／列表边界识别，普通换行不拆段。跨多个段落的选区需重新选择；接受前仍校验段落和原文。
- 结果框是单一工作面板，新一轮替换上一轮展示；一次只显示当前一处修改，通过“上一处／下一处”切换其他待处理建议。处理完的卡片移除，完整回复留在原评论／聊天；旧的未处理建议仍可切换回来。
- 结果框右上角显示 Codex 最近一次调用的上下文估算、窗口占用比例和距配置 compact 阈值的参考余量。接近阈值时高亮，收到 compact 事件时显示进行中；未收到统计时显示待统计，恢复会话时标注上次值。窗口优先使用 Codex 返回值，悬停可查看本地配置和统计时间。
- 点击拒绝或发送拒绝反馈时，自动将文件、原文、未采用的建议及你的反馈同步到原评论／聊天，合作者可见；普通拒绝只保存和发评论，不启动模型。同步失败时可在当前结果卡重试，重试前检查是否已经发送。
- 输出回复到原来的评论／聊天，使用当前 Overleaf 账号并带 `[bot · GPT-6 Astra]` 前缀。它不是独立的 Overleaf 协作者账号。
- 只响应此浏览器中由你新提交成功的 `@bot` 消息。不会扫描旧消息或自动执行其他协作者的评论。
- 任务结束后关闭 Codex、MCP 和本地桥接进程；历史保留在磁盘。刷新网页不会重置项目会话。

## 安装（macOS / Linux）

需要 Node.js 22+、已登录且有 GPT-6 Astra 权限的 Codex、Google Chrome 和 Poppler。

```bash
# macOS
brew install poppler
# Linux: apt install poppler-utils
npm ci
npm run check
```

1. 打开 `chrome://extensions`，开启开发者模式。
2. 加载未打包的扩展程序，选择本仓库 `dist/extension`。
3. 复制扩展 ID，运行：

```bash
npm run install:host -- --extension-id=YOUR_CHROME_EXTENSION_ID
```

4. 刷新 Overleaf 项目页，在评论或聊天中发送 `@bot 指令`。

安装脚本自动发现本机 Codex 和 Poppler。也可以通过 `AGEAF_CODEX_CLI_PATH`、`AGEAF_PDFTOPPM` 指定路径。脚本在本机生成启动器和 Native Messaging 注册文件，不把个人路径写入仓库。

默认模型为 `gpt-6-astra`，推理强度为 `high`。沿用 Codex 本地登录和配置，包括上下文／自动压缩设置；本地上下文配置不能扩大模型服务端实际容量。

## 更新后的页面恢复

更新或重新加载扩展后，已经打开的 Overleaf 标签页需要刷新整个页面；只切换 `.tex` 文件不会重新加载扩展脚本。若出现“扩展已更新或当前页面与扩展的连接已失效”，先保存正在编辑的内容，点击“已保存，刷新页面”，然后重新发送本次 `@bot` 指令。不会自动重发评论，也不会清空已有项目会话和已保存的审阅决定。

## 数据与会话

- 项目索引、PDF、渲染页面保存在 `~/.overleaf-astra-bot/projects/<projectId>/`。
- 待同步的审阅决定保存在 Chrome 扩展的本地存储中，刷新网页不会丢失；不会随代码上传 GitHub。
- 图片模式只影响后续 PDF 初始化／刷新；升级不会清空已有对话，历史上已发送的 PDF 文字仍留在原会话中。
- Codex 对话历史由 Codex 自身持久保存；`session.json` 记录项目到对话的映射与 PDF 初始化进度。
- 编译失败时停止初始化，不用旧 PDF 冒充新版本。恢复失败时报告错误，不悄悄创建新会话丢弃历史。
- 同一项目使用进程锁，避免多个标签页同时写入一个会话。
- 论文内容会发送给你登录的 Codex 服务。Overleaf Cookie／CSRF 凭据只留在浏览器；本机桥接不复制登录 Cookie。
- MCP 只提供项目读取和提出修改建议的能力。真正的正文写入由浏览器中的明确接受点击执行，并重新校验目标文件与原文。

## 架构

```text
新提交的 @bot 评论/聊天
  → 轻量 Chrome 触发器
  → Native Messaging 宿主（按需）
  → 项目会话锁 + thread/start 或 thread/resume
  → 首次 PDF 全部页面图片初始化
  → Codex ↔ stdio MCP ↔ 临时、认证的本机桥接 ↔ Overleaf
  → 原评论/聊天回复 + 本地修改审阅
  → 退出进程，保留项目会话
```

MCP 工具：`overleaf_list_files`、`overleaf_read_file`、`overleaf_read_selection`、`overleaf_read_comments`、`overleaf_propose_edit`。

## 限制

当前适配 `www.overleaf.com` 和原生 CodeMirror 编辑器。Overleaf 内部接口更新后可能需要维护。图形化模式、自托管域名和 Windows 尚未验证。

同一项目中存在重复 basename 的文件时，编辑器桥接会拒绝操作，以防误改。待确认建议只保留在当前页面，刷新前请接受／拒绝；项目对话历史仍会保留。大型 PDF 会增加首次初始化时间与模型用量。默认任务超时为 30 分钟，PDF 大小上限为 100 MiB，不会静默裁剪文稿。

## 开发与验证

```bash
npm run check
```

`extension/` 是轻量网页入口和审阅界面；`host/` 管理 Codex、MCP、PDF 与持久会话；`scripts/` 负责构建与本机安装；`test/` 覆盖触发、防重、目标文件校验、会话隔离和锁、审阅决定同步及评论锚点校验。

可选运行 `python3 scripts/smoke-session.py`，使用合成两页 PDF 验证真实 Astra 跨进程记忆和 MCP 恢复（会使用已登录账号的模型额度，需要 Codex 和 Poppler 位于 PATH，或配置上述环境变量）。

网页集成测试可以在独立、未共享的 Overleaf 测试项目里验证聊天触发、评论触发、PDF 初始化、跨进程会话恢复和拒绝反馈。不要在合写论文里发送测试消息。

## 来源与许可证

本项目从 [OniReimu/Ageaf](https://github.com/OniReimu/Ageaf) 的本地实验改造中整理而来，基于上游 `2c8ab76`。编辑器桥接、精确替换和 Codex RPC/环境辅助代码沿用或改编自 Ageaf，并保留 MIT 许可证。项目会话管理、PDF 初始化、按需 MCP 桥接和评论唤醒流程在本仓库维护。

独立社区项目，与 Overleaf 或 OpenAI 无官方隶属关系。
