import { matchesSearchQuery } from "@lingban/domain-models";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { CreatorTab } from "../../data/dashboardData";
import { creatorPackages, dashboardAssets, dashboardServices, dashboardWorkspaces, workshops } from "../../data/dashboardData";
import { l, t, type LocalizedString } from "../../lib/i18n";
import { dashboardRoutes, governanceSections, isGovernanceSection, type GovernanceSection } from "../../lib/routes";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

const creatorTabs: Array<{ key: CreatorTab; label: { zh: string; en: string } }> = [
  { key: "session", label: { zh: "Session 包", en: "Session Package" } },
  { key: "runtime", label: { zh: "运行镜像", en: "Runtime" } },
  { key: "connectors", label: { zh: "Connectors", en: "Connectors" } },
  { key: "release", label: { zh: "发布审核", en: "Release & Audit" } },
];

type GovernanceMetric = {
  label: LocalizedString;
  value: string;
  note: LocalizedString;
};

type GovernanceRow = {
  id: string;
  tone: "" | "active" | "warn" | "success";
  cells: [LocalizedString, LocalizedString, LocalizedString, LocalizedString];
};

type GovernanceMeta = {
  title: LocalizedString;
  summary: LocalizedString;
  actions: LocalizedString[];
  metrics: GovernanceMetric[];
  headers: [LocalizedString, LocalizedString, LocalizedString, LocalizedString];
  rows: GovernanceRow[];
};

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

const packageMeta: Record<
  string,
  {
    owner: { zh: string; en: string };
    updatedAt: string;
    releaseChannel: { zh: string; en: string };
    workshopIds: string[];
    serviceIds: string[];
    versionLine: string[];
    dependencies: Array<{ zh: string; en: string }>;
  }
> = {
  "chrome-tax-runner": {
    owner: { zh: "华港财务组", en: "Harbor Finance Team" },
    updatedAt: "2026-07-07 09:54",
    releaseChannel: { zh: "企业财税工坊 / 私有发布", en: "Enterprise tax workshop / private release" },
    workshopIds: ["enterprise-tax"],
    serviceIds: ["tax-filing"],
    versionLine: ["sev_chrome_tax_runner@2026.07.1", "tsv_tax_filing@2026.07.3", "img: lingban-codex-runtime:2026.07"],
    dependencies: [
      { zh: "浏览器自动化 / OTP 凭证 / 审批节点", en: "Browser automation / OTP credentials / approval nodes" },
      { zh: "受控目标路径写入：receipts / output / archive", en: "Controlled target-path writes: receipts / output / archive" },
    ],
  },
  "creator-drama-suite": {
    owner: { zh: "内容导演组", en: "Content Director Group" },
    updatedAt: "2026-07-07 14:51",
    releaseChannel: { zh: "Creator 工坊 / 灰度", en: "Creator workshop / staged rollout" },
    workshopIds: ["creator-drama"],
    serviceIds: ["drama-storyboard"],
    versionLine: ["sev_creator_drama_suite@2026.07.2", "tsv_drama_storyboard@2026.07.4", "img: lingban-codex-runtime:2026.07"],
    dependencies: [
      { zh: "Seedance / 导演审稿回流 / 外部素材引用", en: "Seedance / director review callbacks / external asset references" },
      { zh: "长对话上下文与版本回放", en: "Long-form conversation context and replay" },
    ],
  },
  "brand-poster-suite": {
    owner: { zh: "品牌内容组", en: "Brand Content Team" },
    updatedAt: "2026-07-07 19:12",
    releaseChannel: { zh: "品牌内容工坊 / 正式发布", en: "Brand content workshop / production" },
    workshopIds: ["brand-poster-suite"],
    serviceIds: ["poster-batch"],
    versionLine: ["sev_brand_poster_suite@2026.07.5", "tsv_poster_batch@2026.07.6", "img: lingban-codex-runtime:2026.07"],
    dependencies: [
      { zh: "GPT Image 2 / 资产库引用 / 结果包回写", en: "GPT Image 2 / asset-library refs / bundle callback writes" },
      { zh: "私有图像 key 只读挂载", en: "Readonly private image-key mounts" },
    ],
  },
};

const creatorOperationMeta: Record<string, CreatorOperationMeta> = {
  "chrome-tax-runner": {
    summary: l(
      "当前更偏向企业复制与审计固化。发布动作应围绕组织模板复制、审批节点回放和 OTP 轮换检查展开。",
      "This package is focused on enterprise replication and audit hardening. Release actions should center on workspace templating, approval replay, and OTP rotation checks."
    ),
    metrics: [
      {
        label: l("发布状态", "Release state"),
        value: "Private",
        tone: "success",
        note: l("仅企业工作区可见。", "Visible only to enterprise workspaces."),
      },
      {
        label: l("复制准备度", "Replication readiness"),
        value: "82%",
        tone: "active",
        note: l("已固化路径与审批模板。", "Path and approval templates are already stabilized."),
      },
      {
        label: l("风险关注", "Risk focus"),
        value: "OTP",
        tone: "warn",
        note: l("轮换计划在 7 天内。", "Rotation plan is due within 7 days."),
      },
    ],
    actions: [
      {
        label: l("发布", "Publish"),
        tone: "active",
        hint: l("回到发布页签核对交付包。", "Return to the release tab and verify the delivery bundle."),
        target: "release",
      },
      {
        label: l("灰度", "Stage rollout"),
        tone: "success",
        hint: l("扩到下一个企业财税工作区。", "Expand to the next enterprise tax workspace."),
        target: "release",
      },
      {
        label: l("回滚", "Rollback"),
        tone: "warn",
        hint: l("先看调试回放中的审批差异。", "Inspect approval diffs in debug replay first."),
        target: "debug",
      },
      {
        label: l("停用", "Disable"),
        tone: "",
        hint: l("停用动作应联动运行策略。", "Disabling should be coordinated with runtime policy."),
        target: "governance-policy",
      },
      {
        label: l("调试", "Debug"),
        tone: "",
        hint: l("直达回放，核对真实会话链路。", "Jump into replay and verify the original run chain."),
        target: "debug",
      },
    ],
    rollout: [
      {
        title: l("企业私有发布", "Enterprise private release"),
        tone: "success",
        note: l("当前仅对华港财务组开放。", "Currently exposed only to Harbor Finance Team."),
      },
      {
        title: l("模板复制固化", "Template replication hardening"),
        tone: "active",
        note: l("审批节点、输出契约和目标路径已打包。", "Approval nodes, output contracts, and target paths are already bundled."),
      },
      {
        title: l("OTP 轮换复核", "OTP rotation review"),
        tone: "warn",
        note: l("凭证到期前需完成一次真实回放。", "One full replay is required before the secret expires."),
      },
    ],
    alerts: [
      {
        title: l("审计导出必保留", "Audit exports must remain enabled"),
        tone: "success",
        note: l("企业实例下载和审计 JSON 不能被关闭。", "Per-run downloads and audit JSON exports must stay enabled."),
      },
      {
        title: l("审批节点不可裁剪", "Approval nodes cannot be trimmed"),
        tone: "warn",
        note: l("任何提交类动作都必须保留对话回流。", "Every submit-class action must keep the conversation callback."),
      },
    ],
  },
  "creator-drama-suite": {
    summary: l(
      "当前核心是把导演意见回流、长对话上下文和素材引用边界一起收敛，再决定是否进入 Creator 工坊灰度。",
      "The current priority is to converge director feedback callbacks, long-context continuity, and asset-reference boundaries before entering creator-studio staged rollout."
    ),
    metrics: [
      {
        label: l("发布状态", "Release state"),
        value: "Pending",
        tone: "warn",
        note: l("待完成脱敏与预算策略。", "Desensitization and budget policy remain pending."),
      },
      {
        label: l("回放完整度", "Replay coverage"),
        value: "74%",
        tone: "active",
        note: l("已覆盖导演修订主链路。", "The director-revision primary flow is already covered."),
      },
      {
        label: l("风险关注", "Risk focus"),
        value: "Assets",
        tone: "warn",
        note: l("外部素材引用仍需收口。", "External asset references still need tighter governance."),
      },
    ],
    actions: [
      {
        label: l("发布", "Publish"),
        tone: "warn",
        hint: l("先回发布页签核对待补项。", "Return to the release tab and review remaining gaps."),
        target: "release",
      },
      {
        label: l("灰度", "Stage rollout"),
        tone: "active",
        hint: l("限定在 Creator 工坊内测范围。", "Limit the rollout to creator-studio preview."),
        target: "release",
      },
      {
        label: l("回滚", "Rollback"),
        tone: "",
        hint: l("回看分镜修订时序差异。", "Compare storyboard revision timing before rollback."),
        target: "debug",
      },
      {
        label: l("停用", "Disable"),
        tone: "",
        hint: l("停用前先收紧素材连接策略。", "Tighten asset-connector policy before disabling."),
        target: "governance-policy",
      },
      {
        label: l("调试", "Debug"),
        tone: "success",
        hint: l("查看导演意见回流与版本差异。", "Inspect director feedback callbacks and version diffs."),
        target: "debug",
      },
    ],
    rollout: [
      {
        title: l("Creator 工坊灰度", "Creator-studio staged rollout"),
        tone: "active",
        note: l("仅开放给内容导演和审稿角色。", "Only exposed to director and review roles."),
      },
      {
        title: l("预算策略补全", "Budget policy completion"),
        tone: "warn",
        note: l("长会话与外部素材仍需额度约束。", "Long conversations and asset imports still need quota enforcement."),
      },
      {
        title: l("多轮审稿模板", "Multi-pass review template"),
        tone: "success",
        note: l("消息流结构已经稳定。", "The message-flow structure is already stable."),
      },
    ],
    alerts: [
      {
        title: l("素材引用边界待收口", "Asset-reference boundary still open"),
        tone: "warn",
        note: l("当前只记录 ref，发布前要复核引用目录。", "Only refs are stored right now; review asset paths before release."),
      },
      {
        title: l("导演回流链路稳定", "Director callback chain is stable"),
        tone: "success",
        note: l("补充意见可直接回到同一会话流。", "Director notes already route back into the same conversation."),
      },
    ],
  },
  "brand-poster-suite": {
    summary: l(
      "这套包已经接近正式发布。当前更重要的是扩大品牌团队灰度范围，并把图像额度和选图回流策略写死在治理层。",
      "This package is close to production release. The next priority is widening the brand-team rollout and hardening image quotas plus selection callbacks in governance."
    ),
    metrics: [
      {
        label: l("发布状态", "Release state"),
        value: "Ready",
        tone: "active",
        note: l("可进入品牌团队正式发布。", "Ready for brand-team production release."),
      },
      {
        label: l("灰度范围", "Rollout scope"),
        value: "02",
        tone: "success",
        note: l("个人空间 + 品牌内容组。", "Personal workspace plus brand-content team."),
      },
      {
        label: l("风险关注", "Risk focus"),
        value: "Quota",
        tone: "warn",
        note: l("图像额度已使用 72%。", "Image quota has reached 72%."),
      },
    ],
    actions: [
      {
        label: l("发布", "Publish"),
        tone: "success",
        hint: l("进入发布页签生成正式通道。", "Open the release tab to prepare the production channel."),
        target: "release",
      },
      {
        label: l("灰度", "Stage rollout"),
        tone: "active",
        hint: l("继续扩大品牌团队可见范围。", "Continue widening brand-team visibility."),
        target: "release",
      },
      {
        label: l("回滚", "Rollback"),
        tone: "",
        hint: l("先对比最近两次选图回写差异。", "Compare the two latest selection callbacks first."),
        target: "debug",
      },
      {
        label: l("停用", "Disable"),
        tone: "",
        hint: l("停用前先检查额度告警与回流目录。", "Inspect quota alerts and callback directories before disabling."),
        target: "governance-cost",
      },
      {
        label: l("调试", "Debug"),
        tone: "",
        hint: l("查看批量出图和结果回写时序。", "Review batch-generation and callback timing."),
        target: "debug",
      },
    ],
    rollout: [
      {
        title: l("品牌团队正式发布", "Brand-team production release"),
        tone: "success",
        note: l("具备正式渠道发布条件。", "Ready for production-channel release."),
      },
      {
        title: l("图像额度治理", "Image-quota governance"),
        tone: "warn",
        note: l("高峰期应提前设置审批阈值。", "Approval thresholds should be enabled before peak usage."),
      },
      {
        title: l("个人空间兼容", "Personal-workspace compatibility"),
        tone: "active",
        note: l("个人空间流程已验证。", "The personal-workspace flow is already validated."),
      },
    ],
    alerts: [
      {
        title: l("图像额度接近阈值", "Image quota nearing threshold"),
        tone: "warn",
        note: l("建议在治理页启用更严格的批量轮次策略。", "Enable stricter batch-round policy in governance."),
      },
      {
        title: l("结果包回写稳定", "Bundle callback is stable"),
        tone: "success",
        note: l("最终精选图和归档目录回写正常。", "Final picks and archive callbacks are behaving correctly."),
      },
    ],
  },
};

function CreatorTabPanel() {
  const lang = useDashboardUiStore((state) => state.lang);
  const activePackageId = useDashboardUiStore((state) => state.activePackageId);
  const creatorTab = useDashboardUiStore((state) => state.creatorTab);
  const pkg = creatorPackages[activePackageId];
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

function CreatorDebugPanel() {
  const lang = useDashboardUiStore((state) => state.lang);
  const activePackageId = useDashboardUiStore((state) => state.activePackageId);
  const pkg = creatorPackages[activePackageId];

  return (
    <div className="detail-body">
      <div className="section-head">
        <div>
          <div className="eyebrow">{t(lang, { zh: "调试回放", en: "Debug Replay" })}</div>
          <div className="tab-title">{t(lang, { zh: "围绕真实 session 的运行回放", en: "Replay around the original session" })}</div>
        </div>
        <span className="pill warn">{t(lang, { zh: "只读", en: "Readonly" })}</span>
      </div>
      <div className="detail-item">
        <div className="file-name">{pkg.id}</div>
        <div className="meta">{t(lang, { zh: "回放保留消息顺序、审批节点、路径写入与工具调用摘要。", en: "The replay preserves message order, approval nodes, path writes, and a summary of tool calls." })}</div>
      </div>
      <div className="detail-item">
        <div className="route-code">trace://{pkg.id}/timeline</div>
        <div className="route-code">trace://{pkg.id}/tools</div>
        <div className="route-code">trace://{pkg.id}/filesystem-diff</div>
      </div>
      <div className="detail-item">
        <div className="file-name">{t(lang, { zh: "建议用途", en: "Recommended use" })}</div>
        <div className="meta">{t(lang, { zh: "定位 session 打包前后的信息漂移、检查审批节点遗漏、核对目标路径写入。", en: "Use it to locate information drift before and after packaging, inspect missing approval nodes, and verify target-path writes." })}</div>
      </div>
    </div>
  );
}

function CreatorGovernancePanel({ section }: { section: GovernanceSection }) {
  const lang = useDashboardUiStore((state) => state.lang);
  const meta = governanceMeta[section];
  const [query, setQuery] = useState("");
  const filteredRows = useMemo(() => {
    return meta.rows.filter((row) =>
      matchesSearchQuery(query, row.cells.flatMap((cell) =>
        typeof cell === "string" ? [cell] : [cell.zh, cell.en]
      ))
    );
  }, [meta.rows, query]);

  return (
    <div className="detail-body">
      <div className="section-head">
        <div>
          <div className="eyebrow">{t(lang, { zh: "治理设置", en: "Governance" })}</div>
          <div className="tab-title">{t(lang, meta.title)}</div>
        </div>
        <span className="pill active">{section}</span>
      </div>
      <div className="section-note">{t(lang, meta.summary)}</div>
      <div className="quick-grid">
        {meta.metrics.map((item) => (
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
          {meta.actions.map((item) => (
            <button className="route-btn" key={t(lang, item)} type="button">
              {t(lang, item)}
            </button>
          ))}
        </div>
      </div>
      <div className="governance-table">
        <div className="governance-table-head">
          {meta.headers.map((item) => (
            <div className="governance-cell governance-head" key={t(lang, item)}>
              {t(lang, item)}
            </div>
          ))}
        </div>
        <div className="governance-table-body">
          {filteredRows.map((row) => (
            <div className="governance-row" key={row.id}>
              <div className="governance-cell governance-primary" data-label={t(lang, meta.headers[0])}>
                {t(lang, row.cells[0])}
              </div>
              <div className="governance-cell" data-label={t(lang, meta.headers[1])}>
                {t(lang, row.cells[1])}
              </div>
              <div className="governance-cell" data-label={t(lang, meta.headers[2])}>
                <span className={`pill ${row.tone}`}>
                  {t(lang, row.cells[2])}
                </span>
              </div>
              <div className="governance-cell governance-note" data-label={t(lang, meta.headers[3])}>
                {t(lang, row.cells[3])}
              </div>
            </div>
          ))}
          {filteredRows.length === 0 ? (
            <div className="panel-empty">
              {t(lang, {
                zh: "当前治理分段没有匹配项。可以清空搜索词，或切换到其他治理分段。",
                en: "No rows match the current governance segment. Clear the query or switch to another governance section.",
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CreatorOperationsRail({
  packageId,
  relatedWorkshops,
  relatedServices,
  isGovernanceRoute,
  governanceSection,
}: {
  packageId: string;
  relatedWorkshops: typeof workshops;
  relatedServices: typeof dashboardServices;
  isGovernanceRoute: boolean;
  governanceSection: GovernanceSection;
}) {
  const navigate = useNavigate();
  const lang = useDashboardUiStore((state) => state.lang);
  const setCreatorTab = useDashboardUiStore((state) => state.setCreatorTab);
  const meta = creatorOperationMeta[packageId] ?? creatorOperationMeta["chrome-tax-runner"];
  const currentMeta = packageMeta[packageId as keyof typeof packageMeta] ?? packageMeta["chrome-tax-runner"];
  const boundWorkspaces = dashboardWorkspaces.filter((item) => item.packageIds.includes(packageId));

  const handleAction = (target: CreatorActionTarget) => {
    if (target === "release") {
      setCreatorTab("release");
      navigate(dashboardRoutes.creatorPackage(packageId));
      return;
    }

    if (target === "debug") {
      navigate(dashboardRoutes.creatorDebug(packageId));
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
          <span className="pill active">{packageId}</span>
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
          <span className="pill">{currentMeta.updatedAt}</span>
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
            <div className="meta">{t(lang, currentMeta.releaseChannel)}</div>
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
            <button className="route-btn" type="button" onClick={() => handleAction("governance-policy")}>
              {t(lang, { zh: "运行策略", en: "Runtime policy" })}
            </button>
            <button className="route-btn" type="button" onClick={() => handleAction("governance-audit")}>
              {t(lang, { zh: "审计中心", en: "Audit center" })}
            </button>
            <button className="route-btn active" type="button" onClick={() => handleAction("governance-cost")}>
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
  const activePackageId = useDashboardUiStore((state) => state.activePackageId);
  const setActivePackageId = useDashboardUiStore((state) => state.setActivePackageId);
  const creatorTab = useDashboardUiStore((state) => state.creatorTab);
  const setCreatorTab = useDashboardUiStore((state) => state.setCreatorTab);
  const currentWorkspace =
    dashboardWorkspaces.find((item) => item.id === currentWorkspaceId) ?? dashboardWorkspaces[0];

  const isDebugRoute = location.pathname.endsWith("/debug");
  const isGovernanceRoute = location.pathname.includes("/creator/governance");
  const governanceSection = isGovernanceSection(section) ? section : "credentials";
  const visiblePackages = Object.values(creatorPackages).filter((item) =>
    currentWorkspace.packageIds.includes(item.id)
  );
  const filteredPackages = useMemo(() => {
    return visiblePackages.filter((item) => {
      const meta = packageMeta[item.id as keyof typeof packageMeta];
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
        meta?.owner.zh,
        meta?.owner.en,
        meta?.releaseChannel.zh,
        meta?.releaseChannel.en,
        ...(meta?.versionLine ?? []),
      ]);
    });
  }, [searchQuery, statusFilter, visiblePackages]);

  useEffect(() => {
    if (packageId && creatorPackages[packageId] && currentWorkspace.packageIds.includes(packageId)) {
      setActivePackageId(packageId);
      return;
    }

    const fallbackPackage = visiblePackages[0];
    if (fallbackPackage && fallbackPackage.id !== activePackageId) {
      setActivePackageId(fallbackPackage.id);
      if (!isGovernanceRoute) {
        navigate(dashboardRoutes.creatorPackage(fallbackPackage.id), { replace: true });
      }
    }
  }, [
    activePackageId,
    currentWorkspace,
    isGovernanceRoute,
    navigate,
    packageId,
    setActivePackageId,
    visiblePackages,
  ]);

  const pkg = creatorPackages[activePackageId] ?? visiblePackages[0] ?? creatorPackages["chrome-tax-runner"];
  const currentMeta = packageMeta[pkg.id as keyof typeof packageMeta];
  const relatedWorkshops = workshops.filter((item) => currentMeta?.workshopIds.includes(item.id));
  const relatedServices = dashboardServices.filter((item) => currentMeta?.serviceIds.includes(item.id));

  return (
    <section className="view">
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
            { label: { zh: "可发布工坊", en: "Releasable workshops" }, value: String(currentWorkspace.workshopIds.length).padStart(2, "0"), note: { zh: "按工作区和能力策略发布。", en: "Released by workspace and capability policy." } },
            { label: { zh: "待审计", en: "Pending audit" }, value: "03", note: { zh: "重点看脱敏与凭证注入。", en: "Focused on desensitization and secret injection." } },
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
          {filteredPackages.map((item) => {
            const meta = packageMeta[item.id as keyof typeof packageMeta];
            return (
            <article className={`package-card ${item.id === activePackageId ? "active" : ""}`} key={item.id}>
              <button className="card-hit" type="button" onClick={() => navigate(dashboardRoutes.creatorPackage(item.id))}>
                <div className="instance-head">
                  <div className="list-title">{t(lang, item.title)}</div>
                  <span className={`pill ${item.statusClass}`}>{t(lang, item.status)}</span>
                </div>
                <div className="meta">{t(lang, item.source)}</div>
                <div className="meta">
                  {t(lang, meta.owner)} / {meta.updatedAt}
                </div>
                <div className="pill-row">
                  <span className="path-chip active">{item.id}</span>
                  <span className="path-chip">{meta.serviceIds.length} svc</span>
                </div>
                <div className="section-note">{t(lang, meta.releaseChannel)}</div>
              </button>
            </article>
            );
          })}
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
              <button className={`route-btn ${isGovernanceRoute ? "active" : ""}`} type="button" onClick={() => navigate(dashboardRoutes.creatorGovernance(governanceSection))}>
                {t(lang, { zh: "治理设置", en: "Governance" })}
              </button>
            </div>

            <div className="quick-grid">
              <div className="quick-box">
                <div className="quick-label">{t(lang, { zh: "所有者", en: "Owner" })}</div>
                <div className="quick-value">{t(lang, currentMeta.owner)}</div>
              </div>
              <div className="quick-box">
                <div className="quick-label">{t(lang, { zh: "最后回放时间", en: "Last replay" })}</div>
                <div className="quick-value">{currentMeta.updatedAt}</div>
              </div>
              <div className="quick-box">
                <div className="quick-label">{t(lang, { zh: "发布通道", en: "Release channel" })}</div>
                <div className="quick-value">{t(lang, currentMeta.releaseChannel)}</div>
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
                      onClick={() => navigate(dashboardRoutes.creatorGovernance(item))}
                    >
                      {t(lang, governanceSectionLabel[item])}
                    </button>
                  ))}
                </div>
                <CreatorGovernancePanel section={governanceSection} />
              </>
            ) : isDebugRoute ? (
              <CreatorDebugPanel />
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
                    {currentMeta.versionLine.map((item) => (
                      <div className="route-code" key={item}>
                        {item}
                      </div>
                    ))}
                  </div>
                  <div className="detail-item">
                    <div className="file-name">{t(lang, { zh: "依赖摘要", en: "Dependency summary" })}</div>
                    {currentMeta.dependencies.map((item) => (
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
                <CreatorTabPanel />
              </>
            )}
          </article>
        </div>

        <CreatorOperationsRail
          governanceSection={governanceSection}
          isGovernanceRoute={isGovernanceRoute}
          packageId={pkg.id}
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
