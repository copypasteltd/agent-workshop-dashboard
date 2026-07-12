# 灵办词元控制台 / Lingban Dashboard

## 仓库定位 / Repository Role

本目录是面向重度用户与 creator 的 Web Dashboard，位于 `app/dashboard`，属于拆分分支 `agent-workshop-app` 的前端主站部分。

This directory contains the Web Dashboard for power users and creators. It lives at `app/dashboard` and forms the heavy-use web frontend in the `agent-workshop-app` branch.

## 产品职责 / Product Scope

- 工坊目录浏览、筛选、详情与启动入口
- 多任务实例列表、运行状态、会话详情与文件查看
- Creator 工作台、发布视图、治理与审计面板
- 多语言、明暗主题、抽屉式侧边栏与高信息密度布局

## 代码结构 / Code Structure

| 路径 | 作用 | 关键文件 |
| --- | --- | --- |
| `src/app/` | 应用壳、provider、router、shell | `App.tsx`, `DashboardShell.tsx`, `router/AppRouter.tsx` |
| `src/pages/workshops/` | 工坊目录与详情入口 | `WorkshopsPage.tsx` |
| `src/pages/instances/` | 实例列表、运行态视图、任务会话主页面 | `InstancesPage.tsx` |
| `src/pages/creator/` | Creator 工作台、发布与治理 | `CreatorPage.tsx`, `CreatorGovernancePanel.tsx` |
| `src/components/` | 认证屏、基础图标与复用组件 | `DashboardAuthScreen.tsx`, `IconSprite.tsx` |
| `src/lib/` | API、路由、i18n、实时流、主题、工作区上下文 | `api.ts`, `runStream.ts`, `i18n.ts`, `workspaceContext.ts` |
| `src/stores/` | 认证态与 UI 态 | `dashboardAuthStore.ts`, `dashboardUiStore.ts` |
| `src/styles/` | 原型样式与设计 token | `prototype.css`, `tokens.css` |

## 技术栈 / Tech Stack

- React 18
- Vite 5
- TypeScript
- React Router
- Zustand
- TanStack Query
- i18next / react-i18next

## 共享依赖 / Shared Packages

| 包 | 用途 |
| --- | --- |
| `@lingban/api-sdk` | API 调用层 |
| `@lingban/contracts` | 类型与契约 |
| `@lingban/domain-models` | 运行态与业务模型 |
| `@lingban/ui-tokens` | 视觉 token |
| `@lingban/realtime` | 实时订阅能力 |

## 开发命令 / Commands

```bash
pnpm -C app/dashboard dev
pnpm -C app/dashboard build
pnpm -C app/dashboard preview
pnpm -C app/dashboard lint
pnpm -C app/dashboard typecheck
```

## 视觉与交互约束 / Interaction Notes

- 以方案 C 原型为正式方向
- 左侧导航为抽屉式折叠结构
- 页面拆分优先保证可读性，不堆叠过高密度信息
- 实例详情页必须支持完整对话模式，不做静态运行日志页

## 当前状态 / Current Status

当前已经落地应用壳、路由、主题、多语言框架和原型级页面结构。后续主要工作是把真实 API、工作区权限、实时 run 流与 creator 发布流完整接入。
