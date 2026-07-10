import type {
  CreatorPackageDetail,
  CreatorPackageSummary,
  CreatorReleaseActivation,
  CreatorReleaseGate,
  CreatorReleaseSummary,
  CreatorReplaySummary,
  ServiceCatalogEntry,
  WorkshopCatalogEntry,
} from "@lingban/contracts";
import { matchesSearchQuery } from "@lingban/domain-models";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { CreatorTab } from "../../data/dashboardData";
import { creatorPackages, dashboardAssets, dashboardServices, workshops } from "../../data/dashboardData";
import { isCreatorGovernanceTarget, resolveCreatorAccessState } from "../../lib/accessControl";
import { dashboardCatalogApi, dashboardCreatorApi } from "../../lib/api";
import { l, t, type LocalizedString } from "../../lib/i18n";
import { dashboardRoutes, governanceSections, isGovernanceSection, type GovernanceSection } from "../../lib/routes";
import { listDashboardWorkspaceViews, resolveDashboardWorkspaceView } from "../../lib/workspaceContext";
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

function buildFallbackCreatorPackageView(
  packageId: string,
  workspaceContextKey: string
): CreatorPackageView {
  const fallbackPackage = creatorPackages[packageId] ?? creatorPackages["chrome-tax-runner"];
  const workspace = resolveDashboardWorkspaceView({
    selectionId: workspaceContextKey,
  });

  return {
    id: fallbackPackage.id,
    title: fallbackPackage.title,
    source: fallbackPackage.source,
    status: fallbackPackage.status,
    statusClass: fallbackPackage.statusClass,
    ownerLabel: workspace.name,
    updatedAt: "--",
    releaseChannel: l("静态回退", "Static fallback"),
    workspaceContextKeys: [workspace.id],
    linkedWorkshopIds: [],
    linkedServiceIds: [],
    versionLine: [],
    dependencies: [],
    session: fallbackPackage.session,
    runtime: fallbackPackage.runtime,
    connectors: fallbackPackage.connectors,
    release: fallbackPackage.release,
  };
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

function findFallbackWorkshopReference(workshopId: string): RelatedWorkshopReference | null {
  const matched = workshops.find((item) => item.id === workshopId);
  if (!matched) {
    return null;
  }

  return {
    id: matched.id,
    title: matched.title,
  };
}

function findFallbackServiceReference(serviceId: string): RelatedServiceReference | null {
  const matched = dashboardServices.find((item) => item.id === serviceId);
  if (!matched) {
    return null;
  }

  return {
    id: matched.id,
    name: matched.name,
    targetPath: matched.targetPath,
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

const governanceMeta: Record<GovernanceSection, GovernanceMeta> = {
  credentials: {
    title: l("凭证与注入策略", "Credentials and injection policy"),
    summary: l(
      "治理页需要同时回答三件事：哪些凭证已经挂载、哪些是第三方引用、哪些凭证需要轮换或收敛作用域。",
      "The governance page must answer three questions together: which secrets are mounted, which stay as third-party refs, and which need rotation or tighter scoping."
    ),
    actions: [l("导出凭证清单", "Export credential ledger"), l("检查轮换计划", "Review rotation plan")],
    metrics: [
      { label: l("第一方挂载", "First-party mounts"), value: "04", note: l("实例启动即挂载。", "Mounted at run boot.") },
      { label: l("第三方引用", "Third-party refs"), value: "03", note: l("只保存 connector ref。", "Only connector refs are retained.") },
      { label: l("待轮换", "Rotation due"), value: "01", note: l("下一个 7 天内到期。", "Expires within the next 7 days.") },
    ],
    headers: [l("凭证域", "Credential domain"), l("作用范围", "Scope"), l("状态", "State"), l("注入方式", "Injection mode")],
    rows: [
      {
        id: "cred-otp",
        tone: "success",
        cells: [
          l("企业邮箱 OTP", "Enterprise OTP"),
          l("华港财务组 / tax-filing", "Harbor Finance / tax-filing"),
          l("已连接", "Connected"),
          l("只读 secret mount，提交前回到审批节点。", "Readonly secret mount, returns to approval before submit."),
        ],
      },
      {
        id: "cred-seedance",
        tone: "active",
        cells: [
          l("Seedance API", "Seedance API"),
          l("品牌内容组 / creator-drama", "Brand Content / creator-drama"),
          l("引用中", "Referenced"),
          l("仅保存 connector ref，不烘焙进 session 包。", "Only the connector ref is stored and never baked into the session package."),
        ],
      },
      {
        id: "cred-image",
        tone: "warn",
        cells: [
          l("私有图像 Key", "Private image key"),
          l("个人空间 + 品牌内容工坊", "Personal + brand-content workshop"),
          l("7 天内轮换", "Rotate in 7 days"),
          l("按账户只读挂载，实例结束后容器销毁。", "Readonly per-account mount, destroyed with the container."),
        ],
      },
    ],
  },
  members: {
    title: l("成员与空间边界", "Members and workspace boundaries"),
    summary: l(
      "工作区、包权限和实例查看权限必须成套展示，避免 Creator 侧只看到角色名而看不到实际可见范围。",
      "Workspace, package access, and run visibility must be shown together so Creator never sees role names without their effective scope."
    ),
    actions: [l("导出成员矩阵", "Export member matrix"), l("检查空间边界", "Review workspace boundaries")],
    metrics: [
      { label: l("工作区", "Workspaces"), value: "03", note: l("个人 + 2 个企业空间。", "Personal plus 2 enterprise spaces.") },
      { label: l("Creator 角色", "Creator roles"), value: "05", note: l("区分发布、审计、治理。", "Split across release, audit, and governance.") },
      { label: l("可接管实例", "Takeover-capable"), value: "02", note: l("具备实例接管权限。", "Can take over live runs.") },
    ],
    headers: [l("成员 / 角色", "Member / role"), l("可见范围", "Visible scope"), l("实例权限", "Run access"), l("包权限", "Package access")],
    rows: [
      {
        id: "member-finance",
        tone: "success",
        cells: [
          l("李宁 / 财务成员", "Li Ning / finance operator"),
          l("华港财务组", "Harbor Finance Team"),
          l("只读实例 + 提交审批", "Read runs + approve submit"),
          l("只读 chrome-tax-runner", "Readonly chrome-tax-runner"),
        ],
      },
      {
        id: "member-director",
        tone: "active",
        cells: [
          l("许导 / 内容导演", "Director Xu / content lead"),
          l("品牌内容组 + 个人空间", "Brand Content + Personal"),
          l("查看、追问、补充导演意见", "Read, follow up, add director notes"),
          l("可发布 creator-drama-suite", "Can release creator-drama-suite"),
        ],
      },
      {
        id: "member-admin",
        tone: "warn",
        cells: [
          l("系统管理员 / Governance", "System admin / governance"),
          l("全部工作区", "All workspaces"),
          l("查看全部实例与审计账本", "Read all runs and audit ledgers"),
          l("可治理全部 package 与凭证域", "Can govern all packages and secret domains"),
        ],
      },
    ],
  },
  policy: {
    title: l("运行与审批策略", "Runtime and approval policy"),
    summary: l(
      "治理页中的策略必须直接对应实例行为，包括浏览器审批、路径白名单和容器销毁策略。",
      "Policies shown in governance must map directly to runtime behavior, including browser approvals, path allowlists, and container teardown."
    ),
    actions: [l("查看策略快照", "View policy snapshot"), l("导出白名单", "Export allowlists")],
    metrics: [
      { label: l("浏览器敏感动作", "Sensitive browser actions"), value: "审批后执行", note: l("提交、支付、确认类动作。", "Submit, pay, and confirm actions.") },
      { label: l("路径白名单", "Path allowlists"), value: "03 层", note: l("root / output / archive。", "root / output / archive.") },
      { label: l("容器策略", "Container policy"), value: "独占销毁", note: l("实例关闭即销毁。", "Destroyed on instance close.") },
    ],
    headers: [l("策略项", "Policy"), l("作用域", "Scope"), l("当前值", "Current value"), l("执行说明", "Execution note")],
    rows: [
      {
        id: "policy-browser",
        tone: "warn",
        cells: [
          l("浏览器高风险动作", "High-risk browser actions"),
          l("tax-filing / poster-batch", "tax-filing / poster-batch"),
          l("审批节点强制开启", "Approval node required"),
          l("提交、支付、删除类动作全部回到对话流。", "All submit, payment, and destructive actions return to the conversation."),
        ],
      },
      {
        id: "policy-path",
        tone: "success",
        cells: [
          l("文件路径白名单", "File path allowlist"),
          l("全部实例", "All runs"),
          l("/workspace/<task-id>/*", "/workspace/<task-id>/*"),
          l("允许切目录，不允许越出实例根路径。", "Directory switches are allowed, but leaving the task root is forbidden."),
        ],
      },
      {
        id: "policy-container",
        tone: "active",
        cells: [
          l("独占容器生命周期", "Dedicated container lifecycle"),
          l("全部实例", "All runs"),
          l("实例关闭即销毁", "Destroy on close"),
          l("结果目录与审计目录保留，运行容器不复用。", "Output and audit directories remain while runtime containers are never reused."),
        ],
      },
    ],
  },
  audit: {
    title: l("审计与发布留痕", "Audit and release ledger"),
    summary: l(
      "这里要覆盖发布前脱敏、调试回放、实例级导出三条链路，保证 session 包与运行结果都能被追溯。",
      "This view must cover pre-release desensitization, debug replay, and per-run exports so both packages and results remain traceable."
    ),
    actions: [l("导出审计 JSON", "Export audit JSON"), l("查看回放摘要", "Open replay summary")],
    metrics: [
      { label: l("待审计发布", "Pending releases"), value: "01", note: l("creator-drama-suite 待复核。", "creator-drama-suite awaits review.") },
      { label: l("回放保留期", "Replay retention"), value: "90d", note: l("工具调用与路径差异保留 90 天。", "Tool calls and filesystem diffs are kept for 90 days.") },
      { label: l("实例导出", "Run exports"), value: "支持", note: l("按实例导出 JSON 与摘要。", "Per-run JSON and summary export is enabled.") },
    ],
    headers: [l("留痕对象", "Ledger object"), l("来源", "Source"), l("保留策略", "Retention"), l("当前状态", "Current status")],
    rows: [
      {
        id: "audit-release",
        tone: "warn",
        cells: [
          l("发布前脱敏清单", "Pre-release desensitization"),
          l("creator-drama-suite", "creator-drama-suite"),
          l("发布前必做", "Required before release"),
          l("剩余 1 项路径引用复核。", "One path-reference review item remains."),
        ],
      },
      {
        id: "audit-trace",
        tone: "success",
        cells: [
          l("Debug 回放", "Debug replay"),
          l("chrome-tax-runner", "chrome-tax-runner"),
          l("90 天", "90 days"),
          l("消息时序、工具调用和路径差异均可回放。", "Message order, tool calls, and path diffs are all replayable."),
        ],
      },
      {
        id: "audit-export",
        tone: "active",
        cells: [
          l("实例结果导出", "Per-run export"),
          l("tax-q2 / poster-batch-17", "tax-q2 / poster-batch-17"),
          l("结果目录长期保留", "Retained with result directories"),
          l("支持导出审计 JSON、摘要和结果回执。", "Can export audit JSON, summaries, and final receipts."),
        ],
      },
    ],
  },
  cost: {
    title: l("成本与额度治理", "Cost and quota governance"),
    summary: l(
      "成本页要把工作区、账户和 package 维度的额度拆清楚，超额时必须能回到审批链路。",
      "The cost view must separate workspace, account, and package quotas clearly and route overages back into the approval flow."
    ),
    actions: [l("导出成本摘要", "Export cost summary"), l("查看额度阈值", "Inspect quota thresholds")],
    metrics: [
      { label: l("浏览器分钟", "Browser minutes"), value: "126", note: l("按工作区单独计量。", "Metered per workspace.") },
      { label: l("图像额度", "Image quota"), value: "72%", note: l("个人空间与品牌工坊分开结算。", "Personal and brand-content spaces are billed separately.") },
      { label: l("超额回流", "Overage callback"), value: "开启", note: l("超额动作回到审批节点。", "Overages route back to approval nodes.") },
    ],
    headers: [l("成本项", "Cost item"), l("计量域", "Metering scope"), l("当前使用", "Current usage"), l("阈值 / 动作", "Threshold / action")],
    rows: [
      {
        id: "cost-browser",
        tone: "success",
        cells: [
          l("浏览器执行分钟", "Browser execution minutes"),
          l("华港财务组", "Harbor Finance Team"),
          l("42 / 120 分钟", "42 / 120 min"),
          l("超过阈值后需继续审批。", "Crossing the threshold requires a new approval."),
        ],
      },
      {
        id: "cost-image",
        tone: "warn",
        cells: [
          l("图像生成额度", "Image-generation quota"),
          l("个人空间 + 品牌内容组", "Personal + Brand Content"),
          l("72 / 100 点", "72 / 100 credits"),
          l("剩余 28 点，建议收紧批量出图轮次。", "28 credits remain; reduce unnecessary batch generations."),
        ],
      },
      {
        id: "cost-api",
        tone: "active",
        cells: [
          l("外部 API 调用", "External API calls"),
          l("creator-drama-suite", "creator-drama-suite"),
          l("680 / 2000 调用", "680 / 2000 calls"),
          l("低于告警阈值，可继续灰度。", "Below the alert threshold and safe for staged rollout."),
        ],
      },
    ],
  },
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
}: {
  pkg: CreatorPackageView;
  availableWorkspaceContextKeys: string[];
  defaultWorkspaceContextKey: string;
}) {
  const lang = useDashboardUiStore((state) => state.lang);
  const creatorTab = useDashboardUiStore((state) => state.creatorTab);

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
        workspaces: authMode === "required" ? authWorkspaces : undefined,
        fallbackWorkspaceId: authCurrentWorkspace?.workspaceId,
      }),
    [authCurrentWorkspace?.workspaceId, authMode, authWorkspaces, currentWorkspaceId]
  );
  const workspaceViews = useMemo(
    () => listDashboardWorkspaceViews(authMode === "required" ? authWorkspaces : undefined),
    [authMode, authWorkspaces]
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
  const previewMode = authMode !== "required";
  const dataQueriesEnabled = authMode === "required" && authenticated && creatorAccess.canAccessCreator;
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
  const packageDetailQuery = useQuery({
    queryKey: ["dashboard", "creator", "package", activePackageId],
    queryFn: async () => {
      if (!activePackageId) {
        return null;
      }

      return dashboardCreatorApi.getPackage(activePackageId);
    },
    enabled: dataQueriesEnabled && Boolean(activePackageId),
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
      previewMode
        ? currentWorkspace.packageIds.map((item) =>
            buildFallbackCreatorPackageView(item, currentWorkspace.id)
          )
        : creatorAccess.canAccessCreator
          ? (packagesQuery.data ?? []).map(mapCreatorPackageSummary)
          : [],
    [
      creatorAccess.canAccessCreator,
      currentWorkspace.id,
      currentWorkspace.packageIds,
      packagesQuery.data,
      previewMode,
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
  const allowStaticCatalogFallback = previewMode || currentWorkspace.source !== "auth";
  const relatedWorkshops = useMemo(
    () =>
      pkg == null
        ? []
        : pkg.linkedWorkshopIds.map((workshopId) => {
            const catalogMatch = catalogWorkshops.find((item) => item.workshopId === workshopId);
            if (catalogMatch) {
              return mapCatalogWorkshopReference(catalogMatch);
            }

            return allowStaticCatalogFallback
              ? findFallbackWorkshopReference(workshopId) ?? buildUnresolvedWorkshopReference(workshopId)
              : buildUnresolvedWorkshopReference(workshopId);
          }),
    [allowStaticCatalogFallback, catalogWorkshops, pkg]
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

            return allowStaticCatalogFallback
              ? findFallbackServiceReference(serviceId) ?? buildUnresolvedServiceReference(serviceId)
              : buildUnresolvedServiceReference(serviceId);
          }),
    [allowStaticCatalogFallback, catalogServices, pkg]
  );
  const boundWorkspaces = useMemo(
    () => (pkg == null ? [] : workspaceViews.filter((item) => pkg.workspaceContextKeys.includes(item.id))),
    [pkg, workspaceViews]
  );
  const visibleWorkshopCount = previewMode
    ? currentWorkspace.workshopIds.length
    : workshopsQuery.data?.length ?? 0;
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
            <h2 className="hero-title">{t(lang, { zh: "按 package 管理，而不是把所有工程细节堆在一页", en: "Manage by package instead of stacking all engineering detail into one page" })}</h2>
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
