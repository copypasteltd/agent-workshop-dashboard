import { l, type LocalizedString } from "../lib/i18n";

export type Workshop = {
  id: string;
  cover: string;
  title: LocalizedString;
  badge: LocalizedString;
  audience: LocalizedString;
  summary: LocalizedString;
  route: string;
  next: LocalizedString;
  tags: string[];
  linkedService: string;
  linkedInstance: string;
};

export type DashboardService = {
  id: string;
  workshopId: string;
  name: LocalizedString;
  summary: LocalizedString;
  auth: LocalizedString;
  eta: string;
  targetPath: string;
  linkedInstance: string;
};

export type InstanceTab = "overview" | "files" | "runtime" | "audit";
export type CreatorTab = "session" | "runtime" | "connectors" | "release";

export type InstanceRecord = {
  id: string;
  title: LocalizedString;
  workshop: LocalizedString;
  workspaceId: string;
  workspace: LocalizedString;
  status: LocalizedString;
  statusClass: string;
  tags?: string[];
  attentionMode?: "todo" | "running" | "done";
  targetPath: string;
  route: string;
  summary: LocalizedString;
  nextAction: LocalizedString;
  metrics: Array<{ label: LocalizedString; value: LocalizedString | string }>;
  messages: Array<{
    kind: "system" | "user" | "agent";
    title: LocalizedString | string;
    time: string;
    body: LocalizedString;
    attachments?: Array<{ label: string; path: string }>;
  }>;
  overview: {
    cards: Array<{ label: LocalizedString; value: LocalizedString }>;
  };
  files: {
    currentPath: string;
    paths: string[];
    items: Array<{ name: string; path: string; note: LocalizedString; preview?: LocalizedString; type: string }>;
  };
  runtime: {
    container: string;
    image: string;
    mounts: LocalizedString[];
    notes: LocalizedString[];
  };
  audit: {
    timeline: Array<{ time: string; text: LocalizedString }>;
    boundaries: LocalizedString[];
  };
};

export type CreatorPackage = {
  id: string;
  title: LocalizedString;
  source: LocalizedString;
  status: LocalizedString;
  statusClass: string;
  session: { summary: LocalizedString; items: LocalizedString[] };
  runtime: { summary: LocalizedString; items: LocalizedString[] };
  connectors: { summary: LocalizedString; items: LocalizedString[] };
  release: { summary: LocalizedString; items: LocalizedString[] };
};

export const dashboardAssets = {
  logo: "/assets/logo.svg",
  tax: "/assets/workshop-tax.svg",
  drama: "/assets/workshop-drama.svg",
  image: "/assets/workshop-image.svg",
  runtime: "/assets/runtime-map.svg",
};

export const workshops: Workshop[] = [
  {
    id: "enterprise-tax",
    cover: dashboardAssets.tax,
    title: l("企业财税工坊", "Enterprise Tax Workshop"),
    badge: l("企业线", "Enterprise"),
    audience: l(
      "适合财务团队、代账团队、企业运营人员。",
      "Built for finance teams, tax operators, and business admins."
    ),
    summary: l(
      "实例化后系统会先引导 Codex 向用户确认所需资料，再继续执行受控浏览器报税流程。",
      "After instantiation the system first asks Codex to collect required inputs, then continues into the controlled browser filing flow."
    ),
    route: "dashboard://workshops/enterprise-tax",
    next: l(
      "常见后续：进入实例对话、审批提交、下载回执。",
      "Typical next steps: enter the run conversation, approve submit, and download receipts."
    ),
    tags: ["/workspace/tax-q2/", "Chrome", "OTP", "approval"],
    linkedService: "tax-filing",
    linkedInstance: "tax-q2",
  },
  {
    id: "creator-drama",
    cover: dashboardAssets.drama,
    title: l("短剧生产工坊", "Drama Production Workshop"),
    badge: l("内容线", "Content"),
    audience: l(
      "适合导演、编导、短剧工作室与内容运营。",
      "Built for directors, writers, studios, and content operators."
    ),
    summary: l(
      "围绕脚本、分镜、素材与审稿循环，以完整对话形态驱动创作流程。",
      "Drives script, storyboard, asset, and review loops through a full conversational production flow."
    ),
    route: "dashboard://workshops/creator-drama",
    next: l(
      "常见后续：补充导演意见、回收素材、导出分镜包。",
      "Typical next steps: collect director notes, gather assets, and export storyboard bundles."
    ),
    tags: ["/workspace/drama-ep08/", "Seedance", "review", "assets"],
    linkedService: "drama-storyboard",
    linkedInstance: "drama-ep08",
  },
  {
    id: "brand-poster-suite",
    cover: dashboardAssets.image,
    title: l("品牌内容工坊", "Brand Content Workshop"),
    badge: l("创意线", "Creative"),
    audience: l(
      "适合品牌团队、内容策划与个人创作者。",
      "Built for brand teams, campaign planners, and independent creators."
    ),
    summary: l(
      "支持批量出图、版本筛选、结果回流和 Creator 侧的私有图像能力挂载。",
      "Supports batch image generation, version review, result callbacks, and creator-side private image capability mounts."
    ),
    route: "dashboard://workshops/brand-poster-suite",
    next: l(
      "常见后续：批量选图、打包下载、回到 Creator 更新策略。",
      "Typical next steps: select variants, download bundles, and return to Creator to adjust policy."
    ),
    tags: ["/workspace/poster-batch-17/", "image key", "bundle", "callback"],
    linkedService: "poster-batch",
    linkedInstance: "poster-batch-17",
  },
];

export const dashboardServices: DashboardService[] = [
  {
    id: "tax-filing",
    workshopId: "enterprise-tax",
    name: l("香港有限公司季度报税", "Hong Kong Quarterly Filing"),
    summary: l(
      "启动后先由系统插入询问信息消息，再由 Codex 收集报税主体、期间、材料和审批要求，随后接管浏览器完成申报。",
      "After launch, the system inserts the information-collection message and Codex gathers the filing entity, period, materials, and approval rules before taking over the browser."
    ),
    auth: l("企业邮箱 OTP / 财务文件只读挂载 / 最终提交审批", "Enterprise OTP / readonly finance files / final-submit approval"),
    eta: "04-08 min",
    targetPath: "/workspace/tax-q2/",
    linkedInstance: "tax-q2",
  },
  {
    id: "drama-storyboard",
    workshopId: "creator-drama",
    name: l("短剧分镜生成与审稿", "Drama Storyboard Generation"),
    summary: l(
      "实例化后保持完整对话模式，围绕剧情目标、风格参考、导演意见和素材回流持续推进分镜修订。",
      "The run stays in a full conversation mode and continues through plot goals, style references, director notes, and asset callbacks for storyboard revisions."
    ),
    auth: l("Seedance API / 外部素材引用 / 审稿回流", "Seedance API / external asset refs / review callbacks"),
    eta: "08-15 min",
    targetPath: "/workspace/drama-ep08/",
    linkedInstance: "drama-ep08",
  },
  {
    id: "poster-batch",
    workshopId: "brand-poster-suite",
    name: l("品牌海报批量生成", "Brand Poster Batch"),
    summary: l(
      "围绕品牌约束批量生成海报、KV 和变体图，并将筛选结果同步回写到输出目录与归档目录。",
      "Generates posters, key visuals, and variants in bulk around brand constraints, then writes selection results back to output and archive paths."
    ),
    auth: l("私有图像能力挂载 / 只读密钥 / 结果包回写", "Private image capability mount / readonly key / bundle callback"),
    eta: "06-12 min",
    targetPath: "/workspace/poster-batch-17/",
    linkedInstance: "poster-batch-17",
  },
];

export const instances: Record<string, InstanceRecord> = {
  "tax-q2": {
    id: "tax-q2",
    title: l("香港有限公司 2026Q2 报税", "Hong Kong Co. 2026Q2 Filing"),
    workshop: l("企业财税工坊", "Enterprise Tax Workshop"),
    workspaceId: "harbor-finance",
    workspace: l("华港财务组", "Harbor Finance Team"),
    status: l("待审批", "Approval"),
    statusClass: "warn",
    targetPath: "/workspace/tax-q2/",
    route: "dashboard://instances/tax-q2",
    summary: l(
      "登录、材料核对、表单预填已完成，当前等待最终提交审批。",
      "Login, material verification, and prefilling are complete. The run is waiting for final submit approval."
    ),
    nextAction: l("确认最终提交", "Confirm final submit"),
    metrics: [
      { label: l("当前阶段", "Current stage"), value: l("最终审批前", "Pre-submit approval") },
      { label: l("目标路径", "Target path"), value: "/workspace/tax-q2/" },
      { label: l("最近产出", "Latest output"), value: "filing-slip.pdf" },
    ],
    messages: [
      {
        kind: "system",
        title: l("System Insert", "System Insert"),
        time: "09:31",
        body: l(
          "请先告诉我报税主体、申报期间、登录方式、已准备材料，以及是否需要在最终提交前发起审批。",
          "Please tell me the filing entity, filing period, login method, prepared materials, and whether final submission requires approval."
        ),
      },
      {
        kind: "user",
        title: l("用户", "User"),
        time: "09:33",
        body: l(
          "主体是香港有限公司，申报 2026 年第二季度。登录信息已经保存在组织凭证里。已上传银行流水、董事签章和上一期报表。提交前必须向我确认。",
          "The entity is Hong Kong Co. for 2026 Q2. Login is stored in organization secrets. I uploaded bank statements, the director stamp, and the prior report. You must confirm before submission."
        ),
      },
      {
        kind: "agent",
        title: "Codex Runtime",
        time: "09:39",
        body: l(
          "我已进入工作目录 `/workspace/tax-q2/`，并完成登录、材料核对与表单预填。关键步骤截图已写入 `screenshots/`。",
          "I entered `/workspace/tax-q2/` and completed login, material checks, and prefilling. Key-step screenshots were written into `screenshots/`."
        ),
      },
      {
        kind: "system",
        title: l("审批提醒", "Approval Reminder"),
        time: "09:46",
        body: l(
          "当前需要确认是否执行最终提交。审批通过后，系统会继续当前容器，不会重新收集材料。",
          "Final submit now requires confirmation. After approval, the same container will continue without recollecting materials."
        ),
      },
      {
        kind: "user",
        title: l("用户", "User"),
        time: "09:47",
        body: l(
          "确认提交。提交完成后，把回执、总结和审计日志整理到输出目录。",
          "Approved. After submission, place the receipt, summary, and audit log into the output directory."
        ),
      },
      {
        kind: "agent",
        title: "Codex Runtime",
        time: "09:54",
        body: l(
          "最终提交完成。回执、总结与审计日志已写入 `output/`，归档副本同步写入 `archive/`。",
          "Final submission completed. The receipt, summary, and audit log were written into `output/`, with archived copies synced into `archive/`."
        ),
      },
    ],
    overview: {
      cards: [
        { label: l("下一步", "Next step"), value: l("确认是否继续生成老板摘要", "Confirm whether to generate an executive brief") },
        { label: l("用户最常做", "Common user action"), value: l("下载回执并继续追问税额说明", "Download the receipt and ask follow-up questions about tax calculations") },
        { label: l("当前交付", "Current deliverable"), value: l("回执、总结、审计日志、截图", "Receipt, summary, audit log, screenshots") },
      ],
    },
    files: {
      currentPath: "/workspace/tax-q2/output/",
      paths: ["output/", "receipts/", "screenshots/", "archive/"],
      items: [
        {
          name: "filing-slip.pdf",
          path: "/workspace/tax-q2/output/filing-slip.pdf",
          note: l("最终税务回执，可直接对外交付。", "Final tax receipt, ready for delivery."),
          preview: l("PDF 回执类文件建议直接下载查看。", "PDF receipt files are best inspected via direct download."),
          type: "output",
        },
        {
          name: "final-summary.md",
          path: "/workspace/tax-q2/output/final-summary.md",
          note: l("面向用户的执行总结，可回流到对话流。", "User-facing execution summary that can be sent back into the conversation."),
          preview: l(
            "# 执行总结\n- 申报主体：香港有限公司\n- 申报期间：2026Q2\n- 当前状态：已完成提交\n- 输出目录：/workspace/tax-q2/output/",
            "# Execution Summary\n- Entity: Hong Kong Co.\n- Filing Period: 2026Q2\n- Status: submitted\n- Output path: /workspace/tax-q2/output/"
          ),
          type: "callback",
        },
        {
          name: "filing-bundle.zip",
          path: "/workspace/tax-q2/output/filing-bundle.zip",
          note: l("打包后的完整交付件，一键下载。", "Bundled deliverables for one-click download."),
          preview: l("ZIP 打包件建议直接下载。", "ZIP bundles are intended for direct download."),
          type: "bundle",
        },
        {
          name: "audit-log.json",
          path: "/workspace/tax-q2/archive/audit-log.json",
          note: l("包含审批、执行时间线与路径写入记录。", "Contains approvals, execution timeline, and path writes."),
          preview: l(
            '{\n  "approval": "approved",\n  "steps": ["login", "prefill", "submit"],\n  "targetPath": "/workspace/tax-q2/"\n}',
            '{\n  "approval": "approved",\n  "steps": ["login", "prefill", "submit"],\n  "targetPath": "/workspace/tax-q2/"\n}'
          ),
          type: "archive",
        },
      ],
    },
    runtime: {
      container: "container://run-ctx-2048",
      image: "lingban-codex-runtime:2026.07",
      mounts: [
        l("任务根路径：/workspace/tax-q2/", "Task root: /workspace/tax-q2/"),
        l("上传材料目录：/workspace/tax-q2/receipts/", "Receipt path: /workspace/tax-q2/receipts/"),
        l("输出目录：/workspace/tax-q2/output/", "Output path: /workspace/tax-q2/output/"),
        l("第三方引用：connector://imagegen/private-brand-key", "Third-party ref: connector://imagegen/private-brand-key"),
      ],
      notes: [
        l("实例独占容器，关闭即销毁。", "The instance owns a dedicated container and is destroyed on close."),
        l("浏览器能力只对当前实例可见，不跨用户共享。", "Browser capability is visible only to this instance and is never shared across users."),
        l("私有凭证以只读挂载方式注入。", "Private secrets are injected as readonly mounts."),
      ],
    },
    audit: {
      timeline: [
        { time: "09:32", text: l("实例建立，系统插入询问信息消息。", "Instance booted and the system inserted the information-collection message.") },
        { time: "09:39", text: l("完成登录、材料核对与表单预填。", "Completed login, material checks, and form prefilling.") },
        { time: "09:47", text: l("审批通过，继续同一容器执行最终提交。", "Approval granted, continuing in the same container.") },
        { time: "09:54", text: l("结果写入 output，归档同步完成。", "Outputs written into output, archive sync completed.") },
      ],
      boundaries: [
        l("文件浏览只允许在当前任务根路径下进行。", "File browsing is allowed only under the current task root."),
        l("用户可切换子路径，但不能越出白名单目录。", "Users may switch subpaths but cannot leave the whitelisted directories."),
        l("下载动作必须经过路径解析与权限校验。", "Download actions require path resolution and permission checks."),
      ],
    },
  },
  "drama-ep08": {
    id: "drama-ep08",
    title: l("短剧第 8 集分镜确认", "Episode 8 Shot Breakdown Review"),
    workshop: l("短剧生产工坊", "Drama Production Workshop"),
    workspaceId: "brand-lab",
    workspace: l("品牌内容组", "Brand Content Team"),
    status: l("运行中", "Running"),
    statusClass: "active",
    targetPath: "/workspace/drama-ep08/",
    route: "dashboard://instances/drama-ep08",
    summary: l(
      "分镜草案和镜头说明已经完成，当前需要补充导演的修改意见。",
      "Storyboard draft and shot notes are ready, and the next input needed is the director's revision notes."
    ),
    nextAction: l("补充导演意见", "Add director notes"),
    metrics: [
      { label: l("当前阶段", "Current stage"), value: l("导演修订", "Director revision") },
      { label: l("目标路径", "Target path"), value: "/workspace/drama-ep08/" },
      { label: l("最近产出", "Latest output"), value: "storyboard-pack.zip" },
    ],
    messages: [
      {
        kind: "system",
        title: l("System Insert", "System Insert"),
        time: "14:20",
        body: l(
          "请告诉我本集剧情目标、已有剧本版本、参考风格，以及你希望我先完成分镜还是先整理镜头素材。",
          "Please tell me the episode objective, current script version, reference style, and whether I should do the storyboard or organize shot assets first."
        ),
      },
      {
        kind: "user",
        title: l("用户", "User"),
        time: "14:23",
        body: l("先完成分镜。风格参考偏港风都市。素材稍后补。", "Do the storyboard first. The style reference is urban Hong Kong noir. Assets will come later."),
      },
      {
        kind: "agent",
        title: "Codex Runtime",
        time: "14:51",
        body: l(
          "分镜草案已完成并写入 `output/storyboard-v1.md`。当前建议你补充导演修改意见，我再继续二次修订。",
          "The storyboard draft is complete and stored at `output/storyboard-v1.md`. The next best step is to add director notes so I can do the second revision."
        ),
      },
    ],
    overview: {
      cards: [
        { label: l("下一步", "Next step"), value: l("收集导演意见", "Collect director notes") },
        { label: l("当前最重要", "Current focus"), value: l("缩短镜头调整回合", "Reduce storyboard revision rounds") },
        { label: l("当前交付", "Current deliverable"), value: l("分镜草案、镜头表、风格说明", "Storyboard draft, shot list, style notes") },
      ],
    },
    files: {
      currentPath: "/workspace/drama-ep08/output/",
      paths: ["output/", "assets/", "review/", "archive/"],
      items: [
        {
          name: "storyboard-v1.md",
          path: "/workspace/drama-ep08/output/storyboard-v1.md",
          note: l("第一版分镜草案。", "First storyboard draft."),
          preview: l(
            "# EP08 分镜草案\n1. 天桥夜景开场\n2. 角色对峙推进\n3. 近景情绪转折",
            "# EP08 Storyboard Draft\n1. Night bridge opening\n2. Character confrontation\n3. Close-up emotional turn"
          ),
          type: "output",
        },
        {
          name: "shot-list.csv",
          path: "/workspace/drama-ep08/output/shot-list.csv",
          note: l("镜头列表，可供后续排期使用。", "Shot list for scheduling."),
          preview: l(
            "scene,shot,lens\n1,01,24mm\n1,02,50mm\n2,01,85mm",
            "scene,shot,lens\n1,01,24mm\n1,02,50mm\n2,01,85mm"
          ),
          type: "output",
        },
      ],
    },
    runtime: {
      container: "container://run-ctx-2119",
      image: "lingban-codex-runtime:2026.07",
      mounts: [
        l("任务根路径：/workspace/drama-ep08/", "Task root: /workspace/drama-ep08/"),
        l("外部能力：Seedance API", "External capability: Seedance API"),
        l("审稿回流路径：review/", "Review callback path: review/"),
      ],
      notes: [l("当前实例保持对话连续性，导演意见会直接进入同一条会话流。", "The current instance preserves conversation continuity and director notes go directly into the same run.")],
    },
    audit: {
      timeline: [
        { time: "14:20", text: l("实例建立并询问创作目标。", "Instance booted and asked about the creative objective.") },
        { time: "14:51", text: l("完成第一版分镜并输出草案。", "Finished the first storyboard draft and wrote the output.") },
      ],
      boundaries: [l("外部素材引用只记录引用关系，不内置原文件。", "External asset use stores references, not bundled originals.")],
    },
  },
  "poster-batch-17": {
    id: "poster-batch-17",
    title: l("品牌海报批次 17", "Poster Batch 17"),
    workshop: l("品牌内容工坊", "Brand Content Workshop"),
    workspaceId: "brand-lab",
    workspace: l("品牌内容组", "Brand Content Team"),
    status: l("回流中", "Callback"),
    statusClass: "success",
    targetPath: "/workspace/poster-batch-17/",
    route: "dashboard://instances/poster-batch-17",
    summary: l(
      "12 张图已生成，当前正在筛选最终版本并回写到输出目录。",
      "12 images have been generated and the final selections are being written back to the output directory."
    ),
    nextAction: l("确认最终选图", "Confirm final selections"),
    metrics: [
      { label: l("当前阶段", "Current stage"), value: l("选图回写", "Selection callback") },
      { label: l("目标路径", "Target path"), value: "/workspace/poster-batch-17/" },
      { label: l("最近产出", "Latest output"), value: "poster-bundle.zip" },
    ],
    messages: [
      {
        kind: "agent",
        title: "Codex Runtime",
        time: "19:04",
        body: l(
          "12 张图已出，最终选中的 4 张将被写入 `output/final/` 并同时保留候选版本。",
          "12 images are ready. The final 4 selections will be written into `output/final/` while keeping the candidate set."
        ),
      },
    ],
    overview: {
      cards: [
        { label: l("下一步", "Next step"), value: l("确认最终 4 张", "Confirm the final 4 images") },
        { label: l("当前最重要", "Current focus"), value: l("减少返工轮次", "Reduce rework rounds") },
        { label: l("当前交付", "Current deliverable"), value: l("精选图、候选图、打包下载", "Final picks, candidate set, bundled download") },
      ],
    },
    files: {
      currentPath: "/workspace/poster-batch-17/output/",
      paths: ["output/", "variants/", "archive/"],
      items: [
        {
          name: "poster-bundle.zip",
          path: "/workspace/poster-batch-17/output/poster-bundle.zip",
          note: l("精选图与说明文档的打包件。", "Bundle with final posters and notes."),
          preview: l("图像打包件建议直接下载。", "Image bundles are meant for direct download."),
          type: "bundle",
        },
      ],
    },
    runtime: {
      container: "container://run-ctx-2140",
      image: "lingban-codex-runtime:2026.07",
      mounts: [
        l("任务根路径：/workspace/poster-batch-17/", "Task root: /workspace/poster-batch-17/"),
        l("图像能力引用：connector://imagegen/private-brand-key", "Image ref: connector://imagegen/private-brand-key"),
      ],
      notes: [l("私有图像凭证以只读挂载注入。", "Private image credentials are mounted readonly.")],
    },
    audit: {
      timeline: [
        { time: "18:10", text: l("触发批量出图。", "Triggered batch image generation.") },
        { time: "19:04", text: l("进入选图回流阶段。", "Entered selection callback phase.") },
      ],
      boundaries: [l("候选图默认保留在实例路径，不自动对外可见。", "Candidate images stay inside the instance path and are not outward-facing by default.")],
    },
  },
  "personal-brand-lab": {
    id: "personal-brand-lab",
    title: l("个人品牌实验批次", "Personal Brand Experiment"),
    workshop: l("品牌内容工坊", "Brand Content Workshop"),
    workspaceId: "personal",
    workspace: l("个人空间", "Personal Workspace"),
    status: l("运行中", "Running"),
    statusClass: "active",
    targetPath: "/workspace/personal/brand-lab/",
    route: "dashboard://instances/personal-brand-lab",
    summary: l(
      "围绕个人品牌海报与简介图进行迭代，当前等待你补充新的风格偏好。",
      "Iterating on personal brand posters and profile visuals, currently waiting for new style preferences."
    ),
    nextAction: l("补充风格偏好", "Add style preferences"),
    metrics: [
      { label: l("当前阶段", "Current stage"), value: l("风格调整", "Style tuning") },
      { label: l("目标路径", "Target path"), value: "/workspace/personal/brand-lab/" },
      { label: l("最近产出", "Latest output"), value: "profile-kv-v2.png" },
    ],
    messages: [
      {
        kind: "system",
        title: l("System Insert", "System Insert"),
        time: "21:06",
        body: l(
          "请告诉我你想保留的视觉方向、不可使用的颜色，以及这次结果主要用于头像、封面还是介绍页。",
          "Please tell me which visual direction to keep, which colors to avoid, and whether the result is primarily for an avatar, cover, or profile page."
        ),
      },
      {
        kind: "user",
        title: l("用户", "User"),
        time: "21:08",
        body: l(
          "延续薄荷绿和白色，但减少科技感，主要用于个人介绍页封面。",
          "Keep the mint and white palette, reduce the tech feel, and optimize it for a personal profile cover."
        ),
      },
      {
        kind: "agent",
        title: "Codex Runtime",
        time: "21:14",
        body: l(
          "我已经把第二版构图写入 `output/profile-kv-v2.png`，当前建议你继续补充排版偏好，我再生成介绍页整套图。",
          "I wrote the second composition into `output/profile-kv-v2.png`. The next best step is to add layout preferences so I can generate the full profile-page set."
        ),
      },
    ],
    overview: {
      cards: [
        { label: l("下一步", "Next step"), value: l("补充封面排版偏好", "Add cover-layout preferences") },
        { label: l("当前重点", "Current focus"), value: l("保持个人品牌统一性", "Keep personal-brand consistency") },
        { label: l("当前交付", "Current deliverable"), value: l("KV 试稿、封面草图、提示词归档", "KV draft, cover mockup, prompt archive") },
      ],
    },
    files: {
      currentPath: "/workspace/personal/brand-lab/output/",
      paths: ["output/", "variants/", "archive/"],
      items: [
        {
          name: "profile-kv-v2.png",
          path: "/workspace/personal/brand-lab/output/profile-kv-v2.png",
          note: l("第二版封面主视觉。", "Second-pass cover key visual."),
          preview: l("图片文件建议直接下载查看。", "Image files are best inspected via download."),
          type: "output",
        },
        {
          name: "prompt-archive.json",
          path: "/workspace/personal/brand-lab/archive/prompt-archive.json",
          note: l("当前实验所使用的提示词和参数归档。", "Archived prompts and parameters for the current experiment."),
          preview: l(
            '{\n  "palette": ["mint", "white"],\n  "tone": "lighter editorial",\n  "usage": "profile-cover"\n}',
            '{\n  "palette": ["mint", "white"],\n  "tone": "lighter editorial",\n  "usage": "profile-cover"\n}'
          ),
          type: "archive",
        },
      ],
    },
    runtime: {
      container: "container://run-ctx-2201",
      image: "lingban-codex-runtime:2026.07",
      mounts: [
        l("任务根路径：/workspace/personal/brand-lab/", "Task root: /workspace/personal/brand-lab/"),
        l("图像能力引用：connector://imagegen/personal-style-key", "Image ref: connector://imagegen/personal-style-key"),
      ],
      notes: [
        l("个人空间实例仍然使用独占容器，不与企业空间共享。", "Personal-workspace runs still use dedicated containers and are never shared with enterprise workspaces."),
      ],
    },
    audit: {
      timeline: [
        { time: "21:06", text: l("实例建立并询问视觉边界。", "Instance booted and asked for visual boundaries.") },
        { time: "21:14", text: l("输出第二版主视觉。", "Produced the second key visual.") },
      ],
      boundaries: [
        l("个人空间下载目录默认只对当前账户可见。", "Personal workspace download paths are visible only to the current account by default."),
      ],
    },
  },
};

export const creatorPackages: Record<string, CreatorPackage> = {
  "chrome-tax-runner": {
    id: "chrome-tax-runner",
    title: l("chrome-tax-runner.session", "chrome-tax-runner.session"),
    source: l("来源：华港财务组 / 实例：tax-q2", "Source: Harbor Finance Team / instance: tax-q2"),
    status: l("已审计", "Audited"),
    statusClass: "success",
    session: {
      summary: l(
        "这份 package 保留了真实会话中的用户提问顺序、审批节点、路径结构和结果回流逻辑。",
        "This package preserves the real conversation order, approval nodes, path structure, and result callback logic from the original run."
      ),
      items: [
        l("完整对话流保留，不压缩成技能摘要。", "The full conversation flow is preserved instead of being collapsed into a skill summary."),
        l("审批节点与目标路径一并保存。", "Approval nodes are saved together with target paths."),
        l("脱敏后再进入发布通道。", "Desensitization happens before release."),
      ],
    },
    runtime: {
      summary: l(
        "标准镜像中包含 codex-cli、Node、Python、浏览器自动化与系统依赖。新用户打开实例时分配全新容器，关闭即销毁。",
        "The standard image contains codex-cli, Node, Python, browser automation, and system dependencies. New users receive a fresh container per instance and it is destroyed on close."
      ),
      items: [
        l("基础镜像：ubuntu:24.04", "Base image: ubuntu:24.04"),
        l("核心运行层：codex-cli / node / python", "Core runtime: codex-cli / node / python"),
        l("浏览器层：playwright / browser bridge", "Browser layer: playwright / browser bridge"),
        l("工作区层：/workspace/<task-id>/", "Workspace layer: /workspace/<task-id>/"),
      ],
    },
    connectors: {
      summary: l(
        "能力注入优先采用第一方 MCP、第三方 connector ref 和只读 secret mount。",
        "Capability injection prioritizes first-party MCP, third-party connector refs, and readonly secret mounts."
      ),
      items: [
        l("第一方 MCP：实例启动即挂载。", "First-party MCP: mounted at boot."),
        l("第三方 MCP：只记录 connector ref。", "Third-party MCP: only the connector ref is stored."),
        l("图像 Key / OTP：会话级只读挂载。", "Image keys / OTP channels: session-level readonly mounts."),
      ],
    },
    release: {
      summary: l(
        "发布单元由 session 包、工作区模板、镜像依赖、MCP 策略和输出契约共同组成。",
        "The release unit is made of the session package, workspace template, image dependencies, MCP policy, and output contract."
      ),
      items: [
        l("企业财税工坊", "Enterprise tax workshop"),
        l("私有预览通道", "Private preview channel"),
        l("审计清单 A-01 ~ A-05 全部通过", "Audit checklist A-01 to A-05 passed"),
      ],
    },
  },
  "creator-drama-suite": {
    id: "creator-drama-suite",
    title: l("creator-drama-suite.session", "creator-drama-suite.session"),
    source: l("来源：品牌内容组 / 实例：drama-ep08", "Source: Brand Content Team / instance: drama-ep08"),
    status: l("待发布", "Pending release"),
    statusClass: "warn",
    session: {
      summary: l("适合保留分镜修订回路、导演意见回流和素材补录逻辑。", "Best suited to preserve storyboard revision loops, director feedback, and asset backfill logic."),
      items: [
        l("保留分镜与素材双线程对话。", "Preserves dual-thread conversation for storyboard and asset work."),
        l("待补一轮预算控制规则。", "Needs one more pass on budget control rules."),
      ],
    },
    runtime: {
      summary: l("以同一标准镜像扩展 Seedance 等内容能力。", "Extends the same standard image with content capabilities such as Seedance."),
      items: [l("增加外部内容能力挂载。", "Adds external content capability mounts.")],
    },
    connectors: {
      summary: l("以第三方 connector ref 为主。", "Primarily uses third-party connector refs."),
      items: [l("Seedance connector ref", "Seedance connector ref")],
    },
    release: {
      summary: l("优先进入 creator 工坊灰度。", "Prioritized for creator-studio limited rollout."),
      items: [l("目标通道：Creator 工坊内测", "Target channel: creator studio preview")],
    },
  },
  "brand-poster-suite": {
    id: "brand-poster-suite",
    title: l("brand-poster-suite.session", "brand-poster-suite.session"),
    source: l("来源：品牌内容组 / 实例：poster-batch-17", "Source: Brand Content Team / instance: poster-batch-17"),
    status: l("可发布", "Ready"),
    statusClass: "active",
    session: {
      summary: l("适合保留批量出图、选图回流和结果交付逻辑。", "Best suited to preserve batch generation, selection callbacks, and delivery logic."),
      items: [l("批量出图与选图逻辑稳定。", "Batch generation and selection logic are stable.")],
    },
    runtime: {
      summary: l("主要扩展图像生成能力挂载。", "Mainly extends image generation capability mounts."),
      items: [l("增加图像服务只读密钥挂载。", "Adds readonly image-service key mounts.")],
    },
    connectors: {
      summary: l("私有图像能力按用户或工作区绑定。", "Private image capabilities are bound per user or workspace."),
      items: [l("connector://imagegen/private-brand-key", "connector://imagegen/private-brand-key")],
    },
    release: {
      summary: l("适合面向品牌团队正式发布。", "Suitable for release to brand teams."),
      items: [l("目标通道：品牌内容工坊", "Target channel: brand content workshop")],
    },
  },
};
