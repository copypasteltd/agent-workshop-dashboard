import type { WorkspaceSummary } from "@lingban/contracts";
import {
  dashboardWorkspaces,
  type DashboardWorkspace,
} from "../data/dashboardData";
import { l, type LocalizedString } from "./i18n";

export type DashboardWorkspaceView = DashboardWorkspace & {
  contextKey: string;
  selectionId: string;
  runtimeWorkspaceId: string;
  source: "static" | "auth";
  slug: string | null;
  role: WorkspaceSummary["role"] | null;
  membershipStatus: WorkspaceSummary["membershipStatus"] | null;
  authType: WorkspaceSummary["type"] | null;
};

const workspacePresetMap = new Map(
  dashboardWorkspaces.map((workspace) => [workspace.id, workspace])
);

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

function resolveWorkspacePreset(contextKey: string) {
  return workspacePresetMap.get(contextKey) ?? null;
}

function resolveWorkspaceRoot(workspace: WorkspaceSummary, preset?: DashboardWorkspace | null) {
  if (workspace.root) {
    return workspace.root;
  }

  if (preset?.root) {
    return preset.root;
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

export function buildStaticDashboardWorkspaceView(
  contextKey: string
): DashboardWorkspaceView {
  const preset = resolveWorkspacePreset(contextKey);
  if (!preset) {
    throw new Error(`Unknown static dashboard workspace preset: ${contextKey}`);
  }

  return {
    ...preset,
    contextKey: preset.id,
    selectionId: preset.id,
    runtimeWorkspaceId: preset.id,
    source: "static",
    slug: null,
    role: null,
    membershipStatus: null,
    authType: null,
  };
}

export function buildDashboardWorkspaceViewFromAuth(
  workspace: WorkspaceSummary
): DashboardWorkspaceView {
  const contextKey = resolveAuthWorkspaceContextKey(workspace);
  const preset = resolveWorkspacePreset(contextKey);
  const role = workspaceRoleLabel(workspace.role);
  const meta = preset
    ? l(
        `${role.zh} / ${preset.meta.zh}`,
        `${role.en} / ${preset.meta.en}`
      )
    : l(
        `${role.zh} / ${workspace.slug || workspace.workspaceId}`,
        `${role.en} / ${workspace.slug || workspace.workspaceId}`
      );

  return {
    ...(preset ?? {
      id: contextKey,
      name: l(workspace.name, workspace.name),
      type: workspaceTypeLabel(workspace.type),
      meta,
      root: resolveWorkspaceRoot(workspace, null),
      workshopIds: [],
      packageIds: [],
    }),
    id: contextKey,
    contextKey,
    name: l(workspace.name, workspace.name),
    type: workspaceTypeLabel(workspace.type),
    meta,
    root: resolveWorkspaceRoot(workspace, preset),
    selectionId: workspace.workspaceId,
    runtimeWorkspaceId: workspace.workspaceId,
    source: "auth",
    slug: workspace.slug,
    role: workspace.role,
    membershipStatus: workspace.membershipStatus,
    authType: workspace.type,
  };
}

export function listDashboardWorkspaceViews(workspaces?: WorkspaceSummary[]) {
  if (workspaces && workspaces.length > 0) {
    return workspaces.map(buildDashboardWorkspaceViewFromAuth);
  }

  return dashboardWorkspaces.map((workspace) =>
    buildStaticDashboardWorkspaceView(workspace.id)
  );
}

export function resolveDashboardWorkspaceView(input: {
  selectionId?: string | null;
  workspaces?: WorkspaceSummary[];
  fallbackWorkspaceId?: string | null;
}) {
  const { selectionId, workspaces, fallbackWorkspaceId } = input;

  if (workspaces && workspaces.length > 0) {
    const exactMatch = selectionId
      ? workspaces.find((workspace) => workspace.workspaceId === selectionId)
      : null;
    if (exactMatch) {
      return buildDashboardWorkspaceViewFromAuth(exactMatch);
    }

    const contextMatch = selectionId
      ? workspaces.find(
          (workspace) => resolveAuthWorkspaceContextKey(workspace) === selectionId
        )
      : null;
    if (contextMatch) {
      return buildDashboardWorkspaceViewFromAuth(contextMatch);
    }

    const fallbackMatch = fallbackWorkspaceId
      ? workspaces.find((workspace) => workspace.workspaceId === fallbackWorkspaceId)
      : null;
    if (fallbackMatch) {
      return buildDashboardWorkspaceViewFromAuth(fallbackMatch);
    }

    return buildDashboardWorkspaceViewFromAuth(workspaces[0]);
  }

  if (selectionId && workspacePresetMap.has(selectionId)) {
    return buildStaticDashboardWorkspaceView(selectionId);
  }

  return buildStaticDashboardWorkspaceView(dashboardWorkspaces[0].id);
}
