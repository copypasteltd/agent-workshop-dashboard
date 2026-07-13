import type { WorkspaceContextSummary, WorkspaceSummary } from "@lingban/contracts";
import { l, type LocalizedString } from "./i18n";

export type DashboardWorkspaceBootstrap = WorkspaceSummary | WorkspaceContextSummary;

export type DashboardWorkspaceView = {
  id: string;
  name: LocalizedString;
  type: LocalizedString;
  meta: LocalizedString;
  root: string;
  contextKey: string;
  selectionId: string;
  runtimeWorkspaceId: string;
  source: "static" | "public" | "auth";
  slug: string | null;
  role: WorkspaceSummary["role"] | null;
  membershipStatus: WorkspaceSummary["membershipStatus"] | null;
  authType: WorkspaceSummary["type"] | null;
};

export function hasAuthoritativeDashboardWorkspaceContext(
  workspace: DashboardWorkspaceView
) {
  return workspace.source === "auth" || workspace.source === "public";
}

function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function workspaceTypeLabel(type: WorkspaceSummary["type"]): LocalizedString {
  switch (type) {
    case "personal":
      return l("个人", "Personal");
    case "team":
      return l("团队", "Team");
    case "enterprise":
    default:
      return l("企业", "Enterprise");
  }
}

function workspaceRoleLabel(role: WorkspaceSummary["role"]): LocalizedString {
  switch (role) {
    case "owner":
      return l("所有者", "Owner");
    case "admin":
      return l("管理员", "Admin");
    case "operator":
      return l("操作员", "Operator");
    case "creator":
      return l("创作者", "Creator");
    case "viewer":
    default:
      return l("查看者", "Viewer");
  }
}

function previewWorkspaceName(): LocalizedString {
  return l("未连接工作区", "Workspace unavailable");
}

function previewWorkspaceType(): LocalizedString {
  return l("未连接", "Unavailable");
}

function previewWorkspaceMeta(): LocalizedString {
  return l("等待会话或目录上下文", "Waiting for session or catalog context");
}

function buildPreviewWorkspaceRoot() {
  return "/workspace/";
}

function resolveWorkspaceRoot(workspace: WorkspaceSummary) {
  if (workspace.root) {
    return workspace.root;
  }

  const normalizedSlug =
    normalizeText(workspace.slug).replace(/[^a-z0-9-]+/g, "-") || workspace.workspaceId;
  return `/workspace/${normalizedSlug}/`;
}

function resolveAuthWorkspaceContextKey(workspace: WorkspaceSummary) {
  return workspace.contextKey || inferWorkspaceContextKey({
    workspaceId: workspace.workspaceId,
    slug: workspace.slug,
    name: workspace.name,
    type: workspace.type,
  });
}

function isCatalogWorkspaceContext(
  workspace: DashboardWorkspaceBootstrap
): workspace is WorkspaceContextSummary {
  return "runtimeWorkspaceId" in workspace && "displayName" in workspace;
}

function matchesWorkspaceSelection(
  workspace: DashboardWorkspaceBootstrap,
  selectionId: string
) {
  if (isCatalogWorkspaceContext(workspace)) {
    return (
      workspace.contextKey === selectionId ||
      workspace.runtimeWorkspaceId === selectionId
    );
  }

  return (
    workspace.workspaceId === selectionId ||
    resolveAuthWorkspaceContextKey(workspace) === selectionId
  );
}

export function inferWorkspaceContextKey(input: {
  workspaceId?: string | null;
  slug?: string | null;
  name?: string | null;
  type?: WorkspaceSummary["type"] | string | null;
}) {
  const type = normalizeText(input.type);
  const haystack = [
    normalizeText(input.workspaceId),
    normalizeText(input.slug),
    normalizeText(input.name),
  ].join(" ");

  if (type === "personal" || haystack.includes("personal") || /个人/.test(haystack)) {
    return "personal";
  }

  if (/harbor|finance|tax|filing|财务|财税|报税/.test(haystack)) {
    return "harbor-finance";
  }

  if (/brand|content|poster|drama|creator|品牌|内容|海报|短剧/.test(haystack)) {
    return "brand-lab";
  }

  if (type === "enterprise" || type === "team") {
    return "brand-lab";
  }

  return "personal";
}

export function buildPreviewDashboardWorkspaceView(
  selectionId?: string | null
): DashboardWorkspaceView {
  const normalizedSelection =
    normalizeText(selectionId).replace(/[^a-z0-9-]+/g, "-") || "workspace";

  return {
    id: normalizedSelection,
    name: previewWorkspaceName(),
    type: previewWorkspaceType(),
    meta: previewWorkspaceMeta(),
    root: buildPreviewWorkspaceRoot(),
    contextKey: normalizedSelection,
    selectionId: selectionId?.trim() || normalizedSelection,
    runtimeWorkspaceId: selectionId?.trim() || normalizedSelection,
    source: "static",
    slug: null,
    role: null,
    membershipStatus: null,
    authType: null,
  };
}

export function buildDashboardWorkspaceViewFromCatalogContext(
  workspace: WorkspaceContextSummary
): DashboardWorkspaceView {
  return {
    id: workspace.contextKey,
    contextKey: workspace.contextKey,
    name: workspace.displayName,
    type: workspaceTypeLabel(workspace.type),
    meta: workspace.meta,
    root: workspace.root,
    selectionId: workspace.contextKey,
    runtimeWorkspaceId: workspace.runtimeWorkspaceId,
    source: "public",
    slug: workspace.contextKey,
    role: null,
    membershipStatus: null,
    authType: workspace.type,
  };
}

export function buildDashboardWorkspaceViewFromAuth(
  workspace: WorkspaceSummary
): DashboardWorkspaceView {
  const contextKey = resolveAuthWorkspaceContextKey(workspace);
  const role = workspaceRoleLabel(workspace.role);
  const meta = l(
    `${role.zh} / ${workspace.slug || workspace.workspaceId}`,
    `${role.en} / ${workspace.slug || workspace.workspaceId}`
  );

  return {
    id: contextKey,
    contextKey,
    name: l(workspace.name, workspace.name),
    type: workspaceTypeLabel(workspace.type),
    meta,
    root: resolveWorkspaceRoot(workspace),
    selectionId: workspace.workspaceId,
    runtimeWorkspaceId: workspace.workspaceId,
    source: "auth",
    slug: workspace.slug,
    role: workspace.role,
    membershipStatus: workspace.membershipStatus,
    authType: workspace.type,
  };
}

function buildDashboardWorkspaceView(
  workspace: DashboardWorkspaceBootstrap
): DashboardWorkspaceView {
  return isCatalogWorkspaceContext(workspace)
    ? buildDashboardWorkspaceViewFromCatalogContext(workspace)
    : buildDashboardWorkspaceViewFromAuth(workspace);
}

export function listDashboardWorkspaceViews(
  workspaces?: DashboardWorkspaceBootstrap[]
) {
  if (workspaces && workspaces.length > 0) {
    return workspaces.map(buildDashboardWorkspaceView);
  }

  return [];
}

export function resolveDashboardWorkspaceView(input: {
  selectionId?: string | null;
  workspaces?: DashboardWorkspaceBootstrap[];
  fallbackWorkspace?: DashboardWorkspaceBootstrap | null;
}) {
  const { selectionId, workspaces, fallbackWorkspace } = input;

  if (workspaces && workspaces.length > 0) {
    const exactMatch = selectionId
      ? workspaces.find((workspace) =>
          matchesWorkspaceSelection(workspace, selectionId)
        )
      : null;
    if (exactMatch) {
      return buildDashboardWorkspaceView(exactMatch);
    }

    if (fallbackWorkspace) {
      return buildDashboardWorkspaceView(fallbackWorkspace);
    }

    return buildDashboardWorkspaceView(workspaces[0]);
  }

  return buildPreviewDashboardWorkspaceView(selectionId ?? null);
}
