import type { RunFileEntry, RunSnapshot, RunStatus } from "@lingban/contracts";
import type { InstanceRecord } from "../data/dashboardData";
import { l } from "./i18n";

function formatClock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function inferWorkshopName(taskVersionId: string) {
  if (taskVersionId.includes("tax")) {
    return l("企业财税工坊", "Enterprise Tax Workshop");
  }

  if (taskVersionId.includes("drama")) {
    return l("短剧生产工坊", "Drama Production Workshop");
  }

  if (taskVersionId.includes("poster")) {
    return l("品牌内容工坊", "Brand Content Workshop");
  }

  return l("云端实例工坊", "Cloud Run Workshop");
}

function normalizeWorkspaceId(workspaceId: string) {
  if (workspaceId.includes("harbor")) {
    return "harbor-finance";
  }

  if (workspaceId.includes("brand")) {
    return "brand-lab";
  }

  if (workspaceId.includes("personal")) {
    return "personal";
  }

  return workspaceId;
}

function inferWorkspaceName(workspaceId: string) {
  const normalized = normalizeWorkspaceId(workspaceId);

  if (normalized === "harbor-finance") {
    return l("华港财务组", "Harbor Finance Team");
  }

  if (normalized === "brand-lab") {
    return l("品牌内容组", "Brand Content Team");
  }

  if (normalized === "personal") {
    return l("个人空间", "Personal Workspace");
  }

  return l("默认工作区", "Default Workspace");
}

function statusMeta(status: RunStatus) {
  switch (status) {
    case "RUNNING":
    case "SUCCEEDED":
      return {
        label: status === "SUCCEEDED" ? l("已完成", "Done") : l("运行中", "Running"),
        className: status === "SUCCEEDED" ? "success" : "active",
        nextAction: status === "SUCCEEDED" ? l("查看结果文件", "Inspect result files") : l("继续对话", "Continue conversation"),
      };
    case "WAITING_APPROVAL":
      return {
        label: l("待审批", "Approval"),
        className: "warn",
        nextAction: l("处理审批请求", "Handle approval request"),
      };
    case "FAILED":
      return {
        label: l("失败", "Failed"),
        className: "danger",
        nextAction: l("查看错误并重试", "Inspect errors and retry"),
      };
    case "CANCELLED":
      return {
        label: l("已取消", "Cancelled"),
        className: "warn",
        nextAction: l("重新发起实例", "Launch again"),
      };
    case "READY":
    case "QUEUED":
    case "STARTING":
      return {
        label:
          status === "READY"
            ? l("已就绪", "Ready")
            : status === "QUEUED"
              ? l("排队中", "Queued")
              : l("启动中", "Starting"),
        className: "active",
        nextAction: l("等待实例继续推进", "Wait for the run to continue"),
      };
    case "CREATED":
    default:
      return {
        label: l("待补充", "Needs input"),
        className: "warn",
        nextAction: l("补充执行信息", "Provide required inputs"),
      };
  }
}

function toRelativeFileName(filePath: string, targetPath: string) {
  if (filePath.startsWith(targetPath)) {
    return filePath.slice(targetPath.length) || filePath;
  }

  return filePath;
}

function collectPathOptions(targetPath: string, files: RunFileEntry[]) {
  const directories = files
    .filter((file) => file.path.endsWith("/"))
    .map((file) => file.path);
  const unique = Array.from(new Set([targetPath, ...directories]));
  return unique.length > 0 ? unique : [targetPath];
}

function buildFileItems(targetPath: string, files: RunFileEntry[]) {
  return files
    .filter((file) => !file.path.endsWith("/"))
    .map((file) => ({
      name: toRelativeFileName(file.path, targetPath),
      path: file.path,
      note: l(`最近更新 ${formatClock(file.updatedAt)}`, `Updated ${formatClock(file.updatedAt)}`),
      preview: l("文本文件可直接预览，二进制文件建议直接下载。", "Text files can be previewed directly. Binary files are best downloaded."),
      type: file.kind,
    }));
}

export function isLiveRunId(value: string | undefined) {
  return Boolean(value?.startsWith("run_"));
}

export function mapRunSnapshotToInstanceRecord(snapshot: RunSnapshot, liveFiles?: RunFileEntry[]): InstanceRecord {
  const files = liveFiles ?? snapshot.files;
  const latestOutput = files.find((file) => !file.path.endsWith("/"));
  const status = statusMeta(snapshot.run.status);
  const latestMessage = snapshot.messages.at(-1);
  const pathOptions = collectPathOptions(snapshot.run.targetPath, files);

  return {
    id: snapshot.run.runId,
    title: l(snapshot.run.title, snapshot.run.title),
    workshop: inferWorkshopName(snapshot.run.taskVersionId),
    workspaceId: normalizeWorkspaceId(snapshot.run.workspaceId),
    workspace: inferWorkspaceName(snapshot.run.workspaceId),
    status: status.label,
    statusClass: status.className,
    targetPath: snapshot.run.targetPath,
    route: `dashboard://instances/${snapshot.run.runId}`,
    summary:
      latestMessage?.text
        ? l(latestMessage.text, latestMessage.text)
        : l(snapshot.run.statusReason ?? "实例已建立，等待继续执行。", snapshot.run.statusReason ?? "Run created and waiting to continue."),
    nextAction: status.nextAction,
    metrics: [
      { label: l("当前阶段", "Current stage"), value: status.label },
      { label: l("目标路径", "Target path"), value: snapshot.run.targetPath },
      { label: l("最近产出", "Latest output"), value: latestOutput ? toRelativeFileName(latestOutput.path, snapshot.run.targetPath) : "-" },
    ],
    messages: snapshot.messages.map((message) => ({
      kind: message.role === "agent" ? "agent" : message.role === "user" ? "user" : "system",
      title:
        message.role === "agent"
          ? "Codex Runtime"
          : message.role === "user"
            ? l("用户", "User")
            : l("系统", "System"),
      time: formatClock(message.createdAt),
      body: l(message.text, message.text),
    })),
    overview: {
      cards: [
        { label: l("运行状态", "Run status"), value: status.label },
        {
          label: l("最近更新时间", "Last updated"),
          value: l(formatClock(snapshot.run.updatedAt), formatClock(snapshot.run.updatedAt)),
        },
        {
          label: l("当前建议动作", "Suggested next step"),
          value: status.nextAction,
        },
      ],
    },
    files: {
      currentPath: pathOptions[0] ?? snapshot.run.targetPath,
      paths: pathOptions.map((path) => path.replace(snapshot.run.targetPath, "") || "/"),
      items: buildFileItems(snapshot.run.targetPath, files),
    },
    runtime: {
      container: `container://${snapshot.run.runId}`,
      image: "lingban-codex-runtime:workspace",
      mounts: [
        l(`任务根路径：${snapshot.run.targetPath}`, `Task root: ${snapshot.run.targetPath}`),
        l(`工作区：${snapshot.run.workspaceId}`, `Workspace: ${snapshot.run.workspaceId}`),
      ],
      notes: [
        l("当前实例仍然保持完整对话模式，可继续补充信息或要求继续执行。", "The run remains in full conversation mode and can continue with more inputs or execution requests."),
        l("文件浏览限制在当前 target path 内。", "File browsing stays constrained to the current target path."),
      ],
    },
    audit: {
      timeline: snapshot.messages.slice(-4).map((message) => ({
        time: formatClock(message.createdAt),
        text: l(message.text, message.text),
      })),
      boundaries: [
        l("文件浏览只允许在当前任务根路径下进行。", "File browsing is allowed only under the current task root."),
        l("下载动作必须经过路径解析与权限校验。", "Downloads require path resolution and permission checks."),
      ],
    },
  };
}
