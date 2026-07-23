# 灵办词元用户控制台 / Lingban User Dashboard

灵办词元 Dashboard 面向重度用户、Creator 与工作区成员。平台总管理后台已拆分为独立 Admin Console；Dashboard 仅保留受权限控制的外部入口。

Lingban Dashboard serves power users, creators, and workspace members. The platform control plane is deployed as an independent Admin Console; Dashboard keeps only an authorization-gated external link.

## 仓库信息 / Repository

| 项目 / Item | 内容 / Value |
|---|---|
| GitHub | `git@github.com:copypasteltd/agent-workshop-dashboard.git` |
| Monorepo 路径 / Path | `app/dashboard` |
| 主分支 / Branch | `main` |
| 技术栈 / Stack | React 18, Vite 5, TypeScript, React Router, TanStack Query, Zustand, i18next |
| 设计基线 / Design baseline | 方案 C Operator |

## 用户功能 / User Capabilities

| 功能域 / Domain | 能力 / Capabilities |
|---|---|
| 认证与工作区 | 登录、注册、会话刷新、工作区切换、成员权限守卫 |
| 工坊 | 搜索、分类、收藏、工坊与服务详情、启动入口、最近使用 |
| 执行实例 | 多任务筛选、完整 Codex 对话、实时状态、附件、审批和结果 |
| 文件 | target path 文件树、路径导航、预览、下载票据和归档 |
| 批量任务 | 导入、字段映射、校验、估算、启动、重试和取消 |
| Creator | Session Project、空白 Source Run、Capture、Draft、Replay、Seal、Package、Catalog、Release 和 Audit Export |
| 工作区治理 | Provider 绑定、Credential、MCP、Quota、Billing 和成本摘要 |
| 体验基础 | 中英文、明暗主题、通知、全局搜索、抽屉侧栏和响应式布局 |

## 路由 / Routes

| 路由 | 内容 |
|---|---|
| `/workspace/workshops` | 工坊目录、详情、服务、批量任务和启动 |
| `/workspace/instances` | 实例列表、新建空白 Codex、任务对话、文件、运行状态和审批 |
| `/workspace/settings/providers` | 工作区 Provider 路由和默认模型 |
| `/workspace/creator` | Creator 资产、发布和回放治理 |
| `/workspace/creator/governance/:section` | Policy、Audit、Cost 治理视图 |
| `/admin/*` | 跳转到 `VITE_ADMIN_CONSOLE_URL` 指定的独立 Admin Console |
| `/dashboard/*` | 历史链接兼容跳转 |

Dashboard contains no Admin Shell, Admin pages, Admin session state, or internal Admin routes.

## 实例生命周期 / Run Lifecycle

- 实例列表支持当前、失败、取消和归档视图。
- 运行中的实例可执行“停止并释放”；停止阶段锁定消息、附件和审批。
- 已结束且已释放的实例可归档、恢复归档或永久删除。
- `RELEASE_FAILED / ORPHANED` 提供重新释放入口并展示失败原因与清理次数。
- 永久删除使用独立确认窗口；失败后保留实例可见性和错误诊断。
- Runtime 页展示停止时间、释放时间、计费停止时间、记录状态和清理尝试次数。

The instance workspace exposes stop, release retry, archive, restore, and permanent deletion with explicit confirmations and lifecycle diagnostics. Terminal runs remain readable while conversation mutations stay locked.

## 环境变量 / Environment

```env
VITE_API_BASE_URL=http://127.0.0.1:3100
VITE_ADMIN_CONSOLE_URL=http://192.168.31.20:38140/
```

API 地址优先读取运行时配置 `window.__LINGBAN_RUNTIME_CONFIG__.apiBaseUrl`，其次读取 `VITE_API_BASE_URL`，部署环境可按当前主机和正式端口推导。Admin 链接完全独立配置。

API resolution first uses `window.__LINGBAN_RUNTIME_CONFIG__.apiBaseUrl`, then `VITE_API_BASE_URL`, followed by deployment-aware host inference. The Admin URL is configured independently.

## 开发与验证 / Development

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
pnpm preview
```

本地脚本仅使用 Node.js、pnpm、Vite 和浏览器，不会启动 Docker、WSL、Podman 或其他虚拟化环境。

Local scripts use Node.js, pnpm, Vite, and a browser only. They do not start Docker, WSL, Podman, or another virtualization runtime.

## 布局规则 / Layout Rules

- 左侧导航使用可折叠抽屉，折叠后释放内容宽度。
- `1440px`、`1100px`、`560px` 断点处理宽屏、多栏收缩和移动堆叠。
- 实例详情持续保留完整对话，运行信息和文件位于任务详情内部。
- 表单、按钮、状态与文字在各断点保持完整，不产生横向页面溢出。
- 图标统一使用现代扁平图标体系，并提供可访问名称。

The Dashboard and Admin Console have independent interface, route, build, session, and deployment boundaries.

## Session Control / Session Control

- Instance pages open `SessionCaptureDrawer` for terminal or completed-turn checkpoint capture.
- Instance and Creator pages provide `NewInstanceDrawer` for a blank recording Run with explicit Provider, MCP, and Credential references.
- `SessionProjectsPanel` tracks Source Run, Capture, Draft, sealed version, Package, Workshop, and Service IDs.
- Creator opens `SessionAssetWorkbench` for Capture selection, Draft revision, redaction review, Replay Gate, sealing, and Package binding.
- Sealed Source assets can create a draft Workshop, draft Service, immutable Task Version, Package, and candidate Session Binding in one guided flow.
- Raw Capture objects require an access reason and display the latest audited access records.
- The workbench renders as three columns on desktop, two columns on narrow desktop, and one column at the smallest supported viewport.

Verification completed on `1440x1000`, `1024x768`, and `390x844` without horizontal overflow. The complete Dashboard/Admin/H5 E2E suite passes `33/33`.

## 2026-07-20 Production QA / 2026-07-20 生产复验

已部署页面完成工坊、实例、实例详情、Provider 设置和 Creator 路由复验。中文/英文、深色/浅色和抽屉侧栏均可切换；Rail 图标与抽屉开关提供动态可访问名称，纯视觉遮罩从可访问树隐藏。1440x900 与 1024x768 无横向溢出或可见元素越界。

The deployed Dashboard passes route, locale, theme, drawer, and responsive checks. Rail actions and drawer controls expose accessible names, while the visual scrim stays outside the accessibility tree.

## 2026-07-23 会话媒体与视频预览 / Conversation Media and Video Preview

实例会话会解析 Agent 消息中的本地图片和视频引用，并通过 Run 文件预览接口获取短期内联票据。视频使用原生 `<video controls playsInline>`，保持 16:9 容器、metadata 预加载、失败重试和下载兜底。普通附件继续使用文件标签展示。

实例文件页支持 `video` 预览模式，图片、视频、PDF、文本继续使用独立渲染分支。支持 `mp4/webm/mov/m4v/ogv/ogg` 路径识别，实际播放范围取决于客户端解码能力。

Instance conversations and file previews render authorized local videos through short-lived inline tickets. Media parsing remains scoped to the active run target path, and unsupported or failed playback retains a direct download path.

```bash
pnpm typecheck
pnpm lint
pnpm test:message-media
pnpm build
```
