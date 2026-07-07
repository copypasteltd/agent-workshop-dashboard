# 灵办词元控制台 / Lingban Dashboard

## 概览 / Overview

本仓库是灵办词元面向重度用户与 Creator 的 Web 控制台，技术栈固定为 React + Vite。控制台负责工坊浏览、实例管理、Creator 工作台与多语言体验。

This repository contains the Lingban web dashboard for power users and creators. The stack is fixed to React + Vite. The dashboard is responsible for workshop discovery, instance management, creator tooling, and multilingual operation.

## 当前范围 / Current Scope

- 工坊页：浏览、筛选、查看工坊入口
- 实例页：run 列表、状态监控、会话视图
- Creator 页：面向后续 session/workshop 构建的工作区
- 抽屉式左侧边栏
- 明暗主题与中英文切换

- Workshops page for discovery and access
- Instances page for run lists, monitoring, and session views
- Creator page for future workshop/session authoring
- Collapsible drawer-style sidebar
- Light/dark themes with Chinese/English localization

## 技术栈 / Tech Stack

- React 18
- Vite 5
- TypeScript
- React Router
- Zustand
- TanStack Query
- i18next + react-i18next
- Workspace-shared packages: `@lingban/api-sdk`, `@lingban/contracts`, `@lingban/domain-models`, `@lingban/ui-tokens`

## 目录结构 / Directory Structure

```text
src/
  app/
  pages/
    workshops/
    instances/
    creator/
  components/
  stores/
  lib/
  data/
  styles/
  assets/
```

## 开发命令 / Scripts

```bash
pnpm dev
pnpm build
pnpm preview
pnpm lint
```

## 开发约束 / Development Notes

- 信息密度需要服务重度操作场景，但不能压垮可读性
- 左侧导航采用抽屉式折叠结构
- 控制台必须支持多语言
- 交互和视觉应与已确认的方案 C 原型保持一致

- Information density should support operational use without overwhelming readability
- The left navigation uses a collapsible drawer model
- The dashboard must support multiple languages
- Interaction and visual structure should stay aligned with the approved style-C prototype

## 状态 / Status

当前仓库已经落位主应用壳、路由、基础页面和样式体系。后续会继续接入真实 run 数据、Creator 工作流与权限治理能力。

The repository already includes the main application shell, routing, base pages, and styling system. Next steps include real run data, creator workflows, and governance features.
