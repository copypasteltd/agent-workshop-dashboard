import type {
  CredentialDetail,
  CredentialLifecycleImpactAction,
  CredentialSummary,
  CredentialUsageResponse,
  CreatorAuditExportRecord,
  CreatorGovernanceSectionSummary,
  McpCallRecord,
  McpBindingRecord,
  McpRegistryEntry,
  QuotaCounter,
  QuotaEvent,
  QuotaOverrideRecord,
  QuotaPolicy,
  WorkspaceInvitationView,
  WorkspaceMemberRecord,
  WorkspaceMembershipStatus,
  WorkspaceRole,
} from "@lingban/contracts";
import { matchesSearchQuery } from "@lingban/domain-models";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  dashboardAuthApi,
  dashboardBillingApi,
  dashboardCreatorApi,
  dashboardCredentialsApi,
  dashboardMcpApi,
  dashboardQuotaApi,
} from "../../lib/api";
import { l, t, type LocalizedString } from "../../lib/i18n";
import {
  billingSourceLabel,
  billingSourceTone,
  formatBillingQuantity,
  formatBillingUsd,
} from "../../lib/billing";
import type { GovernanceSection } from "../../lib/routes";
import { useDashboardAuthStore } from "../../stores/dashboardAuthStore";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

export type GovernanceMetric = {
  label: LocalizedString;
  value: string;
  note: LocalizedString;
};

type GovernanceRow = {
  id: string;
  tone: "" | "active" | "warn" | "success";
  cells: [LocalizedString, LocalizedString, LocalizedString, LocalizedString];
};

export type GovernanceMeta = {
  title: LocalizedString;
  summary: LocalizedString;
  actions: LocalizedString[];
  metrics: GovernanceMetric[];
  headers: [LocalizedString, LocalizedString, LocalizedString, LocalizedString];
  rows: GovernanceRow[];
};

type CreatorGovernancePanelProps = {
  packageId: string;
  section: GovernanceSection;
  meta: GovernanceMeta;
  workspaceLabel: LocalizedString;
  workspaceRuntimeId: string;
  workspaceContextKey: string;
  linkedServiceIds: string[];
};

type CredentialDraft = {
  scope: CredentialSummary["scope"];
  displayName: string;
  provider: string;
  secretKind: CredentialSummary["secretKind"];
  mountMode: CredentialSummary["mountMode"];
  secretValue: string;
  secretRef: string;
  envName: string;
  mountPathTemplate: string;
  rotationDueAt: string;
  notes: string;
};

type CredentialRotateDraft = {
  secretValue: string;
  secretRef: string;
  rotationDueAt: string;
  note: string;
};

type CredentialLifecycleDraft = {
  impactAction: CredentialLifecycleImpactAction;
  note: string;
};

type McpDraft = {
  mcpId: string;
  displayName: string;
  source: McpRegistryEntry["source"];
  transport: McpRegistryEntry["transport"];
  ref: string;
  stdioRefSha256: string;
  riskLevel: McpRegistryEntry["riskLevel"];
  defaultCredentialId: string;
  approvalRequired: boolean;
  tags: string;
  description: string;
};

type BindingDraft = {
  mcpId: string;
  scope: McpBindingRecord["scope"];
  scopeRef: string;
  credentialId: string;
  networkPolicyRef: string;
  approvalRequired: boolean;
  autoAttach: boolean;
  notes: string;
};

type QuotaPolicyDraft = {
  scopeType: QuotaPolicy["scopeType"];
  scopeRefId: string;
  metric: QuotaPolicy["metric"];
  windowType: QuotaPolicy["windowType"];
  limitValue: string;
  softLimitValue: string;
  hardLimitValue: string;
  actionOnSoftLimit: QuotaPolicy["actionOnSoftLimit"];
  actionOnHardLimit: QuotaPolicy["actionOnHardLimit"];
  summaryZh: string;
  summaryEn: string;
  notes: string;
};

type MemberInviteDraft = {
  email: string;
  role: WorkspaceRole;
  note: string;
  expiresInDays: string;
};

type MemberEditDraft = {
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
};

function localizedStatusTone(
  value:
    | CredentialSummary["status"]
    | McpRegistryEntry["status"]
    | McpBindingRecord["status"]
) {
  switch (value) {
    case "active":
      return "success";
    case "needs-rotation":
    case "needs-review":
      return "warn";
    case "disabled":
    case "revoked":
    case "deprecated":
      return "";
    default:
      return "active";
  }
}

function credentialScopeLabel(value: CredentialSummary["scope"]) {
  return value === "workspace" ? l("工作区", "Workspace") : l("用户", "User");
}

function credentialStatusLabel(value: CredentialSummary["status"]) {
  switch (value) {
    case "active":
      return l("已启用", "Active");
    case "needs-rotation":
      return l("待轮换", "Needs rotation");
    case "disabled":
      return l("已停用", "Disabled");
    case "revoked":
    default:
      return l("已吊销", "Revoked");
  }
}

function credentialKindLabel(value: CredentialSummary["secretKind"]) {
  switch (value) {
    case "api-key":
      return l("API Key", "API key");
    case "access-token":
      return l("访问令牌", "Access token");
    case "oauth-token":
      return l("OAuth 令牌", "OAuth token");
    case "json-file":
      return l("JSON 文件", "JSON file");
    case "browser-storage-state":
      return l("浏览器状态", "Browser storage state");
    case "session-cookie":
    default:
      return l("会话 Cookie", "Session cookie");
  }
}

function credentialMountLabel(value: CredentialSummary["mountMode"]) {
  return value === "env" ? l("环境变量", "Env mount") : l("文件挂载", "File mount");
}

function credentialImpactActionLabel(value: CredentialLifecycleImpactAction) {
  switch (value) {
    case "block":
      return l("有活跃运行则阻断", "Block when active runs exist");
    case "allow-active-runs":
      return l("允许现有运行继续", "Allow active runs to continue");
    case "cancel-active-runs":
    default:
      return l("取消现有运行", "Cancel active runs");
  }
}

function runSurfaceLabel(value: CredentialUsageResponse["activeRuns"][number]["entrySurface"]) {
  switch (value) {
    case "dashboard":
      return l("控制台", "Dashboard");
    case "h5":
      return l("H5", "H5");
    case "mini-program":
    default:
      return l("小程序", "Mini program");
  }
}

function runStatusLabel(value: CredentialUsageResponse["activeRuns"][number]["status"]) {
  switch (value) {
    case "CREATED":
      return l("已创建", "Created");
    case "READY":
      return l("已就绪", "Ready");
    case "QUEUED":
      return l("排队中", "Queued");
    case "STARTING":
      return l("启动中", "Starting");
    case "RUNNING":
      return l("运行中", "Running");
    case "WAITING_APPROVAL":
      return l("等待审批", "Waiting approval");
    case "SUCCEEDED":
      return l("已完成", "Succeeded");
    case "FAILED":
      return l("已失败", "Failed");
    case "CANCELLED":
    default:
      return l("已取消", "Cancelled");
  }
}

function runStatusTone(
  value: CredentialUsageResponse["activeRuns"][number]["status"]
): GovernanceRow["tone"] {
  switch (value) {
    case "RUNNING":
    case "READY":
    case "QUEUED":
    case "STARTING":
      return "active";
    case "WAITING_APPROVAL":
      return "warn";
    case "SUCCEEDED":
      return "success";
    case "FAILED":
    case "CANCELLED":
    case "CREATED":
    default:
      return "";
  }
}

function connectorSourceLabel(value: McpRegistryEntry["source"]) {
  switch (value) {
    case "first-party":
      return l("第一方", "First party");
    case "workspace-managed":
      return l("工作区托管", "Workspace managed");
    case "third-party":
    default:
      return l("第三方", "Third party");
  }
}

function connectorTransportLabel(value: McpRegistryEntry["transport"]) {
  switch (value) {
    case "stdio":
      return l("STDIO", "STDIO");
    case "sse":
      return l("SSE", "SSE");
    case "websocket":
      return l("WebSocket", "WebSocket");
    case "http":
    default:
      return l("HTTP", "HTTP");
  }
}

function connectorRiskLabel(value: McpRegistryEntry["riskLevel"]) {
  switch (value) {
    case "low":
      return l("低风险", "Low risk");
    case "medium":
      return l("中风险", "Medium risk");
    case "high":
      return l("高风险", "High risk");
    case "critical":
    default:
      return l("关键风险", "Critical risk");
  }
}

function mcpCallStatusLabel(value: McpCallRecord["status"]) {
  switch (value) {
    case "success":
      return l("成功", "Success");
    case "error":
      return l("错误", "Error");
    case "cancelled":
      return l("已取消", "Cancelled");
    case "rejected":
    default:
      return l("已拦截", "Rejected");
  }
}

function mcpCallStatusTone(value: McpCallRecord["status"]): GovernanceRow["tone"] {
  switch (value) {
    case "success":
      return "success";
    case "error":
    case "rejected":
      return "warn";
    case "cancelled":
    default:
      return "";
  }
}

function riskTone(value: McpRegistryEntry["riskLevel"]): GovernanceRow["tone"] {
  switch (value) {
    case "low":
      return "success";
    case "medium":
      return "active";
    case "high":
    case "critical":
    default:
      return "warn";
  }
}

function bindingScopeLabel(value: McpBindingRecord["scope"]) {
  switch (value) {
    case "workspace":
      return l("工作区", "Workspace");
    case "user":
      return l("用户", "User");
    case "session-version":
      return l("Session 版本", "Session version");
    case "run":
    default:
      return l("运行实例", "Run");
  }
}

function bindingStatusLabel(value: McpBindingRecord["status"]) {
  switch (value) {
    case "active":
      return l("已生效", "Active");
    case "disabled":
      return l("已停用", "Disabled");
    case "needs-review":
    default:
      return l("待复核", "Needs review");
  }
}

function workspaceRoleLabel(value: WorkspaceRole) {
  switch (value) {
    case "owner":
      return l("所有者", "Owner");
    case "admin":
      return l("管理员", "Admin");
    case "creator":
      return l("创作者", "Creator");
    case "operator":
      return l("执行者", "Operator");
    case "viewer":
    default:
      return l("查看者", "Viewer");
  }
}

function workspaceMembershipStatusLabel(value: WorkspaceMembershipStatus) {
  switch (value) {
    case "active":
      return l("已启用", "Active");
    case "suspended":
    default:
      return l("已暂停", "Suspended");
  }
}

function workspaceInvitationStatusLabel(value: WorkspaceInvitationView["invitation"]["status"]) {
  switch (value) {
    case "pending":
      return l("待接受", "Pending");
    case "accepted":
      return l("已接受", "Accepted");
    case "revoked":
      return l("已撤销", "Revoked");
    case "expired":
    default:
      return l("已过期", "Expired");
  }
}

function workspaceMembershipTone(value: WorkspaceMembershipStatus): GovernanceRow["tone"] {
  return value === "active" ? "success" : "warn";
}

function workspaceInvitationTone(
  value: WorkspaceInvitationView["invitation"]["status"]
): GovernanceRow["tone"] {
  switch (value) {
    case "accepted":
      return "success";
    case "pending":
      return "active";
    case "revoked":
    case "expired":
    default:
      return "warn";
  }
}

function canManageWorkspaceMembers(role: WorkspaceRole | null | undefined) {
  return role === "owner" || role === "admin";
}

function allowedManagedWorkspaceRoles(role: WorkspaceRole | null | undefined): WorkspaceRole[] {
  if (role === "owner") {
    return ["admin", "creator", "operator", "viewer"];
  }

  if (role === "admin") {
    return ["creator", "operator", "viewer"];
  }

  return [];
}

function canEditWorkspaceMember(options: {
  currentRole: WorkspaceRole | null | undefined;
  currentUserId: string | null | undefined;
  member: WorkspaceMemberRecord;
}) {
  if (!canManageWorkspaceMembers(options.currentRole)) {
    return false;
  }

  if (options.member.user.userId === options.currentUserId) {
    return false;
  }

  if (options.member.membership.role === "owner") {
    return false;
  }

  if (options.currentRole === "admin" && options.member.membership.role === "admin") {
    return false;
  }

  return true;
}

function quotaScopeLabel(value: QuotaPolicy["scopeType"]) {
  switch (value) {
    case "workspace":
      return l("工作区", "Workspace");
    case "workspace-context":
      return l("工作区上下文", "Workspace context");
    case "service":
      return l("服务", "Service");
    case "task-version":
      return l("任务版本", "Task version");
    case "session-version":
      return l("Session 版本", "Session version");
    case "package":
      return l("Creator 包", "Creator package");
    case "entry-surface":
      return l("入口面", "Entry surface");
    case "user":
    default:
      return l("用户", "User");
  }
}

function quotaMetricLabel(value: QuotaPolicy["metric"]) {
  switch (value) {
    case "active_runs":
      return l("活跃实例数", "Active runs");
    case "daily_runs":
      return l("单日实例数", "Daily runs");
    case "browser_minutes":
      return l("浏览器分钟", "Browser minutes");
    case "model_tokens":
      return l("模型 Token", "Model tokens");
    case "image_credits":
      return l("图像额度", "Image credits");
    case "mcp_calls":
      return l("MCP 调用数", "MCP calls");
    case "storage_bytes":
      return l("存储字节", "Storage bytes");
    case "download_bytes":
      return l("下载流量", "Download bytes");
    case "audit_exports":
      return l("审计导出次数", "Audit exports");
    case "replays":
      return l("回放次数", "Replays");
    case "ws_connections":
    default:
      return l("实时连接数", "Realtime connections");
  }
}

function quotaWindowLabel(value: QuotaPolicy["windowType"]) {
  switch (value) {
    case "instant":
      return l("瞬时", "Instant");
    case "monthly":
      return l("月度", "Monthly");
    case "daily":
    default:
      return l("单日", "Daily");
  }
}

function quotaPolicyStatusLabel(value: QuotaPolicy["status"], enabled: boolean) {
  if (!enabled) {
    return l("已停用", "Disabled");
  }

  switch (value) {
    case "active":
      return l("生效中", "Active");
    case "paused":
      return l("已暂停", "Paused");
    case "draft":
      return l("草稿", "Draft");
    case "replaced":
      return l("已替换", "Replaced");
    case "archived":
    default:
      return l("已归档", "Archived");
  }
}

function quotaEventDecisionLabel(value: QuotaEvent["decision"]) {
  switch (value) {
    case "healthy":
      return l("健康", "Healthy");
    case "warned":
      return l("告警", "Warned");
    case "blocked":
      return l("阻断", "Blocked");
    case "approval_pending":
      return l("待审批", "Approval pending");
    case "approved_override":
      return l("已放行", "Approved override");
    case "rejected_override":
    default:
      return l("已拒绝", "Rejected override");
  }
}

function quotaOverrideStatusLabel(value: QuotaOverrideRecord["status"]) {
  switch (value) {
    case "approved":
      return l("已放行", "Approved");
    case "rejected":
      return l("已拒绝", "Rejected");
    case "expired":
      return l("已过期", "Expired");
    case "pending":
    default:
      return l("待审批", "Pending");
  }
}

function quotaDecisionTone(
  value:
    | QuotaEvent["decision"]
    | QuotaOverrideRecord["status"]
    | QuotaPolicy["status"]
    | "disabled"
) {
  switch (value) {
    case "active":
    case "approved":
    case "approved_override":
    case "healthy":
      return "success" as const;
    case "warned":
    case "approval_pending":
    case "pending":
    case "paused":
    case "draft":
      return "warn" as const;
    case "blocked":
    case "rejected":
    case "rejected_override":
    case "expired":
    case "archived":
    case "replaced":
    case "disabled":
    default:
      return "" as const;
  }
}

function resolveQuotaDraftScopeRefId(
  scopeType: QuotaPolicyDraft["scopeType"],
  draftValue: string,
  context: {
    workspaceRuntimeId: string;
    workspaceContextKey: string;
    packageId: string;
  }
) {
  const explicit = draftValue.trim();
  if (explicit) {
    return explicit;
  }

  switch (scopeType) {
    case "workspace":
      return context.workspaceRuntimeId;
    case "workspace-context":
      return context.workspaceContextKey;
    case "package":
      return context.packageId;
    default:
      return "";
  }
}

function sameText(value: string | null | undefined, fallback = "-") {
  const safe = value?.trim() || fallback;
  return l(safe, safe);
}

function formatIsoLabel(value: string | null | undefined, fallback: LocalizedString) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return sameText(value);
  }

  const output = date.toISOString().slice(0, 16).replace("T", " ");
  return sameText(output);
}

function formatMaybeIso(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function formatDataVolume(bytes: number | null | undefined) {
  if (bytes == null || bytes <= 0) {
    return "-";
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
}

function splitTags(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOptionalString(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSha256Hex(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return /^[a-f0-9]{64}$/i.test(normalized) ? normalized : null;
}

function joinLocalized(
  parts: Array<LocalizedString | string | null | undefined>,
  separator = " / "
) {
  const filtered = parts.filter((part): part is LocalizedString | string =>
    part != null && (typeof part !== "string" || part.trim().length > 0)
  );

  return l(
    filtered
      .map((part) => (typeof part === "string" ? part : part.zh))
      .join(separator),
    filtered
      .map((part) => (typeof part === "string" ? part : part.en))
      .join(separator)
  );
}

function entityDisplayLabel(primary: string | null | undefined, secondary: string | null | undefined) {
  const primaryText = primary?.trim();
  const secondaryText = secondary?.trim();

  if (primaryText && secondaryText && primaryText !== secondaryText) {
    return sameText(`${primaryText} (${secondaryText})`);
  }

  return sameText(primaryText ?? secondaryText);
}

function rowSearchTexts(row: GovernanceRow) {
  return row.cells.flatMap((cell) => [cell.zh, cell.en]);
}

function toGovernanceMetaFragment(summary: CreatorGovernanceSectionSummary) {
  return {
    summary: summary.summary,
    metrics: summary.metrics,
    headers: [
      summary.headers[0],
      summary.headers[1],
      summary.headers[2],
      summary.headers[3],
    ],
    rows: summary.rows.map((row) => ({
      id: row.id,
      tone: row.tone,
      cells: [row.cells[0], row.cells[1], row.cells[2], row.cells[3]],
    })),
  } satisfies Pick<GovernanceMeta, "summary" | "metrics" | "headers" | "rows">;
}

function queryErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function triggerBrowserDownload(fileName: string, blob: Blob) {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Current runtime does not support browser downloads.");
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function GovernanceDataTable({
  headers,
  rows,
  emptyText,
}: {
  headers: [LocalizedString, LocalizedString, LocalizedString, LocalizedString];
  rows: GovernanceRow[];
  emptyText: LocalizedString;
}) {
  const lang = useDashboardUiStore((state) => state.lang);

  return (
    <div className="governance-table">
      <div className="governance-table-head">
        {headers.map((item) => (
          <div className="governance-cell governance-head" key={t(lang, item)}>
            {t(lang, item)}
          </div>
        ))}
      </div>
      <div className="governance-table-body">
        {rows.map((row) => (
          <div className="governance-row" key={row.id}>
            <div className="governance-cell governance-primary" data-label={t(lang, headers[0])}>
              {t(lang, row.cells[0])}
            </div>
            <div className="governance-cell" data-label={t(lang, headers[1])}>
              {t(lang, row.cells[1])}
            </div>
            <div className="governance-cell" data-label={t(lang, headers[2])}>
              <span className={`pill ${row.tone}`}>{t(lang, row.cells[2])}</span>
            </div>
            <div className="governance-cell governance-note" data-label={t(lang, headers[3])}>
              {t(lang, row.cells[3])}
            </div>
          </div>
        ))}
        {rows.length === 0 ? <div className="panel-empty">{t(lang, emptyText)}</div> : null}
      </div>
    </div>
  );
}

function GovernanceField({
  label,
  children,
}: {
  label: LocalizedString;
  children: ReactNode;
}) {
  const lang = useDashboardUiStore((state) => state.lang);

  return (
    <label className="fake-input governance-field">
      <span className="tiny-note">{t(lang, label)}</span>
      {children}
    </label>
  );
}

function GovernanceTextArea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: LocalizedString;
}) {
  const lang = useDashboardUiStore((state) => state.lang);

  return (
    <textarea
      className="composer-input governance-textarea"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={t(lang, placeholder)}
    />
  );
}

function GovernanceSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: LocalizedString }>;
}) {
  const lang = useDashboardUiStore((state) => state.lang);

  return (
    <select
      className="governance-select"
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {t(lang, option.label)}
        </option>
      ))}
    </select>
  );
}

function GovernanceCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: LocalizedString;
}) {
  const lang = useDashboardUiStore((state) => state.lang);

  return (
    <label className="governance-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{t(lang, label)}</span>
    </label>
  );
}

export function CreatorGovernancePanel({
  packageId,
  section,
  meta,
  workspaceLabel,
  workspaceRuntimeId,
  workspaceContextKey,
  linkedServiceIds,
}: CreatorGovernancePanelProps) {
  const lang = useDashboardUiStore((state) => state.lang);
  const authMode = useDashboardAuthStore((state) => state.authMode);
  const authenticated = useDashboardAuthStore((state) => state.authenticated);
  const currentWorkspace = useDashboardAuthStore((state) => state.currentWorkspace);
  const currentUserId = useDashboardAuthStore((state) => state.user?.userId ?? null);
  const queryClient = useQueryClient();
  const authReady = authMode === "required" && authenticated;
  const currentWorkspaceRole = currentWorkspace?.role ?? null;
  const canManageMembers = canManageWorkspaceMembers(currentWorkspaceRole);
  const manageableRoles = allowedManagedWorkspaceRoles(currentWorkspaceRole);
  const [query, setQuery] = useState("");
  const [credentialEditorMode, setCredentialEditorMode] = useState<"create" | "rotate">("create");
  const [policyEditorMode, setPolicyEditorMode] = useState<"registry" | "binding">("registry");
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [invitationActionError, setInvitationActionError] = useState<string | null>(null);
  const [latestInvitationToken, setLatestInvitationToken] = useState<{
    invitationId: string;
    email: string;
    token: string;
  } | null>(null);
  const [inviteDraft, setInviteDraft] = useState<MemberInviteDraft>({
    email: "",
    role: manageableRoles[0] ?? "viewer",
    note: "",
    expiresInDays: "7",
  });
  const [memberDrafts, setMemberDrafts] = useState<Record<string, MemberEditDraft>>({});
  const [credentialDraft, setCredentialDraft] = useState<CredentialDraft>({
    scope: "workspace",
    displayName: "",
    provider: "",
    secretKind: "api-key",
    mountMode: "env",
    secretValue: "",
    secretRef: "",
    envName: "",
    mountPathTemplate: "",
    rotationDueAt: "",
    notes: "",
  });
  const [credentialRotateDraft, setCredentialRotateDraft] = useState<CredentialRotateDraft>({
    secretValue: "",
    secretRef: "",
    rotationDueAt: "",
    note: "",
  });
  const [credentialLifecycleDraft, setCredentialLifecycleDraft] = useState<CredentialLifecycleDraft>({
    impactAction: "block",
    note: "",
  });
  const [mcpDraft, setMcpDraft] = useState<McpDraft>({
    mcpId: "",
    displayName: "",
    source: "third-party",
    transport: "http",
    ref: "",
    stdioRefSha256: "",
    riskLevel: "medium",
    defaultCredentialId: "",
    approvalRequired: false,
    tags: "",
    description: "",
  });
  const [bindingDraft, setBindingDraft] = useState<BindingDraft>({
    mcpId: "",
    scope: "workspace",
    scopeRef: "",
    credentialId: "",
    networkPolicyRef: "",
    approvalRequired: false,
    autoAttach: true,
    notes: "",
  });
  const [auditActionError, setAuditActionError] = useState<string | null>(null);
  const [downloadingAuditExportId, setDownloadingAuditExportId] = useState<string | null>(null);
  const [quotaActionError, setQuotaActionError] = useState<string | null>(null);
  const [showQuotaPolicyForm, setShowQuotaPolicyForm] = useState(false);
  const [quotaOverrideDecisionNote, setQuotaOverrideDecisionNote] = useState("");
  const [quotaPolicyDraft, setQuotaPolicyDraft] = useState<QuotaPolicyDraft>({
    scopeType: "workspace-context",
    scopeRefId: "",
    metric: "daily_runs",
    windowType: "daily",
    limitValue: "12",
    softLimitValue: "10",
    hardLimitValue: "12",
    actionOnSoftLimit: "require_approval",
    actionOnHardLimit: "block",
    summaryZh: "",
    summaryEn: "",
    notes: "",
  });

  const membersQuery = useQuery({
    queryKey: ["dashboard", "workspace", "members", workspaceRuntimeId],
    queryFn: async () => dashboardAuthApi.listWorkspaceMembers(workspaceRuntimeId),
    enabled: authReady && section === "members",
    retry: false,
    staleTime: 30_000,
  });
  const invitationsQuery = useQuery({
    queryKey: ["dashboard", "workspace", "invitations", workspaceRuntimeId],
    queryFn: async () => dashboardAuthApi.listWorkspaceInvitations(workspaceRuntimeId),
    enabled: authReady && section === "members" && canManageMembers,
    retry: false,
    staleTime: 30_000,
  });

  const credentialsQuery = useQuery({
    queryKey: ["dashboard", "governance", "credentials", workspaceRuntimeId],
    queryFn: async () => dashboardCredentialsApi.listCredentials(),
    enabled: authReady && (section === "credentials" || section === "policy"),
    retry: false,
    staleTime: 30_000,
  });
  const selectedCredentialDetailQuery = useQuery({
    queryKey: ["dashboard", "governance", "credential-detail", selectedCredentialId],
    queryFn: async () => {
      if (!selectedCredentialId) {
        return null;
      }

      return dashboardCredentialsApi.getCredential(selectedCredentialId);
    },
    enabled: authReady && section === "credentials" && Boolean(selectedCredentialId),
    retry: false,
    staleTime: 30_000,
  });
  const selectedCredentialUsageQuery = useQuery({
    queryKey: ["dashboard", "governance", "credential-usage", selectedCredentialId],
    queryFn: async () => {
      if (!selectedCredentialId) {
        return null;
      }

      return dashboardCredentialsApi.getCredentialUsage(selectedCredentialId);
    },
    enabled: authReady && section === "credentials" && Boolean(selectedCredentialId),
    retry: false,
    staleTime: 15_000,
  });
  const mcpsQuery = useQuery({
    queryKey: ["dashboard", "governance", "mcps", workspaceRuntimeId],
    queryFn: async () => dashboardMcpApi.listMcps(),
    enabled: authReady && section === "policy",
    retry: false,
    staleTime: 30_000,
  });
  const bindingsQuery = useQuery({
    queryKey: ["dashboard", "governance", "mcp-bindings", workspaceRuntimeId],
    queryFn: async () => dashboardMcpApi.listBindings(),
    enabled: authReady && section === "policy",
    retry: false,
    staleTime: 30_000,
  });
  const governanceSummaryQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "governance-summary",
      packageId,
      section,
      workspaceContextKey,
    ],
    queryFn: async () =>
      dashboardCreatorApi.getGovernanceSectionSummary(
        packageId,
        section === "audit" ? "audit" : "cost",
        {
          workspaceContextKey,
        }
      ),
    enabled: authReady && (section === "audit" || section === "cost"),
    retry: false,
    staleTime: 30_000,
  });
  const auditExportsQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "audit-exports",
      packageId,
      workspaceContextKey,
    ],
    queryFn: async () =>
      dashboardCreatorApi.listAuditExports(packageId, {
        workspaceContextKey,
      }),
    enabled: authReady && (section === "audit" || section === "cost"),
    retry: false,
    staleTime: 30_000,
  });
  const mcpCallsQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "mcp-calls",
      packageId,
      workspaceContextKey,
      ...linkedServiceIds,
    ],
    queryFn: async () => {
      const uniqueServiceIds = [...new Set(linkedServiceIds.map((item) => item.trim()).filter(Boolean))];
      if (uniqueServiceIds.length === 0) {
        return [] as McpCallRecord[];
      }

      const batches = await Promise.all(
        uniqueServiceIds.map((serviceId) =>
          dashboardMcpApi.listCalls({
            workspaceContextKey,
            serviceId,
            limit: 12,
          })
        )
      );

      const merged = new Map<string, McpCallRecord>();
      for (const batch of batches) {
        for (const record of batch) {
          const current = merged.get(record.callId);
          if (!current || current.occurredAt < record.occurredAt) {
            merged.set(record.callId, record);
          }
        }
      }

      return [...merged.values()]
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
        .slice(0, 12);
    },
    enabled: authReady && section === "audit",
    retry: false,
    staleTime: 15_000,
  });
  const quotaPoliciesQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "quota",
      "policies",
      packageId,
      workspaceContextKey,
    ],
    queryFn: async () =>
      dashboardQuotaApi.listPolicies({
        workspaceContextKey,
        packageId,
      }),
    enabled: authReady && section === "cost",
    retry: false,
    staleTime: 30_000,
  });
  const quotaCountersQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "quota",
      "counters",
      packageId,
      workspaceContextKey,
    ],
    queryFn: async () =>
      dashboardQuotaApi.listCounters({
        workspaceContextKey,
        packageId,
      }),
    enabled: authReady && section === "cost",
    retry: false,
    staleTime: 30_000,
  });
  const quotaEventsQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "quota",
      "events",
      packageId,
      workspaceContextKey,
    ],
    queryFn: async () =>
      dashboardQuotaApi.listEvents({
        workspaceContextKey,
        packageId,
      }),
    enabled: authReady && section === "cost",
    retry: false,
    staleTime: 15_000,
  });
  const quotaOverridesQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "quota",
      "overrides",
      packageId,
      workspaceContextKey,
    ],
    queryFn: async () =>
      dashboardQuotaApi.listOverrides({
        workspaceContextKey,
        packageId,
      }),
    enabled: authReady && section === "cost",
    retry: false,
    staleTime: 15_000,
  });
  const billingSummaryQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "billing",
      "summary",
      packageId,
      workspaceContextKey,
    ],
    queryFn: async () =>
      dashboardBillingApi.getSummary({
        workspaceContextKey,
        packageId,
      }),
    enabled: authReady && section === "cost",
    retry: false,
    staleTime: 15_000,
  });
  const billingEntriesQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "billing",
      "entries",
      packageId,
      workspaceContextKey,
    ],
    queryFn: async () =>
      dashboardBillingApi.listEntries({
        workspaceContextKey,
        packageId,
        limit: 8,
      }),
    enabled: authReady && section === "cost",
    retry: false,
    staleTime: 15_000,
  });

  useEffect(() => {
    const firstId = credentialsQuery.data?.[0]?.credentialId ?? null;
    if (!selectedCredentialId && firstId) {
      setSelectedCredentialId(firstId);
    }

    if (
      selectedCredentialId &&
      credentialsQuery.data &&
      credentialsQuery.data.every((item) => item.credentialId !== selectedCredentialId)
    ) {
      setSelectedCredentialId(firstId);
    }
  }, [credentialsQuery.data, selectedCredentialId]);

  useEffect(() => {
    if (manageableRoles.length === 0) {
      return;
    }

    setInviteDraft((current) =>
      manageableRoles.includes(current.role)
        ? current
        : {
            ...current,
            role: manageableRoles[0] ?? "viewer",
          }
    );
  }, [manageableRoles]);

  useEffect(() => {
    if (!membersQuery.data) {
      return;
    }

    setMemberDrafts((current) => {
      const next: Record<string, MemberEditDraft> = { ...current };
      let changed = false;

      for (const member of membersQuery.data) {
        const seeded = {
          role: member.membership.role,
          status: member.membership.status,
        } satisfies MemberEditDraft;
        const existing = next[member.user.userId];
        if (!existing || existing.role !== seeded.role || existing.status !== seeded.status) {
          next[member.user.userId] = seeded;
          changed = true;
        }
      }

      for (const userId of Object.keys(next)) {
        if (membersQuery.data.every((member) => member.user.userId !== userId)) {
          delete next[userId];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [membersQuery.data]);

  useEffect(() => {
    if (mcpsQuery.data && mcpsQuery.data.length > 0 && !bindingDraft.mcpId) {
      setBindingDraft((current) => ({ ...current, mcpId: mcpsQuery.data?.[0]?.mcpId ?? "" }));
    }
  }, [bindingDraft.mcpId, mcpsQuery.data]);

  async function invalidateCostState() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "creator", "governance-summary", packageId, "cost", workspaceContextKey],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "creator", "billing", "summary", packageId, workspaceContextKey],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "creator", "billing", "entries", packageId, workspaceContextKey],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "creator", "mcp-calls", packageId, workspaceContextKey],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "creator", "quota", "policies", packageId, workspaceContextKey],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "creator", "quota", "counters", packageId, workspaceContextKey],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "creator", "quota", "events", packageId, workspaceContextKey],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "creator", "quota", "overrides", packageId, workspaceContextKey],
      }),
    ]);
  }

  async function invalidateMembersState() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "workspace", "members", workspaceRuntimeId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "workspace", "invitations", workspaceRuntimeId],
      }),
    ]);
  }

  async function invalidateCredentialsState() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "governance", "credentials", workspaceRuntimeId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "governance", "credential-detail", selectedCredentialId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "governance", "credential-usage", selectedCredentialId],
      }),
    ]);
  }

  const createWorkspaceInvitationMutation = useMutation({
    mutationFn: async () => {
      const parsedExpiresInDays = Number.parseInt(inviteDraft.expiresInDays.trim(), 10);
      return dashboardAuthApi.createWorkspaceInvitation(workspaceRuntimeId, {
        email: inviteDraft.email.trim(),
        role: inviteDraft.role,
        note: inviteDraft.note.trim() || undefined,
        expiresInDays: Number.isFinite(parsedExpiresInDays) ? parsedExpiresInDays : undefined,
      });
    },
    onSuccess: async (result) => {
      setInvitationActionError(null);
      setLatestInvitationToken({
        invitationId: result.invitation.invitation.invitationId,
        email: result.invitation.invitation.email,
        token: result.acceptToken,
      });
      setInviteDraft({
        email: "",
        role: manageableRoles[0] ?? "viewer",
        note: "",
        expiresInDays: "7",
      });
      await invalidateMembersState();
    },
    onError: (error) => {
      setInvitationActionError(queryErrorMessage(error));
    },
  });

  const updateWorkspaceMemberMutation = useMutation({
    mutationFn: async (input: {
      userId: string;
      patch: Partial<Pick<MemberEditDraft, "role" | "status">>;
    }) => dashboardAuthApi.updateWorkspaceMember(workspaceRuntimeId, input.userId, input.patch),
    onSuccess: async () => {
      setMemberActionError(null);
      await invalidateMembersState();
    },
    onError: (error) => {
      setMemberActionError(queryErrorMessage(error));
    },
  });

  const revokeWorkspaceInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) =>
      dashboardAuthApi.revokeWorkspaceInvitation(workspaceRuntimeId, invitationId),
    onSuccess: async () => {
      setInvitationActionError(null);
      await invalidateMembersState();
    },
    onError: (error) => {
      setInvitationActionError(queryErrorMessage(error));
    },
  });

  const createCredentialMutation = useMutation({
    mutationFn: async () =>
      dashboardCredentialsApi.createCredential({
        scope: credentialDraft.scope,
        displayName: credentialDraft.displayName.trim(),
        provider: credentialDraft.provider.trim(),
        secretKind: credentialDraft.secretKind,
        mountMode: credentialDraft.mountMode,
        secretValue: credentialDraft.secretValue,
        secretRef: normalizeOptionalString(credentialDraft.secretRef),
        envName: credentialDraft.envName.trim() || undefined,
        mountPathTemplate: credentialDraft.mountPathTemplate.trim() || undefined,
        expiresAt: null,
        rotationDueAt: formatMaybeIso(credentialDraft.rotationDueAt) ?? null,
        notes: credentialDraft.notes.trim() || null,
      }),
    onSuccess: async (result) => {
      setSelectedCredentialId(result.credentialId);
      setCredentialDraft({
        scope: "workspace",
        displayName: "",
        provider: "",
        secretKind: "api-key",
        mountMode: "env",
        secretValue: "",
        secretRef: "",
        envName: "",
        mountPathTemplate: "",
        rotationDueAt: "",
        notes: "",
      });
      await invalidateCredentialsState();
    },
  });

  const rotateCredentialMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCredentialId) {
        throw new Error("No credential selected for rotation.");
      }

      return dashboardCredentialsApi.rotateCredential(selectedCredentialId, {
        secretValue: credentialRotateDraft.secretValue,
        secretRef: normalizeOptionalString(credentialRotateDraft.secretRef),
        rotationDueAt: formatMaybeIso(credentialRotateDraft.rotationDueAt) ?? null,
        note: credentialRotateDraft.note.trim() || null,
      });
    },
    onSuccess: async () => {
      setCredentialRotateDraft({
        secretValue: "",
        secretRef: "",
        rotationDueAt: "",
        note: "",
      });
      await invalidateCredentialsState();
    },
  });

  const suspendCredentialMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCredentialId) {
        throw new Error("No credential selected for suspension.");
      }

      return dashboardCredentialsApi.suspendCredential(selectedCredentialId, {
        impactAction: credentialLifecycleDraft.impactAction,
        note: normalizeOptionalString(credentialLifecycleDraft.note),
      });
    },
    onSuccess: async () => {
      setCredentialLifecycleDraft({
        impactAction: "block",
        note: "",
      });
      await invalidateCredentialsState();
    },
  });

  const revokeCredentialMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCredentialId) {
        throw new Error("No credential selected for revocation.");
      }

      return dashboardCredentialsApi.revokeCredential(selectedCredentialId, {
        impactAction: credentialLifecycleDraft.impactAction,
        note: normalizeOptionalString(credentialLifecycleDraft.note),
      });
    },
    onSuccess: async () => {
      setCredentialLifecycleDraft({
        impactAction: "block",
        note: "",
      });
      await invalidateCredentialsState();
    },
  });

  const createMcpMutation = useMutation({
    mutationFn: async () => {
      const stdioRefSha256 =
        mcpDraft.transport === "stdio"
          ? normalizeSha256Hex(mcpDraft.stdioRefSha256)
          : null;

      if (mcpDraft.transport === "stdio" && !stdioRefSha256) {
        throw new Error("Stdio MCP requires a valid 64-character ref SHA-256 digest.");
      }

      return dashboardMcpApi.createMcp({
        mcpId: mcpDraft.mcpId.trim(),
        displayName: mcpDraft.displayName.trim(),
        description: mcpDraft.description.trim() || null,
        source: mcpDraft.source,
        transport: mcpDraft.transport,
        ref: mcpDraft.ref.trim(),
        stdioPolicy:
          mcpDraft.transport === "stdio"
            ? {
                refSha256: stdioRefSha256!,
              }
            : null,
        status: "active",
        riskLevel: mcpDraft.riskLevel,
        defaultCredentialId: mcpDraft.defaultCredentialId.trim() || null,
        defaultNetworkPolicyRef: null,
        approvalRequired: mcpDraft.approvalRequired,
        tags: splitTags(mcpDraft.tags),
      });
    },
    onSuccess: async (result) => {
      setMcpDraft({
        mcpId: "",
        displayName: "",
        source: "third-party",
        transport: "http",
        ref: "",
        stdioRefSha256: "",
        riskLevel: "medium",
        defaultCredentialId: "",
        approvalRequired: false,
        tags: "",
        description: "",
      });
      setBindingDraft((current) => ({ ...current, mcpId: result.mcpId }));
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "governance", "mcps", workspaceRuntimeId],
      });
    },
  });

  const createBindingMutation = useMutation({
    mutationFn: async () =>
      dashboardMcpApi.createBinding({
        mcpId: bindingDraft.mcpId.trim(),
        scope: bindingDraft.scope,
        scopeRef: bindingDraft.scopeRef.trim() || undefined,
        credentialId: bindingDraft.credentialId.trim() || null,
        networkPolicyRef: bindingDraft.networkPolicyRef.trim() || null,
        approvalRequired: bindingDraft.approvalRequired,
        autoAttach: bindingDraft.autoAttach,
        notes: bindingDraft.notes.trim() || null,
      }),
    onSuccess: async () => {
      setBindingDraft((current) => ({
        ...current,
        scope: "workspace",
        scopeRef: "",
        credentialId: "",
        networkPolicyRef: "",
        approvalRequired: false,
        autoAttach: true,
        notes: "",
      }));
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "governance", "mcp-bindings", workspaceRuntimeId],
      });
    },
  });

  const createAuditExportMutation = useMutation({
    mutationFn: async (format: "json" | "csv") =>
      dashboardCreatorApi.createAuditExport(packageId, {
        workspaceContextKey,
        format,
      }),
    onMutate: () => {
      setAuditActionError(null);
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "audit-exports", packageId, workspaceContextKey],
        }),
        invalidateCostState(),
      ]);

      try {
        setDownloadingAuditExportId(result.export.exportId);
        const downloaded = await dashboardCreatorApi.downloadAuditExport(
          packageId,
          result.export.exportId
        );
        triggerBrowserDownload(downloaded.fileName, downloaded.blob);
      } catch (error) {
        setAuditActionError(queryErrorMessage(error));
      } finally {
        setDownloadingAuditExportId(null);
      }
    },
    onError: (error) => {
      setAuditActionError(queryErrorMessage(error));
    },
  });

  const createQuotaPolicyMutation = useMutation({
    mutationFn: async () => {
      const scopeRefId = resolveQuotaDraftScopeRefId(
        quotaPolicyDraft.scopeType,
        quotaPolicyDraft.scopeRefId,
        {
          workspaceRuntimeId,
          workspaceContextKey,
          packageId,
        }
      );
      if (!scopeRefId) {
        throw new Error("Quota scope reference is required.");
      }

      return dashboardQuotaApi.createPolicy({
        scopeType: quotaPolicyDraft.scopeType,
        scopeRefId,
        metric: quotaPolicyDraft.metric,
        windowType: quotaPolicyDraft.windowType,
        limitValue: Number(quotaPolicyDraft.limitValue),
        softLimitValue: quotaPolicyDraft.softLimitValue.trim()
          ? Number(quotaPolicyDraft.softLimitValue)
          : null,
        hardLimitValue: quotaPolicyDraft.hardLimitValue.trim()
          ? Number(quotaPolicyDraft.hardLimitValue)
          : null,
        actionOnSoftLimit: quotaPolicyDraft.actionOnSoftLimit,
        actionOnHardLimit: quotaPolicyDraft.actionOnHardLimit,
        status: "active",
        enabled: true,
        priority: 100,
        summary:
          quotaPolicyDraft.summaryZh.trim() || quotaPolicyDraft.summaryEn.trim()
            ? {
                zh: quotaPolicyDraft.summaryZh.trim() || quotaPolicyDraft.summaryEn.trim(),
                en: quotaPolicyDraft.summaryEn.trim() || quotaPolicyDraft.summaryZh.trim(),
              }
            : null,
        notes: quotaPolicyDraft.notes.trim() || null,
        workspaceContextKey,
        packageId,
        serviceId: null,
        taskVersionId: null,
        sessionVersionId: null,
        entrySurface: null,
      });
    },
    onMutate: () => {
      setQuotaActionError(null);
    },
    onSuccess: async () => {
      setQuotaPolicyDraft({
        scopeType: "workspace-context",
        scopeRefId: "",
        metric: "daily_runs",
        windowType: "daily",
        limitValue: "12",
        softLimitValue: "10",
        hardLimitValue: "12",
        actionOnSoftLimit: "require_approval",
        actionOnHardLimit: "block",
        summaryZh: "",
        summaryEn: "",
        notes: "",
      });
      setShowQuotaPolicyForm(false);
      await invalidateCostState();
    },
    onError: (error) => {
      setQuotaActionError(queryErrorMessage(error));
    },
  });

  const updateQuotaPolicyMutation = useMutation({
    mutationFn: async ({
      policyId,
      input,
    }: {
      policyId: string;
      input: Partial<Pick<QuotaPolicy, "status" | "enabled">>;
    }) => dashboardQuotaApi.updatePolicy(policyId, input),
    onMutate: () => {
      setQuotaActionError(null);
    },
    onSuccess: async () => {
      await invalidateCostState();
    },
    onError: (error) => {
      setQuotaActionError(queryErrorMessage(error));
    },
  });

  const approveQuotaOverrideMutation = useMutation({
    mutationFn: async (overrideId: string) =>
      dashboardQuotaApi.approveOverride(overrideId, {
        note: quotaOverrideDecisionNote.trim() || undefined,
      }),
    onMutate: () => {
      setQuotaActionError(null);
    },
    onSuccess: async () => {
      setQuotaOverrideDecisionNote("");
      await invalidateCostState();
    },
    onError: (error) => {
      setQuotaActionError(queryErrorMessage(error));
    },
  });

  const rejectQuotaOverrideMutation = useMutation({
    mutationFn: async (overrideId: string) =>
      dashboardQuotaApi.rejectOverride(overrideId, {
        note: quotaOverrideDecisionNote.trim() || undefined,
      }),
    onMutate: () => {
      setQuotaActionError(null);
    },
    onSuccess: async () => {
      setQuotaOverrideDecisionNote("");
      await invalidateCostState();
    },
    onError: (error) => {
      setQuotaActionError(queryErrorMessage(error));
    },
  });

  async function handleAuditExportDownload(record: CreatorAuditExportRecord) {
    try {
      setAuditActionError(null);
      setDownloadingAuditExportId(record.exportId);
      const downloaded = await dashboardCreatorApi.downloadAuditExport(
        packageId,
        record.exportId
      );
      triggerBrowserDownload(downloaded.fileName || record.fileName, downloaded.blob);
    } catch (error) {
      setAuditActionError(queryErrorMessage(error));
    } finally {
      setDownloadingAuditExportId(null);
    }
  }

  function handleMemberDraftChange(
    userId: string,
    field: keyof MemberEditDraft,
    value: WorkspaceRole | WorkspaceMembershipStatus
  ) {
    setMemberDrafts((current) => {
      const existing = current[userId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [userId]: {
          ...existing,
          [field]: value,
        },
      };
    });
  }

  async function handleMemberUpdate(member: WorkspaceMemberRecord) {
    const draft = memberDrafts[member.user.userId];
    if (!draft) {
      return;
    }

    const patch: { role?: WorkspaceRole; status?: WorkspaceMembershipStatus } = {};
    if (draft.role !== member.membership.role) {
      patch.role = draft.role;
    }
    if (draft.status !== member.membership.status) {
      patch.status = draft.status;
    }

    if (!patch.role && !patch.status) {
      return;
    }

    setMemberActionError(null);
    await updateWorkspaceMemberMutation.mutateAsync({
      userId: member.user.userId,
      patch,
    });
  }

  const workspaceMembers = useMemo(
    () =>
      [...(membersQuery.data ?? [])].sort(
        (left, right) =>
          left.user.displayName.localeCompare(right.user.displayName) ||
          left.user.userId.localeCompare(right.user.userId)
      ),
    [membersQuery.data]
  );
  const workspaceInvitations = useMemo(
    () =>
      [...(invitationsQuery.data ?? [])].sort(
        (left, right) =>
          right.invitation.createdAt.localeCompare(left.invitation.createdAt) ||
          left.invitation.invitationId.localeCompare(right.invitation.invitationId)
      ),
    [invitationsQuery.data]
  );
  const filteredWorkspaceMembers = useMemo(
    () =>
      workspaceMembers.filter((member) =>
        matchesSearchQuery(query, [
          member.user.displayName,
          member.user.email,
          member.user.userId,
          workspaceRoleLabel(member.membership.role).zh,
          workspaceRoleLabel(member.membership.role).en,
          workspaceMembershipStatusLabel(member.membership.status).zh,
          workspaceMembershipStatusLabel(member.membership.status).en,
        ])
      ),
    [query, workspaceMembers]
  );
  const filteredWorkspaceInvitations = useMemo(
    () =>
      workspaceInvitations.filter((invitation) =>
        matchesSearchQuery(query, [
          invitation.invitation.email,
          invitation.invitation.invitationId,
          invitation.invitation.note ?? "",
          workspaceRoleLabel(invitation.invitation.role).zh,
          workspaceRoleLabel(invitation.invitation.role).en,
          workspaceInvitationStatusLabel(invitation.invitation.status).zh,
          workspaceInvitationStatusLabel(invitation.invitation.status).en,
          invitation.invitedBy?.displayName ?? "",
          invitation.invitedBy?.email ?? "",
        ])
      ),
    [query, workspaceInvitations]
  );
  const manageableMembers = useMemo(
    () =>
      filteredWorkspaceMembers.filter((member) =>
        canEditWorkspaceMember({
          currentRole: currentWorkspaceRole,
          currentUserId,
          member,
        })
      ),
    [currentUserId, currentWorkspaceRole, filteredWorkspaceMembers]
  );
  const pendingWorkspaceInvitations = useMemo(
    () => filteredWorkspaceInvitations.filter((item) => item.invitation.status === "pending"),
    [filteredWorkspaceInvitations]
  );
  const memberRows = useMemo(() => {
    if (!membersQuery.data) {
      return meta.rows;
    }

    return filteredWorkspaceMembers.map<GovernanceRow>((member) => ({
      id: member.user.userId,
      tone: workspaceMembershipTone(member.membership.status),
      cells: [
        entityDisplayLabel(member.user.displayName, member.user.email),
        joinLocalized([
          workspaceRoleLabel(member.membership.role),
          workspaceLabel,
        ]),
        workspaceMembershipStatusLabel(member.membership.status),
        joinLocalized([
          sameText(member.user.userId),
          formatIsoLabel(member.membership.updatedAt, l("-", "-")),
        ]),
      ],
    }));
  }, [filteredWorkspaceMembers, membersQuery.data, meta.rows, workspaceLabel]);
  const invitationRows = useMemo(
    () =>
      filteredWorkspaceInvitations.map<GovernanceRow>((invitation) => ({
        id: invitation.invitation.invitationId,
        tone: workspaceInvitationTone(invitation.invitation.status),
        cells: [
          sameText(invitation.invitation.email),
          joinLocalized([
            workspaceRoleLabel(invitation.invitation.role),
            invitation.invitedBy
              ? entityDisplayLabel(invitation.invitedBy.displayName, invitation.invitedBy.email)
              : null,
          ]),
          workspaceInvitationStatusLabel(invitation.invitation.status),
          joinLocalized([
            formatIsoLabel(invitation.invitation.expiresAt, l("-", "-")),
            invitation.invitation.note ? sameText(invitation.invitation.note) : null,
          ]),
        ],
      })),
    [filteredWorkspaceInvitations]
  );
  const memberMetrics = useMemo(() => {
    if (!membersQuery.data) {
      return meta.metrics;
    }

    const activeMembers = workspaceMembers.filter((item) => item.membership.status === "active").length;
    const suspendedMembers = workspaceMembers.length - activeMembers;
    const pendingInvitations = workspaceInvitations.filter(
      (item) => item.invitation.status === "pending"
    ).length;

    return [
      {
        label: l("成员总数", "Workspace members"),
        value: String(workspaceMembers.length).padStart(2, "0"),
        note: l("当前工作区内可见的正式成员关系。", "Formal workspace memberships visible in the current workspace."),
      },
      {
        label: l("启用 / 暂停", "Active / suspended"),
        value: `${activeMembers}/${suspendedMembers}`,
        note: l("暂停成员会失去实例与治理访问权。", "Suspended members lose run and governance access."),
      },
      {
        label: l("待处理邀请", "Pending invites"),
        value: canManageMembers ? String(pendingInvitations).padStart(2, "0") : "--",
        note: canManageMembers
          ? l("待接受邀请由工作区治理链路直接驱动。", "Pending invitations are driven directly by the workspace governance chain.")
          : l("当前角色只能查看成员列表，不能管理邀请。", "The current role can read members but cannot manage invitations."),
      },
    ] satisfies GovernanceMetric[];
  }, [canManageMembers, membersQuery.data, meta.metrics, workspaceInvitations, workspaceMembers]);

  const memberHeaders: [LocalizedString, LocalizedString, LocalizedString, LocalizedString] = [
    l("成员", "Member"),
    l("角色 / 空间", "Role / workspace"),
    l("状态", "Status"),
    l("标识 / 更新时间", "Identity / updated at"),
  ];
  const invitationHeaders: [LocalizedString, LocalizedString, LocalizedString, LocalizedString] = [
    l("邀请对象", "Invitee"),
    l("角色 / 发起人", "Role / invited by"),
    l("状态", "Status"),
    l("到期 / 备注", "Expires / note"),
  ];

  const credentialRows = useMemo(() => {
    if (!credentialsQuery.data) {
      return meta.rows;
    }

    return credentialsQuery.data.map<GovernanceRow>((credential) => ({
      id: credential.credentialId,
      tone: localizedStatusTone(credential.status),
      cells: [
        sameText(credential.displayName),
        joinLocalized([credentialScopeLabel(credential.scope), credential.provider]),
        credentialStatusLabel(credential.status),
        joinLocalized([
          credentialMountLabel(credential.mountMode),
          credentialKindLabel(credential.secretKind),
          credential.rotationDueAt
            ? formatIsoLabel(credential.rotationDueAt, l("未设置轮换时间", "No rotation due date"))
            : null,
        ]),
      ],
    }));
  }, [credentialsQuery.data, meta.rows]);

  const filteredCredentialRows = useMemo(
    () => credentialRows.filter((row) => matchesSearchQuery(query, rowSearchTexts(row))),
    [credentialRows, query]
  );

  const credentialMetrics = useMemo(() => {
    if (!credentialsQuery.data) {
      return meta.metrics;
    }

    const workspaceScoped = credentialsQuery.data.filter((item) => item.scope === "workspace").length;
    const rotationDue = credentialsQuery.data.filter((item) => item.status === "needs-rotation").length;
    const activeCredentials = credentialsQuery.data.filter((item) => item.status === "active").length;

    return [
      {
        label: l("凭证总数", "Credential ledger"),
        value: String(credentialsQuery.data.length).padStart(2, "0"),
        note: l("当前工作区可见的全部凭证对象。", "All credential records visible in the current workspace."),
      },
      {
        label: l("工作区作用域", "Workspace scoped"),
        value: String(workspaceScoped).padStart(2, "0"),
        note: l("会随工作区上下文共同进入运行时。", "Injected together with the current workspace context."),
      },
      {
        label: l("待轮换 / 启用", "Rotation due / active"),
        value: `${rotationDue}/${activeCredentials}`,
        note: l("轮换状态直接来源于后端治理对象。", "Rotation state comes directly from backend governance objects."),
      },
    ] satisfies GovernanceMetric[];
  }, [credentialsQuery.data, meta.metrics]);

  const selectedCredentialSummary =
    credentialsQuery.data?.find((item) => item.credentialId === selectedCredentialId) ?? null;
  const selectedCredential =
    selectedCredentialDetailQuery.data ??
    (selectedCredentialSummary
      ? ({
          ...selectedCredentialSummary,
          envName: null,
          mountPathTemplate: null,
        } satisfies CredentialDetail)
      : null);
  const selectedCredentialUsage = selectedCredentialUsageQuery.data;
  const credentialUsageRunHeaders: [
    LocalizedString,
    LocalizedString,
    LocalizedString,
    LocalizedString,
  ] = [
    l("运行", "Run"),
    l("服务 / 入口", "Service / surface"),
    l("状态", "Status"),
    l("路径 / 范围", "Path / scope"),
  ];
  const credentialUsageBindingHeaders: [
    LocalizedString,
    LocalizedString,
    LocalizedString,
    LocalizedString,
  ] = [
    l("绑定", "Binding"),
    l("作用域", "Scope"),
    l("状态", "Status"),
    l("执行策略", "Execution policy"),
  ];
  const activeCredentialUsageRows = useMemo(
    () =>
      (selectedCredentialUsage?.activeRuns ?? []).map<GovernanceRow>((run) => ({
        id: run.runId,
        tone: runStatusTone(run.status),
        cells: [
          sameText(run.title),
          joinLocalized([
            run.serviceName ?? sameText(run.serviceId),
            runSurfaceLabel(run.entrySurface),
          ]),
          runStatusLabel(run.status),
          joinLocalized([
            sameText(run.targetPath),
            run.usesMcpBinding ? l("MCP 引用", "Referenced via MCP") : null,
            run.usesDirectMount ? l("挂载注入", "Mounted directly") : null,
          ]),
        ],
      })),
    [selectedCredentialUsage]
  );
  const recentCredentialUsageRows = useMemo(
    () =>
      (selectedCredentialUsage?.recentRuns ?? []).map<GovernanceRow>((run) => ({
        id: run.runId,
        tone: runStatusTone(run.status),
        cells: [
          sameText(run.title),
          joinLocalized([
            run.serviceName ?? sameText(run.serviceId),
            runSurfaceLabel(run.entrySurface),
          ]),
          runStatusLabel(run.status),
          joinLocalized([
            formatIsoLabel(run.updatedAt, l("-", "-")),
            sameText(run.targetPath),
          ]),
        ],
      })),
    [selectedCredentialUsage]
  );
  const credentialBindingUsageRows = useMemo(
    () =>
      (selectedCredentialUsage?.bindings ?? []).map<GovernanceRow>((binding) => ({
        id: binding.bindingId,
        tone: localizedStatusTone(binding.status),
        cells: [
          entityDisplayLabel(binding.mcpDisplayName, binding.mcpId),
          joinLocalized([bindingScopeLabel(binding.scope), sameText(binding.scopeRef)]),
          bindingStatusLabel(binding.status),
          joinLocalized([
            binding.autoAttach ? l("自动挂接", "Auto attach") : l("手动挂接", "Manual attach"),
            binding.approvalRequired ? l("需审批", "Approval required") : null,
            binding.networkPolicyRef ? sameText(binding.networkPolicyRef) : null,
          ]),
        ],
      })),
    [selectedCredentialUsage]
  );
  const credentialLookup = useMemo(() => {
    const mapping = new Map<string, CredentialSummary>();
    for (const item of credentialsQuery.data ?? []) {
      mapping.set(item.credentialId, item);
    }
    return mapping;
  }, [credentialsQuery.data]);
  const mcpLookup = useMemo(() => {
    const mapping = new Map<string, McpRegistryEntry>();
    for (const item of mcpsQuery.data ?? []) {
      mapping.set(item.mcpId, item);
    }
    return mapping;
  }, [mcpsQuery.data]);

  const registryRows = useMemo(() => {
    if (!mcpsQuery.data) {
      return meta.rows;
    }

    return mcpsQuery.data.map<GovernanceRow>((entry) => ({
      id: entry.mcpId,
      tone: localizedStatusTone(entry.status),
      cells: [
        sameText(entry.displayName),
        joinLocalized([connectorSourceLabel(entry.source), connectorTransportLabel(entry.transport)]),
        entry.status === "active"
          ? l("已注册", "Registered")
          : entry.status === "deprecated"
            ? l("待下线", "Deprecated")
            : l("已停用", "Disabled"),
        joinLocalized([
          connectorRiskLabel(entry.riskLevel),
          entry.approvalRequired ? l("审批必经", "Approval required") : l("可直接挂接", "Direct attach"),
          entry.defaultCredentialId
            ? entityDisplayLabel(
                credentialLookup.get(entry.defaultCredentialId)?.displayName,
                entry.defaultCredentialId
              )
            : null,
        ]),
      ],
    }));
  }, [credentialLookup, mcpsQuery.data, meta.rows]);

  const bindingRows = useMemo(() => {
    if (!bindingsQuery.data) {
      return meta.rows;
    }

    return bindingsQuery.data.map<GovernanceRow>((binding) => ({
      id: binding.bindingId,
      tone: localizedStatusTone(binding.status),
      cells: [
        entityDisplayLabel(mcpLookup.get(binding.mcpId)?.displayName, binding.mcpId),
        joinLocalized([bindingScopeLabel(binding.scope), binding.scopeRef]),
        bindingStatusLabel(binding.status),
        joinLocalized([
          binding.autoAttach ? l("自动挂接", "Auto attach") : l("手动挂接", "Manual attach"),
          binding.approvalRequired ? l("审批", "Approval") : null,
          binding.credentialId
            ? entityDisplayLabel(
                credentialLookup.get(binding.credentialId)?.displayName,
                binding.credentialId
              )
            : null,
          binding.networkPolicyRef ? sameText(binding.networkPolicyRef) : null,
        ]),
      ],
    }));
  }, [bindingsQuery.data, credentialLookup, mcpLookup, meta.rows]);

  const filteredRegistryRows = useMemo(
    () => registryRows.filter((row) => matchesSearchQuery(query, rowSearchTexts(row))),
    [query, registryRows]
  );
  const filteredBindingRows = useMemo(
    () => bindingRows.filter((row) => matchesSearchQuery(query, rowSearchTexts(row))),
    [bindingRows, query]
  );

  const policyMetrics = useMemo(() => {
    if (!mcpsQuery.data || !bindingsQuery.data) {
      return meta.metrics;
    }

    const approvalBound = bindingsQuery.data.filter((item) => item.approvalRequired).length;
    const activeBindings = bindingsQuery.data.filter((item) => item.status === "active").length;
    const autoAttached = bindingsQuery.data.filter((item) => item.autoAttach).length;

    return [
      {
        label: l("注册连接器", "Registered MCPs"),
        value: String(mcpsQuery.data.length).padStart(2, "0"),
        note: l("当前工作区可见的连接器注册表。", "Registry entries currently visible to this workspace."),
      },
      {
        label: l("已生效绑定", "Active bindings"),
        value: `${activeBindings}/${bindingsQuery.data.length}`,
        note: l("决定实例启动时的自动挂接集合。", "Controls the auto-attached set during run boot."),
      },
      {
        label: l("审批 / 自动挂接", "Approval / auto attach"),
        value: `${approvalBound}/${autoAttached}`,
        note: l("用于识别高风险外部能力的运行边界。", "Helps identify high-risk external capability boundaries."),
      },
    ] satisfies GovernanceMetric[];
  }, [bindingsQuery.data, mcpsQuery.data, meta.metrics]);
  const quotaPolicies = useMemo(
    () =>
      [...(quotaPoliciesQuery.data ?? [])].sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || left.policyId.localeCompare(right.policyId)
      ),
    [quotaPoliciesQuery.data]
  );
  const quotaCountersByPolicyId = useMemo(() => {
    const mapping = new Map<string, QuotaCounter>();
    for (const counter of quotaCountersQuery.data ?? []) {
      const current = mapping.get(counter.policyId);
      if (!current || counter.updatedAt > current.updatedAt) {
        mapping.set(counter.policyId, counter);
      }
    }
    return mapping;
  }, [quotaCountersQuery.data]);
  const quotaEvents = useMemo(
    () =>
      [...(quotaEventsQuery.data ?? [])].sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) || left.eventId.localeCompare(right.eventId)
      ),
    [quotaEventsQuery.data]
  );
  const quotaEventsByPolicyId = useMemo(() => {
    const mapping = new Map<string, QuotaEvent>();
    for (const event of quotaEvents) {
      if (!mapping.has(event.policyId)) {
        mapping.set(event.policyId, event);
      }
    }
    return mapping;
  }, [quotaEvents]);
  const quotaOverrides = useMemo(
    () =>
      [...(quotaOverridesQuery.data ?? [])].sort(
        (left, right) =>
          right.requestedAt.localeCompare(left.requestedAt) ||
          left.overrideId.localeCompare(right.overrideId)
      ),
    [quotaOverridesQuery.data]
  );
  const pendingQuotaOverrides = useMemo(
    () => quotaOverrides.filter((item) => item.status === "pending"),
    [quotaOverrides]
  );
  const recentBillingEntries = useMemo(
    () =>
      [...(billingEntriesQuery.data ?? [])].sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) || left.entryId.localeCompare(right.entryId)
      ),
    [billingEntriesQuery.data]
  );
  const topBillingMetric =
    useMemo(
      () =>
        [...(billingSummaryQuery.data?.metrics ?? [])].sort((left, right) => right.amountUsd - left.amountUsd)[0] ??
        null,
      [billingSummaryQuery.data?.metrics]
    );
  const recentMcpCalls = useMemo(
    () =>
      [...(mcpCallsQuery.data ?? [])].sort(
        (left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.callId.localeCompare(right.callId)
      ),
    [mcpCallsQuery.data]
  );
  const latestMcpAuditCall = recentMcpCalls[0] ?? null;
  const distinctMcpConnectorCount = new Set(recentMcpCalls.map((item) => item.mcpId)).size;
  const mcpAuditIssueCount = recentMcpCalls.filter((item) => item.status !== "success").length;
  const recentMcpBillingEntries = useMemo(
    () => recentBillingEntries.filter((entry) => entry.source === "mcp-call"),
    [recentBillingEntries]
  );
  const latestMcpBillingEntry = recentMcpBillingEntries[0] ?? null;
  const mcpBillingMetric = useMemo(
    () => billingSummaryQuery.data?.metrics.find((metric) => metric.metric === "mcp_calls") ?? null,
    [billingSummaryQuery.data?.metrics]
  );
  const renderMcpAuditCard = () => (
    <article className="detail-item governance-card">
      <div className="card-row">
        <div>
          <div className="file-name">
            {t(lang, { zh: "最近 MCP 调用审计", en: "Recent MCP call audit" })}
          </div>
          <div className="meta">
            {t(
              lang,
              linkedServiceIds.length > 0
                ? {
                    zh: "这里按当前 package 关联服务聚合真实 MCP 调用记录，可直接复核 connector、tool、风险等级、耗时和阻断状态。",
                    en: "This aggregates real MCP call records by the services linked to the current package, so connector, tool, risk level, duration, and rejection state can be reviewed directly.",
                  }
                : {
                    zh: "当前 package 还没有登记关联服务，因此无法收敛 MCP 调用审计范围。",
                    en: "The current package does not declare any linked service yet, so the MCP audit scope cannot be narrowed.",
                  }
            )}
          </div>
        </div>
        <span className={`pill ${mcpAuditIssueCount > 0 ? "warn" : recentMcpCalls.length > 0 ? "active" : ""}`}>
          {mcpCallsQuery.isFetching
            ? t(lang, { zh: "同步中", en: "Syncing" })
            : t(lang, { zh: `${recentMcpCalls.length} 条`, en: `${recentMcpCalls.length} records` })}
        </span>
      </div>

      {linkedServiceIds.length === 0 ? (
        <div className="panel-empty">
          {t(
            lang,
            l(
              "先在 Creator 包内登记正式关联服务，MCP 调用审计才能形成精确的治理范围。",
              "Register formal linked services for this package first so MCP call audit can resolve an exact governance scope."
            )
          )}
        </div>
      ) : recentMcpCalls.length === 0 ? (
        <div className="panel-empty">
          {t(
            lang,
            l(
              "当前工作区上下文下还没有命中 MCP 调用审计记录。",
              "No MCP call audit record matches the current workspace context yet."
            )
          )}
        </div>
      ) : (
        <>
          <div className="governance-form-grid">
            <div className="fake-input governance-field">
              <span className="tiny-note">{t(lang, l("调用数", "Calls"))}</span>
              <div className="meta">{String(recentMcpCalls.length)}</div>
            </div>
            <div className="fake-input governance-field">
              <span className="tiny-note">{t(lang, l("连接器", "Connectors"))}</span>
              <div className="meta">{String(distinctMcpConnectorCount)}</div>
            </div>
            <div className="fake-input governance-field">
              <span className="tiny-note">{t(lang, l("异常/拦截", "Issues"))}</span>
              <div className="meta">{String(mcpAuditIssueCount)}</div>
            </div>
            <div className="fake-input governance-field">
              <span className="tiny-note">{t(lang, l("最近发生", "Latest"))}</span>
              <div className="meta">
                {t(lang, formatIsoLabel(latestMcpAuditCall?.occurredAt ?? null, l("尚无记录", "No activity yet")))}
              </div>
            </div>
          </div>

          <div className="governance-stack">
            {recentMcpCalls.map((record) => (
              <article className="detail-item governance-card" key={record.callId}>
                <div className="card-row">
                  <div>
                    <div className="file-name">{`${record.displayName} / ${record.toolName}`}</div>
                    <div className="meta">{record.callId}</div>
                  </div>
                  <div className="pill-row">
                    <span className={`pill ${riskTone(record.riskLevel)}`}>
                      {t(lang, connectorRiskLabel(record.riskLevel))}
                    </span>
                    <span className={`pill ${mcpCallStatusTone(record.status)}`}>
                      {t(lang, mcpCallStatusLabel(record.status))}
                    </span>
                  </div>
                </div>
                <div className="governance-form-grid">
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("来源", "Source"))}</span>
                    <div className="meta">{t(lang, connectorSourceLabel(record.source))}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("连接方式", "Transport"))}</span>
                    <div className="meta">{t(lang, connectorTransportLabel(record.transport))}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("耗时", "Duration"))}</span>
                    <div className="meta">{record.durationMs == null ? "-" : `${record.durationMs} ms`}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("发生时间", "Occurred at"))}</span>
                    <div className="meta">{t(lang, formatIsoLabel(record.occurredAt, l("-", "-")))}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("输入流量", "Input volume"))}</span>
                    <div className="meta">{formatDataVolume(record.inputBytes)}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("输出流量", "Output volume"))}</span>
                    <div className="meta">{formatDataVolume(record.outputBytes)}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("工作区上下文", "Workspace context"))}</span>
                    <div className="meta">{record.workspaceContextKey ?? "-"}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("审批要求", "Approval gate"))}</span>
                    <div className="meta">
                      {record.approvalRequired
                        ? t(lang, l("需要审批", "Approval required"))
                        : t(lang, l("直接放行", "Auto allowed"))}
                    </div>
                  </div>
                </div>
                {record.inputSummary ? <div className="meta">{record.inputSummary}</div> : null}
                {record.errorMessage ? <div className="meta">{record.errorMessage}</div> : null}
              </article>
            ))}
          </div>
        </>
      )}
    </article>
  );

  const renderMcpCostCard = () => (
    <article className="detail-item governance-card">
      <div className="card-row">
        <div>
          <div className="file-name">{t(lang, { zh: "MCP 调用与计费联动", en: "MCP call to billing linkage" })}</div>
          <div className="meta">
            {t(
              lang,
              linkedServiceIds.length > 0
                ? {
                    zh: "将 Creator 包下真实 MCP 调用审计与 mcp_calls 账本计量放在同一视图，便于核对调用量、成本与阻断情况。",
                    en: "This places real MCP audit records and mcp_calls ledger metering in one view so usage, cost, and rejection status can be reconciled together.",
                  }
                : {
                    zh: "当前 package 尚未声明关联服务，因此无法对齐 MCP 调用与成本归集范围。",
                    en: "The current package has not declared any linked service yet, so MCP usage cannot be reconciled against billing scope.",
                  }
            )}
          </div>
        </div>
        <span
          className={`pill ${
            (mcpBillingMetric?.entriesCount ?? 0) > 0
              ? "active"
              : recentMcpCalls.length > 0
                ? "warn"
                : ""
          }`}
        >
          {mcpCallsQuery.isFetching || billingEntriesQuery.isFetching
            ? t(lang, { zh: "同步中", en: "Syncing" })
            : t(lang, {
                zh: `${formatBillingQuantity(mcpBillingMetric?.quantity ?? 0)} 次`,
                en: `${formatBillingQuantity(mcpBillingMetric?.quantity ?? 0)} calls`,
              })}
        </span>
      </div>

      {linkedServiceIds.length === 0 ? (
        <div className="panel-empty">
          {t(
            lang,
            l(
              "先补齐 Creator 包的关联服务，系统才能把 MCP 调用审计、计费和配额落到同一治理范围。",
              "Link services to the Creator package first so MCP audit, billing, and quotas can be reconciled in one governance scope."
            )
          )}
        </div>
      ) : recentMcpCalls.length === 0 && !mcpBillingMetric ? (
        <div className="panel-empty">
          {t(
            lang,
            l(
              "当前范围下还没有 MCP 调用审计或计费记录。",
              "No MCP audit record or MCP billing entry exists in the current scope yet."
            )
          )}
        </div>
      ) : (
        <>
          <div className="governance-form-grid">
            <div className="fake-input governance-field">
              <span className="tiny-note">{t(lang, l("审计调用数", "Audited calls"))}</span>
              <div className="meta">{String(recentMcpCalls.length)}</div>
            </div>
            <div className="fake-input governance-field">
              <span className="tiny-note">{t(lang, l("入账调用量", "Billed quantity"))}</span>
              <div className="meta">{formatBillingQuantity(mcpBillingMetric?.quantity ?? 0)}</div>
            </div>
            <div className="fake-input governance-field">
              <span className="tiny-note">{t(lang, l("账本金额", "Ledger amount"))}</span>
              <div className="meta">{formatBillingUsd(mcpBillingMetric?.amountUsd ?? 0)}</div>
            </div>
            <div className="fake-input governance-field">
              <span className="tiny-note">{t(lang, l("入账事件", "Ledger entries"))}</span>
              <div className="meta">{String(mcpBillingMetric?.entriesCount ?? recentMcpBillingEntries.length)}</div>
            </div>
            <div className="fake-input governance-field">
              <span className="tiny-note">{t(lang, l("异常/拦截", "Issues"))}</span>
              <div className="meta">{String(mcpAuditIssueCount)}</div>
            </div>
            <div className="fake-input governance-field">
              <span className="tiny-note">{t(lang, l("最近入账", "Latest billed"))}</span>
              <div className="meta">
                {t(
                  lang,
                  formatIsoLabel(
                    latestMcpBillingEntry?.occurredAt ?? mcpBillingMetric?.latestOccurredAt ?? null,
                    l("尚无账本记录", "No billing yet")
                  )
                )}
              </div>
            </div>
          </div>

          {recentMcpBillingEntries.length > 0 ? (
            <div className="governance-stack">
              {recentMcpBillingEntries.slice(0, 3).map((entry) => (
                <article className="detail-item governance-card" key={entry.entryId}>
                  <div className="card-row">
                    <div>
                      <div className="file-name">{t(lang, billingSourceLabel(entry.source))}</div>
                      <div className="meta">{entry.sourceRef ?? entry.entryId}</div>
                    </div>
                    <span className={`pill ${billingSourceTone(entry.source)}`}>
                      {formatBillingUsd(entry.amountUsd)}
                    </span>
                  </div>
                  <div className="governance-form-grid">
                    <div className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, l("指标", "Metric"))}</span>
                      <div className="meta">{t(lang, quotaMetricLabel(entry.metric))}</div>
                    </div>
                    <div className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, l("数量", "Quantity"))}</span>
                      <div className="meta">{formatBillingQuantity(entry.quantity)}</div>
                    </div>
                    <div className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, l("成本依据", "Cost basis"))}</span>
                      <div className="meta">{entry.costBasis}</div>
                    </div>
                    <div className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, l("发生时间", "Occurred at"))}</span>
                      <div className="meta">{t(lang, formatIsoLabel(entry.occurredAt, l("-", "-")))}</div>
                    </div>
                  </div>
                  {entry.note ? <div className="meta">{entry.note}</div> : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="panel-empty">
              {t(
                lang,
                l(
                  "已经观测到 MCP 调用，但账本里还没有 mcp_calls 事件，适合继续检查归集延迟或过滤范围。",
                  "MCP calls have been observed, but no mcp_calls ledger entry is visible yet. Check reconciliation delay or scope filters next."
                )
              )}
            </div>
          )}
        </>
      )}
    </article>
  );

  const renderBillingSummaryCard = () => (
    <article className="detail-item governance-card">
      <div className="card-row">
        <div>
          <div className="file-name">{t(lang, { zh: "计量账本摘要", en: "Billing ledger summary" })}</div>
          <div className="meta">
            {t(lang, {
              zh: "聚合当前 package 在工作区上下文中的成本计量结果。",
              en: "Aggregate billing totals for this package inside the current workspace context.",
            })}
          </div>
        </div>
        <span className={`pill ${billingSummaryQuery.data?.totalEntriesCount ? "active" : ""}`}>
          {billingSummaryQuery.isFetching ? t(lang, { zh: "同步中", en: "Syncing" }) : String(billingSummaryQuery.data?.totalEntriesCount ?? 0)}
        </span>
      </div>

      <div className="governance-form-grid">
        <div className="fake-input governance-field">
          <span className="tiny-note">{t(lang, { zh: "累计金额", en: "Total amount" })}</span>
          <div className="meta">{formatBillingUsd(billingSummaryQuery.data?.totalAmountUsd ?? 0)}</div>
        </div>
        <div className="fake-input governance-field">
          <span className="tiny-note">{t(lang, { zh: "计量事件", en: "Ledger entries" })}</span>
          <div className="meta">{String(billingSummaryQuery.data?.totalEntriesCount ?? 0)}</div>
        </div>
        <div className="fake-input governance-field">
          <span className="tiny-note">{t(lang, { zh: "最高成本项", en: "Top metric" })}</span>
          <div className="meta">{topBillingMetric ? t(lang, topBillingMetric.label) : "-"}</div>
        </div>
        <div className="fake-input governance-field">
          <span className="tiny-note">{t(lang, { zh: "最近更新时间", en: "Latest update" })}</span>
          <div className="meta">
            {t(
              lang,
              formatIsoLabel(
                billingSummaryQuery.data?.updatedAt ?? null,
                l("尚无计量记录", "No metering yet")
              )
            )}
          </div>
        </div>
      </div>

      {topBillingMetric ? (
        <div className="meta">
          {t(
            lang,
            l(
              `最高成本项为 ${topBillingMetric.label.zh}，累计 ${formatBillingQuantity(topBillingMetric.quantity)}，金额 ${formatBillingUsd(topBillingMetric.amountUsd)}。`,
              `The highest-cost metric is ${topBillingMetric.label.en}, with ${formatBillingQuantity(topBillingMetric.quantity)} units and ${formatBillingUsd(topBillingMetric.amountUsd)} total.`
            )
          )}
        </div>
      ) : (
        <div className="panel-empty">
          {t(lang, {
            zh: "当前 package 还没有产生实际计量记录。",
            en: "No billable activity has been recorded for this package yet.",
          })}
        </div>
      )}
    </article>
  );

  const renderRecentBillingEntriesCard = () => (
    <article className="detail-item governance-card">
      <div className="card-row">
        <div>
          <div className="file-name">{t(lang, { zh: "最近计量事件", en: "Recent metering events" })}</div>
          <div className="meta">
            {t(lang, {
              zh: "用于核对导出、文件访问、消息发送、MCP 调用和运行时长对应的账单来源。",
              en: "Audit exports, file access, run messages, MCP calls, and runtime cost all appear here with their billing source.",
            })}
          </div>
        </div>
        <span className={`pill ${recentBillingEntries.length > 0 ? "active" : ""}`}>
          {recentBillingEntries.length}
        </span>
      </div>

      {recentBillingEntries.length === 0 ? (
        <div className="panel-empty">
          {t(lang, {
            zh: "没有命中的计量事件。",
            en: "No billing entries match the current scope.",
          })}
        </div>
      ) : (
        <div className="governance-stack">
          {recentBillingEntries.map((entry) => (
            <article className="detail-item governance-card" key={entry.entryId}>
              <div className="card-row">
                <div>
                  <div className="file-name">{t(lang, billingSourceLabel(entry.source))}</div>
                  <div className="meta">{entry.entryId}</div>
                </div>
                <span className={`pill ${billingSourceTone(entry.source)}`}>
                  {formatBillingUsd(entry.amountUsd)}
                </span>
              </div>
              <div className="governance-form-grid">
                <div className="fake-input governance-field">
                  <span className="tiny-note">{t(lang, { zh: "指标", en: "Metric" })}</span>
                  <div className="meta">{entry.metric}</div>
                </div>
                <div className="fake-input governance-field">
                  <span className="tiny-note">{t(lang, { zh: "数量", en: "Quantity" })}</span>
                  <div className="meta">{formatBillingQuantity(entry.quantity)}</div>
                </div>
                <div className="fake-input governance-field">
                  <span className="tiny-note">{t(lang, { zh: "成本依据", en: "Cost basis" })}</span>
                  <div className="meta">{entry.costBasis}</div>
                </div>
                <div className="fake-input governance-field">
                  <span className="tiny-note">{t(lang, { zh: "发生时间", en: "Occurred at" })}</span>
                  <div className="meta">{t(lang, formatIsoLabel(entry.occurredAt, l("-", "-")))}</div>
                </div>
              </div>
              {entry.note ? <div className="meta">{entry.note}</div> : null}
            </article>
          ))}
        </div>
      )}
    </article>
  );

  const dynamicGovernanceSummary = useMemo(() => {
    if (section !== "audit" && section !== "cost") {
      return null;
    }

    if (!governanceSummaryQuery.data) {
      return null;
    }

    return toGovernanceMetaFragment(governanceSummaryQuery.data);
  }, [governanceSummaryQuery.data, section]);
  const dynamicSummary = useMemo(() => {
    if (section === "members" && membersQuery.data) {
      const pendingInvitations = workspaceInvitations.filter(
        (item) => item.invitation.status === "pending"
      ).length;

      return canManageMembers
        ? l(
            `当前工作区共有 ${workspaceMembers.length} 名成员，${pendingInvitations} 个邀请仍待接受。成员状态、角色调整与邀请撤销现在直接写入正式后端治理链路。`,
            `${workspaceMembers.length} members are visible in this workspace and ${pendingInvitations} invitations are still pending. Member status changes, role edits, and invitation revokes now write directly into the formal backend governance chain.`
          )
        : l(
            `当前工作区共有 ${workspaceMembers.length} 名成员。当前角色可以查看成员结构和状态，但不能修改邀请或成员权限。`,
            `${workspaceMembers.length} members are visible in this workspace. The current role can inspect the membership topology and status but cannot change invitations or member permissions.`
          );
    }

    if (section === "credentials" && credentialsQuery.data) {
      if (credentialsQuery.data.length === 0) {
        return l(
          "当前工作区还没有登记任何凭证对象。先创建治理记录，再把凭证绑定到运行实例或外部连接器。",
          "No credential record exists for this workspace yet. Create a governance record first, then bind it into runs or external connectors."
        );
      }

      const workspaceScoped = credentialsQuery.data.filter((item) => item.scope === "workspace").length;
      const activeCredentials = credentialsQuery.data.filter((item) => item.status === "active").length;
      const rotationDue = credentialsQuery.data.filter((item) => item.status === "needs-rotation").length;

      return l(
        `当前工作区共登记 ${credentialsQuery.data.length} 个凭证对象，其中 ${workspaceScoped} 个跟随工作区注入，${activeCredentials} 个处于启用状态，${rotationDue} 个待轮换。`,
        `${credentialsQuery.data.length} credential records are visible in this workspace. ${workspaceScoped} are workspace-scoped, ${activeCredentials} are active, and ${rotationDue} still need rotation.`
      );
    }

    if (section === "policy" && mcpsQuery.data && bindingsQuery.data) {
      if (mcpsQuery.data.length === 0 && bindingsQuery.data.length === 0) {
        return l(
          "当前工作区还没有登记连接器或绑定策略。先注册 MCP，再声明运行时自动挂接与审批边界。",
          "No connector registry entry or binding policy exists in this workspace yet. Register an MCP first, then declare auto-attach and approval boundaries."
        );
      }

      const activeBindings = bindingsQuery.data.filter((item) => item.status === "active").length;
      const approvalRequired = bindingsQuery.data.filter((item) => item.approvalRequired).length;
      const autoAttached = bindingsQuery.data.filter((item) => item.autoAttach).length;

      return l(
        `当前工作区可见 ${mcpsQuery.data.length} 个连接器注册项、${bindingsQuery.data.length} 条绑定策略，其中 ${activeBindings} 条已生效，${approvalRequired} 条要求审批，${autoAttached} 条会在实例启动时自动挂接。`,
        `${mcpsQuery.data.length} connector registry entries and ${bindingsQuery.data.length} binding policies are visible in this workspace. ${activeBindings} are active, ${approvalRequired} require approval, and ${autoAttached} auto-attach during run boot.`
      );
    }

    if (dynamicGovernanceSummary) {
      return dynamicGovernanceSummary.summary;
    }

    return meta.summary;
  }, [
    canManageMembers,
    bindingsQuery.data,
    credentialsQuery.data,
    dynamicGovernanceSummary,
    membersQuery.data,
    mcpsQuery.data,
    meta.summary,
    section,
    workspaceInvitations,
    workspaceMembers,
  ]);

  const dynamicGovernanceRows = useMemo(() => {
    if (!dynamicGovernanceSummary) {
      return [];
    }

    return dynamicGovernanceSummary.rows.filter((row) =>
      matchesSearchQuery(query, rowSearchTexts(row))
    );
  }, [dynamicGovernanceSummary, query]);

  const filteredQuotaPolicies = useMemo(
    () =>
      quotaPolicies.filter((policy) =>
        matchesSearchQuery(query, [
          policy.policyId,
          policy.scopeRefId,
          policy.summary?.zh ?? "",
          policy.summary?.en ?? "",
          policy.notes ?? "",
          quotaScopeLabel(policy.scopeType).zh,
          quotaScopeLabel(policy.scopeType).en,
          quotaMetricLabel(policy.metric).zh,
          quotaMetricLabel(policy.metric).en,
          quotaPolicyStatusLabel(policy.status, policy.enabled).zh,
          quotaPolicyStatusLabel(policy.status, policy.enabled).en,
        ])
      ),
    [query, quotaPolicies]
  );
  const filteredQuotaOverrides = useMemo(
    () =>
      quotaOverrides.filter((item) =>
        matchesSearchQuery(query, [
          item.overrideId,
          item.policyId,
          item.scopeRefId,
          item.reasonSummary.zh,
          item.reasonSummary.en,
          quotaMetricLabel(item.metric).zh,
          quotaMetricLabel(item.metric).en,
          quotaOverrideStatusLabel(item.status).zh,
          quotaOverrideStatusLabel(item.status).en,
        ])
      ),
    [query, quotaOverrides]
  );
  const filteredQuotaEvents = useMemo(
    () =>
      quotaEvents.filter((item) =>
        matchesSearchQuery(query, [
          item.eventId,
          item.policyId,
          item.scopeRefId,
          item.note ?? "",
          quotaMetricLabel(item.metric).zh,
          quotaMetricLabel(item.metric).en,
          quotaEventDecisionLabel(item.decision).zh,
          quotaEventDecisionLabel(item.decision).en,
        ])
      ),
    [query, quotaEvents]
  );

  const credentialHeaders: [LocalizedString, LocalizedString, LocalizedString, LocalizedString] = [
    l("凭证名称", "Credential"),
    l("范围 / 提供方", "Scope / provider"),
    l("状态", "State"),
    l("注入摘要", "Injection summary"),
  ];
  const registryHeaders: [LocalizedString, LocalizedString, LocalizedString, LocalizedString] = [
    l("连接器", "Connector"),
    l("来源 / 传输", "Source / transport"),
    l("状态", "State"),
    l("运行策略", "Runtime policy"),
  ];
  const bindingHeaders: [LocalizedString, LocalizedString, LocalizedString, LocalizedString] = [
    l("绑定对象", "Binding"),
    l("作用域", "Scope"),
    l("状态", "State"),
    l("执行说明", "Execution note"),
  ];

  const recentAuditExports = auditExportsQuery.data ?? [];
  const sharedDynamicError =
    membersQuery.error ||
    invitationsQuery.error ||
    credentialsQuery.error ||
    mcpsQuery.error ||
    bindingsQuery.error ||
    selectedCredentialDetailQuery.error ||
    selectedCredentialUsageQuery.error ||
    auditExportsQuery.error ||
    mcpCallsQuery.error ||
    quotaPoliciesQuery.error ||
    quotaCountersQuery.error ||
    quotaEventsQuery.error ||
    quotaOverridesQuery.error ||
    billingSummaryQuery.error ||
    billingEntriesQuery.error ||
    governanceSummaryQuery.error;

  if (!authReady) {
    return (
      <div className="detail-body">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "治理设置", en: "Governance" })}</div>
            <div className="tab-title">{t(lang, meta.title)}</div>
          </div>
          <span className="pill active">{section}</span>
        </div>
        <div className="section-note">{t(lang, dynamicSummary)}</div>
        <div className="composer-error">
          {t(lang, {
            zh: "当前治理分段只接受已认证工作区的权威后端数据。未登录或未恢复会话时，不再显示静态治理样例。",
            en: "This governance segment accepts authoritative backend data from an authenticated workspace only. Static governance samples are no longer shown before sign-in or session recovery.",
          })}
        </div>
        <div className="governance-stack">
          <article className="detail-item governance-card">
            <div className="card-row">
              <div>
                <div className="file-name">{t(lang, { zh: "当前上下文", en: "Current context" })}</div>
                <div className="meta">{t(lang, workspaceLabel)}</div>
              </div>
              <span className="pill warn">{packageId}</span>
            </div>
            <div className="panel-empty">
              {t(
                lang,
                l(
                  "先恢复 Dashboard 登录态，再查看凭证、成员、MCP、审计和成本治理的正式对象。",
                  "Restore the Dashboard session first, then reopen governance to inspect formal credentials, members, MCP policies, audit records, and cost controls."
                )
              )}
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-body">
      <div className="section-head">
        <div>
          <div className="eyebrow">{t(lang, { zh: "治理设置", en: "Governance" })}</div>
          <div className="tab-title">{t(lang, meta.title)}</div>
        </div>
        <span className="pill active">{section}</span>
      </div>
      <div className="section-note">{t(lang, dynamicSummary)}</div>

      {sharedDynamicError &&
      (section === "credentials" ||
        section === "members" ||
        section === "policy" ||
        section === "audit" ||
        section === "cost") ? (
        <div className="composer-error">{queryErrorMessage(sharedDynamicError)}</div>
      ) : null}

      <div className="quick-grid">
        {(section === "members"
          ? memberMetrics
          : section === "credentials"
          ? credentialMetrics
          : section === "policy"
            ? policyMetrics
            : dynamicGovernanceSummary?.metrics ?? meta.metrics
        ).map((item) => (
          <div className="quick-box" key={t(lang, item.label)}>
            <div className="quick-label">{t(lang, item.label)}</div>
            <div className="quick-value">{item.value}</div>
            <div className="tiny-note">{t(lang, item.note)}</div>
          </div>
        ))}
      </div>

      <div className="task-row">
        <label className="fake-input governance-search">
          <svg
            className="icon"
            style={{ display: "inline-block", verticalAlign: -4, width: 14, height: 14, marginRight: 6 }}
          >
            <use href="#i-search" />
          </svg>
          <input
            className="search-inline-input"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(lang, {
              zh: "搜索当前治理页的域名、范围、状态或说明",
              en: "Search domains, scope, state, or notes in the current governance view",
            })}
          />
        </label>
        <div className="pill-row">
          {section === "credentials" ? (
            <>
              <button
                className={`route-btn ${credentialEditorMode === "create" ? "active" : ""}`}
                type="button"
                onClick={() => setCredentialEditorMode("create")}
              >
                {t(lang, { zh: "新增凭证", en: "Create credential" })}
              </button>
              <button
                className={`route-btn ${credentialEditorMode === "rotate" ? "active" : ""}`}
                type="button"
                disabled={!selectedCredentialId}
                onClick={() => setCredentialEditorMode("rotate")}
              >
                {t(lang, { zh: "轮换选中", en: "Rotate selected" })}
              </button>
            </>
          ) : section === "policy" ? (
            <>
              <button
                className={`route-btn ${policyEditorMode === "registry" ? "active" : ""}`}
                type="button"
                onClick={() => setPolicyEditorMode("registry")}
              >
                {t(lang, { zh: "连接器注册", en: "Registry" })}
              </button>
              <button
                className={`route-btn ${policyEditorMode === "binding" ? "active" : ""}`}
                type="button"
                onClick={() => setPolicyEditorMode("binding")}
              >
                {t(lang, { zh: "绑定策略", en: "Bindings" })}
              </button>
            </>
          ) : section === "audit" ? (
            <>
              <button
                className="route-btn active"
                type="button"
                disabled={createAuditExportMutation.isPending}
                onClick={() => void createAuditExportMutation.mutateAsync("json")}
              >
                {createAuditExportMutation.isPending
                  ? t(lang, { zh: "导出中...", en: "Exporting..." })
                  : t(lang, { zh: "导出审计 JSON", en: "Export audit JSON" })}
              </button>
              <button
                className="route-btn"
                type="button"
                disabled={createAuditExportMutation.isPending}
                onClick={() => void createAuditExportMutation.mutateAsync("csv")}
              >
                {t(lang, { zh: "导出审计 CSV", en: "Export audit CSV" })}
              </button>
            </>
          ) : section === "cost" ? (
            <>
              <button
                className={`route-btn ${showQuotaPolicyForm ? "active" : ""}`}
                type="button"
                onClick={() => setShowQuotaPolicyForm((current) => !current)}
              >
                {t(
                  lang,
                  showQuotaPolicyForm
                    ? { zh: "收起额度策略", en: "Hide quota form" }
                    : { zh: "创建额度策略", en: "Create quota policy" }
                )}
              </button>
              <button
                className="route-btn"
                type="button"
                onClick={() => {
                  setQuotaActionError(null);
                  void invalidateCostState();
                }}
              >
                {t(lang, { zh: "刷新成本状态", en: "Refresh cost state" })}
              </button>
            </>
          ) : (
            meta.actions.map((item) => (
              <button className="route-btn" key={t(lang, item)} type="button">
                {t(lang, item)}
              </button>
            ))
          )}
        </div>
      </div>

      {section === "credentials" ? (
        <>
          <GovernanceDataTable
            headers={credentialHeaders}
            rows={filteredCredentialRows}
            emptyText={l(
              "当前工作区还没有凭证对象。可以先创建第一条治理记录。",
              "No credential records exist yet. Create the first governance record to continue."
            )}
          />

          <div className="governance-stack">
            <article className="detail-item governance-card">
              <div className="card-row">
                <div>
                  <div className="file-name">
                    {t(
                      lang,
                      credentialEditorMode === "create"
                        ? { zh: "新增凭证对象", en: "Create credential record" }
                        : { zh: "轮换选中凭证", en: "Rotate selected credential" }
                    )}
                  </div>
                  <div className="meta">
                    {credentialEditorMode === "create"
                      ? t(lang, {
                          zh: "这一步只写治理对象与注入元数据。Secret 本体仍由你自己的凭证系统或载体保管。",
                          en: "This writes the governance record and injection metadata only. The secret value itself remains in your own credential store.",
                        })
                      : t(lang, {
                          zh: "轮换动作会更新 secret ref、轮换时间和后续到期计划，不会泄露真实凭证明文。",
                          en: "Rotation updates the secret ref, rotation timestamp, and due plan without revealing raw secret material.",
                        })}
                  </div>
                </div>
                {selectedCredential ? (
                  <button
                    className={`path-chip ${selectedCredential.credentialId === selectedCredentialId ? "active" : ""}`}
                    type="button"
                    onClick={() => setCredentialEditorMode("rotate")}
                  >
                    {selectedCredential.credentialId}
                  </button>
                ) : null}
              </div>

              {credentialEditorMode === "create" ? (
                <>
                  <div className="governance-form-grid">
                    <GovernanceField label={l("作用域", "Scope")}>
                      <GovernanceSelect
                        value={credentialDraft.scope}
                        onChange={(scope) => setCredentialDraft((current) => ({ ...current, scope }))}
                        options={[
                          { value: "workspace", label: l("工作区", "Workspace") },
                          { value: "user", label: l("用户", "User") },
                        ]}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("凭证名称", "Display name")}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={credentialDraft.displayName}
                        onChange={(event) =>
                          setCredentialDraft((current) => ({ ...current, displayName: event.target.value }))
                        }
                        placeholder={t(lang, l("例如：品牌图像 API Key", "For example: Brand image API key"))}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("提供方", "Provider")}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={credentialDraft.provider}
                        onChange={(event) =>
                          setCredentialDraft((current) => ({ ...current, provider: event.target.value }))
                        }
                        placeholder={t(lang, l("例如：OpenAI / Seedance / Browser", "For example: OpenAI / Seedance / Browser"))}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("凭证类型", "Secret kind")}>
                      <GovernanceSelect
                        value={credentialDraft.secretKind}
                        onChange={(secretKind) => setCredentialDraft((current) => ({ ...current, secretKind }))}
                        options={[
                          { value: "api-key", label: l("API Key", "API key") },
                          { value: "access-token", label: l("访问令牌", "Access token") },
                          { value: "oauth-token", label: l("OAuth 令牌", "OAuth token") },
                          { value: "json-file", label: l("JSON 文件", "JSON file") },
                          { value: "browser-storage-state", label: l("浏览器状态", "Browser storage state") },
                          { value: "session-cookie", label: l("会话 Cookie", "Session cookie") },
                        ]}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("注入方式", "Mount mode")}>
                      <GovernanceSelect
                        value={credentialDraft.mountMode}
                        onChange={(mountMode) => setCredentialDraft((current) => ({ ...current, mountMode }))}
                        options={[
                          { value: "env", label: l("环境变量", "Env") },
                          { value: "file", label: l("文件挂载", "File") },
                        ]}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("密钥明文", "Secret value")}>
                      <GovernanceTextArea
                        value={credentialDraft.secretValue}
                        onChange={(secretValue) =>
                          setCredentialDraft((current) => ({ ...current, secretValue }))
                        }
                        placeholder={l(
                          "输入将被加密保存并在运行时物化的真实凭证内容。",
                          "Enter the raw secret material that will be encrypted at rest and materialized at run time."
                        )}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("Secret Ref", "Secret ref")}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={credentialDraft.secretRef}
                        onChange={(event) =>
                          setCredentialDraft((current) => ({ ...current, secretRef: event.target.value }))
                        }
                        placeholder={t(
                          lang,
                          l("例如：vault://workspace/brand/openai-key", "For example: vault://workspace/brand/openai-key")
                        )}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("环境变量名", "Env name")}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={credentialDraft.envName}
                        onChange={(event) =>
                          setCredentialDraft((current) => ({ ...current, envName: event.target.value }))
                        }
                        placeholder={t(lang, l("例如：OPENAI_API_KEY", "For example: OPENAI_API_KEY"))}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("文件模板路径", "Mount path template")}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={credentialDraft.mountPathTemplate}
                        onChange={(event) =>
                          setCredentialDraft((current) => ({ ...current, mountPathTemplate: event.target.value }))
                        }
                        placeholder={t(lang, l("例如：/run/secrets/openai-api-key", "For example: /run/secrets/openai-api-key"))}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("下次轮换时间", "Next rotation due")}>
                      <input
                        className="search-inline-input"
                        type="datetime-local"
                        value={credentialDraft.rotationDueAt}
                        onChange={(event) =>
                          setCredentialDraft((current) => ({ ...current, rotationDueAt: event.target.value }))
                        }
                      />
                    </GovernanceField>
                  </div>
                  <GovernanceField label={l("备注", "Notes")}>
                    <GovernanceTextArea
                      value={credentialDraft.notes}
                      onChange={(notes) => setCredentialDraft((current) => ({ ...current, notes }))}
                      placeholder={l(
                        "说明凭证用途、来源或轮换策略。",
                        "Describe the intended use, source, or rotation policy."
                      )}
                    />
                  </GovernanceField>
                  {createCredentialMutation.error ? (
                    <div className="composer-error">{queryErrorMessage(createCredentialMutation.error)}</div>
                  ) : null}
                  <div className="governance-form-actions">
                    <button
                      className="route-btn active"
                      type="button"
                      disabled={createCredentialMutation.isPending}
                      onClick={() => void createCredentialMutation.mutateAsync()}
                    >
                      {createCredentialMutation.isPending
                        ? t(lang, { zh: "创建中...", en: "Creating..." })
                        : t(lang, { zh: "保存凭证", en: "Save credential" })}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="governance-inline-meta">
                    <span className={`pill ${selectedCredential ? localizedStatusTone(selectedCredential.status) : ""}`}>
                      {selectedCredential ? t(lang, credentialStatusLabel(selectedCredential.status)) : "-"}
                    </span>
                    <span className="path-chip">{selectedCredential ? t(lang, credentialScopeLabel(selectedCredential.scope)) : "-"}</span>
                    <span className="path-chip">
                      {selectedCredential ? t(lang, credentialKindLabel(selectedCredential.secretKind)) : "-"}
                    </span>
                    <span className="path-chip">
                      {selectedCredential
                        ? t(
                            lang,
                            formatIsoLabel(
                              selectedCredential.rotationDueAt,
                              l("未设置轮换时间", "No rotation due date")
                            )
                          )
                        : "-"}
                    </span>
                  </div>
                  {selectedCredentialUsage ? (
                    <>
                      <div className="quick-grid">
                        <div className="quick-box">
                          <div className="quick-label">{t(lang, l("关联运行", "Referenced runs"))}</div>
                          <div className="quick-value">
                            {String(selectedCredentialUsage.summary.totalRunCount).padStart(2, "0")}
                          </div>
                          <div className="tiny-note">
                            {t(lang, l("当前凭证在运行图中的总引用次数。", "Total run references resolved for this credential."))}
                          </div>
                        </div>
                        <div className="quick-box">
                          <div className="quick-label">{t(lang, l("活跃运行", "Active runs"))}</div>
                          <div className="quick-value">
                            {String(selectedCredentialUsage.summary.activeRunCount).padStart(2, "0")}
                          </div>
                          <div className="tiny-note">
                            {t(lang, l("这些运行仍可能继续消费当前凭证。", "These runs may still consume the credential."))}
                          </div>
                        </div>
                        <div className="quick-box">
                          <div className="quick-label">{t(lang, l("绑定策略", "Binding policies"))}</div>
                          <div className="quick-value">
                            {String(selectedCredentialUsage.summary.bindingCount).padStart(2, "0")}
                          </div>
                          <div className="tiny-note">
                            {t(lang, l("工作区内直接引用该凭证的 MCP 绑定数。", "MCP bindings that directly reference this credential."))}
                          </div>
                        </div>
                      </div>
                      <GovernanceDataTable
                        headers={credentialUsageRunHeaders}
                        rows={activeCredentialUsageRows}
                        emptyText={l(
                          "当前没有活跃运行占用该凭证，可以直接执行停用或吊销动作。",
                          "No active runs currently depend on this credential."
                        )}
                      />
                      <GovernanceDataTable
                        headers={credentialUsageBindingHeaders}
                        rows={credentialBindingUsageRows}
                        emptyText={l(
                          "当前没有 MCP 绑定直接引用该凭证。",
                          "No MCP bindings directly reference this credential."
                        )}
                      />
                      <GovernanceDataTable
                        headers={credentialUsageRunHeaders}
                        rows={recentCredentialUsageRows}
                        emptyText={l(
                          "当前还没有可展示的历史运行引用。",
                          "No historical run references are available yet."
                        )}
                      />
                    </>
                  ) : selectedCredentialUsageQuery.isLoading ? (
                    <div className="meta">
                      {t(lang, {
                        zh: "正在汇总当前凭证的运行与绑定引用图...",
                        en: "Building the run and binding usage graph for this credential...",
                      })}
                    </div>
                  ) : null}
                  <div className="governance-form-grid">
                    <GovernanceField label={l("选中凭证", "Selected credential")}>
                      <select
                        className="governance-select"
                        value={selectedCredentialId ?? ""}
                        onChange={(event) => setSelectedCredentialId(event.target.value || null)}
                      >
                        {(credentialsQuery.data ?? []).map((item) => (
                          <option key={item.credentialId} value={item.credentialId}>
                            {item.displayName}
                          </option>
                        ))}
                      </select>
                    </GovernanceField>
                    <GovernanceField label={l("新的密钥明文", "New secret value")}>
                      <GovernanceTextArea
                        value={credentialRotateDraft.secretValue}
                        onChange={(secretValue) =>
                          setCredentialRotateDraft((current) => ({ ...current, secretValue }))
                        }
                        placeholder={l(
                          "输入本次轮换后的真实凭证内容。",
                          "Enter the replacement secret material for this rotation."
                        )}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("新的 Secret Ref", "New secret ref")}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={credentialRotateDraft.secretRef}
                        onChange={(event) =>
                          setCredentialRotateDraft((current) => ({ ...current, secretRef: event.target.value }))
                        }
                        placeholder={t(lang, l("例如：vault://workspace/brand/openai-key@2026-07", "For example: vault://workspace/brand/openai-key@2026-07"))}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("新的轮换到期时间", "New rotation due")}>
                      <input
                        className="search-inline-input"
                        type="datetime-local"
                        value={credentialRotateDraft.rotationDueAt}
                        onChange={(event) =>
                          setCredentialRotateDraft((current) => ({
                            ...current,
                            rotationDueAt: event.target.value,
                          }))
                        }
                      />
                    </GovernanceField>
                    <GovernanceField label={l("当前注入模板", "Current injection template")}>
                      <div className="meta">
                        {selectedCredential
                          ? `${t(lang, credentialMountLabel(selectedCredential.mountMode))} / ${
                              selectedCredential.envName || selectedCredential.mountPathTemplate || "-"
                            }`
                          : "-"}
                      </div>
                    </GovernanceField>
                  </div>
                  <GovernanceField label={l("轮换备注", "Rotation note")}>
                    <GovernanceTextArea
                      value={credentialRotateDraft.note}
                      onChange={(note) => setCredentialRotateDraft((current) => ({ ...current, note }))}
                      placeholder={l(
                        "说明此次轮换原因、批次或关联变更单。",
                        "Describe why the rotation happened and reference the related change set."
                      )}
                    />
                  </GovernanceField>
                  <div className="governance-form-grid">
                    <GovernanceField label={l("活跃运行影响策略", "Active run impact action")}>
                      <GovernanceSelect
                        value={credentialLifecycleDraft.impactAction}
                        onChange={(impactAction) =>
                          setCredentialLifecycleDraft((current) => ({ ...current, impactAction }))
                        }
                        options={[
                          { value: "block", label: credentialImpactActionLabel("block") },
                          {
                            value: "allow-active-runs",
                            label: credentialImpactActionLabel("allow-active-runs"),
                          },
                          {
                            value: "cancel-active-runs",
                            label: credentialImpactActionLabel("cancel-active-runs"),
                          },
                        ]}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("停用 / 吊销备注", "Suspend / revoke note")}>
                      <GovernanceTextArea
                        value={credentialLifecycleDraft.note}
                        onChange={(note) =>
                          setCredentialLifecycleDraft((current) => ({ ...current, note }))
                        }
                        placeholder={l(
                          "说明本次停用或吊销的原因、关联事件和执行窗口。",
                          "Describe why the credential is being suspended or revoked."
                        )}
                      />
                    </GovernanceField>
                  </div>
                  {rotateCredentialMutation.error ? (
                    <div className="composer-error">{queryErrorMessage(rotateCredentialMutation.error)}</div>
                  ) : null}
                  {suspendCredentialMutation.error ? (
                    <div className="composer-error">{queryErrorMessage(suspendCredentialMutation.error)}</div>
                  ) : null}
                  {revokeCredentialMutation.error ? (
                    <div className="composer-error">{queryErrorMessage(revokeCredentialMutation.error)}</div>
                  ) : null}
                  <div className="governance-form-actions">
                    <button
                      className="route-btn active"
                      type="button"
                      disabled={!selectedCredentialId || rotateCredentialMutation.isPending}
                      onClick={() => void rotateCredentialMutation.mutateAsync()}
                    >
                      {rotateCredentialMutation.isPending
                        ? t(lang, { zh: "轮换中...", en: "Rotating..." })
                        : t(lang, { zh: "提交轮换", en: "Submit rotation" })}
                    </button>
                    <button
                      className="route-btn"
                      type="button"
                      disabled={!selectedCredentialId || suspendCredentialMutation.isPending}
                      onClick={() => void suspendCredentialMutation.mutateAsync()}
                    >
                      {suspendCredentialMutation.isPending
                        ? t(lang, { zh: "停用处理中...", en: "Suspending..." })
                        : t(lang, { zh: "停用凭证", en: "Suspend credential" })}
                    </button>
                    <button
                      className="route-btn"
                      type="button"
                      disabled={!selectedCredentialId || revokeCredentialMutation.isPending}
                      onClick={() => void revokeCredentialMutation.mutateAsync()}
                    >
                      {revokeCredentialMutation.isPending
                        ? t(lang, { zh: "吊销处理中...", en: "Revoking..." })
                        : t(lang, { zh: "吊销凭证", en: "Revoke credential" })}
                    </button>
                  </div>
                </>
              )}
            </article>
          </div>
        </>
      ) : section === "policy" ? (
        <>
          <GovernanceDataTable
            headers={registryHeaders}
            rows={filteredRegistryRows}
            emptyText={l(
              "当前工作区还没有注册外部连接器。可以先补一条第三方或工作区托管 MCP。",
              "No external connectors are registered yet. Add a third-party or workspace-managed MCP first."
            )}
          />

          <GovernanceDataTable
            headers={bindingHeaders}
            rows={filteredBindingRows}
            emptyText={l(
              "当前工作区还没有绑定策略。创建绑定后，实例启动时才会自动解析并挂接连接器。",
              "No binding policies exist yet. Create a binding so runs can resolve and attach connectors during boot."
            )}
          />

          <div className="governance-stack">
            {policyEditorMode === "registry" ? (
              <article className="detail-item governance-card">
                <div className="file-name">{t(lang, { zh: "注册第三方 / 工作区托管 MCP", en: "Register third-party or workspace-managed MCP" })}</div>
                <div className="meta">
                  {t(lang, {
                    zh: "这一层定义连接器本身。第一方能力由平台内建，不在这里重复登记。",
                    en: "This layer defines the connector itself. First-party capabilities stay platform-owned and are not re-registered here.",
                  })}
                </div>
                <div className="governance-form-grid">
                  <GovernanceField label={l("MCP ID", "MCP ID")}>
                    <input
                      className="search-inline-input"
                      type="text"
                      value={mcpDraft.mcpId}
                      onChange={(event) => setMcpDraft((current) => ({ ...current, mcpId: event.target.value }))}
                      placeholder={t(lang, l("例如：third-party:figma-mcp", "For example: third-party:figma-mcp"))}
                    />
                  </GovernanceField>
                  <GovernanceField label={l("显示名称", "Display name")}>
                    <input
                      className="search-inline-input"
                      type="text"
                      value={mcpDraft.displayName}
                      onChange={(event) =>
                        setMcpDraft((current) => ({ ...current, displayName: event.target.value }))
                      }
                      placeholder={t(lang, l("例如：Figma MCP", "For example: Figma MCP"))}
                    />
                  </GovernanceField>
                  <GovernanceField label={l("来源", "Source")}>
                    <GovernanceSelect
                      value={mcpDraft.source}
                      onChange={(source) => setMcpDraft((current) => ({ ...current, source }))}
                      options={[
                        { value: "third-party", label: l("第三方", "Third party") },
                        { value: "workspace-managed", label: l("工作区托管", "Workspace managed") },
                      ]}
                    />
                  </GovernanceField>
                  <GovernanceField label={l("传输协议", "Transport")}>
                    <GovernanceSelect
                      value={mcpDraft.transport}
                      onChange={(transport) => setMcpDraft((current) => ({ ...current, transport }))}
                      options={[
                        { value: "http", label: l("HTTP", "HTTP") },
                        { value: "sse", label: l("SSE", "SSE") },
                        { value: "stdio", label: l("STDIO", "STDIO") },
                        { value: "websocket", label: l("WebSocket", "WebSocket") },
                      ]}
                    />
                  </GovernanceField>
                    <GovernanceField label={l("引用地址", "Connector ref")}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={mcpDraft.ref}
                      onChange={(event) => setMcpDraft((current) => ({ ...current, ref: event.target.value }))}
                        placeholder={t(lang, l("例如：https://mcp.example.com/sse", "For example: https://mcp.example.com/sse"))}
                      />
                    </GovernanceField>
                    {mcpDraft.transport === "stdio" ? (
                      <GovernanceField label={l("执行路径摘要", "Ref SHA-256")}>
                        <input
                          className="search-inline-input"
                          type="text"
                          value={mcpDraft.stdioRefSha256}
                          onChange={(event) =>
                            setMcpDraft((current) => ({
                              ...current,
                              stdioRefSha256: event.target.value,
                            }))
                          }
                          placeholder={t(
                            lang,
                            l(
                              "填写 stdio 可执行路径的 SHA-256 摘要。",
                              "Provide the SHA-256 digest of the stdio executable path."
                            )
                          )}
                        />
                      </GovernanceField>
                    ) : null}
                    <GovernanceField label={l("风险等级", "Risk level")}>
                      <GovernanceSelect
                        value={mcpDraft.riskLevel}
                        onChange={(riskLevel) => setMcpDraft((current) => ({ ...current, riskLevel }))}
                      options={[
                        { value: "low", label: l("低风险", "Low") },
                        { value: "medium", label: l("中风险", "Medium") },
                        { value: "high", label: l("高风险", "High") },
                        { value: "critical", label: l("关键风险", "Critical") },
                      ]}
                    />
                  </GovernanceField>
                  <GovernanceField label={l("默认凭证", "Default credential")}>
                    <select
                      className="governance-select"
                      value={mcpDraft.defaultCredentialId}
                      onChange={(event) =>
                        setMcpDraft((current) => ({ ...current, defaultCredentialId: event.target.value }))
                      }
                    >
                      <option value="">{t(lang, { zh: "无", en: "None" })}</option>
                      {(credentialsQuery.data ?? []).map((item) => (
                        <option key={item.credentialId} value={item.credentialId}>
                          {item.displayName}
                        </option>
                      ))}
                    </select>
                  </GovernanceField>
                  <GovernanceField label={l("标签", "Tags")}>
                    <input
                      className="search-inline-input"
                      type="text"
                      value={mcpDraft.tags}
                      onChange={(event) => setMcpDraft((current) => ({ ...current, tags: event.target.value }))}
                      placeholder={t(lang, l("逗号分隔，例如：design,asset,sse", "Comma separated, for example: design,asset,sse"))}
                    />
                  </GovernanceField>
                </div>
                <GovernanceCheckbox
                  checked={mcpDraft.approvalRequired}
                  onChange={(approvalRequired) => setMcpDraft((current) => ({ ...current, approvalRequired }))}
                  label={l("高风险调用必须先经审批", "Require approval for high-risk use")}
                />
                <GovernanceField label={l("描述", "Description")}>
                  <GovernanceTextArea
                    value={mcpDraft.description}
                    onChange={(description) => setMcpDraft((current) => ({ ...current, description }))}
                    placeholder={l(
                      "记录连接器用途、供应方、访问边界和上线约束。",
                      "Describe the connector purpose, provider, access boundary, and rollout constraints."
                    )}
                  />
                </GovernanceField>
                {createMcpMutation.error ? (
                  <div className="composer-error">{queryErrorMessage(createMcpMutation.error)}</div>
                ) : null}
                <div className="governance-form-actions">
                  <button
                    className="route-btn active"
                    type="button"
                    disabled={createMcpMutation.isPending}
                    onClick={() => void createMcpMutation.mutateAsync()}
                  >
                    {createMcpMutation.isPending
                      ? t(lang, { zh: "注册中...", en: "Registering..." })
                      : t(lang, { zh: "注册 MCP", en: "Register MCP" })}
                  </button>
                </div>
              </article>
            ) : (
              <article className="detail-item governance-card">
                <div className="file-name">{t(lang, { zh: "创建绑定策略", en: "Create binding policy" })}</div>
                <div className="meta">
                  {t(lang, {
                    zh: `绑定策略决定 ${t(lang, workspaceLabel)} 下的实例在启动时如何自动挂接 MCP 与凭证。`,
                    en: `Binding policies decide how runs inside ${t(lang, workspaceLabel)} auto-attach MCPs and credentials at boot.`,
                  })}
                </div>
                <div className="governance-form-grid">
                  <GovernanceField label={l("目标 MCP", "Target MCP")}>
                    <select
                      className="governance-select"
                      value={bindingDraft.mcpId}
                      onChange={(event) => setBindingDraft((current) => ({ ...current, mcpId: event.target.value }))}
                    >
                      {(mcpsQuery.data ?? []).map((item) => (
                        <option key={item.mcpId} value={item.mcpId}>
                          {item.displayName}
                        </option>
                      ))}
                    </select>
                  </GovernanceField>
                  <GovernanceField label={l("作用域", "Binding scope")}>
                    <GovernanceSelect
                      value={bindingDraft.scope}
                      onChange={(scope) => setBindingDraft((current) => ({ ...current, scope }))}
                      options={[
                        { value: "workspace", label: l("工作区", "Workspace") },
                        { value: "user", label: l("用户", "User") },
                        { value: "session-version", label: l("Session 版本", "Session version") },
                        { value: "run", label: l("运行实例", "Run") },
                      ]}
                    />
                  </GovernanceField>
                  <GovernanceField label={l("Scope Ref", "Scope ref")}>
                    <input
                      className="search-inline-input"
                      type="text"
                      value={bindingDraft.scopeRef}
                      onChange={(event) => setBindingDraft((current) => ({ ...current, scopeRef: event.target.value }))}
                      placeholder={t(
                        lang,
                        l(
                          `留空可回退为当前工作区 ${workspaceRuntimeId}`,
                          `Leave empty to fall back to workspace ${workspaceRuntimeId}`
                        )
                      )}
                    />
                  </GovernanceField>
                  <GovernanceField label={l("绑定凭证", "Bound credential")}>
                    <select
                      className="governance-select"
                      value={bindingDraft.credentialId}
                      onChange={(event) =>
                        setBindingDraft((current) => ({ ...current, credentialId: event.target.value }))
                      }
                    >
                      <option value="">{t(lang, { zh: "无", en: "None" })}</option>
                      {(credentialsQuery.data ?? []).map((item) => (
                        <option key={item.credentialId} value={item.credentialId}>
                          {item.displayName}
                        </option>
                      ))}
                    </select>
                  </GovernanceField>
                  <GovernanceField label={l("网络策略引用", "Network policy ref")}>
                    <input
                      className="search-inline-input"
                      type="text"
                      value={bindingDraft.networkPolicyRef}
                      onChange={(event) =>
                        setBindingDraft((current) => ({ ...current, networkPolicyRef: event.target.value }))
                      }
                      placeholder={t(lang, l("例如：net/default-egress", "For example: net/default-egress"))}
                    />
                  </GovernanceField>
                </div>
                <div className="governance-toggle-row">
                  <GovernanceCheckbox
                    checked={bindingDraft.approvalRequired}
                    onChange={(approvalRequired) =>
                      setBindingDraft((current) => ({ ...current, approvalRequired }))
                    }
                    label={l("使用该绑定前需要审批", "Require approval before use")}
                  />
                  <GovernanceCheckbox
                    checked={bindingDraft.autoAttach}
                    onChange={(autoAttach) => setBindingDraft((current) => ({ ...current, autoAttach }))}
                    label={l("实例启动时自动挂接", "Auto-attach during run boot")}
                  />
                </div>
                <GovernanceField label={l("备注", "Notes")}>
                  <GovernanceTextArea
                    value={bindingDraft.notes}
                    onChange={(notes) => setBindingDraft((current) => ({ ...current, notes }))}
                    placeholder={l(
                      "说明该绑定面向的工坊、版本或风险边界。",
                      "Document the workshop, version, or risk boundary targeted by this binding."
                    )}
                  />
                </GovernanceField>
                {createBindingMutation.error ? (
                  <div className="composer-error">{queryErrorMessage(createBindingMutation.error)}</div>
                ) : null}
                <div className="governance-form-actions">
                  <button
                    className="route-btn active"
                    type="button"
                    disabled={!bindingDraft.mcpId || createBindingMutation.isPending}
                    onClick={() => void createBindingMutation.mutateAsync()}
                  >
                    {createBindingMutation.isPending
                      ? t(lang, { zh: "绑定中...", en: "Binding..." })
                      : t(lang, { zh: "保存绑定", en: "Save binding" })}
                  </button>
                </div>
              </article>
            )}
          </div>
        </>
      ) : section === "cost" ? (
        <>
          <GovernanceDataTable
            headers={dynamicGovernanceSummary?.headers ?? meta.headers}
            rows={dynamicGovernanceRows}
            emptyText={l(
              "当前成本治理视图还没有可展示的数据。",
              "No metering rows are available in the current cost governance view."
            )}
          />

          <div className="governance-stack">
            <article className="detail-item governance-card">
              <div className="card-row">
                <div>
                  <div className="file-name">{t(lang, { zh: "额度策略台账", en: "Quota policy ledger" })}</div>
                  <div className="meta">
                    {t(
                      lang,
                      showQuotaPolicyForm
                        ? {
                            zh: "在当前工作区上下文下新增正式额度策略，直接影响 run 创建前预检查和后续审批链。",
                            en: "Create formal quota policies for the current workspace context. They immediately affect pre-run checks and the approval path.",
                          }
                        : {
                            zh: "这里展示命中当前 package 与工作区上下文的正式额度策略、即时计数器和最新决策事件。",
                            en: "This ledger shows the active quota policies, live counters, and latest decision events in scope for this package and workspace context.",
                          }
                    )}
                  </div>
                </div>
                {quotaPoliciesQuery.isFetching ? (
                  <span className="pill active">{t(lang, { zh: "同步中", en: "Syncing" })}</span>
                ) : (
                  <span className="pill active">{filteredQuotaPolicies.length}</span>
                )}
              </div>

              {quotaActionError ? <div className="composer-error">{quotaActionError}</div> : null}

              {showQuotaPolicyForm ? (
                <>
                  <div className="governance-form-grid">
                    <GovernanceField label={l("计量范围", "Scope type")}>
                      <GovernanceSelect
                        value={quotaPolicyDraft.scopeType}
                        onChange={(scopeType) =>
                          setQuotaPolicyDraft((current) => ({ ...current, scopeType }))
                        }
                        options={[
                          { value: "workspace-context", label: l("工作区上下文", "Workspace context") },
                          { value: "package", label: l("Creator 包", "Creator package") },
                          { value: "workspace", label: l("工作区", "Workspace") },
                          { value: "service", label: l("服务", "Service") },
                          { value: "entry-surface", label: l("入口面", "Entry surface") },
                        ]}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("Scope Ref", "Scope ref")}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={quotaPolicyDraft.scopeRefId}
                        onChange={(event) =>
                          setQuotaPolicyDraft((current) => ({
                            ...current,
                            scopeRefId: event.target.value,
                          }))
                        }
                        placeholder={t(
                          lang,
                          l(
                            resolveQuotaDraftScopeRefId(
                              quotaPolicyDraft.scopeType,
                              quotaPolicyDraft.scopeRefId,
                              { workspaceRuntimeId, workspaceContextKey, packageId }
                            ) || "请输入精确 scope ref",
                            resolveQuotaDraftScopeRefId(
                              quotaPolicyDraft.scopeType,
                              quotaPolicyDraft.scopeRefId,
                              { workspaceRuntimeId, workspaceContextKey, packageId }
                            ) || "Provide an exact scope ref"
                          )
                        )}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("计量指标", "Metric")}>
                      <GovernanceSelect
                        value={quotaPolicyDraft.metric}
                        onChange={(metric) =>
                          setQuotaPolicyDraft((current) => ({ ...current, metric }))
                        }
                        options={[
                          { value: "daily_runs", label: l("单日实例数", "Daily runs") },
                          { value: "active_runs", label: l("活跃实例数", "Active runs") },
                          { value: "browser_minutes", label: l("浏览器分钟", "Browser minutes") },
                          { value: "image_credits", label: l("图像额度", "Image credits") },
                          { value: "audit_exports", label: l("审计导出次数", "Audit exports") },
                          { value: "mcp_calls", label: l("MCP 调用数", "MCP calls") },
                          { value: "model_tokens", label: l("模型 Token", "Model tokens") },
                        ]}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("窗口", "Window")}>
                      <GovernanceSelect
                        value={quotaPolicyDraft.windowType}
                        onChange={(windowType) =>
                          setQuotaPolicyDraft((current) => ({ ...current, windowType }))
                        }
                        options={[
                          { value: "daily", label: l("单日", "Daily") },
                          { value: "instant", label: l("瞬时", "Instant") },
                          { value: "monthly", label: l("月度", "Monthly") },
                        ]}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("阈值", "Limit value")}>
                      <input
                        className="search-inline-input"
                        type="number"
                        min="0"
                        value={quotaPolicyDraft.limitValue}
                        onChange={(event) =>
                          setQuotaPolicyDraft((current) => ({
                            ...current,
                            limitValue: event.target.value,
                          }))
                        }
                      />
                    </GovernanceField>
                    <GovernanceField label={l("软阈值", "Soft limit")}>
                      <input
                        className="search-inline-input"
                        type="number"
                        min="0"
                        value={quotaPolicyDraft.softLimitValue}
                        onChange={(event) =>
                          setQuotaPolicyDraft((current) => ({
                            ...current,
                            softLimitValue: event.target.value,
                          }))
                        }
                        placeholder="optional"
                      />
                    </GovernanceField>
                    <GovernanceField label={l("硬阈值", "Hard limit")}>
                      <input
                        className="search-inline-input"
                        type="number"
                        min="0"
                        value={quotaPolicyDraft.hardLimitValue}
                        onChange={(event) =>
                          setQuotaPolicyDraft((current) => ({
                            ...current,
                            hardLimitValue: event.target.value,
                          }))
                        }
                        placeholder="optional"
                      />
                    </GovernanceField>
                    <GovernanceField label={l("软阈值动作", "Soft-limit action")}>
                      <GovernanceSelect
                        value={quotaPolicyDraft.actionOnSoftLimit}
                        onChange={(actionOnSoftLimit) =>
                          setQuotaPolicyDraft((current) => ({ ...current, actionOnSoftLimit }))
                        }
                        options={[
                          { value: "warn", label: l("告警", "Warn") },
                          { value: "require_approval", label: l("要求审批", "Require approval") },
                        ]}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("硬阈值动作", "Hard-limit action")}>
                      <GovernanceSelect
                        value={quotaPolicyDraft.actionOnHardLimit}
                        onChange={(actionOnHardLimit) =>
                          setQuotaPolicyDraft((current) => ({ ...current, actionOnHardLimit }))
                        }
                        options={[
                          { value: "block", label: l("阻断", "Block") },
                          { value: "require_override", label: l("要求超额放行", "Require override") },
                        ]}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("摘要（中文）", "Summary (ZH)")}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={quotaPolicyDraft.summaryZh}
                        onChange={(event) =>
                          setQuotaPolicyDraft((current) => ({
                            ...current,
                            summaryZh: event.target.value,
                          }))
                        }
                        placeholder={t(lang, l("例如：品牌实验室单日实例控制", "For example: daily run control for brand lab"))}
                      />
                    </GovernanceField>
                    <GovernanceField label={l("Summary (EN)", "Summary (EN)")}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={quotaPolicyDraft.summaryEn}
                        onChange={(event) =>
                          setQuotaPolicyDraft((current) => ({
                            ...current,
                            summaryEn: event.target.value,
                          }))
                        }
                        placeholder="Formal quota summary"
                      />
                    </GovernanceField>
                  </div>
                  <GovernanceField label={l("说明", "Notes")}>
                    <GovernanceTextArea
                      value={quotaPolicyDraft.notes}
                      onChange={(notes) =>
                        setQuotaPolicyDraft((current) => ({ ...current, notes }))
                      }
                      placeholder={l(
                        "说明额度策略为何存在、面向哪个工作流、何时应当回收或替换。",
                        "Explain why this quota exists, which workflow it protects, and when it should be retired or replaced."
                      )}
                    />
                  </GovernanceField>
                  <div className="governance-form-actions">
                    <button
                      className="route-btn active"
                      type="button"
                      disabled={createQuotaPolicyMutation.isPending}
                      onClick={() => void createQuotaPolicyMutation.mutateAsync()}
                    >
                      {createQuotaPolicyMutation.isPending
                        ? t(lang, { zh: "创建中...", en: "Creating..." })
                        : t(lang, { zh: "提交额度策略", en: "Create quota policy" })}
                    </button>
                  </div>
                </>
              ) : null}

              {filteredQuotaPolicies.length === 0 ? (
                <div className="panel-empty">
                  {t(
                    lang,
                    l(
                      "当前 package 还没有命中的正式额度策略。可以直接创建第一条治理策略。",
                      "No formal quota policy is in scope for this package yet. Create the first governance policy to continue."
                    )
                  )}
                </div>
              ) : (
                <div className="governance-stack">
                  {filteredQuotaPolicies.map((policy) => {
                    const counter = quotaCountersByPolicyId.get(policy.policyId) ?? null;
                    const latestEvent = quotaEventsByPolicyId.get(policy.policyId) ?? null;
                    const statusLabel = quotaPolicyStatusLabel(policy.status, policy.enabled);
                    const statusTone = quotaDecisionTone(policy.enabled ? policy.status : "disabled");
                    const primaryLabel = policy.summary ? t(lang, policy.summary) : policy.policyId;

                    return (
                      <article className="detail-item governance-card" key={policy.policyId}>
                        <div className="card-row">
                          <div>
                            <div className="file-name">{primaryLabel}</div>
                            <div className="meta">
                              {t(
                                lang,
                                l(
                                  `${quotaScopeLabel(policy.scopeType).zh} / ${quotaMetricLabel(policy.metric).zh} / ${quotaWindowLabel(policy.windowType).zh}`,
                                  `${quotaScopeLabel(policy.scopeType).en} / ${quotaMetricLabel(policy.metric).en} / ${quotaWindowLabel(policy.windowType).en}`
                                )
                              )}
                            </div>
                          </div>
                          <div className="pill-row">
                            <span className={`pill ${statusTone}`}>{t(lang, statusLabel)}</span>
                            <button
                              className="route-btn"
                              type="button"
                              disabled={updateQuotaPolicyMutation.isPending}
                              onClick={() =>
                                void updateQuotaPolicyMutation.mutateAsync({
                                  policyId: policy.policyId,
                                  input: policy.enabled
                                    ? { enabled: false, status: "paused" }
                                    : { enabled: true, status: "active" },
                                })
                              }
                            >
                              {t(
                                lang,
                                policy.enabled
                                  ? { zh: "暂停", en: "Pause" }
                                  : { zh: "恢复", en: "Resume" }
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="governance-form-grid">
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("Scope Ref", "Scope ref"))}</span>
                            <div className="meta">{policy.scopeRefId}</div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("当前值", "Current value"))}</span>
                            <div className="meta">{String(counter?.currentValue ?? 0)}</div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("阈值", "Limit"))}</span>
                            <div className="meta">{String(policy.limitValue)}</div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("软/硬动作", "Soft / hard action"))}</span>
                            <div className="meta">
                              {t(
                                lang,
                                l(
                                  `${policy.actionOnSoftLimit} / ${policy.actionOnHardLimit}`,
                                  `${policy.actionOnSoftLimit} / ${policy.actionOnHardLimit}`
                                )
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="meta">
                          {t(
                            lang,
                            latestEvent
                              ? l(
                                  `最近事件：${quotaEventDecisionLabel(latestEvent.decision).zh} / ${latestEvent.occurredAt}`,
                                  `Latest event: ${quotaEventDecisionLabel(latestEvent.decision).en} / ${latestEvent.occurredAt}`
                                )
                              : l("还没有额度事件记录。", "No quota event has been recorded yet.")
                          )}
                        </div>
                        {policy.notes ? <div className="meta">{policy.notes}</div> : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </article>

            {renderMcpCostCard()}
            {renderBillingSummaryCard()}
            {renderRecentBillingEntriesCard()}

            <article className="detail-item governance-card">
              <div className="card-row">
                <div>
                  <div className="file-name">{t(lang, { zh: "超额审批队列", en: "Override approval queue" })}</div>
                  <div className="meta">
                    {t(
                      lang,
                      pendingQuotaOverrides.length > 0
                        ? {
                            zh: `当前有 ${pendingQuotaOverrides.length} 条超额放行请求待决。审批后将同步回写 run 审批链。`,
                            en: `${pendingQuotaOverrides.length} override requests are waiting for a decision. Approvals sync back into the run approval chain.`,
                          }
                        : {
                            zh: "当前没有待处理的超额放行请求。",
                            en: "No pending quota override request is waiting right now.",
                          }
                    )}
                  </div>
                </div>
                <span className={`pill ${pendingQuotaOverrides.length > 0 ? "warn" : "success"}`}>
                  {pendingQuotaOverrides.length}
                </span>
              </div>

              {filteredQuotaOverrides.length > 0 ? (
                <GovernanceField label={l("审批备注", "Decision note")}>
                  <GovernanceTextArea
                    value={quotaOverrideDecisionNote}
                    onChange={setQuotaOverrideDecisionNote}
                    placeholder={l(
                      "可选。记录放行或拒绝的治理理由，会进入额度事件流与审计轨迹。",
                      "Optional. Record the approval or rejection reason. It will be written into the quota event stream and audit trail."
                    )}
                  />
                </GovernanceField>
              ) : null}

              {filteredQuotaOverrides.length === 0 ? (
                <div className="panel-empty">
                  {t(lang, l("没有命中的超额审批记录。", "No quota override record matches the current filter."))}
                </div>
              ) : (
                <div className="governance-stack">
                  {filteredQuotaOverrides.map((override) => (
                    <article className="detail-item governance-card" key={override.overrideId}>
                      <div className="card-row">
                        <div>
                          <div className="file-name">{t(lang, override.reasonSummary)}</div>
                          <div className="meta">
                            {t(
                              lang,
                              l(
                                `${quotaMetricLabel(override.metric).zh} / ${override.overrideId}`,
                                `${quotaMetricLabel(override.metric).en} / ${override.overrideId}`
                              )
                            )}
                          </div>
                        </div>
                        <span className={`pill ${quotaDecisionTone(override.status)}`}>
                          {t(lang, quotaOverrideStatusLabel(override.status))}
                        </span>
                      </div>
                      <div className="governance-form-grid">
                        <div className="fake-input governance-field">
                          <span className="tiny-note">{t(lang, l("当前值", "Current value"))}</span>
                          <div className="meta">{override.currentValue}</div>
                        </div>
                        <div className="fake-input governance-field">
                          <span className="tiny-note">{t(lang, l("阈值", "Limit"))}</span>
                          <div className="meta">{override.limitValue}</div>
                        </div>
                        <div className="fake-input governance-field">
                          <span className="tiny-note">{t(lang, l("请求增量", "Requested delta"))}</span>
                          <div className="meta">{override.requestedDelta}</div>
                        </div>
                        <div className="fake-input governance-field">
                          <span className="tiny-note">{t(lang, l("申请时间", "Requested at"))}</span>
                          <div className="meta">{t(lang, formatIsoLabel(override.requestedAt, l("-", "-")))}</div>
                        </div>
                      </div>
                      <div className="meta">
                        {override.runId
                          ? t(
                              lang,
                              l(
                                `关联 run: ${override.runId} / approval: ${override.approvalId ?? "-"}`,
                                `Linked run: ${override.runId} / approval: ${override.approvalId ?? "-"}`
                              )
                            )
                          : t(
                              lang,
                              l(
                                `作用域: ${override.scopeRefId}`,
                                `Scope ref: ${override.scopeRefId}`
                              )
                            )}
                      </div>
                      {override.status === "pending" ? (
                        <div className="governance-form-actions">
                          <button
                            className="route-btn active"
                            type="button"
                            disabled={approveQuotaOverrideMutation.isPending}
                            onClick={() => void approveQuotaOverrideMutation.mutateAsync(override.overrideId)}
                          >
                            {approveQuotaOverrideMutation.isPending
                              ? t(lang, { zh: "放行中...", en: "Approving..." })
                              : t(lang, { zh: "批准放行", en: "Approve override" })}
                          </button>
                          <button
                            className="route-btn"
                            type="button"
                            disabled={rejectQuotaOverrideMutation.isPending}
                            onClick={() => void rejectQuotaOverrideMutation.mutateAsync(override.overrideId)}
                          >
                            {rejectQuotaOverrideMutation.isPending
                              ? t(lang, { zh: "拒绝中...", en: "Rejecting..." })
                              : t(lang, { zh: "拒绝请求", en: "Reject request" })}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </article>

            <article className="detail-item governance-card">
              <div className="card-row">
                <div>
                  <div className="file-name">{t(lang, { zh: "额度事件流", en: "Quota event stream" })}</div>
                  <div className="meta">
                    {t(
                      lang,
                      filteredQuotaEvents.length > 0
                        ? {
                            zh: "事件流用于复核当前 package 在额度命中、告警、阻断与超额放行上的实际演化路径。",
                            en: "Use the event stream to audit how this package is moving through warnings, blocks, and override decisions.",
                          }
                        : {
                            zh: "当前还没有额度事件记录。",
                            en: "No quota event has been recorded yet.",
                          }
                    )}
                  </div>
                </div>
                <span className="pill active">{filteredQuotaEvents.length}</span>
              </div>

              {filteredQuotaEvents.length === 0 ? (
                <div className="panel-empty">
                  {t(lang, l("没有命中的额度事件。", "No quota event matches the current filter."))}
                </div>
              ) : (
                <div className="governance-stack">
                  {filteredQuotaEvents.slice(0, 10).map((event) => (
                    <article className="detail-item governance-card" key={event.eventId}>
                      <div className="card-row">
                        <div>
                          <div className="file-name">{event.eventId}</div>
                          <div className="meta">
                            {t(
                              lang,
                              l(
                                `${quotaMetricLabel(event.metric).zh} / ${quotaScopeLabel(event.scopeType).zh}`,
                                `${quotaMetricLabel(event.metric).en} / ${quotaScopeLabel(event.scopeType).en}`
                              )
                            )}
                          </div>
                        </div>
                        <span className={`pill ${quotaDecisionTone(event.decision)}`}>
                          {t(lang, quotaEventDecisionLabel(event.decision))}
                        </span>
                      </div>
                      <div className="governance-form-grid">
                        <div className="fake-input governance-field">
                          <span className="tiny-note">{t(lang, l("当前值", "Current value"))}</span>
                          <div className="meta">{event.currentValue}</div>
                        </div>
                        <div className="fake-input governance-field">
                          <span className="tiny-note">{t(lang, l("阈值", "Limit"))}</span>
                          <div className="meta">{event.limitValue}</div>
                        </div>
                        <div className="fake-input governance-field">
                          <span className="tiny-note">{t(lang, l("发生时间", "Occurred at"))}</span>
                          <div className="meta">{t(lang, formatIsoLabel(event.occurredAt, l("-", "-")))}</div>
                        </div>
                        <div className="fake-input governance-field">
                          <span className="tiny-note">{t(lang, l("关联对象", "Linked ref"))}</span>
                          <div className="meta">{event.runId ?? event.overrideId ?? event.scopeRefId}</div>
                        </div>
                      </div>
                      {event.note ? <div className="meta">{event.note}</div> : null}
                    </article>
                  ))}
                </div>
              )}
            </article>
          </div>
        </>
      ) : section === "members" ? (
        <>
          <GovernanceDataTable
            headers={memberHeaders}
            rows={memberRows}
            emptyText={l(
              "当前工作区成员列表为空。请先创建正式成员关系，或切换到其他工作区。",
              "No workspace members are visible here yet. Create a formal membership first or switch to another workspace."
            )}
          />

          {canManageMembers ? (
            <GovernanceDataTable
              headers={invitationHeaders}
              rows={invitationRows}
              emptyText={l(
                "当前没有在途邀请。可以直接创建新的工作区邀请。",
                "No active invitation is in flight right now. Create a new workspace invitation directly."
              )}
            />
          ) : null}

          <div className="governance-stack">
            <article className="detail-item governance-card">
              <div className="card-row">
                <div>
                  <div className="file-name">
                    {t(lang, {
                      zh: canManageMembers ? "发起工作区邀请" : "成员治理权限",
                      en: canManageMembers ? "Create workspace invitation" : "Member governance access",
                    })}
                  </div>
                  <div className="meta">
                    {t(
                      lang,
                      canManageMembers
                        ? {
                            zh: "邀请会立即写入正式后端对象。当前阶段仍由管理员显式分发 accept token，后续再接企业邮件或通知渠道。",
                            en: "Invitations are persisted as formal backend records immediately. At this stage the admin still distributes the accept token explicitly before enterprise mail or notification delivery is added.",
                          }
                        : {
                            zh: "当前角色具备正式成员可见性，但没有邀请、撤销或成员权限变更权。",
                            en: "The current role has formal member visibility but cannot create invites, revoke them, or change member permissions.",
                          }
                    )}
                  </div>
                </div>
                {membersQuery.isFetching || invitationsQuery.isFetching ? (
                  <span className="pill active">{t(lang, { zh: "同步中", en: "Syncing" })}</span>
                ) : null}
              </div>

              {invitationActionError ? (
                <div className="composer-error">{invitationActionError}</div>
              ) : null}

              {!canManageMembers ? (
                <div className="panel-empty">
                  {t(
                    lang,
                    l(
                      "切换到 Owner 或 Admin 工作区身份后，才能创建邀请或调整成员角色。",
                      "Switch to an Owner or Admin workspace role before creating invitations or adjusting member roles."
                    )
                  )}
                </div>
              ) : (
                <>
                  <div className="governance-form-grid">
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, l("邀请邮箱", "Invite email"))}</span>
                      <input
                        value={inviteDraft.email}
                        onChange={(event) =>
                          setInviteDraft((current) => ({ ...current, email: event.target.value }))
                        }
                        placeholder={t(lang, l("name@company.com", "name@company.com"))}
                      />
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, l("目标角色", "Target role"))}</span>
                      <select
                        className="governance-select"
                        value={inviteDraft.role}
                        onChange={(event) =>
                          setInviteDraft((current) => ({
                            ...current,
                            role: event.target.value as WorkspaceRole,
                          }))
                        }
                      >
                        {manageableRoles.map((role) => (
                          <option key={role} value={role}>
                            {t(lang, workspaceRoleLabel(role))}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, l("有效天数", "Expires in days"))}</span>
                      <input
                        value={inviteDraft.expiresInDays}
                        onChange={(event) =>
                          setInviteDraft((current) => ({
                            ...current,
                            expiresInDays: event.target.value,
                          }))
                        }
                        placeholder="7"
                      />
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, l("备注", "Note"))}</span>
                      <input
                        value={inviteDraft.note}
                        onChange={(event) =>
                          setInviteDraft((current) => ({ ...current, note: event.target.value }))
                        }
                        placeholder={t(
                          lang,
                          l("例如：Creator 发布协作 / 审批值守", "Example: creator release collaboration / approval coverage")
                        )}
                      />
                    </label>
                  </div>
                  <div className="governance-form-actions">
                    <button
                      className="route-btn"
                      type="button"
                      disabled={
                        createWorkspaceInvitationMutation.isPending ||
                        inviteDraft.email.trim().length === 0
                      }
                      onClick={() => {
                        setInvitationActionError(null);
                        void createWorkspaceInvitationMutation.mutateAsync();
                      }}
                    >
                      {createWorkspaceInvitationMutation.isPending
                        ? t(lang, { zh: "创建中...", en: "Creating..." })
                        : t(lang, { zh: "创建邀请", en: "Create invite" })}
                    </button>
                  </div>
                </>
              )}

              {latestInvitationToken ? (
                <div className="governance-inline-meta">
                  <div className="tiny-note">{t(lang, l("最新 accept token", "Latest accept token"))}</div>
                  <div className="meta">
                    {t(
                      lang,
                      l(
                        `${latestInvitationToken.email} / ${latestInvitationToken.invitationId} / ${latestInvitationToken.token}`,
                        `${latestInvitationToken.email} / ${latestInvitationToken.invitationId} / ${latestInvitationToken.token}`
                      )
                    )}
                  </div>
                </div>
              ) : null}
            </article>

            {canManageMembers ? (
              <article className="detail-item governance-card">
                <div className="card-row">
                  <div>
                    <div className="file-name">
                      {t(lang, { zh: "待处理邀请", en: "Pending invitations" })}
                    </div>
                    <div className="meta">
                      {t(
                        lang,
                        pendingWorkspaceInvitations.length > 0
                          ? {
                              zh: `当前有 ${pendingWorkspaceInvitations.length} 个待接受邀请。撤销会立即失效后端 invite token。`,
                              en: `${pendingWorkspaceInvitations.length} invitations are still pending. Revoking one invalidates the backend invite token immediately.`,
                            }
                          : {
                              zh: "当前没有待接受邀请。已接受、已撤销与已过期邀请仍保留在上方治理表中。",
                              en: "No invitation is pending right now. Accepted, revoked, and expired invitations remain visible in the governance table above.",
                            }
                      )}
                    </div>
                  </div>
                </div>

                {pendingWorkspaceInvitations.length === 0 ? (
                  <div className="panel-empty">
                    {t(
                      lang,
                      l(
                        "没有待处理邀请。工作区邀请治理已经处于干净状态。",
                        "No pending invitation remains. The workspace invitation ledger is clean."
                      )
                    )}
                  </div>
                ) : (
                  <div className="governance-stack">
                    {pendingWorkspaceInvitations.map((invitation) => (
                      <article className="detail-item governance-card" key={invitation.invitation.invitationId}>
                        <div className="card-row">
                          <div>
                            <div className="file-name">{invitation.invitation.email}</div>
                            <div className="meta">
                              {t(
                                lang,
                                joinLocalized([
                                  workspaceRoleLabel(invitation.invitation.role),
                                  invitation.invitedBy
                                    ? entityDisplayLabel(
                                        invitation.invitedBy.displayName,
                                        invitation.invitedBy.email
                                      )
                                    : null,
                                ])
                              )}
                            </div>
                          </div>
                          <button
                            className="route-btn"
                            type="button"
                            disabled={revokeWorkspaceInvitationMutation.isPending}
                            onClick={() => {
                              setInvitationActionError(null);
                              void revokeWorkspaceInvitationMutation.mutateAsync(
                                invitation.invitation.invitationId
                              );
                            }}
                          >
                            {revokeWorkspaceInvitationMutation.isPending
                              ? t(lang, { zh: "撤销中...", en: "Revoking..." })
                              : t(lang, { zh: "撤销邀请", en: "Revoke invite" })}
                          </button>
                        </div>
                        <div className="governance-form-grid">
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("状态", "Status"))}</span>
                            <div className="meta">
                              {t(lang, workspaceInvitationStatusLabel(invitation.invitation.status))}
                            </div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("到期时间", "Expires at"))}</span>
                            <div className="meta">
                              {t(
                                lang,
                                formatIsoLabel(invitation.invitation.expiresAt, l("-", "-"))
                              )}
                            </div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("备注", "Note"))}</span>
                            <div className="meta">{invitation.invitation.note ?? "-"}</div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("邀请 ID", "Invitation ID"))}</span>
                            <div className="meta">{invitation.invitation.invitationId}</div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </article>
            ) : null}

            <article className="detail-item governance-card">
              <div className="card-row">
                <div>
                  <div className="file-name">
                    {t(lang, { zh: "成员权限调整", en: "Member access adjustments" })}
                  </div>
                  <div className="meta">
                    {t(
                      lang,
                      canManageMembers
                        ? {
                            zh: "不能修改自己，也不能通过这里变更 owner。Admin 也不能调整其他 admin。",
                            en: "You cannot modify yourself, and owner memberships stay immutable here. Admins also cannot change other admins.",
                          }
                        : {
                            zh: "当前角色只能查看正式成员状态，不能调整权限。",
                            en: "The current role can inspect formal member state but cannot adjust permissions.",
                          }
                    )}
                  </div>
                </div>
              </div>

              {memberActionError ? <div className="composer-error">{memberActionError}</div> : null}

              {!canManageMembers ? (
                <div className="panel-empty">
                  {t(
                    lang,
                    l(
                      "切换到 Owner 或 Admin 身份后，才能修改成员角色或暂停状态。",
                      "Switch to an Owner or Admin role before changing member roles or suspension state."
                    )
                  )}
                </div>
              ) : manageableMembers.length === 0 ? (
                <div className="panel-empty">
                  {t(
                    lang,
                    l(
                      "没有可在当前角色下调整的成员。Owner、自己，或同级 Admin 不会出现在这里。",
                      "No member is mutable under the current role. Owners, your own membership, and peer admins stay out of this list."
                    )
                  )}
                </div>
              ) : (
                <div className="governance-stack">
                  {manageableMembers.map((member) => {
                    const draft = memberDrafts[member.user.userId] ?? {
                      role: member.membership.role,
                      status: member.membership.status,
                    };
                    const changed =
                      draft.role !== member.membership.role || draft.status !== member.membership.status;

                    return (
                      <article className="detail-item governance-card" key={member.user.userId}>
                        <div className="card-row">
                          <div>
                            <div className="file-name">{member.user.displayName}</div>
                            <div className="meta">{member.user.email}</div>
                          </div>
                          <span className={`pill ${member.membership.status === "active" ? "ok" : "warn"}`}>
                            {t(lang, workspaceMembershipStatusLabel(member.membership.status))}
                          </span>
                        </div>
                        <div className="governance-form-grid">
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("成员 ID", "Member ID"))}</span>
                            <div className="meta">{member.user.userId}</div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("当前角色", "Current role"))}</span>
                            <div className="meta">{t(lang, workspaceRoleLabel(member.membership.role))}</div>
                          </div>
                          <label className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("调整角色", "Set role"))}</span>
                            <select
                              className="governance-select"
                              value={draft.role}
                              onChange={(event) =>
                                handleMemberDraftChange(
                                  member.user.userId,
                                  "role",
                                  event.target.value as WorkspaceRole
                                )
                              }
                            >
                              {[member.membership.role, ...manageableRoles]
                                .filter((role, index, list) => list.indexOf(role) === index)
                                .map((role) => (
                                  <option key={role} value={role}>
                                    {t(lang, workspaceRoleLabel(role))}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, l("调整状态", "Set status"))}</span>
                            <select
                              className="governance-select"
                              value={draft.status}
                              onChange={(event) =>
                                handleMemberDraftChange(
                                  member.user.userId,
                                  "status",
                                  event.target.value as WorkspaceMembershipStatus
                                )
                              }
                            >
                              <option value="active">{t(lang, workspaceMembershipStatusLabel("active"))}</option>
                              <option value="suspended">
                                {t(lang, workspaceMembershipStatusLabel("suspended"))}
                              </option>
                            </select>
                          </label>
                        </div>
                        <div className="governance-form-actions">
                          <button
                            className="route-btn"
                            type="button"
                            disabled={!changed || updateWorkspaceMemberMutation.isPending}
                            onClick={() => {
                              setMemberActionError(null);
                              void handleMemberUpdate(member);
                            }}
                          >
                            {updateWorkspaceMemberMutation.isPending
                              ? t(lang, { zh: "保存中...", en: "Saving..." })
                              : t(lang, { zh: "保存调整", en: "Save changes" })}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </article>
          </div>
        </>
      ) : section === "audit" ? (
        <>
          <GovernanceDataTable
            headers={dynamicGovernanceSummary?.headers ?? meta.headers}
            rows={dynamicGovernanceRows}
            emptyText={l(
              "当前治理分段没有匹配项。可以清空搜索词，或切换到其他治理分段。",
              "No rows match the current governance segment. Clear the query or switch to another governance section."
            )}
          />

          <div className="governance-stack">
            {renderMcpAuditCard()}

            <article className="detail-item governance-card">
              <div className="card-row">
                <div>
                  <div className="file-name">
                    {t(lang, { zh: "最近导出的审计包", en: "Recent audit export bundles" })}
                  </div>
                  <div className="meta">
                    {t(
                      lang,
                      recentAuditExports.length > 0
                        ? {
                            zh: `当前工作区已生成 ${recentAuditExports.length} 份导出，可直接下载 JSON 或 CSV 证据包。`,
                            en: `${recentAuditExports.length} exports are available for this workspace context and can be downloaded as JSON or CSV evidence bundles.`,
                          }
                        : {
                            zh: "导出会固化 package 的发布、回放、Gate、激活与实例样本，便于审计归档和外部复核。",
                            en: "Exports snapshot package releases, replays, gates, activations, and run samples for audit archiving and external review.",
                          }
                    )}
                  </div>
                </div>
                {auditExportsQuery.isFetching ? (
                  <span className="pill active">{t(lang, { zh: "同步中", en: "Syncing" })}</span>
                ) : null}
              </div>

              {auditActionError ? (
                <div className="composer-error">{auditActionError}</div>
              ) : null}

              {recentAuditExports.length === 0 ? (
                <div className="panel-empty">
                  {t(
                    lang,
                    l(
                      "当前还没有导出的审计包。可以先生成 JSON 或 CSV 版本。",
                      "No audit bundle has been exported yet. Generate a JSON or CSV bundle first."
                    )
                  )}
                </div>
              ) : null}
            </article>

            {recentAuditExports.map((record) => (
              <article className="detail-item governance-card" key={record.exportId}>
                <div className="card-row">
                  <div>
                    <div className="file-name">{record.fileName}</div>
                    <div className="meta">
                      {t(
                        lang,
                        l(
                          `${record.exportId} / ${record.recordCount} 条记录 / ${record.format.toUpperCase()}`,
                          `${record.exportId} / ${record.recordCount} records / ${record.format.toUpperCase()}`
                        )
                      )}
                    </div>
                  </div>
                  <button
                    className="route-btn"
                    type="button"
                    disabled={downloadingAuditExportId === record.exportId}
                    onClick={() => void handleAuditExportDownload(record)}
                  >
                    {downloadingAuditExportId === record.exportId
                      ? t(lang, { zh: "下载中...", en: "Downloading..." })
                      : t(lang, { zh: "下载", en: "Download" })}
                  </button>
                </div>
                <div className="meta">{t(lang, record.summary)}</div>
                <div className="governance-form-grid">
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("生成时间", "Generated at"))}</span>
                    <div className="meta">
                      {t(
                        lang,
                        formatIsoLabel(
                          record.createdAt,
                          l("未生成", "Not generated")
                        )
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("工作区上下文", "Workspace context"))}</span>
                    <div className="meta">{record.workspaceContextKey}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("文件大小", "File size"))}</span>
                    <div className="meta">
                      {record.sizeBytes == null ? "-" : `${record.sizeBytes} B`}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, l("摘要哈希", "Summary hash"))}</span>
                    <div className="meta">{record.sha256 ?? "-"}</div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <GovernanceDataTable
          headers={dynamicGovernanceSummary?.headers ?? meta.headers}
          rows={dynamicGovernanceRows}
          emptyText={l(
            "当前治理分段没有匹配项。可以清空搜索词，或切换到其他治理分段。",
            "No rows match the current governance segment. Clear the query or switch to another governance section."
          )}
        />
      )}
    </div>
  );
}
