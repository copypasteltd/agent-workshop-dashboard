import type {
  CreatorPackageDetail,
  CreatorPackageSummary,
  CreatorReleaseActivation,
  CreatorReleaseGate,
  CreatorReleaseSummary,
  CreatorReplaySummary,
  EntrySurface,
  SessionPackArchiveSource,
  SessionPackDetail,
  SessionPackGovernanceDiffField,
  SessionPackGovernanceFlag,
  SessionPackGovernancePolicyAction,
  SessionPackGovernancePolicyDecision,
  SessionPackGovernanceRiskLevel,
  SessionPackGovernanceState,
  SessionPackInheritMode,
  SessionPackLineageRelation,
  SessionPackRedactionReviewDecision,
  SessionPackRedactionRuleInput,
  SessionPackRedactionRuleSummary,
  SessionPackRedactionStrategy,
  SessionPackRedactionTargetKind,
  SessionPackSignatureDistributionState,
  SessionPackSignatureStatus,
  ServiceCatalogEntry,
  WorkshopCatalogEntry,
} from "@lingban/contracts";
import { matchesSearchQuery } from "@lingban/domain-models";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { CreatorTab } from "../../data/dashboardData";
import { dashboardAssets } from "../../data/dashboardData";
import { isCreatorGovernanceTarget, resolveCreatorAccessState } from "../../lib/accessControl";
import { dashboardCatalogApi, dashboardCreatorApi, dashboardSessionsApi } from "../../lib/api";
import { l, t, type LocalizedString } from "../../lib/i18n";
import { dashboardRoutes, governanceSections, isGovernanceSection, type GovernanceSection } from "../../lib/routes";
import {
  hasAuthoritativeDashboardWorkspaceContext,
  listDashboardWorkspaceViews,
  resolveDashboardWorkspaceView,
} from "../../lib/workspaceContext";
import { CreatorGovernancePanel, type GovernanceMeta } from "./CreatorGovernancePanel";
import { CreatorReleasePanel, CreatorReplayPanel } from "./CreatorReleasePanels";
import { useDashboardAuthStore } from "../../stores/dashboardAuthStore";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

const EMPTY_WORKSHOPS: WorkshopCatalogEntry[] = [];
const EMPTY_SERVICES: ServiceCatalogEntry[] = [];

const creatorTabs: Array<{ key: CreatorTab; label: { zh: string; en: string } }> = [
  { key: "session", label: { zh: "Session 包", en: "Session Package" } },
  { key: "runtime", label: { zh: "运行镜像", en: "Runtime" } },
  { key: "connectors", label: { zh: "Connectors", en: "Connectors" } },
  { key: "release", label: { zh: "发布审核", en: "Release & Audit" } },
];

type CreatorPackageView = {
  id: string;
  title: LocalizedString;
  source: LocalizedString;
  status: LocalizedString;
  statusClass: string;
  ownerLabel: LocalizedString;
  updatedAt: string;
  releaseChannel: LocalizedString;
  workspaceContextKeys: string[];
  linkedWorkshopIds: string[];
  linkedServiceIds: string[];
  versionLine: string[];
  dependencies: LocalizedString[];
  session: { summary: LocalizedString; items: LocalizedString[] };
  runtime: { summary: LocalizedString; items: LocalizedString[] };
  connectors: { summary: LocalizedString; items: LocalizedString[] };
  release: { summary: LocalizedString; items: LocalizedString[] };
};

function mapCreatorPackageSummary(summary: CreatorPackageSummary): CreatorPackageView {
  return {
    id: summary.packageId,
    title: summary.title,
    source: summary.source,
    status: summary.statusLabel,
    statusClass: summary.tone,
    ownerLabel: summary.ownerLabel,
    updatedAt: summary.updatedAt,
    releaseChannel: summary.releaseChannel,
    workspaceContextKeys: summary.workspaceContextKeys,
    linkedWorkshopIds: summary.linkedWorkshopIds,
    linkedServiceIds: summary.linkedServiceIds,
    versionLine: [],
    dependencies: [],
    session: { summary: l("", ""), items: [] },
    runtime: { summary: l("", ""), items: [] },
    connectors: { summary: l("", ""), items: [] },
    release: { summary: l("", ""), items: [] },
  };
}

function mapCreatorPackageDetail(detail: CreatorPackageDetail): CreatorPackageView {
  return {
    id: detail.packageId,
    title: detail.title,
    source: detail.source,
    status: detail.statusLabel,
    statusClass: detail.tone,
    ownerLabel: detail.ownerLabel,
    updatedAt: detail.updatedAt,
    releaseChannel: detail.releaseChannel,
    workspaceContextKeys: detail.workspaceContextKeys,
    linkedWorkshopIds: detail.linkedWorkshopIds,
    linkedServiceIds: detail.linkedServiceIds,
    versionLine: detail.versionLine,
    dependencies: detail.dependencies,
    session: detail.session,
    runtime: detail.runtime,
    connectors: detail.connectors,
    release: detail.release,
  };
}

function findVersionLineRef(versionLine: string[], kind: "task" | "session") {
  const directPrefix = kind === "task" ? "tsv_" : "sev_";
  const keyedPrefix = kind === "task" ? "task=" : "session=";
  const raw =
    versionLine.find((item) => item.startsWith(directPrefix)) ??
    versionLine.find((item) => item.startsWith(keyedPrefix));
  if (!raw) {
    return null;
  }

  const candidate = raw.startsWith(keyedPrefix) ? raw.slice(keyedPrefix.length) : raw;
  return candidate.split("@", 1)[0]?.trim() || null;
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

function entrySurfaceLabel(surface: EntrySurface) {
  switch (surface) {
    case "dashboard":
      return l("网页控制台", "Dashboard");
    case "h5":
      return l("移动 H5", "Mobile H5");
    case "mini-program":
    default:
      return l("小程序", "Mini Program");
  }
}

function sessionLineageRelationLabel(relation: SessionPackLineageRelation) {
  switch (relation) {
    case "lineage_parent":
      return l("继承父版本", "Lineage parent");
    case "rollback_source":
      return l("回滚来源", "Rollback source");
    case "lineage_child":
      return l("继承子版本", "Lineage child");
    case "rollback_child":
    default:
      return l("回滚派生", "Rollback child");
  }
}

function sessionPackInheritModeLabel(mode: SessionPackInheritMode | null | undefined) {
  switch (mode) {
    case "draft":
      return l("继承草稿", "Inherited draft");
    case "consumer":
      return l("消费派生", "Consumer inherited");
    default:
      return l("Package 固定版本", "Package-pinned");
  }
}

function sessionPackInheritModeTone(mode: SessionPackInheritMode | null | undefined) {
  switch (mode) {
    case "consumer":
      return "warn";
    case "draft":
      return "active";
    default:
      return "";
  }
}

function sessionPackArchiveSourceLabel(source: SessionPackArchiveSource | null | undefined) {
  switch (source) {
    case "runtime-derived":
      return l("运行归档", "Runtime-derived");
    case "imported":
      return l("导入归档", "Imported");
    case "generated":
    default:
      return l("合成归档", "Generated");
  }
}

function sessionPackArchiveSourceTone(source: SessionPackArchiveSource | null | undefined) {
  switch (source) {
    case "runtime-derived":
      return "warn";
    case "imported":
      return "active";
    case "generated":
    default:
      return "";
  }
}

function sessionPackGovernanceStateLabel(state: SessionPackGovernanceState | null | undefined) {
  switch (state) {
    case "package-baseline":
      return l("Package 基线", "Package baseline");
    case "published":
      return l("已发布", "Published");
    case "draft-derived":
      return l("继承草稿", "Draft-derived");
    case "consumer-derived":
      return l("消费派生", "Consumer-derived");
    case "runtime-derived":
      return l("运行快照", "Runtime-derived");
    case "imported":
      return l("导入归档", "Imported");
    case "unpublished":
    default:
      return l("未发布", "Unpublished");
  }
}

function sessionPackGovernanceRiskLabel(risk: SessionPackGovernanceRiskLevel | null | undefined) {
  switch (risk) {
    case "high":
      return l("高风险", "High risk");
    case "medium":
      return l("中风险", "Medium risk");
    case "low":
      return l("低风险", "Low risk");
    case "none":
    default:
      return l("稳定", "Stable");
  }
}

function sessionPackGovernanceRiskTone(risk: SessionPackGovernanceRiskLevel | null | undefined) {
  switch (risk) {
    case "high":
      return "danger";
    case "medium":
      return "warn";
    case "low":
      return "active";
    case "none":
    default:
      return "";
  }
}

function sessionPackGovernanceFlagLabel(flag: SessionPackGovernanceFlag) {
  switch (flag) {
    case "published_targets_attached":
      return l("已挂模板引用", "Template bindings attached");
    case "live_consumer_versions_visible":
      return l("可见消费版本", "Live consumer versions");
    case "unpublished_with_live_consumers":
      return l("已下线但仍有消费", "Unpublished with live consumers");
    case "draft_descendants_present":
      return l("存在草稿派生", "Draft descendants");
    case "consumer_descendants_present":
      return l("存在消费派生", "Consumer descendants");
    case "rollback_descendants_present":
      return l("存在回滚分支", "Rollback descendants");
    case "runtime_evidence_present":
      return l("存在运行证据", "Runtime evidence");
    case "drift_from_package_baseline":
      return l("偏离 Package 基线", "Drifts from package baseline");
    case "missing_persisted_archive":
    default:
      return l("缺持久化归档", "Persisted archive missing");
  }
}

function sessionPackGovernanceDiffFieldLabel(field: SessionPackGovernanceDiffField) {
  switch (field) {
    case "inherit_mode":
      return l("继承模式", "Inherit mode");
    case "lineage_parent_version_id":
      return l("父版本引用", "Lineage parent");
    case "consumer_run_id":
      return l("消费实例", "Consumer run");
    case "consumer_workspace_id":
      return l("消费工作区", "Consumer workspace");
    case "consumer_service_id":
      return l("消费服务", "Consumer service");
    case "consumer_workshop_id":
      return l("消费工坊", "Consumer workshop");
    case "consumer_entry_surface":
      return l("消费入口面", "Consumer surface");
    case "consumer_target_path":
      return l("消费目标路径", "Consumer target path");
    case "workspace_context_keys":
      return l("工作区上下文", "Workspace contexts");
    case "linked_service_ids":
      return l("关联服务", "Linked services");
    case "linked_workshop_ids":
      return l("关联工坊", "Linked workshops");
    case "runtime_profile":
      return l("运行画像", "Runtime profile");
    case "required_bindings":
      return l("绑定要求", "Required bindings");
    case "published_target_count":
      return l("模板引用数", "Template binding count");
    case "expected_root_files":
    default:
      return l("根文件约束", "Expected root files");
  }
}

function sessionPackSignatureStatusLabel(status: SessionPackSignatureStatus | null | undefined) {
  switch (status) {
    case "verified":
      return l("已验真", "Verified");
    case "unsigned-allowed":
      return l("允许无签名", "Unsigned allowed");
    case "missing-required":
      return l("缺少必需签名", "Missing required signature");
    case "key-unavailable":
      return l("验签密钥不可用", "Verification key unavailable");
    case "invalid":
    default:
      return l("签名无效", "Invalid signature");
  }
}

function sessionPackSignatureStatusTone(status: SessionPackSignatureStatus | null | undefined) {
  switch (status) {
    case "verified":
      return "active";
    case "unsigned-allowed":
      return "";
    case "missing-required":
    case "key-unavailable":
    case "invalid":
    default:
      return "warn";
  }
}

function sessionPackSignatureDistributionStateLabel(
  state: SessionPackSignatureDistributionState | null | undefined
) {
  switch (state) {
    case "ready":
      return l("分发完成", "Distribution ready");
    case "partial":
      return l("分发不完整", "Distribution partial");
    case "stale":
      return l("分发状态过期", "Distribution stale");
    case "not-configured":
    default:
      return l("未配置分发目标", "Distribution not configured");
  }
}

function sessionPackSignatureDistributionStateTone(
  state: SessionPackSignatureDistributionState | null | undefined
) {
  switch (state) {
    case "ready":
      return "active";
    case "partial":
    case "stale":
      return "warn";
    case "not-configured":
    default:
      return "";
  }
}

function runRuntimeLaunchModeLabel(mode: "local-process" | "docker" | null | undefined) {
  switch (mode) {
    case "docker":
      return l("容器", "Container");
    case "local-process":
      return l("本机进程", "Local process");
    default:
      return l("未知", "Unknown");
  }
}

function sessionPackGovernancePolicyActionLabel(
  action: SessionPackGovernancePolicyAction
) {
  switch (action) {
    case "archive-redacted":
      return l("脱敏导出", "Redacted export");
    case "inherit":
      return l("派生", "Inherit");
    case "publish":
      return l("发布", "Publish");
    case "rollback":
      return l("回滚", "Rollback");
    case "unpublish":
    default:
      return l("下线", "Unpublish");
  }
}

function sessionPackGovernancePolicyDecisionLabel(
  decision: SessionPackGovernancePolicyDecision | null | undefined
) {
  switch (decision) {
    case "block":
      return l("阻断", "Blocked");
    case "warn":
      return l("警告", "Warn");
    case "allow":
    default:
      return l("放行", "Allowed");
  }
}

function sessionPackGovernancePolicyDecisionTone(
  decision: SessionPackGovernancePolicyDecision | null | undefined
) {
  switch (decision) {
    case "block":
      return "danger";
    case "warn":
      return "warn";
    case "allow":
    default:
      return "active";
  }
}

function sessionPackRedactionTargetKindLabel(kind: SessionPackRedactionTargetKind) {
  switch (kind) {
    case "text":
      return l("文本", "Text");
    case "file-path":
      return l("文件路径", "File path");
    case "json-path":
      return l("JSON 路径", "JSON path");
    case "header":
      return l("请求头", "Header");
    case "cookie":
    default:
      return l("Cookie", "Cookie");
  }
}

function sessionPackRedactionStrategyLabel(strategy: SessionPackRedactionStrategy) {
  switch (strategy) {
    case "mask":
      return l("掩码", "Mask");
    case "remove":
      return l("删除", "Remove");
    case "replace":
      return l("替换", "Replace");
    case "hash":
    default:
      return l("哈希", "Hash");
  }
}

function sessionPackRedactionReviewDecisionLabel(
  decision: SessionPackRedactionReviewDecision | null | undefined
) {
  switch (decision) {
    case "approved":
      return l("已通过", "Approved");
    case "changes_requested":
      return l("待修订", "Changes requested");
    default:
      return l("待审阅", "Pending review");
  }
}

function sessionPackRedactionReviewDecisionTone(
  decision: SessionPackRedactionReviewDecision | null | undefined
) {
  switch (decision) {
    case "approved":
      return "active";
    case "changes_requested":
      return "warn";
    default:
      return "";
  }
}

function formatByteSize(value: number | null | undefined) {
  if (typeof value !== "number" || value <= 0) {
    return "-";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${value} B`;
}

function formatTimestamp(lang: "zh" | "en", value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type SessionComparisonRow = {
  key: string;
  label: LocalizedString;
  baseline: string;
  current: string;
  note?: LocalizedString;
  tone?: "active" | "warn" | "";
};

function normalizeStringArray(values: string[] | null | undefined) {
  return [...new Set((values ?? []).map((item) => item.trim()).filter(Boolean))].sort();
}

function summarizeStringArray(values: string[] | null | undefined) {
  const normalized = normalizeStringArray(values);
  return normalized.length > 0 ? normalized.join(" / ") : "-";
}

function formatSessionBindingSummary(detail: Pick<SessionPackDetail, "requiredBindings">) {
  return l(
    `第一方 MCP ${detail.requiredBindings.firstPartyMcpIds.length} · 外部连接 ${detail.requiredBindings.externalConnectorRefs.length} · 凭证 ${detail.requiredBindings.credentialIds.length}`,
    `First-party MCP ${detail.requiredBindings.firstPartyMcpIds.length} · External connectors ${detail.requiredBindings.externalConnectorRefs.length} · Credentials ${detail.requiredBindings.credentialIds.length}`
  );
}

function formatSessionRuntimeSummary(detail: Pick<SessionPackDetail, "runtimeProfile">) {
  return l(
    `${detail.runtimeProfile.runnerImage ?? "-"} · 浏览器 ${detail.runtimeProfile.browserRequired ? "必需" : "可选"} · Playwright ${detail.runtimeProfile.playwrightRequired ? "必需" : "可选"}`,
    `${detail.runtimeProfile.runnerImage ?? "-"} · Browser ${detail.runtimeProfile.browserRequired ? "required" : "optional"} · Playwright ${detail.runtimeProfile.playwrightRequired ? "required" : "optional"}`
  );
}

type RedactionRuleEditorDraft = {
  ruleId: string;
  slotKey: string;
  targetKind: SessionPackRedactionTargetKind;
  selector: string;
  strategy: SessionPackRedactionStrategy;
  replacement: string;
  rationale: string;
};

function createEmptyRedactionRuleEditorDraft(): RedactionRuleEditorDraft {
  return {
    ruleId: "",
    slotKey: "",
    targetKind: "text",
    selector: "",
    strategy: "mask",
    replacement: "",
    rationale: "",
  };
}

function mapRedactionRuleSummaryToInput(
  rule: SessionPackRedactionRuleSummary
): SessionPackRedactionRuleInput {
  return {
    ruleId: rule.ruleId,
    ...(rule.slotKey ? { slotKey: rule.slotKey } : {}),
    targetKind: rule.targetKind,
    selector: rule.selector,
    strategy: rule.strategy,
    ...(rule.replacement ? { replacement: rule.replacement } : {}),
    ...(rule.rationale ? { rationale: rule.rationale } : {}),
  };
}

function mapRedactionRuleInputToEditor(
  rule: SessionPackRedactionRuleInput
): RedactionRuleEditorDraft {
  return {
    ruleId: rule.ruleId,
    slotKey: rule.slotKey ?? "",
    targetKind: rule.targetKind,
    selector: rule.selector,
    strategy: rule.strategy,
    replacement: rule.replacement ?? "",
    rationale: rule.rationale ?? "",
  };
}

function buildRedactionRuleInputFromEditor(
  draft: RedactionRuleEditorDraft
): SessionPackRedactionRuleInput {
  return {
    ruleId: draft.ruleId.trim(),
    ...(draft.slotKey.trim() ? { slotKey: draft.slotKey.trim() } : {}),
    targetKind: draft.targetKind,
    selector: draft.selector.trim(),
    strategy: draft.strategy,
    ...(draft.strategy === "replace" && draft.replacement.trim()
      ? { replacement: draft.replacement.trim() }
      : {}),
    ...(draft.rationale.trim() ? { rationale: draft.rationale.trim() } : {}),
  };
}

function normalizeRedactionRuleInput(
  rule: SessionPackRedactionRuleInput
): SessionPackRedactionRuleInput {
  return {
    ruleId: rule.ruleId.trim(),
    ...(rule.slotKey?.trim() ? { slotKey: rule.slotKey.trim() } : {}),
    targetKind: rule.targetKind,
    selector: rule.selector.trim(),
    strategy: rule.strategy,
    ...(rule.strategy === "replace" && rule.replacement?.trim()
      ? { replacement: rule.replacement.trim() }
      : {}),
    ...(rule.rationale?.trim() ? { rationale: rule.rationale.trim() } : {}),
  };
}

function normalizeStringKeyList(values: Array<string | null | undefined>) {
  return [...new Set(
    values
      .map((value) => value?.trim() ?? "")
      .filter((value): value is string => value.length > 0)
  )].sort((left, right) => left.localeCompare(right));
}

function informationCollectionSlotStatusLabel(status: "missing" | "optional" | "satisfied") {
  switch (status) {
    case "satisfied":
      return l("已满足", "Satisfied");
    case "missing":
      return l("缺失", "Missing");
    case "optional":
    default:
      return l("可选", "Optional");
  }
}

function informationCollectionSlotStatusTone(status: "missing" | "optional" | "satisfied") {
  switch (status) {
    case "satisfied":
      return "success";
    case "missing":
      return "warn";
    case "optional":
    default:
      return "";
  }
}

function informationCollectionSlotTypeLabel(
  type: "string" | "number" | "boolean" | "date" | "datetime" | "enum" | "file" | "directory" | "json"
) {
  switch (type) {
    case "string":
      return l("文本", "String");
    case "number":
      return l("数字", "Number");
    case "boolean":
      return l("布尔", "Boolean");
    case "date":
      return l("日期", "Date");
    case "datetime":
      return l("日期时间", "Datetime");
    case "enum":
      return l("枚举", "Enum");
    case "file":
      return l("文件", "File");
    case "directory":
      return l("目录", "Directory");
    case "json":
    default:
      return l("JSON", "JSON");
  }
}

function informationCollectionAnswerSourceLabel(source: "user-message" | "manual-review" | null) {
  switch (source) {
    case "manual-review":
      return l("人工复核", "Manual review");
    case "user-message":
      return l("用户消息", "User message");
    default:
      return l("未知来源", "Unknown source");
  }
}

function informationCollectionAnswerSourceTone(source: "user-message" | "manual-review" | null) {
  switch (source) {
    case "manual-review":
      return "warn";
    case "user-message":
      return "active";
    default:
      return "";
  }
}

function informationCollectionAnswerReviewStatusLabel(
  status: "pending" | "approved" | "rejected" | "superseded"
) {
  switch (status) {
    case "approved":
      return l("已批准", "Approved");
    case "rejected":
      return l("已驳回", "Rejected");
    case "superseded":
      return l("已替代", "Superseded");
    case "pending":
    default:
      return l("待复核", "Pending");
  }
}

function informationCollectionAnswerReviewStatusTone(
  status: "pending" | "approved" | "rejected" | "superseded"
) {
  switch (status) {
    case "approved":
      return "success";
    case "rejected":
      return "warn";
    case "superseded":
      return "";
    case "pending":
    default:
      return "active";
  }
}

type RelatedWorkshopReference = {
  id: string;
  title: LocalizedString;
};

type RelatedServiceReference = {
  id: string;
  name: LocalizedString;
  targetPath: string;
};

function mapCatalogWorkshopReference(item: WorkshopCatalogEntry): RelatedWorkshopReference {
  return {
    id: item.workshopId,
    title: item.displayName,
  };
}

function mapCatalogServiceReference(item: ServiceCatalogEntry): RelatedServiceReference {
  return {
    id: item.serviceId,
    name: item.displayName,
    targetPath: item.targetPathHint,
  };
}

function buildUnresolvedWorkshopReference(workshopId: string): RelatedWorkshopReference {
  return {
    id: workshopId,
    title: l(`未解析工坊 ${workshopId}`, `Unresolved workshop ${workshopId}`),
  };
}

function buildUnresolvedServiceReference(serviceId: string): RelatedServiceReference {
  return {
    id: serviceId,
    name: l(`未解析服务 ${serviceId}`, `Unresolved service ${serviceId}`),
    targetPath: "-",
  };
}

type CreatorOperationTone = "" | "active" | "warn" | "success";
type CreatorActionTarget =
  | "release"
  | "debug"
  | "governance-policy"
  | "governance-audit"
  | "governance-cost";

type CreatorOperationMetric = {
  label: LocalizedString;
  value: string;
  tone: CreatorOperationTone;
  note: LocalizedString;
};

type CreatorOperationAction = {
  label: LocalizedString;
  tone: CreatorOperationTone;
  hint: LocalizedString;
  target: CreatorActionTarget;
};

type CreatorOperationItem = {
  title: LocalizedString;
  tone: CreatorOperationTone;
  note: LocalizedString;
};

type CreatorOperationMeta = {
  summary: LocalizedString;
  metrics: CreatorOperationMetric[];
  actions: CreatorOperationAction[];
  rollout: CreatorOperationItem[];
  alerts: CreatorOperationItem[];
};

type WorkspaceChip = {
  id: string;
  name: LocalizedString;
};

function latestByUpdatedAt<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

function releaseStateValue(state: CreatorReleaseSummary["state"] | null) {
  switch (state) {
    case "production":
      return "Production";
    case "staged":
      return "Staged";
    case "private":
      return "Private";
    default:
      return "Draft";
  }
}

function replayStateValue(state: CreatorReplaySummary["state"] | null) {
  switch (state) {
    case "running":
      return "Running";
    case "failed":
      return "Failed";
    case "ready":
      return "Ready";
    default:
      return "None";
  }
}

function gateHealthLabel(gates: CreatorReleaseGate[]) {
  const failed = gates.filter((item) => item.status === "failed").length;
  const pending = gates.filter((item) => item.status === "pending" || item.status === "running").length;

  if (failed > 0) {
    return {
      value: `Fail ${failed}`,
      tone: "warn" as const,
      note: l("存在未通过的正式 Gate。", "One or more formal gates are failed."),
    };
  }

  if (pending > 0) {
    return {
      value: `Pend ${pending}`,
      tone: "active" as const,
      note: l("仍有待处理的正式 Gate。", "One or more formal gates remain pending."),
    };
  }

  if (gates.length > 0) {
    return {
      value: `Pass ${gates.length}`,
      tone: "success" as const,
      note: l("当前 release 的正式 Gate 已全部通过或豁免。", "All formal gates on the current release are passed or waived."),
    };
  }

  return {
    value: "None",
    tone: "" as const,
    note: l("当前 package 还没有正式 Gate 记录。", "No formal gate record exists for this package yet."),
  };
}

function buildCreatorOperationMeta(input: {
  pkg: CreatorPackageView;
  releases: CreatorReleaseSummary[];
  replays: CreatorReplaySummary[];
  gates: CreatorReleaseGate[];
  activations: CreatorReleaseActivation[];
  boundWorkspaces: WorkspaceChip[];
  relatedWorkshops: RelatedWorkshopReference[];
  relatedServices: RelatedServiceReference[];
}): CreatorOperationMeta {
  const { pkg, releases, replays, gates, activations, boundWorkspaces, relatedWorkshops, relatedServices } = input;
  const latestRelease = latestByUpdatedAt(releases);
  const latestReplay = latestByUpdatedAt(replays);
  const activeActivation =
    latestByUpdatedAt(activations.filter((item) => item.state === "active")) ??
    latestByUpdatedAt(activations);
  const gateHealth = gateHealthLabel(gates);
  const workspaceCount = boundWorkspaces.length;
  const riskFocus =
    gates.some((item) => item.status === "failed")
      ? {
          value: "Gate",
          tone: "warn" as const,
          note: l("先解决失败 Gate，再扩大发布范围。", "Resolve failed gates before widening rollout."),
        }
      : gates.some((item) => item.status === "pending" || item.status === "running")
        ? {
            value: "Review",
            tone: "active" as const,
            note: l("正式 Gate 仍在处理中。", "Formal gates are still in progress."),
          }
        : activeActivation
          ? {
              value: "Stable",
              tone: "success" as const,
              note: l("当前 release 已有激活记录。", "The current release already has an activation record."),
            }
          : {
              value: "Activation",
              tone: "warn" as const,
              note: l("仍需完成激活或扩大灰度范围。", "Activation or wider staged rollout is still pending."),
            };

  return {
    summary:
      latestRelease != null
        ? l(
            `当前包围绕 ${pkg.releaseChannel.zh} 继续推进，实例化模板与目录暴露已经跟随正式 release / activation 计算。`,
            `This package is moving through ${pkg.releaseChannel.en}, and both launch templates plus catalog exposure now follow formal release and activation state.`
          )
        : l(
            "当前包还没有正式 release 记录。先完成基础发布，再进入灰度或正式激活。",
            "This package has no formal release record yet. Create a release first before staged or production activation."
          ),
    metrics: [
      {
        label: l("发布状态", "Release state"),
        value: activeActivation ? "Active" : releaseStateValue(latestRelease?.state ?? null),
        tone: activeActivation ? "success" : latestRelease ? "active" : "warn",
        note: activeActivation
          ? l("存在已激活发布。", "An activation record exists for the current package.")
          : latestRelease
            ? l(`最新发布通道：${pkg.releaseChannel.zh}`, `Latest release channel: ${pkg.releaseChannel.en}`)
            : l("尚未创建正式 release。", "No formal release has been created yet."),
      },
      {
        label: l("回放状态", "Replay state"),
        value: replayStateValue(latestReplay?.state ?? null),
        tone: latestReplay?.state === "running" ? "active" : latestReplay ? "success" : "warn",
        note: latestReplay
          ? l(`最近回放更新时间：${latestReplay.updatedAt}`, `Latest replay updated at ${latestReplay.updatedAt}`)
          : l("当前没有可用 replay 记录。", "No replay record is available yet."),
      },
      {
        label: l("风险关注", "Risk focus"),
        value: riskFocus.value,
        tone: riskFocus.tone,
        note: riskFocus.note,
      },
    ],
    actions: [
      {
        label: l("发布", "Publish"),
        tone: latestRelease ? "active" : "warn",
        hint: latestRelease
          ? l("回到发布页签查看 release/gate/activation 主链。", "Open the release tab to inspect release, gate, and activation state.")
          : l("当前还没有 release，先创建一条正式发布记录。", "No release exists yet. Create a release record first."),
        target: "release",
      },
      {
        label: l("灰度", "Stage rollout"),
        tone: workspaceCount > 1 ? "success" : "active",
        hint: l("围绕工作区上下文扩展或收缩可见范围。", "Expand or shrink visibility across workspace contexts."),
        target: "release",
      },
      {
        label: l("回滚", "Rollback"),
        tone: activeActivation ? "warn" : "",
        hint: activeActivation
          ? l("当前存在激活记录，回滚前先核对最新 release 与 replay。", "An activation exists. Check the latest release and replay before rollback.")
          : l("当前没有激活记录，回滚动作会主要落在 release 版本切换。", "No active rollout exists, so rollback mostly means release-version switching."),
        target: "debug",
      },
      {
        label: l("停用", "Disable"),
        tone: activeActivation ? "warn" : "",
        hint: l("停用前应先检查工作区绑定与治理策略。", "Inspect workspace bindings and governance policy before disabling."),
        target: "governance-policy",
      },
      {
        label: l("调试", "Debug"),
        tone: latestReplay ? "active" : "warn",
        hint: latestReplay
          ? l("进入回放链路，核对消息时序、文件差异与审批节点。", "Use replay to inspect message order, file diffs, and approval nodes.")
          : l("当前还没有 replay 记录，建议先补一轮调试回放。", "No replay exists yet. Add a debug replay pass first."),
        target: "debug",
      },
    ],
    rollout: [
      {
        title: l("目录暴露与模板版本", "Catalog exposure and template version"),
        tone: activeActivation ? "success" : latestRelease ? "active" : "warn",
        note: activeActivation
          ? l("实例化模板已跟随 active activation 输出。", "Launch templates already follow the active activation.")
          : latestRelease
            ? l("实例化模板已跟随最新 release 版本计算。", "Launch templates follow the latest release version.")
            : l("尚未形成可消费的 release 模板。", "No consumable release template exists yet."),
      },
      {
        title: l("工作区覆盖范围", "Workspace rollout scope"),
        tone: workspaceCount > 1 ? "active" : "success",
        note: workspaceCount > 0
          ? l(`当前绑定 ${workspaceCount} 个工作区上下文。`, `Currently bound to ${workspaceCount} workspace contexts.`)
          : l("当前还没有可见工作区上下文。", "No workspace context is bound yet."),
      },
      {
        title: l("正式 Gate 健康度", "Formal gate health"),
        tone: gateHealth.tone,
        note: gateHealth.note,
      },
    ],
    alerts: [
      {
        title: l("工坊与服务绑定", "Workshop and service bindings"),
        tone: relatedWorkshops.length > 0 && relatedServices.length > 0 ? "success" : "warn",
        note:
          relatedWorkshops.length > 0 && relatedServices.length > 0
            ? l(
                `已绑定 ${relatedWorkshops.length} 个工坊和 ${relatedServices.length} 个服务。`,
                `Bound to ${relatedWorkshops.length} workshops and ${relatedServices.length} services.`
              )
            : l("当前 package 的工坊或服务绑定仍不完整。", "Workshop or service bindings are still incomplete for this package."),
      },
      {
        title: l("激活状态", "Activation status"),
        tone: activeActivation ? "success" : latestRelease ? "warn" : "",
        note: activeActivation
          ? l(
              `最新激活：${activeActivation.targetWorkspaceContextKey} / ${activeActivation.rolloutMode}`,
              `Latest activation: ${activeActivation.targetWorkspaceContextKey} / ${activeActivation.rolloutMode}`
            )
          : latestRelease
            ? l("已有 release 记录，但当前没有 active activation。", "A release exists, but no active activation is present.")
            : l("还没有 activation 记录。", "No activation record exists yet."),
      },
    ],
  };
}

function createGovernanceMeta(input: {
  title: LocalizedString;
  actions: LocalizedString[];
  headers: GovernanceMeta["headers"];
}): GovernanceMeta {
  return {
    title: input.title,
    summary: l(
      "该治理分段只展示正式后端数据，不再渲染静态参考样例。",
      "This governance segment renders formal backend data only and no longer falls back to static samples."
    ),
    actions: input.actions,
    metrics: [],
    headers: input.headers,
    rows: [],
  };
}

const governanceMeta: Record<GovernanceSection, GovernanceMeta> = {
  credentials: createGovernanceMeta({
    title: l("凭证与注入策略", "Credentials and injection policy"),
    actions: [l("导出凭证清单", "Export credential ledger"), l("检查轮换计划", "Review rotation plan")],
    headers: [
      l("凭证名称", "Credential"),
      l("范围 / 提供方", "Scope / provider"),
      l("状态", "State"),
      l("注入摘要", "Injection summary"),
    ],
  }),
  members: createGovernanceMeta({
    title: l("成员与空间边界", "Members and workspace boundaries"),
    actions: [l("导出成员矩阵", "Export member matrix"), l("检查空间边界", "Review workspace boundaries")],
    headers: [
      l("成员 / 角色", "Member / role"),
      l("可见范围", "Visible scope"),
      l("实例权限", "Run access"),
      l("包权限", "Package access"),
    ],
  }),
  policy: createGovernanceMeta({
    title: l("运行与审批策略", "Runtime and approval policy"),
    actions: [l("查看策略快照", "View policy snapshot"), l("导出白名单", "Export allowlists")],
    headers: [
      l("策略对象", "Policy object"),
      l("来源 / 作用域", "Source / scope"),
      l("状态", "State"),
      l("执行说明", "Execution note"),
    ],
  }),
  audit: createGovernanceMeta({
    title: l("审计与发布留痕", "Audit and release ledger"),
    actions: [l("导出审计 JSON", "Export audit JSON"), l("查看回放摘要", "Open replay summary")],
    headers: [
      l("留痕对象", "Ledger object"),
      l("来源", "Source"),
      l("保留策略", "Retention"),
      l("当前状态", "Current status"),
    ],
  }),
  cost: createGovernanceMeta({
    title: l("成本与额度治理", "Cost and quota governance"),
    actions: [l("导出成本摘要", "Export cost summary"), l("查看额度阈值", "Inspect quota thresholds")],
    headers: [
      l("成本项", "Cost item"),
      l("计量域", "Metering scope"),
      l("当前使用", "Current usage"),
      l("阈值 / 动作", "Threshold / action"),
    ],
  }),
};

const governanceSectionLabel: Record<GovernanceSection, { zh: string; en: string }> = {
  credentials: { zh: "凭证", en: "Credentials" },
  members: { zh: "成员", en: "Members" },
  policy: { zh: "策略", en: "Policy" },
  audit: { zh: "审计", en: "Audit" },
  cost: { zh: "成本", en: "Cost" },
};

function CreatorTabPanel({
  pkg,
  availableWorkspaceContextKeys,
  defaultWorkspaceContextKey,
  queriesEnabled,
}: {
  pkg: CreatorPackageView;
  availableWorkspaceContextKeys: string[];
  defaultWorkspaceContextKey: string;
  queriesEnabled: boolean;
}) {
  const lang = useDashboardUiStore((state) => state.lang);
  const creatorTab = useDashboardUiStore((state) => state.creatorTab);
  const navigate = useNavigate();
  const authMode = useDashboardAuthStore((state) => state.authMode);
  const authenticated = useDashboardAuthStore((state) => state.authenticated);
  const authReady = authMode === "required" && authenticated;
  const queryClient = useQueryClient();
  const packageSessionVersionId = useMemo(
    () => findVersionLineRef(pkg.versionLine, "session"),
    [pkg.versionLine]
  );
  const [activeSessionVersionId, setActiveSessionVersionId] = useState<string | null>(
    packageSessionVersionId
  );
  const [consumerGovernanceQuery, setConsumerGovernanceQuery] = useState("");
  const sessionPackQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "session-pack",
      activeSessionVersionId,
      defaultWorkspaceContextKey,
    ],
    queryFn: async () => dashboardSessionsApi.getSessionPack(activeSessionVersionId!),
    enabled: queriesEnabled && creatorTab === "session" && Boolean(activeSessionVersionId),
    retry: false,
    staleTime: 30_000,
  });
  const sessionLineageQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "session-lineage",
      activeSessionVersionId,
      defaultWorkspaceContextKey,
    ],
    queryFn: async () => dashboardSessionsApi.getSessionPackLineage(activeSessionVersionId!),
    enabled: queriesEnabled && creatorTab === "session" && Boolean(activeSessionVersionId),
    retry: false,
    staleTime: 30_000,
  });
  const comparisonSessionVersionId = useMemo(() => {
    const candidate = packageSessionVersionId ?? null;
    if (!candidate || candidate === activeSessionVersionId) {
      return null;
    }

    return candidate;
  }, [activeSessionVersionId, packageSessionVersionId]);
  const comparisonSessionPackQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "session-pack",
      "comparison",
      comparisonSessionVersionId,
      defaultWorkspaceContextKey,
    ],
    queryFn: async () => dashboardSessionsApi.getSessionPack(comparisonSessionVersionId!),
    enabled:
      queriesEnabled &&
      creatorTab === "session" &&
      Boolean(comparisonSessionVersionId) &&
      comparisonSessionVersionId !== activeSessionVersionId,
    retry: false,
    staleTime: 30_000,
  });
  const sessionPack = sessionPackQuery.data ?? null;
  const sessionLineage = sessionLineageQuery.data ?? null;
  const comparisonSessionPack = comparisonSessionPackQuery.data ?? null;
  const governanceSummary = sessionPack?.governanceSummary ?? null;
  const runtimeEvidenceSummary = sessionPack?.runtimeEvidenceSummary ?? null;
  const signatureSummary = sessionPack?.signatureSummary ?? null;
  const policySummary = sessionPack?.policySummary ?? null;
  const redactionSummary = sessionPack?.redactionSummary ?? null;
  const redactionReview = sessionPack?.redactionReview ?? null;
  const archiveExportAudit = sessionPack?.archiveExportAudit ?? null;
  const consumerGovernance = sessionPack?.consumerGovernance ?? null;
  const informationCollectionReview = sessionPack?.informationCollectionReview ?? null;
  const informationCollectionReviewSlots = useMemo(
    () => informationCollectionReview?.slots ?? [],
    [informationCollectionReview?.slots]
  );
  const archiveRedactedPolicyAction = useMemo(
    () => policySummary?.actions.find((item) => item.action === "archive-redacted") ?? null,
    [policySummary?.actions]
  );
  const inheritPolicyAction = useMemo(
    () => policySummary?.actions.find((item) => item.action === "inherit") ?? null,
    [policySummary?.actions]
  );
  const publishPolicyAction = useMemo(
    () => policySummary?.actions.find((item) => item.action === "publish") ?? null,
    [policySummary?.actions]
  );
  const rollbackPolicyAction = useMemo(
    () => policySummary?.actions.find((item) => item.action === "rollback") ?? null,
    [policySummary?.actions]
  );
  const unpublishPolicyAction = useMemo(
    () => policySummary?.actions.find((item) => item.action === "unpublish") ?? null,
    [policySummary?.actions]
  );
  const consumerGovernanceItems = useMemo(
    () => consumerGovernance?.items ?? [],
    [consumerGovernance?.items]
  );
  const redactionRules = useMemo(() => redactionSummary?.rules ?? [], [redactionSummary?.rules]);
  const persistedSchemaSecretSlotKeys = useMemo(
    () =>
      normalizeStringKeyList([
        ...(redactionSummary?.schemaSecretSlotKeys ?? []),
        ...informationCollectionReviewSlots
          .filter((slot) => slot.secret)
          .map((slot) => slot.key),
      ]),
    [informationCollectionReviewSlots, redactionSummary?.schemaSecretSlotKeys]
  );
  const persistedCuratedSecretSlotKeys = useMemo(
    () => normalizeStringKeyList(redactionSummary?.curatedSecretSlotKeys ?? []),
    [redactionSummary?.curatedSecretSlotKeys]
  );
  const persistedEffectiveSecretSlotKeys = useMemo(
    () =>
      normalizeStringKeyList([
        ...(redactionSummary?.secretSlotKeys ?? []),
        ...persistedSchemaSecretSlotKeys,
        ...persistedCuratedSecretSlotKeys,
      ]),
    [persistedCuratedSecretSlotKeys, persistedSchemaSecretSlotKeys, redactionSummary?.secretSlotKeys]
  );
  const publishedTargets = useMemo(() => sessionPack?.publishedTargets ?? [], [sessionPack?.publishedTargets]);
  const entrySurfaceOptions: EntrySurface[] = ["dashboard", "h5", "mini-program"];
  const sessionWorkspaceOptions = useMemo(() => {
    return [...new Set([
      ...availableWorkspaceContextKeys,
      defaultWorkspaceContextKey,
      ...(sessionPack?.workspaceContextKeys ?? []),
      ...publishedTargets.map((item) => item.workspaceContextKey),
    ])];
  }, [availableWorkspaceContextKeys, defaultWorkspaceContextKey, publishedTargets, sessionPack?.workspaceContextKeys]);
  const sessionServiceOptions = useMemo(() => {
    return [...new Set([
      ...pkg.linkedServiceIds,
      ...(sessionPack?.linkedServiceIds ?? []),
      ...publishedTargets.map((item) => item.serviceId),
    ])];
  }, [pkg.linkedServiceIds, publishedTargets, sessionPack?.linkedServiceIds]);
  const rollbackTargetOptions = useMemo(() => {
    return [...new Set([
      sessionPack?.lineageParentVersionId,
      sessionPack?.rollbackFromVersionId,
    ].filter((item): item is string => Boolean(item)))];
  }, [sessionPack?.lineageParentVersionId, sessionPack?.rollbackFromVersionId]);
  const firstPublishedTarget = publishedTargets[0] ?? null;
  const preferredWorkspaceContextKey =
    firstPublishedTarget?.workspaceContextKey ??
    (sessionWorkspaceOptions.includes(defaultWorkspaceContextKey)
      ? defaultWorkspaceContextKey
      : sessionWorkspaceOptions[0] ?? defaultWorkspaceContextKey);
  const preferredServiceId = firstPublishedTarget?.serviceId ?? sessionServiceOptions[0] ?? "";
  const preferredEntrySurface = firstPublishedTarget?.entrySurface ?? "dashboard";
  const preferredTargetRoot = firstPublishedTarget?.targetRoot ?? "";
  const [publishDraft, setPublishDraft] = useState<{
    workspaceContextKey: string;
    serviceId: string;
    entrySurface: EntrySurface;
    applyToAllEntrySurfaces: boolean;
    taskVersionId: string;
    titleZh: string;
    titleEn: string;
    targetRoot: string;
  }>({
    workspaceContextKey: preferredWorkspaceContextKey,
    serviceId: preferredServiceId,
    entrySurface: preferredEntrySurface,
    applyToAllEntrySurfaces: true,
    taskVersionId: sessionPack?.primaryTaskVersionId ?? "",
    titleZh: "",
    titleEn: "",
    targetRoot: preferredTargetRoot,
  });
  const [rollbackDraft, setRollbackDraft] = useState<{
    workspaceContextKey: string;
    serviceId: string;
    rollbackToSessionVersionId: string;
    entrySurface: EntrySurface;
    applyToAllEntrySurfaces: boolean;
  }>({
    workspaceContextKey: preferredWorkspaceContextKey,
    serviceId: preferredServiceId,
    rollbackToSessionVersionId: rollbackTargetOptions[0] ?? "",
    entrySurface: preferredEntrySurface,
    applyToAllEntrySurfaces: true,
  });
  const [unpublishDraft, setUnpublishDraft] = useState<{
    workspaceContextKey: string;
    serviceId: string;
    entrySurface: EntrySurface;
    applyToAllEntrySurfaces: boolean;
  }>({
    workspaceContextKey: preferredWorkspaceContextKey,
    serviceId: preferredServiceId,
    entrySurface: preferredEntrySurface,
    applyToAllEntrySurfaces: true,
  });
  const [inheritDraft, setInheritDraft] = useState<{
    workspaceContextKey: string;
    inheritMode: SessionPackInheritMode;
    newSessionId: string;
    newSessionVersionId: string;
    reason: string;
  }>({
    workspaceContextKey: preferredWorkspaceContextKey,
    inheritMode: "draft",
    newSessionId: "",
    newSessionVersionId: "",
    reason: "",
  });
  const [redactionWorkspaceContextKey, setRedactionWorkspaceContextKey] = useState(
    preferredWorkspaceContextKey
  );
  const [redactionReviewWorkspaceContextKey, setRedactionReviewWorkspaceContextKey] = useState(
    preferredWorkspaceContextKey
  );
  const [redactionMapVersionDraft, setRedactionMapVersionDraft] = useState(
    redactionSummary?.mapVersion ?? "curated.v1"
  );
  const [redactionCuratedSecretSlotKeysDraft, setRedactionCuratedSecretSlotKeysDraft] = useState<string[]>(
    () => persistedCuratedSecretSlotKeys
  );
  const [redactionRuleDrafts, setRedactionRuleDrafts] = useState<SessionPackRedactionRuleInput[]>(
    () => redactionRules.map(mapRedactionRuleSummaryToInput)
  );
  const [redactionRuleEditor, setRedactionRuleEditor] = useState<RedactionRuleEditorDraft>(
    createEmptyRedactionRuleEditorDraft
  );
  const [editingRedactionRuleId, setEditingRedactionRuleId] = useState<string | null>(null);
  const [redactionReviewNoteDraft, setRedactionReviewNoteDraft] = useState(
    redactionReview?.note ?? ""
  );
  const [sessionOperationNotice, setSessionOperationNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const filteredConsumerGovernanceItems = useMemo(() => {
    return consumerGovernanceItems.filter((item) =>
      matchesSearchQuery(consumerGovernanceQuery, [
        item.sessionVersionId,
        item.sessionId,
        t(lang, item.displayName),
        t(lang, item.summary),
        item.inheritMode ?? null,
        item.consumerRunId,
        item.consumerWorkspaceId,
        item.consumerServiceId,
        item.consumerWorkshopId,
        item.consumerEntrySurface ?? null,
        item.consumerTargetPath,
        item.runtimeSourceRunId,
        item.runtimeSourceTargetPath,
        item.archiveSource,
        ...item.workspaceContextKeys,
        ...item.linkedServiceIds,
        ...item.linkedWorkshopIds,
      ])
    );
  }, [consumerGovernanceItems, consumerGovernanceQuery, lang]);
  const persistedRedactionRuleInputs = useMemo(
    () => redactionRules.map(mapRedactionRuleSummaryToInput).map(normalizeRedactionRuleInput),
    [redactionRules]
  );
  const normalizedRedactionCuratedSecretSlotKeysDraft = useMemo(
    () => normalizeStringKeyList(redactionCuratedSecretSlotKeysDraft),
    [redactionCuratedSecretSlotKeysDraft]
  );
  const persistedCuratedSecretSlotFingerprint = useMemo(
    () => JSON.stringify(persistedCuratedSecretSlotKeys),
    [persistedCuratedSecretSlotKeys]
  );
  const redactionCuratedSecretSlotFingerprint = useMemo(
    () => JSON.stringify(normalizedRedactionCuratedSecretSlotKeysDraft),
    [normalizedRedactionCuratedSecretSlotKeysDraft]
  );
  const redactionRuleDraftFingerprint = useMemo(
    () => JSON.stringify(redactionRuleDrafts.map(normalizeRedactionRuleInput)),
    [redactionRuleDrafts]
  );
  const persistedRedactionRuleFingerprint = useMemo(
    () => JSON.stringify(persistedRedactionRuleInputs),
    [persistedRedactionRuleInputs]
  );
  const redactionDraftDirty =
    (redactionMapVersionDraft.trim() || "") !== (redactionSummary?.mapVersion ?? "") ||
    redactionCuratedSecretSlotFingerprint !== persistedCuratedSecretSlotFingerprint ||
    redactionRuleDraftFingerprint !== persistedRedactionRuleFingerprint;
  const persistedRedactionRuleById = useMemo(
    () => new Map(redactionRules.map((rule) => [rule.ruleId, rule] as const)),
    [redactionRules]
  );
  const draftSecretSlotKeys = useMemo(
    () =>
      normalizeStringKeyList([
        ...persistedSchemaSecretSlotKeys,
        ...normalizedRedactionCuratedSecretSlotKeysDraft,
      ]),
    [normalizedRedactionCuratedSecretSlotKeysDraft, persistedSchemaSecretSlotKeys]
  );
  const draftRuleSlotKeySet = useMemo(
    () =>
      new Set(
        redactionRuleDrafts
          .map((rule) => rule.slotKey?.trim() ?? "")
          .filter((item): item is string => item.length > 0)
      ),
    [redactionRuleDrafts]
  );
  const draftCoveredSecretSlotKeys = useMemo(
    () => draftSecretSlotKeys.filter((slotKey) => draftRuleSlotKeySet.has(slotKey)),
    [draftRuleSlotKeySet, draftSecretSlotKeys]
  );
  const draftUncoveredSecretSlotKeys = useMemo(
    () => draftSecretSlotKeys.filter((slotKey) => !draftRuleSlotKeySet.has(slotKey)),
    [draftRuleSlotKeySet, draftSecretSlotKeys]
  );
  const redactionSlotOptions = useMemo(() => {
    return normalizeStringKeyList([
      ...informationCollectionReviewSlots.map((slot) => slot.key),
      ...persistedEffectiveSecretSlotKeys,
      ...redactionRules.map((rule) => rule.slotKey),
      ...redactionRuleDrafts.map((rule) => rule.slotKey),
    ]);
  }, [
    informationCollectionReviewSlots,
    persistedEffectiveSecretSlotKeys,
    redactionRuleDrafts,
    redactionRules,
  ]);
  const redactionSecretSlotCatalog = useMemo(() => {
    const reviewSlotByKey = new Map(
      informationCollectionReviewSlots.map((slot) => [slot.key, slot] as const)
    );
    const schemaSecretSlotSet = new Set(persistedSchemaSecretSlotKeys);
    const curatedSecretSlotSet = new Set(normalizedRedactionCuratedSecretSlotKeysDraft);
    const persistedSecretCoverageSet = new Set(redactionSummary?.coveredSecretSlotKeys ?? []);

    return redactionSlotOptions.map((slotKey) => {
      const reviewSlot = reviewSlotByKey.get(slotKey) ?? null;
      const schemaSecret = schemaSecretSlotSet.has(slotKey);
      const curatedSecret = curatedSecretSlotSet.has(slotKey);
      const effectiveSecret = schemaSecret || curatedSecret;
      return {
        key: slotKey,
        title: reviewSlot?.title ?? slotKey,
        required: reviewSlot?.required ?? false,
        type: reviewSlot?.type ?? null,
        schemaSecret,
        curatedSecret,
        effectiveSecret,
        draftCovered: effectiveSecret && draftRuleSlotKeySet.has(slotKey),
        persistedCovered: persistedSecretCoverageSet.has(slotKey),
      };
    });
  }, [
    draftRuleSlotKeySet,
    informationCollectionReviewSlots,
    normalizedRedactionCuratedSecretSlotKeysDraft,
    persistedSchemaSecretSlotKeys,
    redactionSlotOptions,
    redactionSummary?.coveredSecretSlotKeys,
  ]);
  const redactionRuleEditorError = useMemo(() => {
    if (!redactionRuleEditor.ruleId.trim()) {
      return t(lang, { zh: "请填写规则 ID。", en: "Rule ID is required." });
    }
    if (!redactionRuleEditor.selector.trim()) {
      return t(lang, { zh: "请填写 selector。", en: "Selector is required." });
    }
    if (
      redactionRuleEditor.strategy === "replace" &&
      !redactionRuleEditor.replacement.trim()
    ) {
      return t(lang, {
        zh: "替换策略必须填写 replacement。",
        en: "Replacement is required when the strategy is replace.",
      });
    }
    const normalizedRuleId = redactionRuleEditor.ruleId.trim();
    const duplicateRule = redactionRuleDrafts.some(
      (rule) =>
        rule.ruleId.trim() === normalizedRuleId &&
        rule.ruleId.trim() !== (editingRedactionRuleId?.trim() ?? "")
    );
    if (duplicateRule) {
      return t(lang, {
        zh: `规则 ID ${normalizedRuleId} 已存在于当前草稿中。`,
        en: `Rule ID ${normalizedRuleId} already exists in the current draft.`,
      });
    }
    return null;
  }, [editingRedactionRuleId, lang, redactionRuleDrafts, redactionRuleEditor]);

  const resetRedactionDraftState = useCallback(
    (input?: {
      workspaceContextKey?: string;
      mapVersion?: string | null;
      curatedSecretSlotKeys?: string[];
      rules?: SessionPackRedactionRuleInput[];
    }) => {
      setRedactionWorkspaceContextKey(input?.workspaceContextKey ?? preferredWorkspaceContextKey);
      setRedactionMapVersionDraft(input?.mapVersion ?? redactionSummary?.mapVersion ?? "curated.v1");
      setRedactionCuratedSecretSlotKeysDraft(
        normalizeStringKeyList(input?.curatedSecretSlotKeys ?? persistedCuratedSecretSlotKeys)
      );
      setRedactionRuleDrafts(
        input?.rules ?? redactionRules.map(mapRedactionRuleSummaryToInput)
      );
      setRedactionRuleEditor(createEmptyRedactionRuleEditorDraft());
      setEditingRedactionRuleId(null);
    },
    [
      persistedCuratedSecretSlotKeys,
      preferredWorkspaceContextKey,
      redactionRules,
      redactionSummary?.mapVersion,
    ]
  );

  useEffect(() => {
    setActiveSessionVersionId(packageSessionVersionId);
  }, [packageSessionVersionId, pkg.id]);

  useEffect(() => {
    setConsumerGovernanceQuery("");
  }, [activeSessionVersionId]);

  useEffect(() => {
    if (!activeSessionVersionId) {
      return;
    }

    setPublishDraft({
      workspaceContextKey: preferredWorkspaceContextKey,
      serviceId: preferredServiceId,
      entrySurface: preferredEntrySurface,
      applyToAllEntrySurfaces: true,
      taskVersionId: sessionPack?.primaryTaskVersionId ?? "",
      titleZh: "",
      titleEn: "",
      targetRoot: preferredTargetRoot,
    });
    setRollbackDraft({
      workspaceContextKey: preferredWorkspaceContextKey,
      serviceId: preferredServiceId,
      rollbackToSessionVersionId: rollbackTargetOptions[0] ?? "",
      entrySurface: preferredEntrySurface,
      applyToAllEntrySurfaces: true,
    });
    setUnpublishDraft({
      workspaceContextKey: preferredWorkspaceContextKey,
      serviceId: preferredServiceId,
      entrySurface: preferredEntrySurface,
      applyToAllEntrySurfaces: true,
    });
    setInheritDraft({
      workspaceContextKey: preferredWorkspaceContextKey,
      inheritMode: "draft",
      newSessionId: "",
      newSessionVersionId: "",
      reason: "",
    });
    resetRedactionDraftState({
      workspaceContextKey: preferredWorkspaceContextKey,
      mapVersion: redactionSummary?.mapVersion ?? "curated.v1",
      curatedSecretSlotKeys: persistedCuratedSecretSlotKeys,
      rules: redactionRules.map(mapRedactionRuleSummaryToInput),
    });
    setRedactionReviewWorkspaceContextKey(preferredWorkspaceContextKey);
    setRedactionReviewNoteDraft(redactionReview?.note ?? "");
  }, [
    activeSessionVersionId,
    preferredEntrySurface,
    preferredServiceId,
    preferredTargetRoot,
    persistedCuratedSecretSlotKeys,
    preferredWorkspaceContextKey,
    redactionReview?.note,
    resetRedactionDraftState,
    redactionRules,
    redactionSummary?.mapVersion,
    rollbackTargetOptions,
    sessionPack?.primaryTaskVersionId,
  ]);

  useEffect(() => {
    setSessionOperationNotice(null);
  }, [activeSessionVersionId]);

  const buildSessionInheritPayload = (input: {
    workspaceContextKey: string;
    inheritMode: SessionPackInheritMode;
    newSessionId: string;
    newSessionVersionId: string;
    reason: string;
  }) => ({
    workspaceContextKey: input.workspaceContextKey,
    inheritMode: input.inheritMode,
    newSessionId: input.newSessionId.trim() || undefined,
    newSessionVersionId: input.newSessionVersionId.trim() || undefined,
    reason: input.reason.trim() || undefined,
  });

  const inheritSessionPackMutation = useMutation({
    mutationFn: async (input: {
      workspaceContextKey: string;
      inheritMode: SessionPackInheritMode;
      newSessionId: string;
      newSessionVersionId: string;
      reason: string;
    }) =>
      dashboardSessionsApi.inheritSessionPack(activeSessionVersionId!, {
        ...buildSessionInheritPayload(input),
      }),
    onSuccess: async (result) => {
      const nextSessionVersionId = result.sessionPack.sessionVersionId;
      queryClient.setQueryData(
        ["dashboard", "creator", "session-pack", nextSessionVersionId, defaultWorkspaceContextKey],
        result.sessionPack
      );
      setActiveSessionVersionId(nextSessionVersionId);
      setSessionOperationNotice({
        tone: "success",
        message: t(lang, {
          zh:
            result.inheritMode === "consumer"
              ? `已从 ${result.inheritedFromSessionVersionId} 派生出消费态版本 ${nextSessionVersionId}。当前 Session 面板已切换到该版本。`
              : `已从 ${result.inheritedFromSessionVersionId} 派生出继承草稿 ${nextSessionVersionId}。当前 Session 面板已切换到新草稿。`,
          en:
            result.inheritMode === "consumer"
              ? `Consumer-derived version ${nextSessionVersionId} was created from ${result.inheritedFromSessionVersionId}. The Session panel is now focused on it.`
              : `Inherited draft ${nextSessionVersionId} was created from ${result.inheritedFromSessionVersionId}. The Session panel is now focused on the new draft.`,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      setSessionOperationNotice({
        tone: "error",
        message: queryErrorMessage(error),
      });
    },
  });

  const unpublishSessionPackMutation = useMutation({
    mutationFn: async () =>
      dashboardSessionsApi.unpublishSessionPack(activeSessionVersionId!, {
        workspaceContextKey: unpublishDraft.workspaceContextKey,
        serviceId: unpublishDraft.serviceId.trim(),
        entrySurface: unpublishDraft.applyToAllEntrySurfaces ? undefined : unpublishDraft.entrySurface,
        applyToAllEntrySurfaces: unpublishDraft.applyToAllEntrySurfaces,
      }),
    onSuccess: async (result) => {
      setSessionOperationNotice({
        tone: "success",
        message: t(lang, {
          zh: `已从 ${result.unpublishedTargets.length} 个模板目标下线当前 Session 引用。`,
          en: `Unpublished the current session reference from ${result.unpublishedTargets.length} launch template targets.`,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      setSessionOperationNotice({
        tone: "error",
        message: queryErrorMessage(error),
      });
    },
  });

  const publishSessionPackMutation = useMutation({
    mutationFn: async () =>
      dashboardSessionsApi.publishSessionPack(activeSessionVersionId!, {
        workspaceContextKey: publishDraft.workspaceContextKey,
        serviceId: publishDraft.serviceId.trim(),
        entrySurface: publishDraft.applyToAllEntrySurfaces ? undefined : publishDraft.entrySurface,
        applyToAllEntrySurfaces: publishDraft.applyToAllEntrySurfaces,
        taskVersionId: publishDraft.taskVersionId.trim() || undefined,
        title: publishDraft.titleZh.trim()
          ? {
              zh: publishDraft.titleZh.trim(),
              en: publishDraft.titleEn.trim() || publishDraft.titleZh.trim(),
            }
          : undefined,
        targetRoot: publishDraft.targetRoot.trim() || undefined,
      }),
    onSuccess: async (result) => {
      setSessionOperationNotice({
        tone: "success",
        message: t(lang, {
          zh: `已发布到 ${result.publishedTargets.length} 个模板目标，替换了 ${result.replacedSessionVersionIds.length} 条旧版本引用。`,
          en: `Published to ${result.publishedTargets.length} launch template targets and replaced ${result.replacedSessionVersionIds.length} previous version references.`,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      setSessionOperationNotice({
        tone: "error",
        message: queryErrorMessage(error),
      });
    },
  });

  const rollbackSessionPackMutation = useMutation({
    mutationFn: async () =>
      dashboardSessionsApi.rollbackSessionPack(activeSessionVersionId!, {
        workspaceContextKey: rollbackDraft.workspaceContextKey,
        serviceId: rollbackDraft.serviceId.trim(),
        rollbackToSessionVersionId: rollbackDraft.rollbackToSessionVersionId.trim(),
        entrySurface: rollbackDraft.applyToAllEntrySurfaces ? undefined : rollbackDraft.entrySurface,
        applyToAllEntrySurfaces: rollbackDraft.applyToAllEntrySurfaces,
      }),
    onSuccess: async (result) => {
      setSessionOperationNotice({
        tone: "success",
        message: t(lang, {
          zh: `已回滚到 ${result.rolledBackToSessionVersionId}，影响 ${result.publishedTargets.length} 个模板目标。`,
          en: `Rolled back to ${result.rolledBackToSessionVersionId} across ${result.publishedTargets.length} launch template targets.`,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      setSessionOperationNotice({
        tone: "error",
        message: queryErrorMessage(error),
      });
    },
  });

  const downloadSessionPackArchiveMutation = useMutation({
    mutationFn: async () => dashboardSessionsApi.downloadSessionPackArchive(activeSessionVersionId!),
    onSuccess: async (result) => {
      const fileName =
        result.fileName?.trim() || `${activeSessionVersionId}.session-pack.json.gz`;
      triggerBrowserDownload(
        fileName,
        new Blob([result.content], {
          type: result.contentType?.trim() || "application/octet-stream",
        })
      );
      setSessionOperationNotice({
        tone: "success",
        message: t(lang, {
          zh: `已下载 ${fileName}。`,
          en: `Downloaded ${fileName}.`,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      setSessionOperationNotice({
        tone: "error",
        message: queryErrorMessage(error),
      });
    },
  });
  const downloadRedactedSessionPackArchiveMutation = useMutation({
    mutationFn: async () =>
      dashboardSessionsApi.downloadSessionPackArchive(activeSessionVersionId!, {
        redact: true,
      }),
    onSuccess: async (result) => {
      const baseFileName =
        result.fileName?.trim() || `${activeSessionVersionId}.session-pack.json.gz`;
      const fileName = baseFileName.endsWith(".json.gz")
        ? `${baseFileName.slice(0, -".json.gz".length)}.redacted.json.gz`
        : `${baseFileName}.redacted`;
      triggerBrowserDownload(
        fileName,
        new Blob([result.content], {
          type: result.contentType?.trim() || "application/octet-stream",
        })
      );
      setSessionOperationNotice({
        tone: "success",
        message: t(lang, {
          zh: `已下载脱敏归档 ${fileName}。`,
          en: `Downloaded redacted archive ${fileName}.`,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      setSessionOperationNotice({
        tone: "error",
        message: queryErrorMessage(error),
      });
    },
  });
  const reviewSessionPackRedactionMutation = useMutation({
    mutationFn: async (decision: SessionPackRedactionReviewDecision) =>
      dashboardSessionsApi.reviewSessionPackRedaction(activeSessionVersionId!, {
        workspaceContextKey: redactionReviewWorkspaceContextKey,
        decision,
        note: redactionReviewNoteDraft.trim() || undefined,
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(
        ["dashboard", "creator", "session-pack", result.sessionPack.sessionVersionId, defaultWorkspaceContextKey],
        result.sessionPack
      );
      setRedactionReviewNoteDraft(result.sessionPack.redactionReview?.note ?? "");
      setSessionOperationNotice({
        tone: "success",
        message: t(lang, {
          zh:
            result.decision === "approved"
              ? "已记录脱敏审阅通过。"
              : "已记录脱敏修订意见。",
          en:
            result.decision === "approved"
              ? "Recorded an approved redaction review."
              : "Recorded redaction changes requested.",
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      setSessionOperationNotice({
        tone: "error",
        message: queryErrorMessage(error),
      });
    },
  });
  const updateSessionPackRedactionMapMutation = useMutation({
    mutationFn: async () =>
      dashboardSessionsApi.updateSessionPackRedactionMap(activeSessionVersionId!, {
        workspaceContextKey: redactionWorkspaceContextKey,
        mapVersion: redactionMapVersionDraft.trim() || undefined,
        curatedSecretSlotKeys: normalizedRedactionCuratedSecretSlotKeysDraft,
        rules: redactionRuleDrafts.map(normalizeRedactionRuleInput),
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(
        ["dashboard", "creator", "session-pack", result.sessionPack.sessionVersionId, defaultWorkspaceContextKey],
        result.sessionPack
      );
      resetRedactionDraftState({
        workspaceContextKey: redactionWorkspaceContextKey,
        mapVersion:
          result.sessionPack.redactionSummary?.mapVersion ??
          (redactionMapVersionDraft.trim() || "curated.v1"),
        curatedSecretSlotKeys: result.sessionPack.redactionSummary?.curatedSecretSlotKeys ?? [],
        rules:
          result.sessionPack.redactionSummary?.rules.map(mapRedactionRuleSummaryToInput) ?? [],
      });
      setSessionOperationNotice({
        tone: "success",
        message: t(lang, {
          zh: `已写入 ${result.totalRules} 条脱敏规则，并同步 ${normalizedRedactionCuratedSecretSlotKeysDraft.length} 个手工敏感位标记。`,
          en: `Saved ${result.totalRules} redaction rules and synchronized ${normalizedRedactionCuratedSecretSlotKeysDraft.length} curated secret-slot marks.`,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      setSessionOperationNotice({
        tone: "error",
        message: queryErrorMessage(error),
      });
    },
  });
  const stageCurrentRedactionRuleDraft = () => {
    if (redactionRuleEditorError) {
      return;
    }

    const nextRule = normalizeRedactionRuleInput(
      buildRedactionRuleInputFromEditor(redactionRuleEditor)
    );
    setRedactionRuleDrafts((current) => {
      const remaining = current.filter(
        (rule) => rule.ruleId.trim() !== nextRule.ruleId.trim()
      );
      return [...remaining, nextRule];
    });
    setEditingRedactionRuleId(null);
    setRedactionRuleEditor(createEmptyRedactionRuleEditorDraft());
  };
  const editRedactionRuleDraft = (rule: SessionPackRedactionRuleInput) => {
    setEditingRedactionRuleId(rule.ruleId);
    setRedactionRuleEditor(mapRedactionRuleInputToEditor(rule));
  };
  const removeRedactionRuleDraft = (ruleId: string) => {
    setRedactionRuleDrafts((current) =>
      current.filter((rule) => rule.ruleId.trim() !== ruleId.trim())
    );
    if (editingRedactionRuleId?.trim() === ruleId.trim()) {
      setEditingRedactionRuleId(null);
      setRedactionRuleEditor(createEmptyRedactionRuleEditorDraft());
    }
  };
  const toggleCuratedSecretSlotDraft = (slotKey: string) => {
    const normalizedSlotKey = slotKey.trim();
    if (!normalizedSlotKey || persistedSchemaSecretSlotKeys.includes(normalizedSlotKey)) {
      return;
    }

    setRedactionCuratedSecretSlotKeysDraft((current) => {
      const normalizedCurrent = normalizeStringKeyList(current);
      return normalizedCurrent.includes(normalizedSlotKey)
        ? normalizedCurrent.filter((item) => item !== normalizedSlotKey)
        : normalizeStringKeyList([...normalizedCurrent, normalizedSlotKey]);
    });
  };
  const canPersistRedactionDrafts =
    authReady &&
    Boolean(activeSessionVersionId) &&
    !updateSessionPackRedactionMapMutation.isPending &&
    redactionRuleDrafts.every(
      (rule) =>
        Boolean(rule.ruleId.trim()) &&
        Boolean(rule.selector.trim()) &&
        (rule.strategy !== "replace" || Boolean(rule.replacement?.trim()))
    );
  const matchingUnpublishTargets = useMemo(() => {
    const selectedServiceId = unpublishDraft.serviceId.trim();
    if (!selectedServiceId) {
      return [];
    }

    return publishedTargets.filter((item) => {
      if (item.workspaceContextKey !== unpublishDraft.workspaceContextKey) {
        return false;
      }
      if (item.serviceId !== selectedServiceId) {
        return false;
      }
      if (unpublishDraft.applyToAllEntrySurfaces) {
        return true;
      }
      return item.entrySurface === unpublishDraft.entrySurface;
    });
  }, [publishedTargets, unpublishDraft]);
  const sessionComparisonRows = useMemo<SessionComparisonRow[]>(() => {
    if (!sessionPack || !comparisonSessionPack) {
      return [];
    }

    const rows: SessionComparisonRow[] = [];
    const pushIfChanged = (
      key: string,
      label: LocalizedString,
      current: string,
      baseline: string,
      note?: LocalizedString,
      tone: SessionComparisonRow["tone"] = ""
    ) => {
      if (current === baseline) {
        return;
      }

      rows.push({
        key,
        label,
        baseline,
        current,
        note,
        tone,
      });
    };

    pushIfChanged(
      "inherit-mode",
      l("继承模式", "Inherit mode"),
      t(lang, sessionPackInheritModeLabel(sessionPack.inheritMode)),
      t(lang, sessionPackInheritModeLabel(comparisonSessionPack.inheritMode)),
      l(
        "用于区分 package 固定版本、继承草稿与消费派生版本。",
        "Distinguishes package-pinned, inherited draft, and consumer-derived versions."
      ),
      sessionPack.inheritMode === "consumer"
        ? "warn"
        : sessionPack.inheritMode === "draft"
          ? "active"
          : ""
    );
    pushIfChanged(
      "lineage-parent",
      l("继承父版本", "Lineage parent"),
      sessionPack.lineageParentVersionId ?? "-",
      comparisonSessionPack.lineageParentVersionId ?? "-"
    );
    pushIfChanged(
      "consumer-run",
      l("消费来源 Run", "Consumer source run"),
      sessionPack.consumerRunId ?? "-",
      comparisonSessionPack.consumerRunId ?? "-",
      l(
        "消费派生版本会把运行期来源 run 写回到 metadata。",
        "Consumer-derived versions carry the originating run in metadata."
      )
    );
    pushIfChanged(
      "consumer-workspace",
      l("消费工作区", "Consumer workspace"),
      sessionPack.consumerWorkspaceId ?? "-",
      comparisonSessionPack.consumerWorkspaceId ?? "-"
    );
    pushIfChanged(
      "consumer-service",
      l("消费服务", "Consumer service"),
      sessionPack.consumerServiceId ?? "-",
      comparisonSessionPack.consumerServiceId ?? "-"
    );
    pushIfChanged(
      "consumer-workshop",
      l("消费工坊", "Consumer workshop"),
      sessionPack.consumerWorkshopId ?? "-",
      comparisonSessionPack.consumerWorkshopId ?? "-"
    );
    pushIfChanged(
      "consumer-entry-surface",
      l("消费入口面", "Consumer entry surface"),
      sessionPack.consumerEntrySurface
        ? t(lang, entrySurfaceLabel(sessionPack.consumerEntrySurface))
        : "-",
      comparisonSessionPack.consumerEntrySurface
        ? t(lang, entrySurfaceLabel(comparisonSessionPack.consumerEntrySurface))
        : "-"
    );
    pushIfChanged(
      "consumer-target-path",
      l("消费目标路径", "Consumer target path"),
      sessionPack.consumerTargetPath ?? "-",
      comparisonSessionPack.consumerTargetPath ?? "-"
    );
    pushIfChanged(
      "workspace-contexts",
      l("工作区上下文", "Workspace contexts"),
      summarizeStringArray(sessionPack.workspaceContextKeys),
      summarizeStringArray(comparisonSessionPack.workspaceContextKeys)
    );
    pushIfChanged(
      "linked-services",
      l("关联服务", "Linked services"),
      summarizeStringArray(sessionPack.linkedServiceIds),
      summarizeStringArray(comparisonSessionPack.linkedServiceIds)
    );
    pushIfChanged(
      "linked-workshops",
      l("关联工坊", "Linked workshops"),
      summarizeStringArray(sessionPack.linkedWorkshopIds),
      summarizeStringArray(comparisonSessionPack.linkedWorkshopIds)
    );
    pushIfChanged(
      "runtime-profile",
      l("运行时画像", "Runtime profile"),
      t(lang, formatSessionRuntimeSummary(sessionPack)),
      t(lang, formatSessionRuntimeSummary(comparisonSessionPack))
    );
    pushIfChanged(
      "bindings",
      l("绑定要求", "Binding requirements"),
      t(lang, formatSessionBindingSummary(sessionPack)),
      t(lang, formatSessionBindingSummary(comparisonSessionPack))
    );
    pushIfChanged(
      "published-targets",
      l("发布目标数", "Published target count"),
      String(sessionPack.publishedTargetCount),
      String(comparisonSessionPack.publishedTargetCount)
    );
    pushIfChanged(
      "expected-root-files",
      l("根目录契约", "Root file contract"),
      summarizeStringArray(sessionPack.expectedRootFiles),
      summarizeStringArray(comparisonSessionPack.expectedRootFiles)
    );

    return rows;
  }, [comparisonSessionPack, lang, sessionPack]);

  if (creatorTab === "release") {
    return (
      <CreatorReleasePanel
        packageId={pkg.id}
        packageStatusClass={pkg.statusClass}
        availableWorkspaceContextKeys={availableWorkspaceContextKeys}
        defaultWorkspaceContextKey={defaultWorkspaceContextKey}
      />
    );
  }

  const tabData = pkg[creatorTab];

  if (creatorTab === "session") {
    const expectedRootFiles = sessionPack?.expectedRootFiles ?? [];
    const optionalRootFiles = sessionPack?.optionalRootFiles ?? [];
    const runtimeAlternativeFiles = sessionPack?.runtimeAlternativeFiles ?? [];
    const workspaceContextKeys = sessionPack?.workspaceContextKeys ?? [];
    const linkedWorkshopIds = sessionPack?.linkedWorkshopIds ?? [];
    const linkedServiceIds = sessionPack?.linkedServiceIds ?? [];
    const lineageAncestors = sessionLineage?.ancestors ?? [];
    const lineageDescendants = sessionLineage?.descendants ?? [];
    const firstPartyMcpIds = sessionPack?.requiredBindings.firstPartyMcpIds ?? [];
    const externalConnectorRefs = sessionPack?.requiredBindings.externalConnectorRefs ?? [];
    const credentialIds = sessionPack?.requiredBindings.credentialIds ?? [];
    const sourcePackages = sessionPack?.sourcePackages ?? [];
    const sourceReleaseIds = sessionPack?.sourceReleaseIds ?? [];
    const activeActivationIds = sessionPack?.activeActivationIds ?? [];
    const consumerGovernanceWorkspaceIds = consumerGovernance?.workspaceIds ?? [];
    const consumerGovernanceServiceIds = consumerGovernance?.serviceIds ?? [];
    const consumerGovernanceEntrySurfaces = consumerGovernance?.entrySurfaces ?? [];
    const sessionPackError = sessionPackQuery.error ? queryErrorMessage(sessionPackQuery.error) : null;
    const comparisonSessionPackError = comparisonSessionPackQuery.error
      ? queryErrorMessage(comparisonSessionPackQuery.error)
      : null;
    const sessionLineageError = sessionLineageQuery.error
      ? queryErrorMessage(sessionLineageQuery.error)
      : null;
    const sessionWritePending =
      inheritSessionPackMutation.isPending ||
      publishSessionPackMutation.isPending ||
      rollbackSessionPackMutation.isPending ||
      unpublishSessionPackMutation.isPending ||
      reviewSessionPackRedactionMutation.isPending ||
      updateSessionPackRedactionMapMutation.isPending ||
      downloadSessionPackArchiveMutation.isPending ||
      downloadRedactedSessionPackArchiveMutation.isPending;
    const viewingDerivedSession =
      Boolean(activeSessionVersionId) &&
      Boolean(packageSessionVersionId) &&
      activeSessionVersionId !== packageSessionVersionId;
    const versionReferenceOptions = [...new Set([
      packageSessionVersionId,
      sessionPack?.lineageParentVersionId,
      sessionPack?.rollbackFromVersionId,
    ].filter((item): item is string => Boolean(item)))];

    return (
      <div className="detail-body">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "Session 包", en: "Session Package" })}</div>
            <div className="tab-title">
              {sessionPack
                ? t(lang, sessionPack.displayName)
                : t(lang, { zh: "当前选中 package 的详情", en: "Detail for the selected package" })}
            </div>
            {sessionPack && viewingDerivedSession ? (
              <div className="meta">
                {t(lang, {
                  zh:
                    sessionPack.inheritMode === "consumer"
                      ? `当前正在查看消费派生版本 ${sessionPack.sessionVersionId}，package 固定版本为 ${packageSessionVersionId}。`
                      : `当前正在查看继承草稿 ${sessionPack.sessionVersionId}，package 固定版本为 ${packageSessionVersionId}。`,
                  en:
                    sessionPack.inheritMode === "consumer"
                      ? `Viewing consumer-derived version ${sessionPack.sessionVersionId} while the package-pinned version remains ${packageSessionVersionId}.`
                      : `Viewing inherited draft ${sessionPack.sessionVersionId} while the package-pinned version remains ${packageSessionVersionId}.`,
                })}
              </div>
            ) : null}
          </div>
          <span className={`pill ${pkg.statusClass}`}>{t(lang, pkg.status)}</span>
        </div>
        <div className="section-note">
          {sessionPack ? t(lang, sessionPack.summary) : t(lang, tabData.summary)}
        </div>
        {!authReady ? (
          <div className="composer-error">
            {t(lang, {
              zh: "当前会话没有 Creator 写权限。可以继续查看正式 session-pack 详情，发布、回滚和下载操作会保持锁定。",
              en: "This session does not have Creator write access. Formal session-pack detail remains visible while publish, rollback, and download actions stay locked.",
            })}
          </div>
        ) : null}
        {sessionOperationNotice ? (
          <div
            className={sessionOperationNotice.tone === "error" ? "composer-error" : "section-note"}
            data-testid="dashboard-session-operation-notice"
          >
            {sessionOperationNotice.message}
          </div>
        ) : null}

        {sessionPack == null ? (
          <>
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "Session 解析状态", en: "Session resolution" })}</div>
              <div className="meta">
                {activeSessionVersionId
                  ? sessionPackQuery.isLoading
                    ? t(lang, { zh: "正在从正式 API 加载 session-pack。", en: "Loading session-pack from the formal API." })
                    : sessionPackError ??
                      t(lang, { zh: "当前 package 尚未返回正式 session-pack 详情。", en: "This package has not returned formal session-pack detail yet." })
                  : t(lang, { zh: "当前 package 暂未暴露可解析的 sessionVersionId。", en: "The selected package does not expose a resolvable sessionVersionId yet." })}
              </div>
            </div>
            {tabData.items.map((item) => (
              <div className="detail-item" key={t(lang, item)}>
                <div className="file-name">{t(lang, item)}</div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "Pack 标识", en: "Pack identity" })}</div>
              <div className="route-code" data-testid="dashboard-session-pack-identity">
                {sessionPack.sessionVersionId}
              </div>
              <div className="meta">
                {t(lang, {
                  zh: `Manifest ${sessionPack.manifestVersion} · 主任务 ${sessionPack.primaryTaskVersionId ?? "-"}`,
                  en: `Manifest ${sessionPack.manifestVersion} · Primary task ${sessionPack.primaryTaskVersionId ?? "-"}`,
                })}
              </div>
              <div className="meta">
                {t(lang, {
                  zh: `主 package ${sessionPack.primaryPackageId} · 更新时间 ${sessionPack.updatedAt}`,
                  en: `Primary package ${sessionPack.primaryPackageId} · Updated ${sessionPack.updatedAt}`,
                })}
              </div>
              <div className="pill-row">
                <span
                  className={`path-chip ${sessionPackInheritModeTone(sessionPack.inheritMode)}`.trim()}
                >
                  {t(lang, sessionPackInheritModeLabel(sessionPack.inheritMode))}
                </span>
                {sessionPack.consumerEntrySurface ? (
                  <span className="path-chip">
                    {t(lang, entrySurfaceLabel(sessionPack.consumerEntrySurface))}
                  </span>
                ) : null}
                {sessionPack.consumerRunId ? (
                  <span className="path-chip">{sessionPack.consumerRunId}</span>
                ) : null}
                <span
                  className={`path-chip ${sessionPackArchiveSourceTone(sessionPack.archiveSource)}`.trim()}
                >
                  {t(lang, sessionPackArchiveSourceLabel(sessionPack.archiveSource))}
                </span>
              </div>
              {sessionPack.inheritMode === "consumer" ? (
                <>
                  <div className="meta">
                    {t(lang, {
                      zh: `消费工作区 ${sessionPack.consumerWorkspaceId ?? "-"} · 服务 ${sessionPack.consumerServiceId ?? "-"} · 工坊 ${sessionPack.consumerWorkshopId ?? "-"}`,
                      en: `Consumer workspace ${sessionPack.consumerWorkspaceId ?? "-"} · Service ${sessionPack.consumerServiceId ?? "-"} · Workshop ${sessionPack.consumerWorkshopId ?? "-"}`,
                    })}
                  </div>
                  <div className="meta">
                    {t(lang, {
                      zh: sessionPack.consumerTargetPath
                        ? `消费目标路径 ${sessionPack.consumerTargetPath}`
                        : "当前消费派生版本尚未记录 target path。",
                      en: sessionPack.consumerTargetPath
                        ? `Consumer target path ${sessionPack.consumerTargetPath}`
                        : "The current consumer-derived version does not expose a target path yet.",
                    })}
                  </div>
                  <div className="meta">
                    {sessionPack.persistedArchive
                      ? t(lang, {
                          zh: `归档文件 ${sessionPack.archiveFileName ?? "-"} · ${formatByteSize(sessionPack.archiveSizeBytes)} · 记录于 ${formatTimestamp(lang, sessionPack.archiveRecordedAt)}`,
                          en: `Archive ${sessionPack.archiveFileName ?? "-"} · ${formatByteSize(sessionPack.archiveSizeBytes)} · recorded ${formatTimestamp(lang, sessionPack.archiveRecordedAt)}`,
                        })
                      : t(lang, {
                          zh: "当前只存在合成归档视图，尚未记录持久化 archive 文件。",
                          en: "Only a generated archive view is currently available; no persisted archive file has been recorded yet.",
                        })}
                  </div>
                  {sessionPack.runtimeSourceRunId || sessionPack.runtimeSourceTargetPath ? (
                    <div className="meta">
                      {t(lang, {
                        zh: `运行证据 run ${sessionPack.runtimeSourceRunId ?? "-"} · target path ${sessionPack.runtimeSourceTargetPath ?? "-"}`,
                        en: `Runtime evidence run ${sessionPack.runtimeSourceRunId ?? "-"} · target path ${sessionPack.runtimeSourceTargetPath ?? "-"}`,
                      })}
                    </div>
                  ) : null}
                  {sessionPack.runtimeSourceUpdatedAt ? (
                    <div className="meta">
                      {t(lang, {
                        zh: `运行快照更新时间 ${formatTimestamp(lang, sessionPack.runtimeSourceUpdatedAt)}`,
                        en: `Runtime snapshot updated ${formatTimestamp(lang, sessionPack.runtimeSourceUpdatedAt)}`,
                      })}
                    </div>
                  ) : null}
                  {sessionPack.consumerRunId ? (
                    <div className="governance-form-actions">
                      <button
                        className="route-btn"
                        type="button"
                        onClick={() => navigate(dashboardRoutes.instance(sessionPack.consumerRunId!))}
                      >
                        {t(lang, { zh: "打开实例", en: "Open instance" })}
                      </button>
                      <button
                        className="route-btn"
                        type="button"
                        onClick={() => navigate(dashboardRoutes.instance(sessionPack.consumerRunId!, "files"))}
                      >
                        {t(lang, { zh: "查看文件", en: "Open files" })}
                      </button>
                      <button
                        className="route-btn"
                        type="button"
                        onClick={() => navigate(dashboardRoutes.instance(sessionPack.consumerRunId!, "runtime"))}
                      >
                        {t(lang, { zh: "查看运行", en: "Open runtime" })}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
              {versionReferenceOptions.length > 0 ? (
                <div className="pill-row">
                  {versionReferenceOptions.map((item) => (
                    <button
                      className={`path-chip ${activeSessionVersionId === item ? "active" : ""}`}
                      key={`session-ref-${item}`}
                      type="button"
                      onClick={() => setActiveSessionVersionId(item)}
                    >
                      {item === packageSessionVersionId
                        ? t(lang, {
                            zh: `Package 固定 ${item}`,
                            en: `Package pinned ${item}`,
                          })
                        : item}
                    </button>
                  ))}
                  {viewingDerivedSession ? (
                    <button
                      className="path-chip"
                      type="button"
                      onClick={() => setActiveSessionVersionId(packageSessionVersionId)}
                    >
                      {t(lang, {
                        zh: "回到 package 固定版本",
                        en: "Back to package-pinned version",
                      })}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="meta">
                {t(lang, {
                  zh: `Lineage 父版本 ${sessionPack.lineageParentVersionId ?? "-"} · 最近回滚来源 ${sessionPack.rollbackFromVersionId ?? "-"}`,
                  en: `Lineage parent ${sessionPack.lineageParentVersionId ?? "-"} · Latest rollback source ${sessionPack.rollbackFromVersionId ?? "-"}`,
                })}
              </div>
              <div className="meta">
                {t(lang, {
                  zh: `上游 ${lineageAncestors.length} 个 · 下游 ${lineageDescendants.length} 个`,
                  en: `${lineageAncestors.length} upstream and ${lineageDescendants.length} downstream versions`,
                })}
              </div>
            </div>
            {governanceSummary ? (
              <div
                className="detail-item"
                data-testid="dashboard-session-governance-summary-card"
              >
                <div className="card-row">
                  <div className="file-name">{t(lang, { zh: "治理摘要", en: "Governance summary" })}</div>
                  <div className="pill-row">
                    <span
                      className={`pill ${sessionPackGovernanceRiskTone(governanceSummary.riskLevel)}`.trim()}
                    >
                      {t(lang, sessionPackGovernanceRiskLabel(governanceSummary.riskLevel))}
                    </span>
                    <span className="path-chip">
                      {t(lang, sessionPackGovernanceStateLabel(governanceSummary.state))}
                    </span>
                  </div>
                </div>
                <div className="meta">
                  {governanceSummary.flags.includes("unpublished_with_live_consumers")
                    ? t(lang, {
                        zh: "当前版本已经不在模板发布链上，但下游仍然存在消费派生版本，适合先做影响面审计，再决定是否继续回滚或重新发布。",
                        en: "This version is no longer attached to launch templates while downstream consumer-derived versions still exist. Audit the blast radius before rolling back further or republishing.",
                      })
                    : governanceSummary.driftCount > 0
                      ? t(lang, {
                          zh: "当前版本与 package 固定基线存在受跟踪差异，适合先完成差异审计，再进入发布、下线或回滚动作。",
                          en: "Tracked differences exist between the current version and the package-pinned baseline. Review the drift before publishing, unpublishing, or rolling back.",
                        })
                      : t(lang, {
                          zh: "这里汇总当前版本的发布态、派生关系、消费分布和运行证据，方便快速判断治理动作的影响范围。",
                          en: "This section consolidates rollout state, derivation topology, consumer reach, and runtime evidence so governance actions can be scoped quickly.",
                        })}
                </div>
                <div className="governance-form-grid">
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "基线版本", en: "Baseline version" })}</span>
                    <div className="route-code">{governanceSummary.baselineSessionVersionId ?? "-"}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "下游总数", en: "Total descendants" })}</span>
                    <div className="route-code">{String(governanceSummary.totalDescendantCount)}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "草稿派生", en: "Draft descendants" })}</span>
                    <div className="route-code">{String(governanceSummary.draftDescendantCount)}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "消费派生", en: "Consumer descendants" })}</span>
                    <div className="route-code">{String(governanceSummary.consumerDescendantCount)}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "回滚分支", en: "Rollback descendants" })}</span>
                    <div className="route-code">{String(governanceSummary.rollbackDescendantCount)}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "可见消费版本", en: "Visible consumer versions" })}</span>
                    <div className="route-code">
                      {`${governanceSummary.liveConsumerCount} / ${governanceSummary.publishedConsumerCount} / ${governanceSummary.unpublishedConsumerCount}`}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "运行证据", en: "Runtime evidence" })}</span>
                    <div className="route-code">
                      {t(lang, {
                        zh: `${governanceSummary.runtimeEvidenceCount} 条${governanceSummary.hasCurrentRuntimeEvidence ? " · 当前版本已记录" : ""}`,
                        en: `${governanceSummary.runtimeEvidenceCount} records${governanceSummary.hasCurrentRuntimeEvidence ? " · current version recorded" : ""}`,
                      })}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "差异字段", en: "Tracked drift" })}</span>
                    <div className="route-code">{String(governanceSummary.driftCount)}</div>
                  </div>
                </div>
                <div className="meta">
                  {t(lang, {
                    zh: `最近消费更新时间 ${formatTimestamp(lang, governanceSummary.latestConsumerUpdatedAt)} · 最近运行证据更新时间 ${formatTimestamp(lang, governanceSummary.latestRuntimeEvidenceUpdatedAt)}`,
                    en: `Latest consumer update ${formatTimestamp(lang, governanceSummary.latestConsumerUpdatedAt)} · latest runtime evidence ${formatTimestamp(lang, governanceSummary.latestRuntimeEvidenceUpdatedAt)}`,
                  })}
                </div>
                {governanceSummary.flags.length > 0 ? (
                  <div className="pill-row">
                    {governanceSummary.flags.map((flag) => (
                      <span
                        className={`path-chip ${
                          flag === "unpublished_with_live_consumers"
                            ? "warn"
                            : flag === "drift_from_package_baseline" ||
                                flag === "runtime_evidence_present" ||
                                flag === "consumer_descendants_present"
                              ? "warn"
                              : flag === "published_targets_attached"
                                ? "active"
                                : ""
                        }`.trim()}
                        key={`governance-flag-${flag}`}
                      >
                        {t(lang, sessionPackGovernanceFlagLabel(flag))}
                      </span>
                    ))}
                  </div>
                ) : null}
                {governanceSummary.driftFieldKeys.length > 0 ? (
                  <div className="pill-row">
                    {governanceSummary.driftFieldKeys.map((field) => (
                      <span className="path-chip warn" key={`governance-drift-${field}`}>
                        {t(lang, sessionPackGovernanceDiffFieldLabel(field))}
                      </span>
                    ))}
                  </div>
                ) : null}
                {governanceSummary.baselineSessionVersionId &&
                governanceSummary.baselineSessionVersionId !== activeSessionVersionId ? (
                  <div className="governance-form-actions">
                    <button
                      className="route-btn"
                      type="button"
                      onClick={() => setActiveSessionVersionId(governanceSummary.baselineSessionVersionId!)}
                    >
                      {t(lang, { zh: "打开基线版本", en: "Open baseline version" })}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {runtimeEvidenceSummary ? (
              <div
                className="detail-item"
                data-testid="dashboard-session-runtime-evidence-card"
              >
                <div className="card-row">
                  <div className="file-name">
                    {t(lang, { zh: "运行证据", en: "Runtime evidence" })}
                  </div>
                  <div className="pill-row">
                    <span className={`pill ${runtimeEvidenceSummary.totalRecords > 0 ? "active" : ""}`.trim()}>
                      {runtimeEvidenceSummary.totalRecords}
                    </span>
                    {runtimeEvidenceSummary.latestLaunchMode ? (
                      <span
                        className={`path-chip ${
                          runtimeEvidenceSummary.latestLaunchMode === "docker" ? "active" : ""
                        }`.trim()}
                      >
                        {t(lang, runRuntimeLaunchModeLabel(runtimeEvidenceSummary.latestLaunchMode))}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="meta">
                  {runtimeEvidenceSummary.totalRecords > 0
                    ? t(lang, {
                        zh: "这里展示 session-pack 当前可追溯的运行消费证据，覆盖归档来源、运行模式、target path 和工作区快照捕获结果。",
                        en: "This section exposes traceable runtime consumption evidence for the session-pack, including archive source, launch mode, target path, and workspace capture status.",
                      })
                    : t(lang, {
                        zh: "当前版本尚未记录正式的运行消费证据。",
                        en: "No formal runtime consumption evidence has been recorded for this version yet.",
                      })}
                </div>
                <div className="governance-form-grid">
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "证据总数", en: "Total records" })}</span>
                    <div className="route-code">{String(runtimeEvidenceSummary.totalRecords)}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "最近采集", en: "Latest capture" })}</span>
                    <div className="route-code">
                      {formatTimestamp(lang, runtimeEvidenceSummary.latestCapturedAt)}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "最近运行", en: "Latest run" })}</span>
                    <div className="route-code">{runtimeEvidenceSummary.latestRunId ?? "-"}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "当前运行", en: "Current run" })}</span>
                    <div className="route-code">
                      {runtimeEvidenceSummary.hasCurrentRunRecord
                        ? runtimeEvidenceSummary.currentRunId ?? "-"
                        : t(lang, { zh: "未命中", en: "Not matched" })}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "容器记录", en: "Container records" })}</span>
                    <div className="route-code">
                      {String(runtimeEvidenceSummary.containerizedRecordCount)}
                    </div>
                  </div>
                </div>
                {runtimeEvidenceSummary.items.length > 0 ? (
                  <div className="governance-stack">
                    {runtimeEvidenceSummary.items.map((item, index) => {
                      const isCurrentRun = runtimeEvidenceSummary.currentRunId === item.runId;
                      const isLatestRecord = index === 0;
                      const workspaceCaptureTone = item.workspaceBaseCaptureError
                        ? "warn"
                        : item.workspaceBaseCaptured
                          ? "active"
                          : "";
                      return (
                        <article
                          className="detail-item governance-card"
                          key={item.evidenceId}
                        >
                          <div className="card-row">
                            <div className="file-name">{item.runId}</div>
                            <div className="pill-row">
                              <span
                                className={`path-chip ${
                                  item.launchMode === "docker" ? "active" : ""
                                }`.trim()}
                              >
                                {t(lang, runRuntimeLaunchModeLabel(item.launchMode))}
                              </span>
                              <span
                                className={`path-chip ${sessionPackArchiveSourceTone(item.archiveSource)}`.trim()}
                              >
                                {t(lang, sessionPackArchiveSourceLabel(item.archiveSource))}
                              </span>
                              {isLatestRecord ? (
                                <span className="path-chip active">
                                  {t(lang, { zh: "最近记录", en: "Latest record" })}
                                </span>
                              ) : null}
                              {isCurrentRun ? (
                                <span className="path-chip active">
                                  {t(lang, { zh: "当前运行", en: "Current run" })}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="meta">
                            {t(lang, {
                              zh: `采集时间 ${formatTimestamp(lang, item.capturedAt)} · 工作区 ${item.workspaceId} · 申请人 ${item.requestedByUserId ?? "-"}`,
                              en: `Captured ${formatTimestamp(lang, item.capturedAt)} · workspace ${item.workspaceId} · actor ${item.requestedByUserId ?? "-"}`,
                            })}
                          </div>
                          <div className="meta">
                            {item.containerName
                              ? t(lang, {
                                  zh: `容器 ${item.containerName} · 目标路径 ${item.targetPath}`,
                                  en: `Container ${item.containerName} · target path ${item.targetPath}`,
                                })
                              : t(lang, {
                                  zh: `目标路径 ${item.targetPath}`,
                                  en: `Target path ${item.targetPath}`,
                                })}
                          </div>
                          <div className="governance-form-grid">
                            <div className="fake-input governance-field">
                              <span className="tiny-note">{t(lang, { zh: "启动时间", en: "Started" })}</span>
                              <div className="route-code">{formatTimestamp(lang, item.startedAt)}</div>
                            </div>
                            <div className="fake-input governance-field">
                              <span className="tiny-note">{t(lang, { zh: "就绪时间", en: "Ready" })}</span>
                              <div className="route-code">{formatTimestamp(lang, item.readyAt)}</div>
                            </div>
                            <div className="fake-input governance-field">
                              <span className="tiny-note">{t(lang, { zh: "结束时间", en: "Finished" })}</span>
                              <div className="route-code">{formatTimestamp(lang, item.finishedAt)}</div>
                            </div>
                            <div className="fake-input governance-field">
                              <span className="tiny-note">{t(lang, { zh: "退出状态", en: "Exit state" })}</span>
                              <div className="route-code">
                                {item.exitCode !== null
                                  ? String(item.exitCode)
                                  : item.exitSignal ?? "-"}
                              </div>
                            </div>
                            <div className="fake-input governance-field">
                              <span className="tiny-note">{t(lang, { zh: "Runtime profile", en: "Runtime profile" })}</span>
                              <div className="route-code">{item.runtimeProfileId ?? "-"}</div>
                            </div>
                            <div className="fake-input governance-field">
                              <span className="tiny-note">{t(lang, { zh: "Runner image", en: "Runner image" })}</span>
                              <div className="route-code">{item.runnerImage ?? "-"}</div>
                            </div>
                            <div className="fake-input governance-field">
                              <span className="tiny-note">{t(lang, { zh: "快照捕获", en: "Workspace capture" })}</span>
                              <div className="route-code">
                                {t(
                                  lang,
                                  item.workspaceBaseCaptured
                                    ? l("已捕获", "Captured")
                                    : l("未捕获", "Not captured")
                                )}
                              </div>
                            </div>
                            <div className="fake-input governance-field">
                              <span className="tiny-note">{t(lang, { zh: "Manifest 来源", en: "Manifest origin" })}</span>
                              <div className="route-code">
                                {t(
                                  lang,
                                  item.manifestRuntimeDerived
                                    ? l("运行态派生", "Runtime derived")
                                    : l("归档记录", "Archive recorded")
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="pill-row">
                            <span className={`path-chip ${workspaceCaptureTone}`.trim()}>
                              {item.workspaceBaseCaptureError
                                ? t(lang, { zh: "快照捕获异常", en: "Workspace capture error" })
                                : item.workspaceBaseCaptured
                                  ? t(lang, { zh: "快照已保存", en: "Workspace captured" })
                                  : t(lang, { zh: "未保存快照", en: "No workspace capture" })}
                            </span>
                            {item.archiveFileName ? (
                              <span className="path-chip">{item.archiveFileName}</span>
                            ) : null}
                          </div>
                          {item.workspaceBaseCaptureError ? (
                            <div className="meta">
                              {t(lang, {
                                zh: `快照错误：${item.workspaceBaseCaptureError}`,
                                en: `Capture error: ${item.workspaceBaseCaptureError}`,
                              })}
                            </div>
                          ) : null}
                          {item.archiveSha256 ? (
                            <div className="meta">
                              {t(lang, {
                                zh: `Archive SHA-256 ${item.archiveSha256}`,
                                en: `Archive SHA-256 ${item.archiveSha256}`,
                              })}
                            </div>
                          ) : null}
                          <div className="meta">
                            {t(lang, {
                              zh: `运行快照更新时间 ${formatTimestamp(lang, item.runtimeSourceUpdatedAt)}`,
                              en: `Runtime snapshot updated ${formatTimestamp(lang, item.runtimeSourceUpdatedAt)}`,
                            })}
                          </div>
                          <div className="governance-form-actions">
                            <button
                              className="route-btn"
                              type="button"
                              onClick={() => navigate(dashboardRoutes.instance(item.runId))}
                            >
                              {t(lang, { zh: "打开实例", en: "Open instance" })}
                            </button>
                            <button
                              className="route-btn"
                              type="button"
                              onClick={() => navigate(dashboardRoutes.instance(item.runId, "files"))}
                            >
                              {t(lang, { zh: "查看文件", en: "Open files" })}
                            </button>
                            <button
                              className="route-btn"
                              type="button"
                              onClick={() => navigate(dashboardRoutes.instance(item.runId, "runtime"))}
                            >
                              {t(lang, { zh: "查看运行", en: "Open runtime" })}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {signatureSummary ? (
              <div
                className="detail-item"
                data-testid="dashboard-session-signature-summary-card"
              >
                <div className="card-row">
                  <div className="file-name">{t(lang, { zh: "签名治理", en: "Signature governance" })}</div>
                  <span
                    className={`pill ${sessionPackSignatureStatusTone(signatureSummary.status)}`.trim()}
                  >
                    {t(lang, sessionPackSignatureStatusLabel(signatureSummary.status))}
                  </span>
                </div>
                <div className="meta">
                  {signatureSummary.status === "verified"
                    ? t(lang, {
                        zh: "当前归档签名已通过运行时验真，可直接判断它与现行签名策略的兼容情况。",
                        en: "The current archive signature has been verified, so compatibility with the active runtime signing policy can be inspected directly.",
                      })
                    : t(lang, {
                        zh: "这里展示当前归档的签名状态、现行签名策略和验签兼容信息，用来定位 key、算法和导入验签问题。",
                        en: "This section exposes the current archive signature state, active signing policy, and verification compatibility so key, algorithm, and import-verification issues can be diagnosed quickly.",
                      })}
                </div>
                <div className="governance-form-grid">
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "Manifest 算法", en: "Manifest algorithm" })}</span>
                    <div className="route-code">{signatureSummary.algorithm ?? "-"}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "Manifest key", en: "Manifest key" })}</span>
                    <div className="route-code">{signatureSummary.keyId ?? "-"}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "验签要求", en: "Verification required" })}</span>
                    <div className="route-code">
                      {t(lang, signatureSummary.verificationRequired ? l("必需", "Required") : l("可选", "Optional"))}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "签名存在", en: "Signature present" })}</span>
                    <div className="route-code">
                      {t(lang, signatureSummary.present ? l("是", "Yes") : l("否", "No"))}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "运行时签名算法", en: "Runtime signing algorithm" })}</span>
                    <div className="route-code">{signatureSummary.activeSigningAlgorithm ?? "-"}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "运行时签名 key", en: "Runtime signing key" })}</span>
                    <div className="route-code">{signatureSummary.activeSigningKeyId ?? "-"}</div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "运行时签名就绪", en: "Runtime signing ready" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        signatureSummary.signingEnabled
                          ? signatureSummary.activeSigningReady
                            ? l("已就绪", "Ready")
                            : l("未就绪", "Not ready")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "验签 key 范围", en: "Verification keys" })}</span>
                    <div className="route-code">
                      {signatureSummary.acceptedVerificationKeyIds.length > 0
                        ? signatureSummary.acceptedVerificationKeyIds.join(" / ")
                        : signatureSummary.acceptsDefaultVerificationKey
                          ? t(lang, { zh: "default", en: "default" })
                          : "-"}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "key 窗口命中", en: "Key window match" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        signatureSummary.signatureKeyAcceptedByKeyring
                          ? l("已命中", "Matched")
                          : l("未命中", "Outside window")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "分发状态", en: "Distribution state" })}</span>
                    <div className="route-code">
                      {t(lang, sessionPackSignatureDistributionStateLabel(signatureSummary.distributionState))}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "Manifest key 覆盖", en: "Manifest key coverage" })}</span>
                    <div className="route-code">
                      {signatureSummary.distributionTargetCount > 0
                        ? `${signatureSummary.manifestKeyDistributedTargetCount}/${signatureSummary.distributionTargetCount}`
                        : "-"}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "激活 key 覆盖", en: "Active key coverage" })}</span>
                    <div className="route-code">
                      {signatureSummary.distributionTargetCount > 0
                        ? `${signatureSummary.activeSigningKeyDistributedTargetCount}/${signatureSummary.distributionTargetCount}`
                        : "-"}
                    </div>
                  </div>
                </div>
                <div className="pill-row">
                  <span
                    className={`path-chip ${signatureSummary.matchesActiveSigningAlgorithm ? "active" : "warn"}`.trim()}
                  >
                    {t(
                      lang,
                      signatureSummary.matchesActiveSigningAlgorithm
                        ? l("算法已对齐", "Algorithm aligned")
                        : l("算法未对齐", "Algorithm drift")
                    )}
                  </span>
                  <span
                    className={`path-chip ${signatureSummary.matchesActiveSigningKey ? "active" : "warn"}`.trim()}
                  >
                    {t(
                      lang,
                      signatureSummary.matchesActiveSigningKey
                        ? l("Key 已对齐", "Key aligned")
                        : l("Key 未对齐", "Key drift")
                    )}
                  </span>
                  <span
                    className={`path-chip ${sessionPackSignatureDistributionStateTone(signatureSummary.distributionState)}`.trim()}
                  >
                    {t(lang, sessionPackSignatureDistributionStateLabel(signatureSummary.distributionState))}
                  </span>
                </div>
                {signatureSummary.distributionTargets.length > 0 ? (
                  <div className="governance-stack">
                    {signatureSummary.distributionTargets.map((target) => (
                      <article className="detail-item governance-card" key={`signature-target-${target.targetId}`}>
                        <div className="card-row">
                          <div className="file-name">{t(lang, target.displayName)}</div>
                          <div className="pill-row">
                            <span className={`pill ${target.reportFresh ? "active" : "warn"}`.trim()}>
                              {t(lang, target.reportFresh ? l("状态新鲜", "Fresh") : l("状态过期", "Stale"))}
                            </span>
                            <span
                              className={`path-chip ${
                                target.acceptsManifestKey && target.acceptsActiveSigningKey ? "active" : "warn"
                              }`.trim()}
                            >
                              {target.channel}
                            </span>
                          </div>
                        </div>
                        <div className="governance-form-grid">
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, { zh: "验签 key", en: "Accepted keys" })}</span>
                            <div className="route-code">
                              {target.acceptedKeyIds.length > 0 ? target.acceptedKeyIds.join(" / ") : "-"}
                            </div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, { zh: "激活 key", en: "Active key" })}</span>
                            <div className="route-code">{target.activeKeyId ?? "-"}</div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, { zh: "Manifest key", en: "Manifest key" })}</span>
                            <div className="route-code">
                              {t(lang, target.acceptsManifestKey ? l("已覆盖", "Covered") : l("缺失", "Missing"))}
                            </div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, { zh: "当前激活 key", en: "Active signing key" })}</span>
                            <div className="route-code">
                              {t(
                                lang,
                                target.acceptsActiveSigningKey ? l("已覆盖", "Covered") : l("缺失", "Missing")
                              )}
                            </div>
                          </div>
                        </div>
                        {target.lastReportedAt ? (
                          <div className="meta">
                            {t(lang, {
                              zh: `最近上报：${formatTimestamp(lang, target.lastReportedAt)}`,
                              en: `Last reported: ${formatTimestamp(lang, target.lastReportedAt)}`,
                            })}
                          </div>
                        ) : (
                          <div className="meta">
                            {t(lang, {
                              zh: "当前目标未附带单独上报时间，按静态治理配置解释。",
                              en: "This target does not expose a dedicated report timestamp and is interpreted from static governance configuration.",
                            })}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="meta">
                    {t(lang, {
                      zh: "当前尚未配置签名分发目标，因此只展示验签窗口与现行签名策略本身。",
                      en: "No signature-distribution targets are configured yet, so only the verification window and active signing policy are shown here.",
                    })}
                  </div>
                )}
                {signatureSummary.reason ? (
                  <div className="meta">
                    {t(lang, {
                      zh: `验签诊断：${signatureSummary.reason}`,
                      en: `Verification diagnostic: ${signatureSummary.reason}`,
                    })}
                  </div>
                ) : null}
                {signatureSummary.activeSigningError ? (
                  <div className="meta">
                    {t(lang, {
                      zh: `运行时签名配置异常：${signatureSummary.activeSigningError}`,
                      en: `Runtime signing configuration error: ${signatureSummary.activeSigningError}`,
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {policySummary ? (
              <div
                className="detail-item"
                data-testid="dashboard-session-policy-summary-card"
              >
                <div className="card-row">
                  <div className="file-name">{t(lang, { zh: "执行治理策略", en: "Execution governance policy" })}</div>
                  <span
                    className={`pill ${
                      policySummary.actions.some((item) => item.decision === "block")
                        ? "danger"
                        : policySummary.actions.some((item) => item.decision === "warn")
                          ? "warn"
                          : "active"
                    }`.trim()}
                  >
                    {t(
                      lang,
                      policySummary.actions.some((item) => item.decision === "block")
                        ? l("存在阻断", "Blocking checks")
                        : policySummary.actions.some((item) => item.decision === "warn")
                          ? l("存在警告", "Warnings present")
                          : l("全部放行", "All actions allowed")
                    )}
                  </span>
                </div>
                <div className="meta">
                  {t(lang, {
                    zh: "这里展示当前 session-pack 在脱敏复核、覆盖完整性、预检状态、签名验真、key 窗口与分发覆盖上的自动执行治理结果。发布、脱敏导出、派生与回滚会直接复用同一套策略。",
                    en: "This section shows the automated execution-governance result for the current session-pack across redaction review, coverage completeness, preview status, signature verification, key-window admission, and signature distribution coverage. Publish, redacted export, inherit, and rollback reuse the same policy.",
                  })}
                </div>
                <div className="pill-row">
                  {policySummary.actions.map((item) => (
                    <span
                      className={`path-chip ${sessionPackGovernancePolicyDecisionTone(item.decision)}`.trim()}
                      key={`policy-action-${item.action}`}
                    >
                      {`${t(lang, sessionPackGovernancePolicyActionLabel(item.action))} · ${t(
                        lang,
                        sessionPackGovernancePolicyDecisionLabel(item.decision)
                      )}`}
                    </span>
                  ))}
                </div>
                <div className="governance-form-grid">
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "脱敏导出需复核", en: "Redacted export review gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireApprovedRedactionReviewForRedactedExport
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "发布需复核", en: "Publish review gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireApprovedRedactionReviewForPublish
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "脱敏导出需覆盖完整", en: "Redacted export coverage gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireCompleteSecretCoverageForRedactedExport
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "发布需覆盖完整", en: "Publish coverage gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireCompleteSecretCoverageForPublish
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "派生需验签", en: "Inherit signature gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireVerifiedSignatureForInherit
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "发布需验签", en: "Publish signature gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireVerifiedSignatureForPublish
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "回滚需验签", en: "Rollback signature gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireVerifiedSignatureForRollback
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "发布需命中 key 窗口", en: "Publish key-window gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireSignatureKeyAcceptedForPublish
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "回滚需命中 key 窗口", en: "Rollback key-window gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireSignatureKeyAcceptedForRollback
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "发布需完成 key 分发", en: "Publish key-distribution gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireSignatureKeyDistributionForPublish
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "回滚需完成 key 分发", en: "Rollback key-distribution gate" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.requireSignatureKeyDistributionForRollback
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "激活 key 分发预警", en: "Active-key distribution warning" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.warnOnActiveSigningKeyDistributionDrift
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                  <div className="fake-input governance-field">
                    <span className="tiny-note">{t(lang, { zh: "下线消费预警", en: "Unpublish consumer warning" })}</span>
                    <div className="route-code">
                      {t(
                        lang,
                        policySummary.warnOnUnpublishWithLiveConsumers
                          ? l("已启用", "Enabled")
                          : l("未启用", "Disabled")
                      )}
                    </div>
                  </div>
                </div>
                <div className="governance-stack">
                  {policySummary.actions.map((item) => {
                    const actionChecks = policySummary.checks.filter((check) =>
                      item.checkCodes.includes(check.code)
                    );
                    return (
                      <article className="detail-item governance-card" key={`policy-checks-${item.action}`}>
                        <div className="card-row">
                          <div className="file-name">
                            {t(lang, sessionPackGovernancePolicyActionLabel(item.action))}
                          </div>
                          <div className="pill-row">
                            <span
                              className={`pill ${sessionPackGovernancePolicyDecisionTone(item.decision)}`.trim()}
                            >
                              {t(lang, sessionPackGovernancePolicyDecisionLabel(item.decision))}
                            </span>
                            <span className="path-chip">
                              {`${item.blockingCheckCount} / ${item.warningCheckCount}`}
                            </span>
                          </div>
                        </div>
                        {actionChecks.length > 0 ? (
                          actionChecks.map((check) => (
                            <div className="detail-item" key={`policy-check-${item.action}-${check.code}`}>
                              <div className="card-row">
                                <div className="file-name">{t(lang, check.title)}</div>
                                <span
                                  className={`path-chip ${sessionPackGovernancePolicyDecisionTone(check.decision)}`.trim()}
                                >
                                  {t(lang, sessionPackGovernancePolicyDecisionLabel(check.decision))}
                                </span>
                              </div>
                              <div className="meta">{t(lang, check.detail)}</div>
                            </div>
                          ))
                        ) : (
                          <div className="meta">
                            {t(lang, {
                              zh: "当前动作没有命中额外的治理校验，可直接执行。",
                              en: "No additional governance checks are currently applied to this action.",
                            })}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
                <div className="meta">
                  {t(lang, {
                    zh: `策略评估基于当前详情快照 ${formatTimestamp(lang, policySummary.evaluatedAt)}。`,
                    en: `Policy evaluation is based on the current detail snapshot at ${formatTimestamp(lang, policySummary.evaluatedAt)}.`,
                  })}
                </div>
              </div>
            ) : null}
            <div className="detail-item">
              <div className="card-row">
                <div className="file-name">{t(lang, { zh: "发布消费控制", en: "Publish and rollout controls" })}</div>
                <span className="path-chip active" data-testid="dashboard-session-published-target-count">
                  {sessionPack.publishedTargetCount}
                </span>
              </div>
              <div className="meta">
                {t(lang, {
                  zh: "这里直接驱动 launch template 的发布、下线、回滚和归档下载，写链已经走正式 session-pack API。",
                  en: "This surface drives launch-template publish, unpublish, rollback, and archive download through the formal session-pack APIs.",
                })}
              </div>
              <div className="pill-row">
                <button
                  className="route-btn"
                  data-testid="dashboard-session-download-archive"
                  type="button"
                  disabled={!activeSessionVersionId || sessionWritePending}
                  onClick={() => void downloadSessionPackArchiveMutation.mutateAsync()}
                >
                  {downloadSessionPackArchiveMutation.isPending
                    ? t(lang, { zh: "下载中...", en: "Downloading..." })
                    : t(lang, { zh: "下载归档", en: "Download archive" })}
                </button>
                <button
                  className="route-btn active"
                  data-testid="dashboard-session-download-redacted-archive"
                  type="button"
                  disabled={
                    !activeSessionVersionId ||
                    sessionWritePending ||
                    archiveRedactedPolicyAction?.decision === "block"
                  }
                  onClick={() => void downloadRedactedSessionPackArchiveMutation.mutateAsync()}
                >
                  {downloadRedactedSessionPackArchiveMutation.isPending
                    ? t(lang, { zh: "脱敏中...", en: "Redacting..." })
                    : t(lang, { zh: "下载脱敏归档", en: "Download redacted archive" })}
                </button>
              </div>
              <div className="governance-stack">
                {comparisonSessionVersionId ? (
                  <article className="detail-item governance-card" data-testid="dashboard-session-diff-card">
                    <div className="card-row">
                      <div className="file-name">{t(lang, { zh: "派生差异视图", en: "Derived diff view" })}</div>
                      <span className="path-chip active">{sessionComparisonRows.length}</span>
                    </div>
                    <div className="meta">
                      {t(lang, {
                        zh:
                          sessionPack.inheritMode === "consumer"
                            ? "当前版本正在与 package 固定版本做逐字段比较，用来识别这次消费派生到底引入了哪些运行期元数据和绑定变化。"
                            : "当前派生草稿正在与 package 固定版本做逐字段比较，用来确认你准备继续发布的版本改动范围。",
                        en:
                          sessionPack.inheritMode === "consumer"
                            ? "The current version is compared field-by-field against the package-pinned baseline so runtime-only consumer metadata and binding changes stay visible."
                            : "The current inherited draft is compared field-by-field against the package-pinned baseline so the publish scope stays explicit.",
                      })}
                    </div>
                    {sessionPack.inheritMode === "consumer" ? (
                      <div className="meta">
                        {t(lang, {
                          zh: "治理建议：先阅读差异，再决定是否从当前消费派生版本继续派生草稿，然后再执行发布写链。",
                          en: "Governance suggestion: review the diff first, then decide whether to fork a draft from the current consumer-derived version before publishing.",
                        })}
                      </div>
                    ) : null}
                    <div className="pill-row">
                      <span className="path-chip">{comparisonSessionVersionId}</span>
                      <button
                        className="route-btn"
                        type="button"
                        onClick={() => setActiveSessionVersionId(comparisonSessionVersionId)}
                      >
                        {t(lang, { zh: "打开基线版本", en: "Open baseline version" })}
                      </button>
                    </div>
                    {comparisonSessionPackQuery.isLoading && !comparisonSessionPack ? (
                      <div className="meta">
                        {t(lang, { zh: "正在加载对比基线...", en: "Loading comparison baseline..." })}
                      </div>
                    ) : null}
                    {comparisonSessionPackError ? (
                      <div className="composer-error">{comparisonSessionPackError}</div>
                    ) : null}
                    {comparisonSessionPack ? (
                      sessionComparisonRows.length > 0 ? (
                        sessionComparisonRows.map((row) => (
                          <div className="detail-item" key={row.key}>
                            <div className="card-row">
                              <div className="file-name">{t(lang, row.label)}</div>
                              {row.tone ? (
                                <span className={`pill ${row.tone}`}>
                                  {t(lang, { zh: "已变化", en: "Changed" })}
                                </span>
                              ) : null}
                            </div>
                            <div className="meta">{t(lang, { zh: "Package 基线", en: "Package baseline" })}</div>
                            <div className="route-code">{row.baseline}</div>
                            <div className="meta">{t(lang, { zh: "当前版本", en: "Current version" })}</div>
                            <div className="route-code">{row.current}</div>
                            {row.note ? <div className="meta">{t(lang, row.note)}</div> : null}
                          </div>
                        ))
                      ) : (
                        <div className="meta">
                          {t(lang, {
                            zh: "当前派生版本与 package 固定版本在已跟踪字段上没有可见差异。",
                            en: "No tracked field differs between the current derived version and the package-pinned baseline.",
                          })}
                        </div>
                      )
                    ) : null}
                  </article>
                ) : null}
                {sessionPack.inheritMode === "consumer" ? (
                  <article
                    className="detail-item governance-card"
                    data-testid="dashboard-session-consumer-governance-card"
                  >
                    <div className="card-row">
                      <div className="file-name">{t(lang, { zh: "消费态治理", en: "Consumer governance" })}</div>
                      <span className="path-chip warn">{sessionComparisonRows.length}</span>
                    </div>
                    <div className="meta">
                      {t(lang, {
                        zh: "当前版本来自一次消费派生，适合在这里判断是否继续保留运行期元数据，还是先从该版本继续派生草稿，再进入发布或回滚链路。",
                        en: "The current version comes from a consumer derivation. Use this surface to decide whether runtime-only metadata should remain visible or whether you should fork a draft from this version before publishing or rolling back.",
                      })}
                    </div>
                    <div className="pill-row">
                      {comparisonSessionVersionId ? (
                        <span className="path-chip">{comparisonSessionVersionId}</span>
                      ) : null}
                      <span className="path-chip warn">
                        {t(lang, {
                          zh: `${sessionPack.publishedTargetCount} 个模板引用`,
                          en: `${sessionPack.publishedTargetCount} template bindings`,
                        })}
                      </span>
                      {sessionPack.consumerRunId ? (
                        <span className="path-chip">{sessionPack.consumerRunId}</span>
                      ) : null}
                    </div>
                    <div className="governance-form-grid">
                      <div className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "消费工作区", en: "Consumer workspace" })}</span>
                        <div className="route-code">{sessionPack.consumerWorkspaceId ?? "-"}</div>
                      </div>
                      <div className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "消费服务", en: "Consumer service" })}</span>
                        <div className="route-code">{sessionPack.consumerServiceId ?? "-"}</div>
                      </div>
                      <div className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "消费工坊", en: "Consumer workshop" })}</span>
                        <div className="route-code">{sessionPack.consumerWorkshopId ?? "-"}</div>
                      </div>
                      <div className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "入口面", en: "Entry surface" })}</span>
                        <div className="route-code">
                          {sessionPack.consumerEntrySurface
                            ? t(lang, entrySurfaceLabel(sessionPack.consumerEntrySurface))
                            : "-"}
                        </div>
                      </div>
                      <div className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "归档来源", en: "Archive source" })}</span>
                        <div className="route-code">{t(lang, sessionPackArchiveSourceLabel(sessionPack.archiveSource))}</div>
                      </div>
                      <div className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "归档记录时间", en: "Archive recorded at" })}</span>
                        <div className="route-code">{formatTimestamp(lang, sessionPack.archiveRecordedAt)}</div>
                      </div>
                      <div className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "运行来源 run", en: "Runtime source run" })}</span>
                        <div className="route-code">{sessionPack.runtimeSourceRunId ?? sessionPack.consumerRunId ?? "-"}</div>
                      </div>
                      <div className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "运行来源路径", en: "Runtime source path" })}</span>
                        <div className="route-code">{sessionPack.runtimeSourceTargetPath ?? sessionPack.consumerTargetPath ?? "-"}</div>
                      </div>
                    </div>
                    <div className="detail-item">
                      <div className="file-name">{t(lang, { zh: "治理建议", en: "Governance guidance" })}</div>
                      <div className="meta">
                        {t(lang, {
                          zh:
                            sessionComparisonRows.length > 0
                              ? "当前 consumer 版本和 package 基线之间存在可见差异。优先阅读差异，再决定是否把这份运行态版本继续派生成可编辑草稿。"
                              : "当前 consumer 版本与 package 基线没有已跟踪字段差异。可以直接回到基线版本，或把当前运行态上下文保留下来继续派生草稿。",
                          en:
                            sessionComparisonRows.length > 0
                              ? "The current consumer version diverges from the package-pinned baseline on tracked fields. Review the diff first, then decide whether to fork this runtime-shaped version into an editable draft."
                              : "No tracked field differs between the current consumer version and the package-pinned baseline. You can return to the baseline directly or preserve the current runtime-shaped context by forking a draft.",
                        })}
                      </div>
                      {sessionPack.consumerTargetPath ? (
                        <div className="route-code">{sessionPack.consumerTargetPath}</div>
                      ) : (
                        <div className="meta">
                          {t(lang, {
                            zh: "当前消费态版本尚未记录 target path。",
                            en: "The current consumer-derived version does not expose a target path yet.",
                          })}
                        </div>
                      )}
                    </div>
                    <div className="governance-form-actions">
                      {sessionPack.consumerRunId ? (
                        <>
                          <button
                            className="route-btn"
                            type="button"
                            onClick={() => navigate(dashboardRoutes.instance(sessionPack.consumerRunId!))}
                          >
                            {t(lang, { zh: "打开实例", en: "Open instance" })}
                          </button>
                          <button
                            className="route-btn"
                            type="button"
                            onClick={() => navigate(dashboardRoutes.instance(sessionPack.consumerRunId!, "files"))}
                          >
                            {t(lang, { zh: "查看文件", en: "Open files" })}
                          </button>
                          <button
                            className="route-btn"
                            type="button"
                            onClick={() => navigate(dashboardRoutes.instance(sessionPack.consumerRunId!, "runtime"))}
                          >
                            {t(lang, { zh: "查看运行", en: "Open runtime" })}
                          </button>
                        </>
                      ) : null}
                      {comparisonSessionVersionId ? (
                        <button
                          className="route-btn"
                          type="button"
                          onClick={() => setActiveSessionVersionId(comparisonSessionVersionId)}
                        >
                          {t(lang, { zh: "打开基线版本", en: "Open baseline version" })}
                        </button>
                      ) : null}
                      <button
                        className="route-btn active"
                        type="button"
                        disabled={
                          !authReady ||
                          !activeSessionVersionId ||
                          inheritSessionPackMutation.isPending ||
                          inheritPolicyAction?.decision === "block"
                        }
                        onClick={() =>
                          void inheritSessionPackMutation.mutateAsync({
                            workspaceContextKey: inheritDraft.workspaceContextKey,
                            inheritMode: "draft",
                            newSessionId: "",
                            newSessionVersionId: "",
                            reason: `fork draft from consumer ${sessionPack.sessionVersionId}`,
                          })
                        }
                      >
                        {inheritSessionPackMutation.isPending
                          ? t(lang, { zh: "派生中...", en: "Creating draft..." })
                          : t(lang, { zh: "从当前消费态继续派生草稿", en: "Fork draft from current consumer version" })}
                      </button>
                    </div>
                  </article>
                ) : null}
                <article className="detail-item governance-card" data-testid="dashboard-session-inherit-card">
                  <div className="file-name">{t(lang, { zh: "派生新版本", en: "Derive a new version" })}</div>
                  <div className="meta">
                    {t(lang, {
                      zh:
                        inheritDraft.inheritMode === "consumer"
                          ? "显式创建一个 consumer 派生版本，用于治理复核、差异比对或预先准备消费态分支。运行时自动派生的 consumer 版本仍会补齐 run 和目标路径元数据。"
                          : "从当前 Session 版本派生一个新的草稿版本。新草稿生成后，当前面板会自动切换到它，后续发布、下线、回滚和下载都会基于该草稿继续。",
                      en:
                        inheritDraft.inheritMode === "consumer"
                          ? "Create an explicit consumer-derived version for governance review, diff inspection, or pre-staging a consumer branch. Runtime-generated consumer versions still attach run and target-path metadata automatically."
                          : "Derive a new draft from the current session version. Once created, this panel switches to the new draft so subsequent publish, unpublish, rollback, and download actions continue from it.",
                    })}
                  </div>
                  <div className="detail-item">
                    <div className="file-name">{t(lang, { zh: "派生模式", en: "Derivation mode" })}</div>
                    <div className="pill-row">
                      <button
                        className={`path-chip ${inheritDraft.inheritMode === "draft" ? "active" : ""}`}
                        data-testid="dashboard-session-inherit-mode-draft"
                        type="button"
                        onClick={() =>
                          setInheritDraft((current) => ({
                            ...current,
                            inheritMode: "draft",
                          }))
                        }
                      >
                        {t(lang, { zh: "继承草稿", en: "Inherited draft" })}
                      </button>
                      <button
                        className={`path-chip ${inheritDraft.inheritMode === "consumer" ? "warn" : ""}`}
                        data-testid="dashboard-session-inherit-mode-consumer"
                        type="button"
                        onClick={() =>
                          setInheritDraft((current) => ({
                            ...current,
                            inheritMode: "consumer",
                          }))
                        }
                      >
                        {t(lang, { zh: "消费派生", en: "Consumer-derived" })}
                      </button>
                    </div>
                  </div>
                  <div className="governance-form-grid">
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "工作区上下文", en: "Workspace context" })}</span>
                      <select
                        className="governance-select"
                        value={inheritDraft.workspaceContextKey}
                        onChange={(event) =>
                          setInheritDraft((current) => ({
                            ...current,
                            workspaceContextKey: event.target.value,
                          }))
                        }
                      >
                        {sessionWorkspaceOptions.map((item) => (
                          <option key={`inherit-${item}`} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "新 Session ID", en: "New session ID" })}</span>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={inheritDraft.newSessionId}
                        onChange={(event) =>
                          setInheritDraft((current) => ({
                            ...current,
                            newSessionId: event.target.value,
                          }))
                        }
                        placeholder={sessionPack.sessionId ?? "ses_*"}
                      />
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "新 Session Version", en: "New session version" })}</span>
                      <input
                        className="search-inline-input"
                        data-testid="dashboard-session-inherit-version-input"
                        type="text"
                        value={inheritDraft.newSessionVersionId}
                        onChange={(event) =>
                          setInheritDraft((current) => ({
                            ...current,
                            newSessionVersionId: event.target.value,
                          }))
                        }
                        placeholder={
                          inheritDraft.inheritMode === "consumer"
                            ? `${sessionPack.sessionVersionId}_consumer`
                            : `${sessionPack.sessionVersionId}_draft`
                        }
                      />
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "继承原因", en: "Reason" })}</span>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={inheritDraft.reason}
                        onChange={(event) =>
                          setInheritDraft((current) => ({
                            ...current,
                            reason: event.target.value,
                          }))
                        }
                        placeholder={t(lang, {
                          zh: "例如：针对品牌实验室做定向改造",
                          en: "For example: derive a workspace-specific variant for Brand Lab",
                        })}
                      />
                    </label>
                  </div>
                  <div className="governance-form-actions">
                    <button
                      className="route-btn active"
                      data-testid="dashboard-session-inherit-submit"
                      type="button"
                      disabled={
                        !authReady ||
                        !activeSessionVersionId ||
                        inheritSessionPackMutation.isPending ||
                        inheritPolicyAction?.decision === "block"
                      }
                      onClick={() => void inheritSessionPackMutation.mutateAsync(inheritDraft)}
                    >
                      {inheritSessionPackMutation.isPending
                        ? t(lang, { zh: "派生中...", en: "Creating version..." })
                        : inheritDraft.inheritMode === "consumer"
                          ? t(lang, { zh: "创建消费派生版本", en: "Create consumer-derived version" })
                          : t(lang, { zh: "派生继承草稿", en: "Create inherited draft" })}
                    </button>
                  </div>
                </article>

                <article className="detail-item governance-card" data-testid="dashboard-session-publish-card">
                  <div className="file-name">{t(lang, { zh: "发布到消费模板", en: "Publish to launch templates" })}</div>
                  <div className="governance-form-grid">
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "工作区上下文", en: "Workspace context" })}</span>
                      <select
                        className="governance-select"
                        value={publishDraft.workspaceContextKey}
                        onChange={(event) =>
                          setPublishDraft((current) => ({
                            ...current,
                            workspaceContextKey: event.target.value,
                          }))
                        }
                      >
                        {sessionWorkspaceOptions.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "目标服务", en: "Target service" })}</span>
                      <select
                        className="governance-select"
                        value={publishDraft.serviceId}
                        onChange={(event) =>
                          setPublishDraft((current) => ({
                            ...current,
                            serviceId: event.target.value,
                          }))
                        }
                      >
                        {(sessionServiceOptions.length > 0 ? sessionServiceOptions : [""]).map((item) => (
                          <option key={item} value={item}>
                            {item || t(lang, { zh: "暂无服务可选", en: "No service available" })}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "任务版本", en: "Task version" })}</span>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={publishDraft.taskVersionId}
                        onChange={(event) =>
                          setPublishDraft((current) => ({
                            ...current,
                            taskVersionId: event.target.value,
                          }))
                        }
                        placeholder={sessionPack.primaryTaskVersionId ?? "tsv_*"}
                      />
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "目标根路径", en: "Target root" })}</span>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={publishDraft.targetRoot}
                        onChange={(event) =>
                          setPublishDraft((current) => ({
                            ...current,
                            targetRoot: event.target.value,
                          }))
                        }
                        placeholder="/workspace/<service>/"
                      />
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "展示标题（中文）", en: "Display title (ZH)" })}</span>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={publishDraft.titleZh}
                        onChange={(event) =>
                          setPublishDraft((current) => ({
                            ...current,
                            titleZh: event.target.value,
                          }))
                        }
                        placeholder={t(lang, sessionPack.displayName)}
                      />
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "展示标题（英文）", en: "Display title (EN)" })}</span>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={publishDraft.titleEn}
                        onChange={(event) =>
                          setPublishDraft((current) => ({
                            ...current,
                            titleEn: event.target.value,
                          }))
                        }
                        placeholder={t(lang, sessionPack.displayName)}
                      />
                    </label>
                  </div>
                  <div className="detail-item">
                    <div className="file-name">{t(lang, { zh: "入口面", en: "Entry surface" })}</div>
                    <div className="pill-row">
                      <button
                        className={`path-chip ${publishDraft.applyToAllEntrySurfaces ? "active" : ""}`}
                        type="button"
                        onClick={() =>
                          setPublishDraft((current) => ({
                            ...current,
                            applyToAllEntrySurfaces: true,
                          }))
                        }
                      >
                        {t(lang, { zh: "全部入口", en: "All surfaces" })}
                      </button>
                      {entrySurfaceOptions.map((item) => (
                        <button
                          className={`path-chip ${
                            !publishDraft.applyToAllEntrySurfaces && publishDraft.entrySurface === item ? "active" : ""
                          }`}
                          key={`publish-${item}`}
                          type="button"
                          onClick={() =>
                            setPublishDraft((current) => ({
                              ...current,
                              applyToAllEntrySurfaces: false,
                              entrySurface: item,
                            }))
                          }
                        >
                          {t(lang, entrySurfaceLabel(item))}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="governance-form-actions">
                    <button
                      className="route-btn active"
                      data-testid="dashboard-session-publish-submit"
                      type="button"
                      disabled={
                        !authReady ||
                        !publishDraft.serviceId.trim() ||
                        publishSessionPackMutation.isPending ||
                        publishPolicyAction?.decision === "block"
                      }
                      onClick={() => void publishSessionPackMutation.mutateAsync()}
                    >
                      {publishSessionPackMutation.isPending
                        ? t(lang, { zh: "发布中...", en: "Publishing..." })
                        : t(lang, { zh: "写入发布模板", en: "Publish to templates" })}
                    </button>
                  </div>
                </article>

                <article className="detail-item governance-card" data-testid="dashboard-session-unpublish-card">
                  <div className="file-name">{t(lang, { zh: "下线当前模板引用", en: "Unpublish current template bindings" })}</div>
                  <div className="meta">
                    {t(lang, {
                      zh: "移除当前 Session 版本在 launch template 上的消费引用，不删除归档，也不影响已存在的 lineage 记录。",
                      en: "Remove launch-template bindings that currently point at this session version without deleting the archive or its lineage records.",
                    })}
                  </div>
                  <div className="governance-form-grid">
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "工作区上下文", en: "Workspace context" })}</span>
                      <select
                        className="governance-select"
                        value={unpublishDraft.workspaceContextKey}
                        onChange={(event) =>
                          setUnpublishDraft((current) => ({
                            ...current,
                            workspaceContextKey: event.target.value,
                          }))
                        }
                      >
                        {sessionWorkspaceOptions.map((item) => (
                          <option key={`unpublish-${item}`} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "目标服务", en: "Target service" })}</span>
                      <select
                        className="governance-select"
                        value={unpublishDraft.serviceId}
                        onChange={(event) =>
                          setUnpublishDraft((current) => ({
                            ...current,
                            serviceId: event.target.value,
                          }))
                        }
                      >
                        {(sessionServiceOptions.length > 0 ? sessionServiceOptions : [""]).map((item) => (
                          <option key={`unpublish-service-${item}`} value={item}>
                            {item || t(lang, { zh: "暂无服务可选", en: "No service available" })}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="detail-item">
                    <div className="file-name">{t(lang, { zh: "入口面", en: "Entry surface" })}</div>
                    <div className="pill-row">
                      <button
                        className={`path-chip ${unpublishDraft.applyToAllEntrySurfaces ? "active" : ""}`}
                        type="button"
                        onClick={() =>
                          setUnpublishDraft((current) => ({
                            ...current,
                            applyToAllEntrySurfaces: true,
                          }))
                        }
                      >
                        {t(lang, { zh: "全部入口", en: "All surfaces" })}
                      </button>
                      {entrySurfaceOptions.map((item) => (
                        <button
                          className={`path-chip ${
                            !unpublishDraft.applyToAllEntrySurfaces && unpublishDraft.entrySurface === item ? "active" : ""
                          }`}
                          key={`unpublish-${item}`}
                          type="button"
                          onClick={() =>
                            setUnpublishDraft((current) => ({
                              ...current,
                              applyToAllEntrySurfaces: false,
                              entrySurface: item,
                            }))
                          }
                        >
                          {t(lang, entrySurfaceLabel(item))}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="detail-item">
                    <div className="card-row">
                      <div className="file-name">{t(lang, { zh: "命中模板目标", en: "Matched launch template targets" })}</div>
                      <span className={`path-chip ${matchingUnpublishTargets.length > 0 ? "danger" : ""}`.trim()}>
                        {matchingUnpublishTargets.length}
                      </span>
                    </div>
                    {matchingUnpublishTargets.length > 0 ? (
                      matchingUnpublishTargets.map((item) => (
                        <div className="detail-item" key={`unpublish-target-${item.templateKey}`}>
                          <div className="card-row">
                            <div>
                              <div className="file-name">{t(lang, item.title)}</div>
                              <div className="meta">{item.templateKey}</div>
                            </div>
                            <span className="pill danger">{t(lang, entrySurfaceLabel(item.entrySurface))}</span>
                          </div>
                          <div className="meta">
                            {item.serviceId} / {item.workspaceContextKey} / {item.taskVersionId}
                          </div>
                          <div className="route-code">{item.targetRoot}</div>
                        </div>
                      ))
                    ) : (
                      <div className="meta">
                        {t(lang, {
                          zh: "当前筛选条件下没有命中任何仍然指向该 Session 版本的模板目标。",
                          en: "No launch template target currently points at this session version under the selected filter.",
                        })}
                      </div>
                    )}
                  </div>
                  <div className="governance-form-actions">
                    <button
                      className="route-btn"
                      data-testid="dashboard-session-unpublish-submit"
                      type="button"
                      disabled={
                        !authReady ||
                        !unpublishDraft.serviceId.trim() ||
                        matchingUnpublishTargets.length === 0 ||
                        unpublishSessionPackMutation.isPending ||
                        unpublishPolicyAction?.decision === "block"
                      }
                      onClick={() => void unpublishSessionPackMutation.mutateAsync()}
                    >
                      {unpublishSessionPackMutation.isPending
                        ? t(lang, { zh: "下线中...", en: "Unpublishing..." })
                        : t(lang, { zh: "执行下线", en: "Unpublish now" })}
                    </button>
                  </div>
                </article>

                <article className="detail-item governance-card" data-testid="dashboard-session-rollback-card">
                  <div className="file-name">{t(lang, { zh: "回滚到既有版本", en: "Rollback to an existing version" })}</div>
                  <div className="governance-form-grid">
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "工作区上下文", en: "Workspace context" })}</span>
                      <select
                        className="governance-select"
                        value={rollbackDraft.workspaceContextKey}
                        onChange={(event) =>
                          setRollbackDraft((current) => ({
                            ...current,
                            workspaceContextKey: event.target.value,
                          }))
                        }
                      >
                        {sessionWorkspaceOptions.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "目标服务", en: "Target service" })}</span>
                      <select
                        className="governance-select"
                        value={rollbackDraft.serviceId}
                        onChange={(event) =>
                          setRollbackDraft((current) => ({
                            ...current,
                            serviceId: event.target.value,
                          }))
                        }
                      >
                        {(sessionServiceOptions.length > 0 ? sessionServiceOptions : [""]).map((item) => (
                          <option key={item} value={item}>
                            {item || t(lang, { zh: "暂无服务可选", en: "No service available" })}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "回滚目标版本", en: "Rollback target version" })}</span>
                      <input
                        className="search-inline-input"
                        data-testid="dashboard-session-rollback-target-input"
                        type="text"
                        value={rollbackDraft.rollbackToSessionVersionId}
                        onChange={(event) =>
                          setRollbackDraft((current) => ({
                            ...current,
                            rollbackToSessionVersionId: event.target.value,
                          }))
                        }
                        placeholder={rollbackTargetOptions[0] ?? "sev_*"}
                      />
                    </label>
                  </div>
                  {rollbackTargetOptions.length > 0 ? (
                    <div className="pill-row">
                      {rollbackTargetOptions.map((item) => (
                        <button
                          className={`path-chip ${rollbackDraft.rollbackToSessionVersionId === item ? "active" : ""}`}
                          key={item}
                          type="button"
                          onClick={() =>
                            setRollbackDraft((current) => ({
                              ...current,
                              rollbackToSessionVersionId: item,
                            }))
                          }
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="meta">
                      {t(lang, {
                        zh: "当前 detail 没有自动推导出候选回滚版本，必要时可手填目标 sessionVersionId。",
                        en: "No rollback candidate could be derived automatically from the current detail. Enter a target sessionVersionId manually when needed.",
                      })}
                    </div>
                  )}
                  <div className="detail-item">
                    <div className="file-name">{t(lang, { zh: "入口面", en: "Entry surface" })}</div>
                    <div className="pill-row">
                      <button
                        className={`path-chip ${rollbackDraft.applyToAllEntrySurfaces ? "active" : ""}`}
                        type="button"
                        onClick={() =>
                          setRollbackDraft((current) => ({
                            ...current,
                            applyToAllEntrySurfaces: true,
                          }))
                        }
                      >
                        {t(lang, { zh: "全部入口", en: "All surfaces" })}
                      </button>
                      {entrySurfaceOptions.map((item) => (
                        <button
                          className={`path-chip ${
                            !rollbackDraft.applyToAllEntrySurfaces && rollbackDraft.entrySurface === item ? "active" : ""
                          }`}
                          key={`rollback-${item}`}
                          type="button"
                          onClick={() =>
                            setRollbackDraft((current) => ({
                              ...current,
                              applyToAllEntrySurfaces: false,
                              entrySurface: item,
                            }))
                          }
                        >
                          {t(lang, entrySurfaceLabel(item))}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="governance-form-actions">
                    <button
                      className="route-btn active"
                      data-testid="dashboard-session-rollback-submit"
                      type="button"
                      disabled={
                        !authReady ||
                        !rollbackDraft.serviceId.trim() ||
                        !rollbackDraft.rollbackToSessionVersionId.trim() ||
                        rollbackSessionPackMutation.isPending ||
                        rollbackPolicyAction?.decision === "block"
                      }
                      onClick={() => void rollbackSessionPackMutation.mutateAsync()}
                    >
                      {rollbackSessionPackMutation.isPending
                        ? t(lang, { zh: "回滚中...", en: "Rolling back..." })
                        : t(lang, { zh: "执行回滚", en: "Rollback now" })}
                    </button>
                  </div>
                </article>
              </div>
            </div>
            <div className="detail-item">
              <div className="card-row">
                <div className="file-name">{t(lang, { zh: "版本 Lineage", en: "Version lineage" })}</div>
                <span className="path-chip active">
                  {lineageAncestors.length + lineageDescendants.length}
                </span>
              </div>
              <div className="meta">
                {t(lang, {
                  zh: "这一段现在读取正式 sessions lineage API，用来追踪继承草稿和回滚分支，不再只依赖散落的父版本字段。",
                  en: "This section now reads the formal sessions lineage API so inherited drafts and rollback branches are tracked from a real lineage graph instead of scattered parent pointers.",
                })}
              </div>
              {sessionLineageQuery.isLoading && !sessionLineage ? (
                <div className="meta">
                  {t(lang, {
                    zh: "正在加载版本拓扑...",
                    en: "Loading lineage graph...",
                  })}
                </div>
              ) : null}
              {sessionLineageError ? (
                <div className="meta">{sessionLineageError}</div>
              ) : null}
              <div className="governance-stack">
                <article className="detail-item governance-card">
                  <div className="card-row">
                    <div className="file-name">{t(lang, { zh: "上游版本", en: "Upstream versions" })}</div>
                    <span className="path-chip">{lineageAncestors.length}</span>
                  </div>
                  {lineageAncestors.length > 0 ? (
                    lineageAncestors.map((item) => (
                      <div className="detail-item" key={`ancestor-${item.sessionVersionId}`}>
                        <div className="card-row">
                          <div className="file-name">{item.sessionVersionId}</div>
                          <div className="pill-row">
                            <span className="path-chip">
                              {t(lang, sessionLineageRelationLabel(item.relation))}
                            </span>
                            {item.inheritMode ? (
                              <span
                                className={`path-chip ${sessionPackInheritModeTone(item.inheritMode)}`.trim()}
                              >
                                {t(lang, sessionPackInheritModeLabel(item.inheritMode))}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="meta">{t(lang, item.displayName)}</div>
                        <div className="meta">
                          {t(lang, {
                            zh: `深度 ${item.depth} · 来自 ${item.viaSessionVersionId ?? "-"}`,
                            en: `Depth ${item.depth} via ${item.viaSessionVersionId ?? "-"}`,
                          })}
                        </div>
                        <div className="governance-form-actions">
                          <button
                            className="route-btn"
                            type="button"
                            onClick={() => setActiveSessionVersionId(item.sessionVersionId)}
                          >
                            {t(lang, { zh: "查看该版本", en: "Open version" })}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="meta">
                      {t(lang, {
                        zh: "当前版本没有可见的上游 lineage 记录。",
                        en: "No visible upstream lineage was found for this version.",
                      })}
                    </div>
                  )}
                </article>
                <article className="detail-item governance-card">
                  <div className="card-row">
                    <div className="file-name">{t(lang, { zh: "下游版本", en: "Downstream versions" })}</div>
                    <span className="path-chip">{lineageDescendants.length}</span>
                  </div>
                  {lineageDescendants.length > 0 ? (
                    lineageDescendants.map((item) => (
                      <div className="detail-item" key={`descendant-${item.sessionVersionId}`}>
                        <div className="card-row">
                          <div className="file-name">{item.sessionVersionId}</div>
                          <div className="pill-row">
                            <span className="path-chip">
                              {t(lang, sessionLineageRelationLabel(item.relation))}
                            </span>
                            {item.inheritMode ? (
                              <span
                                className={`path-chip ${sessionPackInheritModeTone(item.inheritMode)}`.trim()}
                              >
                                {t(lang, sessionPackInheritModeLabel(item.inheritMode))}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="meta">{t(lang, item.displayName)}</div>
                        <div className="meta">
                          {t(lang, {
                            zh: `深度 ${item.depth} · 来自 ${item.viaSessionVersionId ?? "-"}`,
                            en: `Depth ${item.depth} via ${item.viaSessionVersionId ?? "-"}`,
                          })}
                        </div>
                        <div className="governance-form-actions">
                          <button
                            className="route-btn"
                            type="button"
                            onClick={() => setActiveSessionVersionId(item.sessionVersionId)}
                          >
                            {t(lang, { zh: "查看该版本", en: "Open version" })}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="meta">
                      {t(lang, {
                        zh: "当前版本没有可见的下游派生或回滚分支。",
                        en: "No visible downstream inherited or rollback branches were found for this version.",
                      })}
                    </div>
                  )}
                </article>
              </div>
            </div>
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "工作区上下文", en: "Workspace context" })}</div>
              {workspaceContextKeys.length > 0 ? (
                workspaceContextKeys.map((item) => (
                  <div className="route-code" key={item}>
                    {item}
                  </div>
                ))
              ) : (
                <div className="meta">
                  {t(lang, { zh: "当前 pack 未声明工作区上下文。", en: "This pack does not declare workspace context keys." })}
                </div>
              )}
              <div className="meta">
                {t(lang, {
                  zh: `关联工坊 ${linkedWorkshopIds.length} 个，关联服务 ${linkedServiceIds.length} 个。`,
                  en: `${linkedWorkshopIds.length} linked workshops and ${linkedServiceIds.length} linked services.`,
                })}
              </div>
            </div>
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "根目录文件", en: "Root files" })}</div>
              {expectedRootFiles.length > 0 ? (
                expectedRootFiles.map((item) => (
                  <div className="route-code" key={item}>
                    {item}
                  </div>
                ))
              ) : (
                <div className="meta">{t(lang, { zh: "当前未声明必需根目录文件。", en: "No required root files are declared for this pack." })}</div>
              )}
              {optionalRootFiles.length > 0 ? (
                <div className="meta">
                  {t(lang, {
                    zh: `可选根文件：${optionalRootFiles.join(" / ")}`,
                    en: `Optional root files: ${optionalRootFiles.join(" / ")}`,
                  })}
                </div>
              ) : null}
              {runtimeAlternativeFiles.length > 0 ? (
                <div className="meta">
                  {t(lang, {
                    zh: `运行时替代文件：${runtimeAlternativeFiles.join(" / ")}`,
                    en: `Runtime alternatives: ${runtimeAlternativeFiles.join(" / ")}`,
                  })}
                </div>
              ) : null}
            </div>
            <div className="detail-item">
              <div className="card-row">
                <div className="file-name">
                  {t(lang, { zh: "信息采集审查摘要", en: "Information collection review" })}
                </div>
                <span className={`pill ${informationCollectionReview ? "active" : ""}`.trim()}>
                  {informationCollectionReview ? informationCollectionReview.totalSlots : 0}
                </span>
              </div>
              {informationCollectionReview ? (
                <>
                  <div className="meta">
                    {t(lang, {
                      zh: `槽位 ${informationCollectionReview.totalSlots} 个，必填 ${informationCollectionReview.requiredSlots} 个，已满足 ${informationCollectionReview.satisfiedSlots} 个。`,
                      en: `${informationCollectionReview.totalSlots} slots, ${informationCollectionReview.requiredSlots} required, ${informationCollectionReview.satisfiedSlots} satisfied.`,
                    })}
                  </div>
                  <div className="meta">
                    {t(lang, {
                      zh: `答案 ${informationCollectionReview.totalAnswers} 条，待复核 ${informationCollectionReview.pendingReviewCount} 条，已批准 ${informationCollectionReview.approvedReviewCount} 条，已驳回 ${informationCollectionReview.rejectedReviewCount} 条。`,
                      en: `${informationCollectionReview.totalAnswers} answers, ${informationCollectionReview.pendingReviewCount} pending, ${informationCollectionReview.approvedReviewCount} approved, ${informationCollectionReview.rejectedReviewCount} rejected.`,
                    })}
                  </div>
                  <div className="meta">
                    {t(lang, {
                      zh: `Slot schema ${informationCollectionReview.slotSchemaVersion ?? "-"} · 最近补充 ${formatTimestamp(lang, informationCollectionReview.latestAnsweredAt)} · 最近复核 ${formatTimestamp(lang, informationCollectionReview.latestReviewedAt)}`,
                      en: `Slot schema ${informationCollectionReview.slotSchemaVersion ?? "-"} · latest answer ${formatTimestamp(lang, informationCollectionReview.latestAnsweredAt)} · latest review ${formatTimestamp(lang, informationCollectionReview.latestReviewedAt)}`,
                    })}
                  </div>
                  <div className="pill-row">
                    <span className="path-chip">
                      {t(lang, {
                        zh: `待复核 ${informationCollectionReview.pendingReviewCount}`,
                        en: `Pending ${informationCollectionReview.pendingReviewCount}`,
                      })}
                    </span>
                    <span className="path-chip success">
                      {t(lang, {
                        zh: `已批准 ${informationCollectionReview.approvedReviewCount}`,
                        en: `Approved ${informationCollectionReview.approvedReviewCount}`,
                      })}
                    </span>
                    <span className={`path-chip ${informationCollectionReview.rejectedReviewCount > 0 ? "warn" : ""}`.trim()}>
                      {t(lang, {
                        zh: `已驳回 ${informationCollectionReview.rejectedReviewCount}`,
                        en: `Rejected ${informationCollectionReview.rejectedReviewCount}`,
                      })}
                    </span>
                    <span className="path-chip">
                      {t(lang, {
                        zh: `已替代 ${informationCollectionReview.supersededReviewCount}`,
                        en: `Superseded ${informationCollectionReview.supersededReviewCount}`,
                      })}
                    </span>
                  </div>
                  <div className="meta">
                    {t(lang, {
                      zh: `用户填报 ${informationCollectionReview.userMessageAnswerCount} 条 · 人工复核 ${informationCollectionReview.manualReviewAnswerCount} 条 · 修订链 ${informationCollectionReview.revisionCount} 条`,
                      en: `${informationCollectionReview.userMessageAnswerCount} user-submitted · ${informationCollectionReview.manualReviewAnswerCount} manual-review · ${informationCollectionReview.revisionCount} revision links`,
                    })}
                  </div>
                  {informationCollectionReviewSlots.length > 0 ? (
                    <div className="governance-stack">
                      {informationCollectionReviewSlots.map((slot) => (
                        <article className="detail-item governance-card" key={`review-slot-${slot.key}`}>
                          <div className="card-row">
                            <div>
                              <div className="file-name">{slot.title}</div>
                              <div className="meta">{slot.key}</div>
                            </div>
                            <div className="pill-row">
                              <span className={`pill ${informationCollectionSlotStatusTone(slot.status)}`.trim()}>
                                {t(lang, informationCollectionSlotStatusLabel(slot.status))}
                              </span>
                              <span className="path-chip">
                                {t(lang, slot.required ? l("必填", "Required") : l("可选", "Optional"))}
                              </span>
                              <span className="path-chip">
                                {t(lang, informationCollectionSlotTypeLabel(slot.type))}
                              </span>
                              {slot.secret ? (
                                <span className="path-chip warn">
                                  {t(lang, { zh: "敏感", en: "Secret" })}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="meta">
                            {t(lang, {
                              zh: `生效答案 ${slot.answerCount} 条 · 已记录 ${slot.trackedAnswerCount} 条 · 待复核 ${slot.pendingReviewCount} 条 · 已批准 ${slot.approvedReviewCount} 条 · 已驳回 ${slot.rejectedReviewCount} 条`,
                              en: `${slot.answerCount} effective answers · ${slot.trackedAnswerCount} tracked · ${slot.pendingReviewCount} pending · ${slot.approvedReviewCount} approved · ${slot.rejectedReviewCount} rejected`,
                            })}
                          </div>
                          <div className="meta">
                            {t(lang, {
                              zh: `最近补充 ${formatTimestamp(lang, slot.lastAnsweredAt)} · 最近复核 ${formatTimestamp(lang, slot.lastReviewedAt)} · 已替代 ${slot.supersededReviewCount} 条`,
                              en: `Latest answer ${formatTimestamp(lang, slot.lastAnsweredAt)} · latest review ${formatTimestamp(lang, slot.lastReviewedAt)} · ${slot.supersededReviewCount} superseded`,
                            })}
                          </div>
                          <div className="pill-row">
                            <span className="path-chip">
                              {t(lang, {
                                zh: `用户填报 ${slot.userMessageAnswerCount}`,
                                en: `User ${slot.userMessageAnswerCount}`,
                              })}
                            </span>
                            <span className={`path-chip ${slot.manualReviewAnswerCount > 0 ? "warn" : ""}`.trim()}>
                              {t(lang, {
                                zh: `人工复核 ${slot.manualReviewAnswerCount}`,
                                en: `Review ${slot.manualReviewAnswerCount}`,
                              })}
                            </span>
                            <span className="path-chip">
                              {t(lang, {
                                zh: `修订链 ${slot.revisionCount}`,
                                en: `Revisions ${slot.revisionCount}`,
                              })}
                            </span>
                            {slot.effectiveSource ? (
                              <span
                                className={`path-chip ${informationCollectionAnswerSourceTone(slot.effectiveSource)}`.trim()}
                              >
                                {t(lang, informationCollectionAnswerSourceLabel(slot.effectiveSource))}
                              </span>
                            ) : null}
                          </div>
                          <div className="meta">
                            {t(lang, {
                              zh: `当前生效 ${slot.effectiveAnswerId ?? "-"} · 来源消息 ${slot.effectiveSourceMessageId ?? "-"} · 最近记录 ${slot.latestAnswerId ?? "-"}`,
                              en: `Effective ${slot.effectiveAnswerId ?? "-"} · source message ${slot.effectiveSourceMessageId ?? "-"} · latest record ${slot.latestAnswerId ?? "-"}`,
                            })}
                          </div>
                          {slot.answers.length > 0 ? (
                            <div className="governance-stack">
                              {slot.answers.map((answer) => (
                                <div key={answer.answerId}>
                                  <div className="pill-row">
                                    <span
                                      className={`path-chip ${informationCollectionAnswerSourceTone(answer.source)}`.trim()}
                                    >
                                      {t(lang, informationCollectionAnswerSourceLabel(answer.source))}
                                    </span>
                                    <span
                                      className={`path-chip ${informationCollectionAnswerReviewStatusTone(answer.reviewStatus)}`.trim()}
                                    >
                                      {t(lang, informationCollectionAnswerReviewStatusLabel(answer.reviewStatus))}
                                    </span>
                                    <span className="path-chip">{answer.kind}</span>
                                    <span className="path-chip">{answer.answerId}</span>
                                  </div>
                                  <div className="meta">
                                    {t(lang, {
                                      zh: `创建 ${formatTimestamp(lang, answer.createdAt)} · 复核 ${formatTimestamp(lang, answer.reviewedAt)} · 来源消息 ${answer.sourceMessageId}`,
                                      en: `Created ${formatTimestamp(lang, answer.createdAt)} · reviewed ${formatTimestamp(lang, answer.reviewedAt)} · source message ${answer.sourceMessageId}`,
                                    })}
                                  </div>
                                  {answer.supersedesAnswerId || answer.supersededByAnswerId ? (
                                    <div className="meta">
                                      {t(lang, {
                                        zh: `替代自 ${answer.supersedesAnswerId ?? "-"} · 被替代为 ${answer.supersededByAnswerId ?? "-"}`,
                                        en: `Supersedes ${answer.supersedesAnswerId ?? "-"} · superseded by ${answer.supersededByAnswerId ?? "-"}`,
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="meta">
                      {t(lang, {
                        zh: "当前归档还没有可展示的槽位复核结果。",
                        en: "No slot-level review result is available in the current archive yet.",
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="meta">
                  {t(lang, {
                    zh: "当前 Session 包还没有导出信息采集审查摘要。",
                    en: "This session pack does not expose an information-collection review summary yet.",
                  })}
                </div>
              )}
            </div>
            <div className="detail-item">
              <div className="card-row">
                <div className="file-name">{t(lang, { zh: "脱敏覆盖摘要", en: "Redaction coverage" })}</div>
                <span className={`pill ${redactionSummary?.secretCoverageComplete ? "active" : "warn"}`.trim()}>
                  {redactionSummary?.secretCoverageComplete
                    ? t(lang, { zh: "已覆盖", en: "Covered" })
                    : t(lang, { zh: "待补齐", en: "Needs coverage" })}
                </span>
              </div>
              {redactionSummary ? (
                <>
                  <div className="meta">
                    {t(lang, {
                      zh: `规则 ${redactionSummary.totalRules} 条 · Secret 槽位 ${redactionSummary.coveredSecretSlotCount}/${redactionSummary.secretSlotCount} 已覆盖 · 未覆盖 ${redactionSummary.uncoveredSecretSlotCount} 个 · 孤儿规则 ${redactionSummary.orphanSlotKeyCount} 个`,
                      en: `${redactionSummary.totalRules} rules · ${redactionSummary.coveredSecretSlotCount}/${redactionSummary.secretSlotCount} secret slots covered · ${redactionSummary.uncoveredSecretSlotCount} uncovered · ${redactionSummary.orphanSlotKeyCount} orphan rules`,
                    })}
                  </div>
                  <div className="meta">
                    {t(lang, {
                      zh: `预检命中规则 ${redactionSummary.previewMatchedRuleCount}/${redactionSummary.totalRules} 条 · 总命中 ${redactionSummary.previewTotalMatches} 次 · 受影响文件 ${redactionSummary.previewMutatedEntries.length} 个`,
                      en: `${redactionSummary.previewMatchedRuleCount}/${redactionSummary.totalRules} preview-matched rules · ${redactionSummary.previewTotalMatches} total matches · ${redactionSummary.previewMutatedEntries.length} mutated entries`,
                    })}
                  </div>
                  <div className="pill-row">
                    <span className="path-chip">
                      {t(lang, {
                        zh: `Map ${redactionSummary.mapVersion ?? "-"}`,
                        en: `Map ${redactionSummary.mapVersion ?? "-"}`,
                      })}
                    </span>
                    <span className="path-chip">
                      {t(lang, {
                        zh: `Slot ${redactionSummary.slotSchemaVersion ?? "-"}`,
                        en: `Slot ${redactionSummary.slotSchemaVersion ?? "-"}`,
                      })}
                    </span>
                    {redactionSummary.targetKinds.map((item) => (
                      <span className="path-chip" key={`redaction-kind-${item}`}>
                        {t(lang, sessionPackRedactionTargetKindLabel(item))}
                      </span>
                    ))}
                    {redactionSummary.strategies.map((item) => (
                      <span className="path-chip" key={`redaction-strategy-${item}`}>
                        {t(lang, sessionPackRedactionStrategyLabel(item))}
                      </span>
                    ))}
                  </div>
                  {redactionSummary.previewError ? (
                    <div className="composer-error">
                      {t(lang, {
                        zh: `脱敏预检失败：${redactionSummary.previewError}`,
                        en: `Redaction preview failed: ${redactionSummary.previewError}`,
                      })}
                    </div>
                  ) : null}
                  {redactionSummary.previewUnmatchedRuleIds.length > 0 ? (
                    <div className="composer-error">
                      {t(lang, {
                        zh: `以下规则在当前归档中没有命中：${redactionSummary.previewUnmatchedRuleIds.join(" / ")}`,
                        en: `These rules did not match the current archive: ${redactionSummary.previewUnmatchedRuleIds.join(" / ")}`,
                      })}
                    </div>
                  ) : null}
                  {redactionSummary.uncoveredSecretSlotKeys.length > 0 ? (
                    <div className="composer-error">
                      {t(lang, {
                        zh: `以下 Secret 槽位还没有 redaction rule：${redactionSummary.uncoveredSecretSlotKeys.join(" / ")}`,
                        en: `These secret slots do not have redaction rules yet: ${redactionSummary.uncoveredSecretSlotKeys.join(" / ")}`,
                      })}
                    </div>
                  ) : null}
                  {redactionSummary.orphanSlotKeys.length > 0 ? (
                    <div className="composer-error">
                      {t(lang, {
                        zh: `以下 slot_key 在当前 slot schema 中不存在：${redactionSummary.orphanSlotKeys.join(" / ")}`,
                        en: `These slot_key values do not exist in the current slot schema: ${redactionSummary.orphanSlotKeys.join(" / ")}`,
                      })}
                    </div>
                  ) : null}
                  <div className="meta">
                    {draftSecretSlotKeys.length > 0
                      ? t(lang, {
                          zh: `当前有效 Secret 槽位：${draftSecretSlotKeys.join(" / ")}`,
                          en: `Effective secret slots: ${draftSecretSlotKeys.join(" / ")}`,
                        })
                      : t(lang, {
                          zh: "当前还没有纳入脱敏治理的 Secret 槽位。",
                          en: "No slot is currently marked as secret for redaction governance.",
                        })}
                  </div>
                  <div className="governance-stack">
                    <article
                      className="detail-item governance-card"
                      data-testid="dashboard-session-redaction-secret-card"
                    >
                      <div className="card-row">
                        <div className="file-name">{t(lang, { zh: "敏感位标记", en: "Secret slot curation" })}</div>
                        <span className={`pill ${draftUncoveredSecretSlotKeys.length > 0 ? "warn" : "active"}`.trim()}>
                          {draftSecretSlotKeys.length}
                        </span>
                      </div>
                      <div className="meta">
                        {t(lang, {
                          zh: `Schema 已标记 ${persistedSchemaSecretSlotKeys.length} 个 · 手工补标 ${normalizedRedactionCuratedSecretSlotKeysDraft.length} 个 · 草稿已覆盖 ${draftCoveredSecretSlotKeys.length}/${draftSecretSlotKeys.length}`,
                          en: `${persistedSchemaSecretSlotKeys.length} schema-marked · ${normalizedRedactionCuratedSecretSlotKeysDraft.length} curated · ${draftCoveredSecretSlotKeys.length}/${draftSecretSlotKeys.length} covered in draft`,
                        })}
                      </div>
                      {draftUncoveredSecretSlotKeys.length > 0 ? (
                        <div className="composer-error">
                          {t(lang, {
                            zh: `以下有效 Secret 槽位还没有绑定规则：${draftUncoveredSecretSlotKeys.join(" / ")}`,
                            en: `These effective secret slots are not bound to any rule yet: ${draftUncoveredSecretSlotKeys.join(" / ")}`,
                          })}
                        </div>
                      ) : null}
                      {redactionSecretSlotCatalog.length > 0 ? (
                        <div className="governance-stack">
                          {redactionSecretSlotCatalog.map((slot) => (
                            <div
                              className="detail-item"
                              key={`redaction-secret-slot-${slot.key}`}
                              data-testid={`dashboard-session-redaction-secret-${slot.key}`}
                            >
                              <div className="card-row">
                                <div>
                                  <div className="file-name">{slot.title}</div>
                                  <div className="meta">{slot.key}</div>
                                </div>
                                <div className="pill-row">
                                  {slot.required ? (
                                    <span className="path-chip">
                                      {t(lang, { zh: "必填", en: "Required" })}
                                    </span>
                                  ) : null}
                                  {slot.type ? (
                                    <span className="path-chip">
                                      {t(lang, informationCollectionSlotTypeLabel(slot.type))}
                                    </span>
                                  ) : null}
                                  {slot.schemaSecret ? (
                                    <span className="path-chip active">
                                      {t(lang, { zh: "Schema 敏感", en: "Schema secret" })}
                                    </span>
                                  ) : null}
                                  {slot.curatedSecret ? (
                                    <span className="path-chip warn">
                                      {t(lang, { zh: "手工补标", en: "Curated" })}
                                    </span>
                                  ) : null}
                                  {slot.effectiveSecret ? (
                                    <span className={`pill ${slot.draftCovered ? "active" : "warn"}`.trim()}>
                                      {slot.draftCovered
                                        ? t(lang, { zh: "已绑规则", en: "Rule linked" })
                                        : t(lang, { zh: "待绑规则", en: "Needs rule" })}
                                    </span>
                                  ) : (
                                    <span className="pill">{t(lang, { zh: "普通槽位", en: "Normal slot" })}</span>
                                  )}
                                </div>
                              </div>
                              <div className="meta">
                                {slot.schemaSecret
                                  ? t(lang, {
                                      zh: "该槽位由 slot schema 直接声明为敏感位，当前界面只允许追加人工敏感位，不允许取消 schema 声明。",
                                      en: "This slot is declared secret by the slot schema. The current workflow allows adding manual secret marks without removing schema declarations.",
                                    })
                                  : slot.curatedSecret
                                    ? t(lang, {
                                        zh: `该槽位已纳入当前 redaction 草稿。${slot.persistedCovered ? "已保存版本存在覆盖规则。" : "保存后会进入正式 Secret 覆盖统计。"}`,
                                        en: `This slot is included in the current redaction draft.${slot.persistedCovered ? " The persisted map already contains a covering rule." : " Saving will move it into formal secret-coverage accounting."}`,
                                      })
                                    : t(lang, {
                                        zh: "该槽位当前按普通槽位处理，需要时可手工补标为敏感位。",
                                        en: "This slot is currently treated as non-secret. You can manually promote it into the secret set when needed.",
                                      })}
                              </div>
                              <div className="governance-form-actions">
                                <button
                                  className={`route-btn ${slot.curatedSecret ? "active" : ""}`.trim()}
                                  data-testid={`dashboard-session-redaction-secret-toggle-${slot.key}`}
                                  type="button"
                                  disabled={!authReady || slot.schemaSecret}
                                  onClick={() => toggleCuratedSecretSlotDraft(slot.key)}
                                >
                                  {slot.schemaSecret
                                    ? t(lang, { zh: "Schema 锁定", en: "Schema locked" })
                                    : slot.curatedSecret
                                      ? t(lang, { zh: "取消补标", en: "Remove mark" })
                                      : t(lang, { zh: "补标敏感位", en: "Mark as secret" })}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="meta">
                          {t(lang, {
                            zh: "当前没有可供补标的槽位来源。请先让运行态导出 slot schema 或信息采集审查摘要。",
                            en: "No slot source is currently available for curation. Export the slot schema or information-collection review summary first.",
                          })}
                        </div>
                      )}
                    </article>
                    <article
                      className="detail-item governance-card"
                      data-testid="dashboard-session-redaction-review-card"
                    >
                      <div className="card-row">
                        <div className="file-name">{t(lang, { zh: "脱敏审阅记录", en: "Redaction review" })}</div>
                        <span
                          className={`pill ${sessionPackRedactionReviewDecisionTone(redactionReview?.decision)}`.trim()}
                        >
                          {t(lang, sessionPackRedactionReviewDecisionLabel(redactionReview?.decision))}
                        </span>
                      </div>
                      <div className="meta">
                        {redactionReview
                          ? t(lang, {
                              zh: `最近审阅 ${formatTimestamp(lang, redactionReview.reviewedAt)} · 审阅人 ${redactionReview.reviewedByUserId ?? "-"} · Map ${redactionReview.mapVersion ?? redactionSummary.mapVersion ?? "-"}`,
                              en: `Latest review ${formatTimestamp(lang, redactionReview.reviewedAt)} · reviewer ${redactionReview.reviewedByUserId ?? "-"} · map ${redactionReview.mapVersion ?? redactionSummary.mapVersion ?? "-"}`,
                            })
                          : t(lang, {
                              zh: "当前 redaction map 还没有正式审阅记录。",
                              en: "The current redaction map does not expose a formal review record yet.",
                            })}
                      </div>
                      <div className="meta">
                        {t(lang, {
                          zh: `本次审阅基于 ${redactionSummary.previewMatchedRuleCount}/${redactionSummary.totalRules} 条规则预检命中，Secret 覆盖 ${redactionSummary.coveredSecretSlotCount}/${redactionSummary.secretSlotCount}。`,
                          en: `This review is grounded on ${redactionSummary.previewMatchedRuleCount}/${redactionSummary.totalRules} preview-matched rules with ${redactionSummary.coveredSecretSlotCount}/${redactionSummary.secretSlotCount} secret slots covered.`,
                        })}
                      </div>
                      {redactionDraftDirty ? (
                        <div className="composer-error">
                          {t(lang, {
                            zh: "当前存在未保存的 redaction 草稿。请先写入 redaction map，再记录正式审阅结论。",
                            en: "There is an unsaved redaction draft. Save the redaction map before recording a formal review decision.",
                          })}
                        </div>
                      ) : null}
                      <div className="governance-form-grid">
                        <label className="fake-input governance-field">
                          <span className="tiny-note">{t(lang, { zh: "工作区上下文", en: "Workspace context" })}</span>
                          <select
                            className="governance-select"
                            value={redactionReviewWorkspaceContextKey}
                            onChange={(event) => setRedactionReviewWorkspaceContextKey(event.target.value)}
                          >
                            {sessionWorkspaceOptions.map((item) => (
                              <option key={`redaction-review-workspace-${item}`} value={item}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="fake-input governance-field" style={{ gridColumn: "1 / -1" }}>
                          <span className="tiny-note">{t(lang, { zh: "审阅说明", en: "Review note" })}</span>
                          <textarea
                            className="governance-textarea"
                            data-testid="dashboard-session-redaction-review-note"
                            rows={3}
                            value={redactionReviewNoteDraft}
                            onChange={(event) => setRedactionReviewNoteDraft(event.target.value)}
                            placeholder={t(lang, {
                              zh: "例如：Secret 槽位已全覆盖，运行时画像文件已移除，允许对外导出。",
                              en: "For example: secret slots are fully covered, runtime profile files are removed, and export is approved.",
                            })}
                          />
                        </label>
                      </div>
                      {redactionReview?.note ? (
                        <div className="meta">
                          {t(lang, {
                            zh: `最新审阅说明：${redactionReview.note}`,
                            en: `Latest review note: ${redactionReview.note}`,
                          })}
                        </div>
                      ) : null}
                      <div className="governance-form-actions">
                        <button
                          className="route-btn active"
                          data-testid="dashboard-session-redaction-review-approve"
                          type="button"
                          disabled={
                            !authReady ||
                            redactionDraftDirty ||
                            redactionSummary.totalRules === 0 ||
                            reviewSessionPackRedactionMutation.isPending
                          }
                          onClick={() => void reviewSessionPackRedactionMutation.mutateAsync("approved")}
                        >
                          {reviewSessionPackRedactionMutation.isPending
                            ? t(lang, { zh: "记录中...", en: "Recording..." })
                            : t(lang, { zh: "标记通过", en: "Mark approved" })}
                        </button>
                        <button
                          className="route-btn"
                          data-testid="dashboard-session-redaction-review-request-changes"
                          type="button"
                          disabled={
                            !authReady ||
                            redactionDraftDirty ||
                            redactionSummary.totalRules === 0 ||
                            reviewSessionPackRedactionMutation.isPending
                          }
                          onClick={() =>
                            void reviewSessionPackRedactionMutation.mutateAsync("changes_requested")
                          }
                        >
                          {t(lang, { zh: "要求修订", en: "Request changes" })}
                        </button>
                      </div>
                    </article>
                    <article
                      className="detail-item governance-card"
                      data-testid="dashboard-session-export-audit-card"
                    >
                      <div className="card-row">
                        <div className="file-name">{t(lang, { zh: "归档导出审计", en: "Archive export audit" })}</div>
                        <span className={`pill ${archiveExportAudit ? "active" : ""}`.trim()}>
                          {archiveExportAudit?.totalExports ?? 0}
                        </span>
                      </div>
                      {archiveExportAudit ? (
                        <>
                          <div className="meta">
                            {t(lang, {
                              zh: `普通导出 ${archiveExportAudit.plainExportCount} 次 · 脱敏导出 ${archiveExportAudit.redactedExportCount} 次 · 最近导出 ${formatTimestamp(lang, archiveExportAudit.latestExportedAt)}`,
                              en: `${archiveExportAudit.plainExportCount} plain exports · ${archiveExportAudit.redactedExportCount} redacted exports · latest export ${formatTimestamp(lang, archiveExportAudit.latestExportedAt)}`,
                            })}
                          </div>
                          {archiveExportAudit.latestRedactedExportedAt ? (
                            <div className="meta">
                              {t(lang, {
                                zh: `最近脱敏导出 ${formatTimestamp(lang, archiveExportAudit.latestRedactedExportedAt)}`,
                                en: `Latest redacted export ${formatTimestamp(lang, archiveExportAudit.latestRedactedExportedAt)}`,
                              })}
                            </div>
                          ) : null}
                          <div className="governance-stack">
                            {archiveExportAudit.entries.map((entry) => (
                              <div className="detail-item" key={entry.exportId}>
                                <div className="card-row">
                                  <div>
                                    <div className="file-name">{entry.exportId}</div>
                                    <div className="meta">{entry.archiveFileName}</div>
                                  </div>
                                  <div className="pill-row">
                                    <span className={`pill ${entry.redacted ? "warn" : "active"}`.trim()}>
                                      {entry.redacted
                                        ? t(lang, { zh: "脱敏", en: "Redacted" })
                                        : t(lang, { zh: "原始", en: "Plain" })}
                                    </span>
                                    <span className={`path-chip ${sessionPackArchiveSourceTone(entry.archiveSource)}`.trim()}>
                                      {t(lang, sessionPackArchiveSourceLabel(entry.archiveSource))}
                                    </span>
                                  </div>
                                </div>
                                <div className="meta">
                                  {t(lang, {
                                    zh: `导出时间 ${formatTimestamp(lang, entry.exportedAt)} · 操作人 ${entry.exportedByUserId ?? "-"} · 工作区 ${entry.workspaceContextKey ?? "-"}`,
                                    en: `Exported ${formatTimestamp(lang, entry.exportedAt)} · actor ${entry.exportedByUserId ?? "-"} · workspace ${entry.workspaceContextKey ?? "-"}`,
                                  })}
                                </div>
                                <div className="meta">
                                  {t(lang, {
                                    zh: `大小 ${formatByteSize(entry.archiveSizeBytes)} · SHA-256 ${entry.archiveSha256.slice(0, 16)}...`,
                                    en: `Size ${formatByteSize(entry.archiveSizeBytes)} · SHA-256 ${entry.archiveSha256.slice(0, 16)}...`,
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="meta">
                          {t(lang, {
                            zh: "当前 Session 包还没有归档导出审计记录。下载归档后这里会沉淀正式证据。",
                            en: "No archive export audit exists for this session pack yet. Downloading an archive will deposit formal evidence here.",
                          })}
                        </div>
                      )}
                    </article>
                  </div>
                  <article className="detail-item governance-card">
                    <div className="card-row">
                      <div className="file-name">{t(lang, { zh: "脱敏规则草稿", en: "Redaction rule draft" })}</div>
                      <span className={`pill ${redactionDraftDirty ? "warn" : "active"}`.trim()}>
                        {redactionRuleDrafts.length}
                      </span>
                    </div>
                    <div className="meta">
                      {t(lang, {
                        zh: redactionDraftDirty
                          ? "当前草稿与已保存 redaction map 存在差异，提交后会重新生成预检摘要。"
                          : "当前草稿已与已保存 redaction map 对齐。",
                        en: redactionDraftDirty
                          ? "The current draft differs from the persisted redaction map. Saving will regenerate preview coverage."
                          : "The current draft is aligned with the persisted redaction map.",
                      })}
                    </div>
                    <div className="governance-form-grid">
                      <label className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "工作区上下文", en: "Workspace context" })}</span>
                        <select
                          className="governance-select"
                          value={redactionWorkspaceContextKey}
                          onChange={(event) => setRedactionWorkspaceContextKey(event.target.value)}
                        >
                          {sessionWorkspaceOptions.map((item) => (
                            <option key={`redaction-workspace-${item}`} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "Map 版本", en: "Map version" })}</span>
                        <input
                          className="search-inline-input"
                          type="text"
                          value={redactionMapVersionDraft}
                          onChange={(event) => setRedactionMapVersionDraft(event.target.value)}
                          placeholder={redactionSummary?.mapVersion ?? "curated.v1"}
                        />
                      </label>
                      <label className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "规则 ID", en: "Rule ID" })}</span>
                        <input
                          className="search-inline-input"
                          type="text"
                          value={redactionRuleEditor.ruleId}
                          onChange={(event) =>
                            setRedactionRuleEditor((current) => ({
                              ...current,
                              ruleId: event.target.value,
                            }))
                          }
                          placeholder="replace-tax-secret"
                        />
                      </label>
                      <label className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "绑定槽位", en: "Bound slot" })}</span>
                        <input
                          className="search-inline-input"
                          type="text"
                          value={redactionRuleEditor.slotKey}
                          onChange={(event) =>
                            setRedactionRuleEditor((current) => ({
                              ...current,
                              slotKey: event.target.value,
                            }))
                          }
                          placeholder="tax_secret"
                        />
                      </label>
                      <label className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "目标类型", en: "Target kind" })}</span>
                        <select
                          className="governance-select"
                          value={redactionRuleEditor.targetKind}
                          onChange={(event) =>
                            setRedactionRuleEditor((current) => ({
                              ...current,
                              targetKind: event.target.value as SessionPackRedactionTargetKind,
                            }))
                          }
                        >
                          {(["text", "file-path", "json-path", "header", "cookie"] as const).map((item) => (
                            <option key={`redaction-kind-${item}`} value={item}>
                              {t(lang, sessionPackRedactionTargetKindLabel(item))}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "策略", en: "Strategy" })}</span>
                        <select
                          className="governance-select"
                          value={redactionRuleEditor.strategy}
                          onChange={(event) =>
                            setRedactionRuleEditor((current) => ({
                              ...current,
                              strategy: event.target.value as SessionPackRedactionStrategy,
                              replacement:
                                event.target.value === "replace" ? current.replacement : "",
                            }))
                          }
                        >
                          {(["mask", "remove", "replace", "hash"] as const).map((item) => (
                            <option key={`redaction-strategy-${item}`} value={item}>
                              {t(lang, sessionPackRedactionStrategyLabel(item))}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "Selector", en: "Selector" })}</span>
                        <input
                          className="search-inline-input"
                          type="text"
                          value={redactionRuleEditor.selector}
                          onChange={(event) =>
                            setRedactionRuleEditor((current) => ({
                              ...current,
                              selector: event.target.value,
                            }))
                          }
                          placeholder="runtime-config.json#$.env.TAX_SECRET"
                        />
                      </label>
                      <label className="fake-input governance-field">
                        <span className="tiny-note">{t(lang, { zh: "Replacement", en: "Replacement" })}</span>
                        <input
                          className="search-inline-input"
                          type="text"
                          disabled={redactionRuleEditor.strategy !== "replace"}
                          value={redactionRuleEditor.replacement}
                          onChange={(event) =>
                            setRedactionRuleEditor((current) => ({
                              ...current,
                              replacement: event.target.value,
                            }))
                          }
                          placeholder="[REDACTED]"
                        />
                      </label>
                    </div>
                    <label className="fake-input governance-field">
                      <span className="tiny-note">{t(lang, { zh: "说明", en: "Rationale" })}</span>
                      <textarea
                        className="governance-textarea"
                        rows={3}
                        value={redactionRuleEditor.rationale}
                        onChange={(event) =>
                          setRedactionRuleEditor((current) => ({
                            ...current,
                            rationale: event.target.value,
                          }))
                        }
                        placeholder={t(lang, {
                          zh: "例如：在归档导出中移除运行时税务凭证与画像文件。",
                          en: "For example: remove runtime tax secrets and profile files from exported archives.",
                        })}
                      />
                    </label>
                    {redactionSlotOptions.length > 0 ? (
                      <div className="pill-row">
                        {redactionSlotOptions.map((item) => (
                          <button
                            className={`path-chip ${redactionRuleEditor.slotKey === item ? "active" : ""}`.trim()}
                            key={`redaction-slot-option-${item}`}
                            type="button"
                            onClick={() =>
                              setRedactionRuleEditor((current) => ({
                                ...current,
                                slotKey: item,
                              }))
                            }
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {redactionRuleEditorError ? (
                      <div className="composer-error">{redactionRuleEditorError}</div>
                    ) : null}
                    <div className="governance-form-actions">
                      <button
                        className="route-btn active"
                        type="button"
                        disabled={!authReady || Boolean(redactionRuleEditorError)}
                        onClick={stageCurrentRedactionRuleDraft}
                      >
                        {editingRedactionRuleId
                          ? t(lang, { zh: "更新规则草稿", en: "Update draft rule" })
                          : t(lang, { zh: "加入规则草稿", en: "Add draft rule" })}
                      </button>
                      <button
                        className="route-btn"
                        type="button"
                        onClick={() => {
                          setEditingRedactionRuleId(null);
                          setRedactionRuleEditor(createEmptyRedactionRuleEditorDraft());
                        }}
                      >
                        {t(lang, { zh: "清空当前编辑", en: "Clear editor" })}
                      </button>
                      <button
                        className="route-btn"
                        type="button"
                        disabled={!redactionDraftDirty}
                        onClick={() => resetRedactionDraftState()}
                      >
                        {t(lang, { zh: "恢复已保存版本", en: "Restore saved map" })}
                      </button>
                      <button
                        className="route-btn active"
                        type="button"
                        disabled={!canPersistRedactionDrafts || !redactionDraftDirty}
                        onClick={() => void updateSessionPackRedactionMapMutation.mutateAsync()}
                      >
                        {updateSessionPackRedactionMapMutation.isPending
                          ? t(lang, { zh: "写入中...", en: "Saving..." })
                          : t(lang, { zh: "写入 redaction map", en: "Save redaction map" })}
                      </button>
                    </div>
                  </article>
                  {redactionRuleDrafts.length > 0 ? (
                    <div className="governance-stack">
                      {redactionRuleDrafts.map((rule) => {
                        const persistedRule = persistedRedactionRuleById.get(rule.ruleId);
                        return (
                          <article
                            className="detail-item governance-card"
                            key={`redaction-rule-${rule.ruleId}`}
                          >
                            <div className="card-row">
                              <div>
                                <div className="file-name">{rule.ruleId}</div>
                                <div className="meta">{rule.slotKey?.trim() || "-"}</div>
                              </div>
                              <div className="pill-row">
                                <span className="path-chip">
                                  {t(lang, sessionPackRedactionTargetKindLabel(rule.targetKind))}
                                </span>
                                <span className="path-chip">
                                  {t(lang, sessionPackRedactionStrategyLabel(rule.strategy))}
                                </span>
                                {persistedRule?.linkedSecretSlot ? (
                                  <span className="pill active">
                                    {t(lang, { zh: "Secret 槽位", en: "Secret slot" })}
                                  </span>
                                ) : rule.slotKey?.trim() ? (
                                  <span className={`pill ${persistedRule ? (persistedRule.linkedSlotExists ? "" : "warn") : "warn"}`.trim()}>
                                    {persistedRule
                                      ? persistedRule.linkedSlotExists
                                        ? t(lang, { zh: "普通槽位", en: "Non-secret slot" })
                                        : t(lang, { zh: "未命中槽位", en: "Missing slot" })
                                      : t(lang, { zh: "待提交槽位", en: "Draft slot" })}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="route-code">{rule.selector}</div>
                            {rule.strategy === "replace" && rule.replacement?.trim() ? (
                              <div className="route-code">{rule.replacement}</div>
                            ) : null}
                            <div className="meta">
                              {persistedRule
                                ? t(lang, {
                                    zh: `绑定槽位 ${persistedRule.slotKey ?? "-"} · ${persistedRule.linkedSlotExists ? "已命中 schema" : "未命中 schema"}`,
                                    en: `Bound slot ${persistedRule.slotKey ?? "-"} · ${persistedRule.linkedSlotExists ? "matches schema" : "missing from schema"}`,
                                  })
                                : t(lang, {
                                    zh: "当前规则还未写入 redaction map，预检摘要将在保存后生成。",
                                    en: "This rule has not been saved into the redaction map yet. Preview coverage will be generated after saving.",
                                  })}
                            </div>
                            <div className="meta">
                              {persistedRule
                                ? t(lang, {
                                    zh: `预检命中 ${persistedRule.previewMatchCount} 次 · 影响文件 ${persistedRule.previewMutatedEntries.length} 个`,
                                    en: `${persistedRule.previewMatchCount} preview matches · ${persistedRule.previewMutatedEntries.length} mutated entries`,
                                  })
                                : t(lang, {
                                    zh: "尚未生成预检命中结果。",
                                    en: "No preview match result has been generated yet.",
                                  })}
                            </div>
                            {persistedRule && persistedRule.previewMutatedEntries.length > 0 ? (
                              <div className="route-code">{persistedRule.previewMutatedEntries.join(" / ")}</div>
                            ) : null}
                            {rule.rationale?.trim() ? <div className="meta">{rule.rationale}</div> : null}
                            <div className="governance-form-actions">
                              <button
                                className={`route-btn ${editingRedactionRuleId === rule.ruleId ? "active" : ""}`.trim()}
                                type="button"
                                onClick={() => editRedactionRuleDraft(rule)}
                              >
                                {t(lang, { zh: "编辑", en: "Edit" })}
                              </button>
                              <button
                                className="route-btn"
                                type="button"
                                onClick={() => removeRedactionRuleDraft(rule.ruleId)}
                              >
                                {t(lang, { zh: "移除", en: "Remove" })}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="meta">
                      {t(lang, {
                        zh: "当前 redaction map 还没有规则。请先创建规则草稿并写入。",
                        en: "The current redaction map does not define any rule yet. Create draft rules and save them first.",
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="meta">
                  {t(lang, {
                    zh: "当前 Session 包还没有可展示的脱敏摘要。",
                    en: "This session pack does not expose a redaction summary yet.",
                  })}
                </div>
              )}
            </div>
            <div className="detail-item">
              <div className="card-row">
                <div className="file-name">{t(lang, { zh: "消费治理清单", en: "Consumer governance map" })}</div>
                <span className={`pill ${consumerGovernance ? "active" : ""}`.trim()}>
                  {consumerGovernance?.totalConsumerVersions ?? 0}
                </span>
              </div>
              {consumerGovernance ? (
                <>
                  <div className="meta">
                    {t(lang, {
                      zh: `共 ${consumerGovernance.totalConsumerVersions} 个消费版本，覆盖工作区 ${consumerGovernanceWorkspaceIds.length} 个、服务 ${consumerGovernanceServiceIds.length} 个、入口面 ${consumerGovernanceEntrySurfaces.length} 个。`,
                      en: `${consumerGovernance.totalConsumerVersions} consumer versions across ${consumerGovernanceWorkspaceIds.length} workspaces, ${consumerGovernanceServiceIds.length} services, and ${consumerGovernanceEntrySurfaces.length} entry surfaces.`,
                    })}
                  </div>
                  <div className="pill-row">
                    <span className="path-chip">
                      {t(lang, {
                        zh: `工作区 ${consumerGovernanceWorkspaceIds.length}`,
                        en: `Workspaces ${consumerGovernanceWorkspaceIds.length}`,
                      })}
                    </span>
                    <span className="path-chip">
                      {t(lang, {
                        zh: `服务 ${consumerGovernanceServiceIds.length}`,
                        en: `Services ${consumerGovernanceServiceIds.length}`,
                      })}
                    </span>
                    <span className="path-chip">
                      {t(lang, {
                        zh: `入口面 ${consumerGovernanceEntrySurfaces.length}`,
                        en: `Surfaces ${consumerGovernanceEntrySurfaces.length}`,
                      })}
                    </span>
                  </div>
                  <label className="fake-input governance-search">
                    <svg
                      className="icon"
                      style={{
                        display: "inline-block",
                        verticalAlign: -4,
                        width: 14,
                        height: 14,
                        marginRight: 6,
                      }}
                    >
                      <use href="#i-search" />
                    </svg>
                    <input
                      className="search-inline-input"
                      type="text"
                      value={consumerGovernanceQuery}
                      onChange={(event) => setConsumerGovernanceQuery(event.target.value)}
                      placeholder={t(lang, {
                        zh: "搜索 session 版本、run、工作区、服务或 target path",
                        en: "Search session version, run, workspace, service, or target path",
                      })}
                    />
                  </label>
                  {filteredConsumerGovernanceItems.length > 0 ? (
                    <div className="governance-stack">
                      {filteredConsumerGovernanceItems.map((item) => {
                        const linkedRunId = item.consumerRunId ?? item.runtimeSourceRunId;
                        const effectiveTargetPath =
                          item.consumerTargetPath ?? item.runtimeSourceTargetPath ?? null;

                        return (
                          <article
                            className="detail-item governance-card"
                            key={`consumer-governance-${item.sessionVersionId}`}
                          >
                            <div className="card-row">
                              <div>
                                <div className="file-name">{t(lang, item.displayName)}</div>
                                <div className="meta">{item.sessionVersionId}</div>
                              </div>
                              <div className="pill-row">
                                {item.isCurrent ? (
                                  <span className="pill active">
                                    {t(lang, { zh: "当前版本", en: "Current" })}
                                  </span>
                                ) : null}
                                <span
                                  className={`path-chip ${sessionPackInheritModeTone(item.inheritMode)}`.trim()}
                                >
                                  {t(lang, sessionPackInheritModeLabel(item.inheritMode))}
                                </span>
                                <span
                                  className={`path-chip ${sessionPackArchiveSourceTone(item.archiveSource)}`.trim()}
                                >
                                  {t(lang, sessionPackArchiveSourceLabel(item.archiveSource))}
                                </span>
                                {item.consumerEntrySurface ? (
                                  <span className="path-chip">
                                    {t(lang, entrySurfaceLabel(item.consumerEntrySurface))}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="meta">{t(lang, item.summary)}</div>
                            <div className="meta">
                              {t(lang, {
                                zh: `深度 ${item.depth} · 来自 ${item.viaSessionVersionId ?? "-"} · 更新时间 ${formatTimestamp(lang, item.updatedAt)}`,
                                en: `Depth ${item.depth} via ${item.viaSessionVersionId ?? "-"} · updated ${formatTimestamp(lang, item.updatedAt)}`,
                              })}
                            </div>
                            <div className="meta">
                              {t(lang, {
                                zh: `消费工作区 ${item.consumerWorkspaceId ?? "-"} · 服务 ${item.consumerServiceId ?? "-"} · 工坊 ${item.consumerWorkshopId ?? "-"}`,
                                en: `Consumer workspace ${item.consumerWorkspaceId ?? "-"} · Service ${item.consumerServiceId ?? "-"} · Workshop ${item.consumerWorkshopId ?? "-"}`,
                              })}
                            </div>
                            <div className="meta">
                              {t(lang, {
                                zh: `上下文 ${item.workspaceContextKeys.length} 个 · 关联服务 ${item.linkedServiceIds.length} 个 · 关联工坊 ${item.linkedWorkshopIds.length} 个 · 模板引用 ${item.publishedTargetCount} 个`,
                                en: `${item.workspaceContextKeys.length} contexts · ${item.linkedServiceIds.length} linked services · ${item.linkedWorkshopIds.length} linked workshops · ${item.publishedTargetCount} template bindings`,
                              })}
                            </div>
                            {effectiveTargetPath ? (
                              <div className="route-code">{effectiveTargetPath}</div>
                            ) : (
                              <div className="meta">
                                {t(lang, {
                                  zh: "当前版本尚未记录消费 target path。",
                                  en: "No consumer target path has been recorded for this version yet.",
                                })}
                              </div>
                            )}
                            {(item.runtimeSourceRunId || item.runtimeSourceTargetPath) && (
                              <div className="meta">
                                {t(lang, {
                                  zh: `运行证据 run ${item.runtimeSourceRunId ?? "-"} · 路径 ${item.runtimeSourceTargetPath ?? "-"}`,
                                  en: `Runtime evidence run ${item.runtimeSourceRunId ?? "-"} · path ${item.runtimeSourceTargetPath ?? "-"}`,
                                })}
                              </div>
                            )}
                            <div className="governance-form-actions">
                              {!item.isCurrent ? (
                                <button
                                  className="route-btn"
                                  type="button"
                                  onClick={() => setActiveSessionVersionId(item.sessionVersionId)}
                                >
                                  {t(lang, { zh: "查看该版本", en: "Open version" })}
                                </button>
                              ) : null}
                              {linkedRunId ? (
                                <>
                                  <button
                                    className="route-btn"
                                    type="button"
                                    onClick={() => navigate(dashboardRoutes.instance(linkedRunId))}
                                  >
                                    {t(lang, { zh: "打开实例", en: "Open instance" })}
                                  </button>
                                  <button
                                    className="route-btn"
                                    type="button"
                                    onClick={() => navigate(dashboardRoutes.instance(linkedRunId, "files"))}
                                  >
                                    {t(lang, { zh: "查看文件", en: "Open files" })}
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="meta">
                      {t(lang, {
                        zh: "当前查询下没有命中的消费治理版本。",
                        en: "No consumer-governance version matches the current query.",
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="meta">
                  {t(lang, {
                    zh: "当前 Session 包还没有可见的消费治理记录。",
                    en: "No visible consumer-governance record is available for this session pack yet.",
                  })}
                </div>
              )}
            </div>
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "来源包", en: "Source packages" })}</div>
              {sourcePackages.length > 0 ? (
                sourcePackages.map((item) => (
                  <div className="meta" key={item.packageId}>
                    {item.packageId} / {item.state} / {item.updatedAt}
                  </div>
                ))
              ) : (
                <div className="meta">{t(lang, { zh: "当前没有登记来源包。", en: "No source packages are registered." })}</div>
              )}
              {sourcePackages.length > 0
                ? sourcePackages.map((item) => (
                    <div className="meta" key={`${item.packageId}-title`}>
                      {t(lang, item.title)}
                    </div>
                  ))
                : null}
            </div>
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "运行时画像", en: "Runtime profile" })}</div>
              <div className="route-code">{sessionPack.runtimeProfile.profileId}</div>
              <div className="route-code">{sessionPack.runtimeProfile.runnerImage ?? "-"}</div>
              <div className="meta">
                {t(lang, {
                  zh: sessionPack.runtimeProfile.browserRequired ? "浏览器能力：必需" : "浏览器能力：非必需",
                  en: sessionPack.runtimeProfile.browserRequired
                    ? "Browser capability: required"
                    : "Browser capability: optional",
                })}
              </div>
              <div className="meta">
                {t(lang, {
                  zh: sessionPack.runtimeProfile.playwrightRequired ? "Playwright：必需" : "Playwright：非必需",
                  en: sessionPack.runtimeProfile.playwrightRequired ? "Playwright: required" : "Playwright: optional",
                })}
              </div>
            </div>
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "绑定要求", en: "Binding requirements" })}</div>
              {firstPartyMcpIds.length > 0 ? (
                firstPartyMcpIds.map((item) => (
                  <div className="route-code" key={item}>
                    MCP / {item}
                  </div>
                ))
              ) : (
                <div className="meta">{t(lang, { zh: "当前未声明第一方 MCP 绑定。", en: "No first-party MCP bindings are declared." })}</div>
              )}
              {externalConnectorRefs.length > 0
                ? externalConnectorRefs.map((item) => (
                    <div className="route-code" key={item}>
                      Connector / {item}
                    </div>
                  ))
                : null}
              {credentialIds.length > 0
                ? credentialIds.map((item) => (
                    <div className="route-code" key={item}>
                      Secret / {item}
                    </div>
                  ))
                : null}
            </div>
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "发布链路", en: "Release lineage" })}</div>
              <div className="meta">
                {t(lang, {
                  zh: `来源发布 ${sourceReleaseIds.length} 条，激活记录 ${activeActivationIds.length} 条。`,
                  en: `${sourceReleaseIds.length} source releases and ${activeActivationIds.length} active activations.`,
                })}
              </div>
              {sourceReleaseIds.length > 0 ? (
                sourceReleaseIds.map((item) => (
                  <div className="route-code" key={item}>
                    {item}
                  </div>
                ))
              ) : (
                <div className="meta">{t(lang, { zh: "当前未关联来源发布。", en: "No source releases are linked." })}</div>
              )}
              {activeActivationIds.length > 0
                ? activeActivationIds.map((item) => (
                    <div className="route-code" key={item}>
                      {item}
                    </div>
                  ))
                : null}
              {sessionPack.releaseChannel ? (
                <div className="meta">
                  {t(lang, {
                    zh: `发布通道：${t(lang, sessionPack.releaseChannel)}`,
                    en: `Release channel: ${t(lang, sessionPack.releaseChannel)}`,
                  })}
                </div>
              ) : null}
              {sessionPack.sourcePackageState ? (
                <div className="meta">
                  {t(lang, {
                    zh: `来源包状态：${sessionPack.sourcePackageState}`,
                    en: `Source package state: ${sessionPack.sourcePackageState}`,
                  })}
                </div>
              ) : null}
            </div>
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "已发布模板目标", en: "Published launch template targets" })}</div>
              {publishedTargets.length > 0 ? (
                publishedTargets.map((item) => (
                  <div className="detail-item" key={item.templateKey}>
                    <div className="card-row">
                      <div>
                        <div className="file-name">{t(lang, item.title)}</div>
                        <div className="meta">{item.templateKey}</div>
                      </div>
                      <span className="pill active">{t(lang, entrySurfaceLabel(item.entrySurface))}</span>
                    </div>
                    <div className="meta">
                      {item.serviceId} / {item.workspaceContextKey} / {item.taskVersionId}
                    </div>
                    <div className="route-code">{item.targetRoot}</div>
                  </div>
                ))
              ) : (
                <div className="meta">
                  {t(lang, {
                    zh: "当前 session-pack 还没有被发布到任何消费模板。",
                    en: "This session-pack has not been published into any launch template yet.",
                  })}
                </div>
              )}
            </div>
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "关联对象", en: "Linked assets" })}</div>
              {linkedWorkshopIds.length > 0 ? (
                linkedWorkshopIds.map((item) => (
                  <div className="route-code" key={item}>
                    Workshop / {item}
                  </div>
                ))
              ) : (
                <div className="meta">{t(lang, { zh: "当前未关联工坊。", en: "No workshops are linked." })}</div>
              )}
              {linkedServiceIds.length > 0
                ? linkedServiceIds.map((item) => (
                    <div className="route-code" key={item}>
                      Service / {item}
                    </div>
                  ))
                : null}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="detail-body">
      <div className="section-head">
        <div>
          <div className="eyebrow">
            {{
              session: t(lang, { zh: "Session 包", en: "Session Package" }),
              runtime: t(lang, { zh: "运行镜像", en: "Runtime" }),
              connectors: t(lang, { zh: "连接器与凭证", en: "Connectors & Secrets" }),
              release: t(lang, { zh: "发布与审计", en: "Release & Audit" }),
            }[creatorTab]}
          </div>
          <div className="tab-title">{t(lang, { zh: "当前选中 package 的详情", en: "Detail for the selected package" })}</div>
        </div>
        <span className={`pill ${pkg.statusClass}`}>{t(lang, pkg.status)}</span>
      </div>
      <div className="section-note">{t(lang, tabData.summary)}</div>
      {tabData.items.map((item) => (
        <div className="detail-item" key={t(lang, item)}>
          <div className="file-name">{t(lang, item)}</div>
        </div>
      ))}
    </div>
  );
}

function CreatorDebugPanel({
  packageId,
}: {
  packageId: string;
}) {
  return <CreatorReplayPanel packageId={packageId} />;
}

function CreatorOperationsRail({
  pkg,
  boundWorkspaces,
  relatedWorkshops,
  relatedServices,
  isGovernanceRoute,
  governanceSection,
  canManageGovernance,
  queriesEnabled,
}: {
  pkg: CreatorPackageView;
  boundWorkspaces: WorkspaceChip[];
  relatedWorkshops: RelatedWorkshopReference[];
  relatedServices: RelatedServiceReference[];
  isGovernanceRoute: boolean;
  governanceSection: GovernanceSection;
  canManageGovernance: boolean;
  queriesEnabled: boolean;
}) {
  const navigate = useNavigate();
  const lang = useDashboardUiStore((state) => state.lang);
  const setCreatorTab = useDashboardUiStore((state) => state.setCreatorTab);
  const releasesQuery = useQuery({
    queryKey: ["dashboard", "creator", "package", pkg.id, "releases"],
    queryFn: async () => dashboardCreatorApi.listPackageReleases(pkg.id),
    enabled: queriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const replaysQuery = useQuery({
    queryKey: ["dashboard", "creator", "package", pkg.id, "replays"],
    queryFn: async () => dashboardCreatorApi.listPackageReplays(pkg.id),
    enabled: queriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const latestRelease = useMemo(
    () => latestByUpdatedAt(releasesQuery.data ?? []),
    [releasesQuery.data]
  );
  const gatesQuery = useQuery({
    queryKey: ["dashboard", "creator", "release", latestRelease?.releaseId ?? null, "gates"],
    queryFn: async () => dashboardCreatorApi.listReleaseGates(latestRelease!.releaseId),
    enabled: queriesEnabled && latestRelease != null,
    retry: false,
    staleTime: 30_000,
  });
  const activationsQuery = useQuery({
    queryKey: ["dashboard", "creator", "release", latestRelease?.releaseId ?? null, "activations"],
    queryFn: async () => dashboardCreatorApi.listReleaseActivations(latestRelease!.releaseId),
    enabled: queriesEnabled && latestRelease != null,
    retry: false,
    staleTime: 30_000,
  });
  const meta = useMemo(
    () =>
      buildCreatorOperationMeta({
        pkg,
        releases: releasesQuery.data ?? [],
        replays: replaysQuery.data ?? [],
        gates: gatesQuery.data ?? [],
        activations: activationsQuery.data ?? [],
        boundWorkspaces,
        relatedWorkshops,
        relatedServices,
      }),
    [
      activationsQuery.data,
      boundWorkspaces,
      gatesQuery.data,
      pkg,
      relatedServices,
      relatedWorkshops,
      releasesQuery.data,
      replaysQuery.data,
    ]
  );
  const cadenceTimestamp = latestRelease?.updatedAt ?? pkg.updatedAt;

  const handleAction = (target: CreatorActionTarget) => {
    if (isCreatorGovernanceTarget(target) && !canManageGovernance) {
      return;
    }

    if (target === "release") {
      setCreatorTab("release");
      navigate(dashboardRoutes.creatorPackage(pkg.id));
      return;
    }

    if (target === "debug") {
      navigate(dashboardRoutes.creatorDebug(pkg.id));
      return;
    }

    if (target === "governance-policy") {
      navigate(dashboardRoutes.creatorGovernance("policy"));
      return;
    }

    if (target === "governance-audit") {
      navigate(dashboardRoutes.creatorGovernance("audit"));
      return;
    }

    navigate(dashboardRoutes.creatorGovernance("cost"));
  };

  return (
    <div className="creator-rail">
      <article className="detail-card creator-ops-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "右栏操作区", en: "Action Rail" })}</div>
            <div className="detail-title">{t(lang, { zh: "发布 / 回滚 / 灰度 / 停用", en: "Publish / Rollback / Rollout / Disable" })}</div>
          </div>
          <span className="pill active">{pkg.id}</span>
        </div>
        <div className="section-note">{t(lang, meta.summary)}</div>
        <div className="creator-rail-metrics">
          {meta.metrics.map((item) => (
            <div className="quick-box" key={t(lang, item.label)}>
              <div className="quick-label">{t(lang, item.label)}</div>
              <div className={`quick-value creator-tone-${item.tone || "plain"}`}>{item.value}</div>
              <div className="tiny-note">{t(lang, item.note)}</div>
            </div>
          ))}
        </div>
        <div className="action-grid">
          {meta.actions.map((item) => (
            <button
              className={`action-btn ${item.tone}`}
              key={t(lang, item.label)}
              type="button"
              disabled={isCreatorGovernanceTarget(item.target) && !canManageGovernance}
              onClick={() => handleAction(item.target)}
            >
              <div className="file-name">{t(lang, item.label)}</div>
              <div className="file-meta">{t(lang, item.hint)}</div>
            </button>
          ))}
        </div>
      </article>

      <article className="detail-card creator-ops-card">
        <div className="section-head">
            <div>
              <div className="eyebrow">{t(lang, { zh: "发布节奏", en: "Release cadence" })}</div>
              <div className="detail-title">{t(lang, { zh: "灰度与回放检查点", en: "Rollout and replay checkpoints" })}</div>
            </div>
          <span className="pill">{cadenceTimestamp}</span>
        </div>
        <div className="detail-body">
          {meta.rollout.map((item) => (
            <div className="audit-row" key={t(lang, item.title)}>
              <div className="card-row">
                <div className="file-name">{t(lang, item.title)}</div>
                <span className={`pill ${item.tone}`}>{t(lang, { zh: "处理中", en: "In flow" })}</span>
              </div>
              <div className="meta">{t(lang, item.note)}</div>
            </div>
          ))}
        </div>
      </article>

      <article className="detail-card creator-ops-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "绑定范围", en: "Bindings" })}</div>
            <div className="detail-title">{t(lang, { zh: "空间 / 工坊 / 服务映射", en: "Workspace / workshop / service map" })}</div>
          </div>
          <span className="pill success">{boundWorkspaces.length}</span>
        </div>
        <div className="detail-body">
          <div className="detail-item">
            <div className="file-name">{t(lang, { zh: "发布通道", en: "Release channel" })}</div>
            <div className="meta">{t(lang, pkg.releaseChannel)}</div>
          </div>
          <div className="detail-item">
            <div className="file-name">{t(lang, { zh: "绑定工作区", en: "Bound workspaces" })}</div>
            <div className="pill-row">
              {boundWorkspaces.map((item) => (
                <span className="path-chip active" key={item.id}>
                  {t(lang, item.name)}
                </span>
              ))}
            </div>
          </div>
          <div className="detail-item">
            <div className="file-name">{t(lang, { zh: "绑定工坊 / 服务", en: "Bound workshops / services" })}</div>
            <div className="pill-row">
              {relatedWorkshops.map((item) => (
                <span className="path-chip" key={item.id}>
                  {t(lang, item.title)}
                </span>
              ))}
              {relatedServices.map((item) => (
                <span className="path-chip success" key={item.id}>
                  {t(lang, item.name)}
                </span>
              ))}
            </div>
          </div>
          {meta.alerts.map((item) => (
            <div className="detail-item" key={t(lang, item.title)}>
              <div className="card-row">
                <div className="file-name">{t(lang, item.title)}</div>
                <span className={`pill ${item.tone}`}>{t(lang, { zh: "关注", en: "Watch" })}</span>
              </div>
              <div className="meta">{t(lang, item.note)}</div>
            </div>
          ))}
        </div>
      </article>

      {isGovernanceRoute ? (
        <article className="detail-card creator-ops-card">
          <div className="section-head">
            <div>
              <div className="eyebrow">{t(lang, { zh: "治理快捷入口", en: "Governance shortcuts" })}</div>
              <div className="detail-title">{t(lang, { zh: "当前分段与关联动作", en: "Current segment and related actions" })}</div>
            </div>
            <span className="pill warn">{t(lang, governanceSectionLabel[governanceSection])}</span>
          </div>
          <div className="pill-row">
              {governanceSections.map((item) => (
                <button
                  className={`path-chip ${item === governanceSection ? "active" : ""}`}
                  key={item}
                  type="button"
                  disabled={!canManageGovernance}
                  onClick={() => navigate(dashboardRoutes.creatorGovernance(item))}
                >
                  {t(lang, governanceSectionLabel[item])}
                </button>
              ))}
          </div>
          <div className="section-note">
            {t(lang, {
              zh: "治理页不脱离当前 package 语境。右栏持续保留发布、灰度、审计和工作区绑定信息，避免只看到抽象策略名。",
              en: "Governance never leaves the current package context. The action rail keeps release, rollout, audit, and workspace bindings visible so the view never collapses into abstract policy labels.",
            })}
          </div>
          <div className="panel-inline-actions">
            <button
              className="route-btn"
              type="button"
              disabled={!canManageGovernance}
              onClick={() => handleAction("governance-policy")}
            >
              {t(lang, { zh: "运行策略", en: "Runtime policy" })}
            </button>
            <button
              className="route-btn"
              type="button"
              disabled={!canManageGovernance}
              onClick={() => handleAction("governance-audit")}
            >
              {t(lang, { zh: "审计中心", en: "Audit center" })}
            </button>
            <button
              className="route-btn active"
              type="button"
              disabled={!canManageGovernance}
              onClick={() => handleAction("governance-cost")}
            >
              {t(lang, { zh: "成本治理", en: "Cost governance" })}
            </button>
          </div>
        </article>
      ) : null}
    </div>
  );
}

export function CreatorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { packageId, section } = useParams();
  const lang = useDashboardUiStore((state) => state.lang);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "warn" | "active">("all");
  const currentWorkspaceId = useDashboardUiStore((state) => state.currentWorkspaceId);
  const authMode = useDashboardAuthStore((state) => state.authMode);
  const authenticated = useDashboardAuthStore((state) => state.authenticated);
  const authWorkspaces = useDashboardAuthStore((state) => state.workspaces);
  const authCurrentWorkspace = useDashboardAuthStore((state) => state.currentWorkspace);
  const activePackageId = useDashboardUiStore((state) => state.activePackageId);
  const setActivePackageId = useDashboardUiStore((state) => state.setActivePackageId);
  const creatorTab = useDashboardUiStore((state) => state.creatorTab);
  const setCreatorTab = useDashboardUiStore((state) => state.setCreatorTab);
  const currentWorkspace = useMemo(
    () =>
      resolveDashboardWorkspaceView({
        selectionId: currentWorkspaceId,
        workspaces: authWorkspaces.length > 0 ? authWorkspaces : undefined,
        fallbackWorkspace: authCurrentWorkspace,
      }),
    [authCurrentWorkspace, authWorkspaces, currentWorkspaceId]
  );
  const workspaceViews = useMemo(
    () => {
      const authViews = listDashboardWorkspaceViews(
        authMode === "required" ? authWorkspaces : undefined
      );
      if (authViews.length > 0) {
        return authViews;
      }

      return hasAuthoritativeDashboardWorkspaceContext(currentWorkspace)
        ? [currentWorkspace]
        : [];
    },
    [authMode, authWorkspaces, currentWorkspace]
  );
  const creatorAccess = useMemo(
    () =>
      resolveCreatorAccessState({
        authMode,
        authenticated,
        workspace: currentWorkspace,
      }),
    [authMode, authenticated, currentWorkspace]
  );
  const workspaceDataReady = hasAuthoritativeDashboardWorkspaceContext(currentWorkspace);
  const dataQueriesEnabled =
    workspaceDataReady &&
    authMode === "required" &&
    authenticated &&
    creatorAccess.canAccessCreator;
  const packagesQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "packages",
      currentWorkspace.selectionId,
      currentWorkspace.id,
    ],
    queryFn: async () =>
      dashboardCreatorApi.listPackages({
        workspaceContextKey: currentWorkspace.id,
      }),
    enabled: dataQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const detailPackageId =
    activePackageId &&
    packagesQuery.data?.some((item) => item.packageId === activePackageId)
      ? activePackageId
      : "";
  const packageDetailQuery = useQuery({
    queryKey: ["dashboard", "creator", "package", detailPackageId],
    queryFn: async () => {
      if (!detailPackageId) {
        return null;
      }

      return dashboardCreatorApi.getPackage(detailPackageId);
    },
    enabled: dataQueriesEnabled && Boolean(detailPackageId),
    retry: false,
    staleTime: 30_000,
  });
  const workshopsQuery = useQuery({
    queryKey: ["dashboard", "catalog", "workshops", currentWorkspace.id],
    queryFn: async () =>
      dashboardCatalogApi.listWorkshops({
        workspaceContextKey: currentWorkspace.id,
      }),
    enabled: dataQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const servicesQuery = useQuery({
    queryKey: ["dashboard", "catalog", "services", currentWorkspace.id],
    queryFn: async () =>
      dashboardCatalogApi.listServices({
        workspaceContextKey: currentWorkspace.id,
      }),
    enabled: dataQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });

  const isDebugRoute = location.pathname.endsWith("/debug");
  const isGovernanceRoute = location.pathname.includes("/creator/governance");
  const governanceSection = isGovernanceSection(section) ? section : "credentials";
  const visiblePackages = useMemo(
    () =>
      creatorAccess.canAccessCreator ? (packagesQuery.data ?? []).map(mapCreatorPackageSummary) : [],
    [
      creatorAccess.canAccessCreator,
      packagesQuery.data,
    ]
  );
  const routePackage = packageId
    ? visiblePackages.find((item) => item.id === packageId) ?? null
    : null;
  const filteredPackages = useMemo(() => {
    return visiblePackages.filter((item) => {
      const statusMatched = statusFilter === "all" || item.statusClass === statusFilter;

      if (!statusMatched) {
        return false;
      }

      return matchesSearchQuery(searchQuery, [
        item.id,
        item.title.zh,
        item.title.en,
        item.source.zh,
        item.source.en,
        item.status.zh,
        item.status.en,
        item.ownerLabel.zh,
        item.ownerLabel.en,
        item.releaseChannel.zh,
        item.releaseChannel.en,
        ...item.versionLine,
      ]);
    });
  }, [searchQuery, statusFilter, visiblePackages]);

  useEffect(() => {
    if (routePackage) {
      if (routePackage.id !== activePackageId) {
        setActivePackageId(routePackage.id);
      }
      return;
    }

    if (packageId) {
      if (activePackageId) {
        setActivePackageId("");
      }
      return;
    }

    const fallbackPackage = visiblePackages[0];
    if (fallbackPackage && fallbackPackage.id !== activePackageId) {
      setActivePackageId(fallbackPackage.id);
      if (!isGovernanceRoute) {
        navigate(dashboardRoutes.creatorPackage(fallbackPackage.id), { replace: true });
      }
      return;
    }

    if (!fallbackPackage && activePackageId) {
      setActivePackageId("");
    }
  }, [
    activePackageId,
    isGovernanceRoute,
    navigate,
    packageId,
    routePackage,
    setActivePackageId,
    visiblePackages,
  ]);

  const selectedVisiblePackage = visiblePackages.find((item) => item.id === activePackageId) ?? null;
  const pkg =
    (packageDetailQuery.data ? mapCreatorPackageDetail(packageDetailQuery.data) : null) ??
    selectedVisiblePackage ??
    visiblePackages[0] ??
    null;
  const catalogWorkshops = workshopsQuery.data ?? EMPTY_WORKSHOPS;
  const catalogServices = servicesQuery.data ?? EMPTY_SERVICES;
  const relatedWorkshops = useMemo(
    () =>
      pkg == null
        ? []
        : pkg.linkedWorkshopIds.map((workshopId) => {
            const catalogMatch = catalogWorkshops.find((item) => item.workshopId === workshopId);
            if (catalogMatch) {
              return mapCatalogWorkshopReference(catalogMatch);
            }

            return buildUnresolvedWorkshopReference(workshopId);
          }),
    [catalogWorkshops, pkg]
  );
  const relatedServices = useMemo(
    () =>
      pkg == null
        ? []
        : pkg.linkedServiceIds.map((serviceId) => {
            const catalogMatch = catalogServices.find((item) => item.serviceId === serviceId);
            if (catalogMatch) {
              return mapCatalogServiceReference(catalogMatch);
            }

            return buildUnresolvedServiceReference(serviceId);
          }),
    [catalogServices, pkg]
  );
  const boundWorkspaces = useMemo(
    () => (pkg == null ? [] : workspaceViews.filter((item) => pkg.workspaceContextKeys.includes(item.id))),
    [pkg, workspaceViews]
  );
  const visibleWorkshopCount = workshopsQuery.data?.length ?? 0;
  const pendingAuditCount = visiblePackages.filter((item) => item.statusClass === "warn").length;
  const creatorAccessNote =
    creatorAccess.reason === "membership-suspended"
      ? t(lang, {
          zh: "当前工作区成员资格已暂停，Creator 包、发布与治理入口已锁定。",
          en: "Workspace membership is suspended, so Creator packages, release actions, and governance are locked.",
        })
      : t(lang, {
          zh: "当前工作区角色不具备 Creator 访问权限。请切换到具备 Creator 角色的工作区，或联系管理员调整成员角色。",
          en: "The current workspace role does not include Creator access. Switch to a workspace with Creator rights or ask an admin to update your membership.",
        });
  const governanceAccessNote = t(lang, {
    zh: "当前工作区允许浏览 Creator 包与回放信息，但治理动作只对 Owner / Admin 开放。",
    en: "This workspace can browse Creator packages and replay data, but governance actions are restricted to Owner and Admin roles.",
  });

  if (!creatorAccess.canAccessCreator) {
    return (
      <section className="view" data-testid="dashboard-creator-page">
        <article className="hero-card">
          <div className="section-head">
            <div>
              <div className="eyebrow">{t(lang, { zh: "Creator 工作台", en: "Creator Studio" })}</div>
              <h2 className="hero-title">
                {t(lang, {
                  zh: "当前工作区没有 Creator 访问权限",
                  en: "Creator access is unavailable in this workspace",
                })}
              </h2>
            </div>
            <span className="pill warn">{t(lang, currentWorkspace.name)}</span>
          </div>
          <div className="section-note">{creatorAccessNote}</div>
          <div className="metric-grid">
            {[
              {
                label: { zh: "当前角色", en: "Current role" },
                value: currentWorkspace.role ? currentWorkspace.role.toUpperCase() : "--",
                note: { zh: "角色决定 Creator 包与治理可见范围。", en: "Role determines Creator package and governance scope." },
              },
              {
                label: { zh: "工作区根路径", en: "Workspace root" },
                value: currentWorkspace.root,
                note: { zh: "切换工作区会同步切换实例、文件与 Creator 边界。", en: "Switching workspaces also switches runs, files, and Creator boundaries." },
              },
              {
                label: { zh: "成员状态", en: "Membership" },
                value: currentWorkspace.membershipStatus ?? "active",
                note: { zh: "暂停成员不会进入 Creator 域。", en: "Suspended memberships never enter the Creator domain." },
              },
            ].map((item) => (
              <div className="metric-card" key={t(lang, item.label)}>
                <div className="metric-label">{t(lang, item.label)}</div>
                <div className="metric-value">{item.value}</div>
                <div className="tiny-note">{t(lang, item.note)}</div>
              </div>
            ))}
          </div>
        </article>

        <div className="creator-layout">
          <div className="conversation-stack">
            <article className="package-card">
              <div className="list-title">
                {t(lang, { zh: "当前空间边界", en: "Current workspace boundary" })}
              </div>
              <div className="section-note">{t(lang, currentWorkspace.meta)}</div>
              <div className="meta">{currentWorkspace.root}</div>
            </article>
          </div>

          <div className="detail-stack">
            <article className="detail-card">
              <div className="section-head">
                <div>
                  <div className="eyebrow">{t(lang, { zh: "访问控制", en: "Access control" })}</div>
                  <div className="detail-title">
                    {t(lang, {
                      zh: "Creator 域保持严格按工作区角色收口",
                      en: "The Creator domain stays scoped by workspace role",
                    })}
                  </div>
                </div>
                <span className="pill warn">{currentWorkspace.role ?? "viewer"}</span>
              </div>
              <div className="detail-body">
                <div className="detail-item">
                  <div className="file-name">
                    {t(lang, { zh: "访问说明", en: "Access note" })}
                  </div>
                  <div className="meta">{creatorAccessNote}</div>
                </div>
                <div className="detail-item">
                  <div className="file-name">
                    {t(lang, { zh: "建议动作", en: "Suggested next step" })}
                  </div>
                  <div className="meta">
                    {t(lang, {
                      zh: "继续查看工坊与实例；如需发布、治理或调整私有能力，请切换到具备 Creator 权限的工作区。",
                      en: "Continue in Workshops or Instances. Switch to a workspace with Creator rights before publishing, governance, or private capability changes.",
                    })}
                  </div>
                </div>
              </div>
              <div className="panel-inline-actions">
                <button className="route-btn" type="button" onClick={() => navigate(dashboardRoutes.workshops)}>
                  {t(lang, { zh: "返回工坊", en: "Open workshops" })}
                </button>
                <button className="route-btn active" type="button" onClick={() => navigate(dashboardRoutes.instances)}>
                  {t(lang, { zh: "查看实例", en: "Open instances" })}
                </button>
              </div>
            </article>
          </div>

          <div className="creator-rail">
            <article className="detail-card creator-ops-card">
              <div className="section-head">
                <div>
                  <div className="eyebrow">{t(lang, { zh: "权限矩阵", en: "Permission matrix" })}</div>
                  <div className="detail-title">
                    {t(lang, { zh: "当前 Creator 入口状态", en: "Current Creator surface state" })}
                  </div>
                </div>
                <span className="pill">{t(lang, currentWorkspace.type)}</span>
              </div>
              <div className="detail-body">
                <div className="detail-item">
                  <div className="card-row">
                    <div className="file-name">{t(lang, { zh: "Package 详情", en: "Package detail" })}</div>
                    <span className="pill warn">{t(lang, { zh: "关闭", en: "Closed" })}</span>
                  </div>
                </div>
                <div className="detail-item">
                  <div className="card-row">
                    <div className="file-name">{t(lang, { zh: "调试回放", en: "Debug replay" })}</div>
                    <span className="pill warn">{t(lang, { zh: "关闭", en: "Closed" })}</span>
                  </div>
                </div>
                <div className="detail-item">
                  <div className="card-row">
                    <div className="file-name">{t(lang, { zh: "治理动作", en: "Governance actions" })}</div>
                    <span className="pill warn">{t(lang, { zh: "关闭", en: "Closed" })}</span>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
    );
  }

  if (pkg == null) {
    return (
      <section className="view" data-testid="dashboard-creator-page">
        <article className="hero-card">
          <div className="section-head">
            <div>
              <div className="eyebrow">{t(lang, { zh: "Creator 工作台", en: "Creator Studio" })}</div>
              <h2 className="hero-title">
                {t(lang, { zh: "当前工作区还没有 Creator 包", en: "No Creator package is available in this workspace yet" })}
              </h2>
            </div>
            <span className="pill active">{t(lang, currentWorkspace.name)}</span>
          </div>
          <div className="section-note">
            {t(lang, {
              zh: "当前页已经切到真实工作区数据链。未发布 package 时不再回退到样例包，避免把不存在的资产展示成可维护对象。",
              en: "This page now follows the authoritative workspace data chain. When no package is published, it no longer falls back to sample packages that do not exist in this workspace.",
            })}
          </div>
        </article>

        <div className="creator-layout">
          <div className="conversation-stack">
            <article className="filter-card">
              <div className="section-head">
                <div>
                  <div className="eyebrow">{t(lang, { zh: "包筛选", en: "Package filters" })}</div>
                  <div className="detail-title">{t(lang, { zh: "当前没有可选包", en: "There is no package to select" })}</div>
                </div>
                <span className="pill active">00</span>
              </div>
              <div className="section-note">
                {t(lang, {
                  zh: "先在 Creator 发布链路里创建或激活 package，然后它才会出现在这里。",
                  en: "Create or activate a package through the Creator release flow before it appears here.",
                })}
              </div>
            </article>
          </div>

          <div className="detail-stack">
            <article className="detail-card">
              <div className="section-head">
                <div>
                  <div className="eyebrow">{t(lang, { zh: "当前状态", en: "Current state" })}</div>
                  <div className="detail-title">{t(lang, { zh: "没有虚构包回填", en: "No fabricated package fallback" })}</div>
                </div>
                <span className="pill warn">00</span>
              </div>
              <div className="detail-body">
                <div className="detail-item">
                  <div className="file-name">{t(lang, { zh: "工作区", en: "Workspace" })}</div>
                  <div className="meta">{t(lang, currentWorkspace.name)}</div>
                </div>
                <div className="detail-item">
                  <div className="file-name">{t(lang, { zh: "根路径", en: "Root path" })}</div>
                  <div className="meta">{currentWorkspace.root}</div>
                </div>
                <div className="detail-item">
                  <div className="file-name">{t(lang, { zh: "后续动作", en: "Next step" })}</div>
                  <div className="meta">
                    {t(lang, {
                      zh: "发布一个 Creator 包，或切换到已经有包的工作区。包一旦发布，这里会直接显示真实版本线、绑定关系和治理数据。",
                      en: "Publish a Creator package or switch to a workspace that already has one. Once a package exists, this surface will show its real version line, bindings, and governance data.",
                    })}
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view" data-testid="dashboard-creator-page">
      <article className="hero-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "Creator 工作台", en: "Creator Studio" })}</div>
            <h2 className="hero-title">{t(lang, { zh: "按 package 管理，工程细节进入独立页面", en: "Manage by package with dedicated pages for engineering detail" })}</h2>
          </div>
          <span className="pill active">dashboard://creator</span>
        </div>
        <div className="section-note">{t(lang, { zh: "Creator 工作区固定拆成 package 详情、调试回放与治理设置三类入口。运行镜像、凭证边界、发布审核与成本治理都能通过深链路由直达。", en: "The Creator workspace is fixed into package detail, debug replay, and governance entry points. Runtime images, secret boundaries, release review, and cost governance are all deep-linkable." })}</div>
        <div className="metric-grid">
          {[
            { label: { zh: "session 包", en: "Session packages" }, value: String(visiblePackages.length).padStart(2, "0"), note: { zh: "当前工作区下可维护的 package。", en: "Packages maintainable inside the current workspace." } },
            { label: { zh: "可发布工坊", en: "Releasable workshops" }, value: String(visibleWorkshopCount).padStart(2, "0"), note: { zh: "按工作区和能力策略发布。", en: "Released by workspace and capability policy." } },
            { label: { zh: "待审计", en: "Pending audit" }, value: String(pendingAuditCount).padStart(2, "0"), note: { zh: "重点看脱敏与凭证注入。", en: "Focused on desensitization and secret injection." } },
          ].map((item) => (
            <div className="metric-card" key={t(lang, item.label)}>
              <div className="metric-label">{t(lang, item.label)}</div>
              <div className="metric-value">{item.value}</div>
              <div className="tiny-note">{t(lang, item.note)}</div>
            </div>
          ))}
        </div>
      </article>

      <div className="creator-layout">
        <div className="conversation-stack">
          <article className="filter-card">
            <div className="section-head">
              <div>
                <div className="eyebrow">{t(lang, { zh: "包筛选", en: "Package Filters" })}</div>
                <div className="detail-title">{t(lang, { zh: "按包收敛 Creator 视图", en: "Converge Creator by package" })}</div>
              </div>
              <span className="pill active">{filteredPackages.length}</span>
            </div>
            <label className="fake-input">
              <svg
                className="icon"
                style={{ display: "inline-block", verticalAlign: -4, width: 14, height: 14, marginRight: 6 }}
              >
                <use href="#i-search" />
              </svg>
              <input
                className="search-inline-input"
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t(lang, {
                  zh: "搜索包名、来源、发布通道或版本线",
                  en: "Search by package, source, release channel, or version line",
                })}
              />
            </label>
            <div className="pill-row">
              {[
                { key: "all" as const, label: { zh: "全部", en: "All" } },
                { key: "success" as const, label: { zh: "已审计", en: "Audited" } },
                { key: "warn" as const, label: { zh: "待发布", en: "Pending" } },
                { key: "active" as const, label: { zh: "可发布", en: "Ready" } },
              ].map((item) => (
                <button
                  className={`path-chip ${statusFilter === item.key ? "active" : ""}`}
                  key={item.key}
                  type="button"
                  onClick={() => setStatusFilter(item.key)}
                >
                  {t(lang, item.label)}
                </button>
              ))}
            </div>
            <div className="section-note">
              {t(lang, {
                zh: "Creator 只管理包、回放与治理，不在这里混入实例会话级对话信息。",
                en: "Creator manages packages, replay, and governance only; instance-level live conversations stay out of this workspace.",
              })}
            </div>
          </article>
          {filteredPackages.length === 0 ? (
            <article className="package-card">
              <div className="list-title">{t(lang, { zh: "没有匹配包", en: "No matched packages" })}</div>
              <div className="section-note">
                {t(lang, {
                  zh: "清空搜索词或切换状态筛选后再试。当前工作区不会显示跨工作区 package。",
                  en: "Clear the query or switch the status filter. Packages never spill across workspaces.",
                })}
              </div>
            </article>
          ) : null}
          {filteredPackages.map((item) => (
            <article className={`package-card ${item.id === activePackageId ? "active" : ""}`} key={item.id}>
              <button className="card-hit" type="button" onClick={() => navigate(dashboardRoutes.creatorPackage(item.id))}>
                <div className="instance-head">
                  <div className="list-title">{t(lang, item.title)}</div>
                  <span className={`pill ${item.statusClass}`}>{t(lang, item.status)}</span>
                </div>
                <div className="meta">{t(lang, item.source)}</div>
                <div className="meta">
                  {t(lang, item.ownerLabel)} / {item.updatedAt}
                </div>
                <div className="pill-row">
                  <span className="path-chip active">{item.id}</span>
                  <span className="path-chip">{item.linkedServiceIds.length} svc</span>
                </div>
                <div className="section-note">{t(lang, item.releaseChannel)}</div>
              </button>
            </article>
          ))}
        </div>

        <div className="detail-stack">
          <article className="detail-card">
            <div className="section-head">
              <div>
                <div className="eyebrow">
                  {isGovernanceRoute
                    ? t(lang, { zh: "治理设置", en: "Governance" })
                    : isDebugRoute
                      ? t(lang, { zh: "调试回放", en: "Debug Replay" })
                      : t(lang, { zh: "当前 package", en: "Selected Package" })}
                </div>
                <div className="detail-title">
                  {isGovernanceRoute
                    ? t(lang, { zh: "平台治理面板", en: "Platform governance panel" })
                    : t(lang, pkg.title)}
                </div>
                <div className="meta">{t(lang, pkg.source)}</div>
              </div>
              <span className={`pill ${pkg.statusClass}`}>{t(lang, pkg.status)}</span>
            </div>
            <img className="cover" src={dashboardAssets.runtime} alt={t(lang, { zh: "运行结构图", en: "Runtime map" })} />

            <div className="task-row">
              <button className={`route-btn ${!isDebugRoute && !isGovernanceRoute ? "active" : ""}`} type="button" onClick={() => navigate(dashboardRoutes.creatorPackage(pkg.id))}>
                {t(lang, { zh: "包详情", en: "Package detail" })}
              </button>
              <button className={`route-btn ${isDebugRoute ? "active" : ""}`} type="button" onClick={() => navigate(dashboardRoutes.creatorDebug(pkg.id))}>
                {t(lang, { zh: "调试回放", en: "Debug replay" })}
              </button>
              <button
                className={`route-btn ${isGovernanceRoute ? "active" : ""}`}
                type="button"
                disabled={!creatorAccess.canManageCreatorGovernance}
                onClick={() => navigate(dashboardRoutes.creatorGovernance(governanceSection))}
              >
                {t(lang, { zh: "治理设置", en: "Governance" })}
              </button>
            </div>

            <div className="quick-grid">
              <div className="quick-box">
                <div className="quick-label">{t(lang, { zh: "所有者", en: "Owner" })}</div>
                <div className="quick-value">{t(lang, pkg.ownerLabel)}</div>
              </div>
              <div className="quick-box">
                <div className="quick-label">{t(lang, { zh: "最后回放时间", en: "Last replay" })}</div>
                <div className="quick-value">{pkg.updatedAt}</div>
              </div>
              <div className="quick-box">
                <div className="quick-label">{t(lang, { zh: "发布通道", en: "Release channel" })}</div>
                <div className="quick-value">{t(lang, pkg.releaseChannel)}</div>
              </div>
            </div>

            {isGovernanceRoute ? (
              <>
                <div className="subtab-row">
                  {governanceSections.map((item) => (
                    <button
                      className={`subtab-btn ${governanceSection === item ? "active" : ""}`}
                      key={item}
                      type="button"
                      disabled={!creatorAccess.canManageCreatorGovernance}
                      onClick={() => navigate(dashboardRoutes.creatorGovernance(item))}
                    >
                      {t(lang, governanceSectionLabel[item])}
                    </button>
                  ))}
                </div>
                {creatorAccess.canManageCreatorGovernance ? (
                  <CreatorGovernancePanel
                    packageId={pkg.id}
                    section={governanceSection}
                    meta={governanceMeta[governanceSection]}
                    workspaceLabel={currentWorkspace.name}
                    workspaceRuntimeId={currentWorkspace.runtimeWorkspaceId}
                    workspaceContextKey={currentWorkspace.contextKey}
                    linkedServiceIds={pkg.linkedServiceIds}
                  />
                ) : (
                  <div className="detail-body">
                    <div className="detail-item">
                      <div className="file-name">{t(lang, { zh: "治理访问受限", en: "Governance access restricted" })}</div>
                      <div className="meta">{governanceAccessNote}</div>
                    </div>
                    <div className="panel-inline-actions">
                      <button
                        className="route-btn"
                        type="button"
                        onClick={() => navigate(dashboardRoutes.creatorPackage(pkg.id))}
                      >
                        {t(lang, { zh: "返回包详情", en: "Back to package detail" })}
                      </button>
                      <button
                        className="route-btn active"
                        type="button"
                        onClick={() => navigate(dashboardRoutes.creatorDebug(pkg.id))}
                      >
                        {t(lang, { zh: "打开回放", en: "Open replay" })}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : isDebugRoute ? (
              <CreatorDebugPanel packageId={pkg.id} />
            ) : (
              <>
                <div className="detail-body">
                  <div className="detail-item">
                    <div className="file-name">{t(lang, { zh: "关联工坊", en: "Linked workshops" })}</div>
                    <div className="pill-row">
                      {relatedWorkshops.map((item) => (
                        <span className="path-chip active" key={item.id}>
                          {t(lang, item.title)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="detail-item">
                    <div className="file-name">{t(lang, { zh: "关联服务", en: "Linked services" })}</div>
                    {relatedServices.map((item) => (
                      <div className="meta" key={item.id}>
                        {t(lang, item.name)} / {item.targetPath}
                      </div>
                    ))}
                  </div>
                  <div className="detail-item">
                    <div className="file-name">{t(lang, { zh: "版本线", en: "Version line" })}</div>
                    {pkg.versionLine.map((item) => (
                      <div className="route-code" key={item}>
                        {item}
                      </div>
                    ))}
                  </div>
                  <div className="detail-item">
                    <div className="file-name">{t(lang, { zh: "依赖摘要", en: "Dependency summary" })}</div>
                    {pkg.dependencies.map((item) => (
                      <div className="meta" key={t(lang, item)}>
                        {t(lang, item)}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="subtab-row">
                  {creatorTabs.map(({ key, label }) => (
                    <button
                      className={`subtab-btn ${creatorTab === key ? "active" : ""}`}
                      key={key}
                      type="button"
                      onClick={() => setCreatorTab(key)}
                    >
                      {t(lang, label)}
                    </button>
                  ))}
                </div>
                <CreatorTabPanel
                  pkg={pkg}
                  availableWorkspaceContextKeys={pkg.workspaceContextKeys}
                  defaultWorkspaceContextKey={currentWorkspace.id}
                  queriesEnabled={dataQueriesEnabled}
                />
              </>
            )}
          </article>
        </div>

        <CreatorOperationsRail
          boundWorkspaces={boundWorkspaces}
          canManageGovernance={creatorAccess.canManageCreatorGovernance}
          governanceSection={governanceSection}
          isGovernanceRoute={isGovernanceRoute}
          pkg={pkg}
          queriesEnabled={dataQueriesEnabled}
          relatedServices={relatedServices}
          relatedWorkshops={relatedWorkshops}
        />
      </div>

      <details className="tech-details">
        <summary>{t(lang, { zh: "查看 Creator 技术详情", en: "Show creator technical details" })}</summary>
        <div className="tech-body">
          <div className="tech-grid">
            <div className="tech-box">
              <h4>{t(lang, { zh: "标准容器策略", en: "Standard container policy" })}</h4>
              <div className="route-code">ubuntu:24.04</div>
              <div className="route-code">codex-cli / node / python</div>
              <div className="route-code">playwright / browser bridge</div>
            </div>
            <div className="tech-box">
              <h4>{t(lang, { zh: "输出契约目录", en: "Output contract paths" })}</h4>
              <div className="route-code">/workspace/&lt;task-id&gt;/receipts/</div>
              <div className="route-code">/workspace/&lt;task-id&gt;/output/</div>
              <div className="route-code">/workspace/&lt;task-id&gt;/archive/</div>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}
