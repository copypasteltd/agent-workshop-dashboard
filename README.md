# 灵办词元控制台 / Lingban Dashboard

灵办词元 Web 控制台面向重度用户、Creator、工作区管理员与平台管理员。工作区控制台和平台管理后台使用独立 Shell、路由与权限边界。

The Lingban Dashboard serves power users, creators, workspace administrators, and platform administrators. Workspace and platform administration surfaces have separate shells, routes, and authorization boundaries.

## 仓库信息 / Repository

| 项目 | 内容 |
| --- | --- |
| GitHub | `git@github.com:copypasteltd/agent-workshop-dashboard.git` |
| Monorepo 路径 | `app/dashboard` |
| 主分支 | `main` |
| 技术栈 | React 18、Vite 5、TypeScript、React Router、TanStack Query、Zustand、i18next |
| 设计基线 | 方案 C Operator |

The component uses internal `workspace:*` packages. Source development runs from the monorepo workspace; standalone release exports include the complete dependency closure.

## 入口与路由 / Entry Points

| 路由 | 受众 | 内容 |
| --- | --- | --- |
| `/` | 已认证用户 | 按角色进入工作区控制台或平台后台 |
| `/workspace/workshops` | 工作区成员 | 工坊目录、详情、服务、批量任务与启动入口 |
| `/workspace/instances` | 工作区成员 | 多实例列表、任务详情、对话、文件、运行态与审批 |
| `/workspace/settings/providers` | 工作区管理员 | 工作区 Provider 路由绑定与默认模型选择 |
| `/workspace/creator` | Creator | Package、Session、Release、Replay 与发布治理 |
| `/workspace/creator/governance/:section` | Creator | Policy、Audit、Cost 治理视图 |
| `/admin/overview` | 平台管理员 | 平台总览、健康状态与管理入口 |
| `/admin/providers` | 平台管理员 | 多 Provider 配置、凭证引用、健康检查与启停 |
| `/dashboard/*` | 历史链接 | 保留路径、查询参数和 Hash 的兼容跳转 |

## 功能域 / Product Domains

| 域 | 已实现能力 |
| --- | --- |
| 认证与工作区 | 登录、注册、刷新会话、工作区切换、角色守卫 |
| 工坊 | 搜索、分类、收藏、详情、服务详情、最近使用 |
| 执行实例 | 多任务筛选、完整 Codex 对话、实时状态、附件、审批、结果卡片 |
| 文件 | target path 树、面包屑、预览、下载票据、归档入口 |
| 批量任务 | 文件导入、字段映射、校验、估算、启动、重试、取消 |
| Creator | Package、Session Pack、Release、Gate、Activation、Replay、Audit Export |
| 治理 | Credential、MCP、Quota、Billing、Provider 绑定、成本与审计摘要 |
| 平台管理 | 独立 Admin Shell、Provider 管理、健康检查、默认路由 |
| 体验基础 | 中英文、明暗主题、通知、全局搜索、抽屉式侧栏、响应式布局 |

## 工程结构 / Code Structure

| 路径 | 作用 |
| --- | --- |
| `src/app/router/AppRouter.tsx` | 工作区、Creator、Admin 与兼容路由 |
| `src/app/DashboardShell.tsx` | 工作区导航、抽屉侧栏、搜索、通知与账户菜单 |
| `src/app/AdminShell.tsx` | 平台管理后台独立布局与权限入口 |
| `src/app/providers/DashboardAuthBootstrap.tsx` | 会话恢复、角色识别与认证启动 |
| `src/pages/workshops/` | 工坊、服务、批量任务与启动流程 |
| `src/pages/instances/` | 实例列表、对话、文件、运行与审批详情 |
| `src/pages/creator/` | Creator 资产、发布、回放、审计与成本治理 |
| `src/pages/admin/` | 平台总览与 Provider 管理 |
| `src/pages/providers/` | 平台 Provider 和工作区绑定表单 |
| `src/lib/api.ts` | API SDK、Token 刷新、Provider API 与地址解析 |
| `src/lib/runStream.ts` | WebSocket/SSE 运行事件订阅 |
| `src/lib/i18n.ts` | 国际化资源与语言切换 |
| `src/stores/` | 认证状态和 UI 状态 |
| `src/styles/` | 方案 C 视觉、设计 Token 与响应式规则 |

## API 地址解析 / API Resolution

Dashboard 按以下优先级解析 API：

1. `window.__LINGBAN_RUNTIME_CONFIG__.apiBaseUrl`
2. `VITE_API_BASE_URL`
3. 浏览器运行地址推导：本机使用 `:3100`，部署端口 `38110` 映射到同主机 `:38130`
4. 同源地址

```env
VITE_API_BASE_URL=http://127.0.0.1:3100
```

This resolution order supports immutable static assets with deployment-time API configuration.

## 开发与验证 / Development

在 monorepo 根目录执行：

```bash
pnpm install
pnpm -C app/dashboard dev
pnpm -C app/dashboard typecheck
pnpm -C app/dashboard lint
pnpm -C app/dashboard build
pnpm -C app/dashboard preview
```

## 布局约束 / Layout Rules

- 左侧导航使用可折叠抽屉；折叠后完全释放内容宽度。
- `1440px`、`1100px`、`560px` 断点分别处理宽屏、多栏收缩与移动堆叠。
- 页面分区使用平面布局，卡片仅承载重复实体、工具或弹窗。
- 实例详情持续保留完整对话，运行信息和文件作为任务内详情视图。
- Provider、Creator 治理和批量导入表单在窄宽度下保持字段、按钮和文本完整可见。
- 所有图标通过统一现代扁平图标体系输出，并提供可访问名称。

## 当前状态 / Current Status

截至 2026-07-14，Dashboard 已接入工作区与平台管理两套正式入口。认证启动、旧路由迁移、Provider 查询兼容、Creator 数据装载、响应式网格和窄屏表单已完成稳定性修复。

As of 2026-07-14, both workspace and platform administration consoles are connected to the live API. Authentication bootstrap, legacy route migration, provider query compatibility, creator data loading, responsive grids, and narrow-screen forms have been stabilized.

| 验证项 | 结果 |
| --- | --- |
| Oxlint | 0 warning / 0 error |
| TypeScript | 通过 |
| Vite production build | 通过 |
| Playwright 双端 E2E | 23/23 通过 |
| Dashboard 页面状态视觉检查 | 52/52 通过 |
| 工作区验收地址 | `http://192.168.31.20:38110/workspace/workshops` |
| 平台后台验收地址 | `http://192.168.31.20:38110/admin/overview` |

生产环境仍需持续补齐真实流量下的性能基线、可访问性审计、国际化文案全量校对与浏览器兼容矩阵。

Production follow-up covers load baselines, accessibility audits, complete translation review, and the supported-browser matrix.
