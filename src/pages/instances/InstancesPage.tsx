import { uploadRunAttachment } from "@lingban/api-sdk";
import type {
  ApproveRunInput,
  ReviewRunInformationAnswerDecision,
  RunInformationCollection,
} from "@lingban/contracts";
import { matchesSearchQuery } from "@lingban/domain-models";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { InstanceRecord, InstanceTab } from "../../data/dashboardData";
import { formatAttachmentSize, pickBrowserAttachments, type BrowserAttachmentDraft } from "../../lib/attachments";
import {
  billingSourceLabel,
  billingSourceTone,
  formatBillingQuantity,
  formatBillingUsd,
} from "../../lib/billing";
import {
  dashboardBillingApi,
  dashboardRunsApi,
  requestDashboardRunFileDownloadUrl,
} from "../../lib/api";
import { t } from "../../lib/i18n";
import { useDashboardRecentRecorder } from "../../lib/recent";
import { isLiveRunId, mapRunSnapshotToInstanceRecord } from "../../lib/liveRunAdapters";
import { dashboardRoutes, isInstanceTab } from "../../lib/routes";
import { useDashboardRunStream } from "../../lib/runStream";
import {
  hasAuthoritativeDashboardWorkspaceContext,
  resolveDashboardWorkspaceView,
} from "../../lib/workspaceContext";
import { useDashboardAuthStore } from "../../stores/dashboardAuthStore";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";
import { SessionCaptureDrawer } from "./SessionCaptureDrawer";
import { NewInstanceDrawer } from "./NewInstanceDrawer";

const instanceTabs: Array<{ key: InstanceTab; label: { zh: string; en: string } }> = [
  { key: "overview", label: { zh: "概览", en: "Overview" } },
  { key: "files", label: { zh: "文件", en: "Files" } },
  { key: "runtime", label: { zh: "运行", en: "Runtime" } },
  { key: "audit", label: { zh: "审计", en: "Audit" } },
];

type InstanceListMode = "all" | "todo" | "running" | "done";

function toListAttentionModeFilter(listMode: InstanceListMode) {
  switch (listMode) {
    case "todo":
      return "todo" as const;
    case "running":
      return "running" as const;
    case "done":
      return "done" as const;
    case "all":
    default:
      return undefined;
  }
}

function toListViewStatusFilter(statusFilter: "all" | "active" | "warn" | "success" | "failed" | "cancelled") {
  switch (statusFilter) {
    case "active":
      return "running" as const;
    case "warn":
      return "approval" as const;
    case "success":
      return "done" as const;
    case "failed":
      return "failed" as const;
    case "cancelled":
      return "cancelled" as const;
    case "all":
    default:
      return undefined;
  }
}

function getInstanceUpdatedAt(instance: InstanceRecord) {
  return instance.messages.at(-1)?.time ?? "--:--";
}

function getUnreadCount(instance: InstanceRecord) {
  let count = 0;

  for (let index = instance.messages.length - 1; index >= 0; index -= 1) {
    const message = instance.messages[index];
    if (message.kind === "user") {
      break;
    }

    count += 1;
  }

  return count;
}

function formatRuntimeTimestamp(lang: "zh" | "en", value: string | null) {
  if (!value) {
    return t(lang, { zh: "未上报", en: "Not reported" });
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatRuntimeLaunchMode(
  lang: "zh" | "en",
  value: InstanceRecord["runtime"]["launchMode"]
) {
  switch (value) {
    case "local-process":
      return t(lang, { zh: "宿主进程", en: "Host process" });
    case "docker":
      return t(lang, { zh: "容器", en: "Container" });
    default:
      return t(lang, { zh: "未上报", en: "Not reported" });
  }
}

function hasRuntimeTelemetry(runtime: InstanceRecord["runtime"]) {
  return (
    runtime.launchMode !== null ||
    runtime.containerName !== null ||
    runtime.startedAt !== null ||
    runtime.readyAt !== null ||
    runtime.finishedAt !== null ||
    runtime.exitCode !== null ||
    runtime.exitSignal !== null
  );
}

function formatBillingOccurredAt(lang: "zh" | "en", value: string | null) {
  if (!value) {
    return t(lang, { zh: "尚无记录", en: "No activity yet" });
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function approvalKindLabel(lang: "zh" | "en", value: string) {
  switch (value) {
    case "quota-override":
      return t(lang, { zh: "配额审批", en: "Quota approval" });
    case "mcp-access":
      return t(lang, { zh: "MCP 访问审批", en: "MCP access approval" });
    case "general":
    default:
      return t(lang, { zh: "普通审批", en: "General approval" });
  }
}

function mcpCallStatusLabel(lang: "zh" | "en", value: string) {
  switch (value) {
    case "success":
      return t(lang, { zh: "成功", en: "Success" });
    case "error":
      return t(lang, { zh: "错误", en: "Error" });
    case "cancelled":
      return t(lang, { zh: "已取消", en: "Cancelled" });
    case "rejected":
      return t(lang, { zh: "已拦截", en: "Rejected" });
    default:
      return value;
  }
}

function mcpCallStatusTone(value: string) {
  switch (value) {
    case "success":
      return "success";
    case "error":
    case "rejected":
      return "warn";
    case "cancelled":
      return "";
    default:
      return "";
  }
}

function mcpRiskLabel(lang: "zh" | "en", value: string) {
  switch (value) {
    case "low":
      return t(lang, { zh: "低风险", en: "Low risk" });
    case "medium":
      return t(lang, { zh: "中风险", en: "Medium risk" });
    case "high":
      return t(lang, { zh: "高风险", en: "High risk" });
    case "critical":
      return t(lang, { zh: "关键风险", en: "Critical risk" });
    default:
      return value;
  }
}

function mcpRiskTone(value: string) {
  switch (value) {
    case "low":
      return "success";
    case "medium":
      return "active";
    case "high":
    case "critical":
      return "warn";
    default:
      return "";
  }
}

function formatDataVolume(value: number | null) {
  if (value === null || value <= 0) {
    return "--";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${value} B`;
}

function hasInformationCollectionData(
  informationCollection: RunInformationCollection | null | undefined
) {
  if (!informationCollection) {
    return false;
  }

  return (
    informationCollection.requiredCount > 0 ||
    informationCollection.satisfiedCount > 0 ||
    informationCollection.missingCount > 0 ||
    informationCollection.userMessageCount > 0 ||
    informationCollection.attachmentCount > 0 ||
    informationCollection.slotSchemaVersion !== null
  );
}

function informationCollectionStatusLabel(
  lang: "zh" | "en",
  status: RunInformationCollection["status"]
) {
  switch (status) {
    case "completed":
      return t(lang, { zh: "已补齐", en: "Completed" });
    case "in_progress":
      return t(lang, { zh: "补充中", en: "In progress" });
    case "pending":
    default:
      return t(lang, { zh: "待补充", en: "Pending" });
  }
}

function informationCollectionSlotStatusLabel(
  lang: "zh" | "en",
  status: RunInformationCollection["slots"][number]["status"]
) {
  switch (status) {
    case "satisfied":
      return t(lang, { zh: "已满足", en: "Satisfied" });
    case "missing":
      return t(lang, { zh: "缺失", en: "Missing" });
    case "optional":
    default:
      return t(lang, { zh: "可选", en: "Optional" });
  }
}

function buildInformationCollectionItems(
  lang: "zh" | "en",
  informationCollection: RunInformationCollection
) {
  return [...informationCollection.slots]
    .sort((left, right) => {
      const leftRank =
        left.status === "missing" && left.required ? 0 : left.status === "satisfied" ? 2 : 1;
      const rightRank =
        right.status === "missing" && right.required ? 0 : right.status === "satisfied" ? 2 : 1;
      return leftRank - rightRank;
    })
    .slice(0, 4)
    .map((slot) => {
      const requirement = slot.required
        ? t(lang, { zh: "必填", en: "Required" })
        : t(lang, { zh: "可选", en: "Optional" });
      const status = informationCollectionSlotStatusLabel(lang, slot.status);
      const attachmentPart =
        slot.attachmentCount > 0
          ? t(lang, {
              zh: `附件 ${slot.attachmentCount}`,
              en: `${slot.attachmentCount} attachment${slot.attachmentCount === 1 ? "" : "s"}`,
            })
          : null;
      const answerPart =
        slot.answerCount > 0
          ? t(lang, {
              zh: `回答 ${slot.answerCount}`,
              en: `${slot.answerCount} answer${slot.answerCount === 1 ? "" : "s"}`,
            })
          : null;
      const detail =
        slot.lastAnswerText?.trim() ||
        slot.prompt?.trim() ||
        slot.description?.trim();
      return [slot.title, requirement, status, attachmentPart, answerPart, detail]
        .filter((item): item is string => Boolean(item))
        .join(" / ");
    });
}

type InformationCollectionAnswer = RunInformationCollection["answers"][number];

type ReviewableInformationAnswer = InformationCollectionAnswer & {
  slotTitle: string;
};

type ReviewFormState = {
  open: boolean;
  note: string;
  replacementValueText: string;
  replacementAttachmentPath: string;
  replacementAttachmentLabel: string;
};

function informationCollectionAnswerReviewStatusLabel(
  lang: "zh" | "en",
  status: InformationCollectionAnswer["reviewStatus"]
) {
  switch (status) {
    case "approved":
      return t(lang, { zh: "已批准", en: "Approved" });
    case "rejected":
      return t(lang, { zh: "已驳回", en: "Rejected" });
    case "superseded":
      return t(lang, { zh: "已替换", en: "Superseded" });
    case "pending":
    default:
      return t(lang, { zh: "待复核", en: "Pending review" });
  }
}

function informationCollectionAnswerReviewTone(status: InformationCollectionAnswer["reviewStatus"]) {
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

function informationCollectionAnswerSourceLabel(
  lang: "zh" | "en",
  source: InformationCollectionAnswer["source"]
) {
  switch (source) {
    case "manual-review":
      return t(lang, { zh: "人工复核", en: "Manual review" });
    case "user-message":
    default:
      return t(lang, { zh: "用户消息", en: "User message" });
  }
}

function informationCollectionAnswerPreview(
  lang: "zh" | "en",
  answer: InformationCollectionAnswer
) {
  if (answer.kind === "attachment") {
    const attachmentLabel = answer.attachmentLabel?.trim();
    const attachmentPath = answer.attachmentPath?.trim();
    if (attachmentLabel && attachmentPath) {
      return `${attachmentLabel} / ${attachmentPath}`;
    }

    return (
      attachmentLabel ||
      attachmentPath ||
      t(lang, {
        zh: "附件答案",
        en: "Attachment answer",
      })
    );
  }

  return (
    answer.valueText?.trim() ||
    t(lang, {
      zh: "空文本",
      en: "Empty text",
    })
  );
}

function createDefaultReviewFormState(answer: InformationCollectionAnswer): ReviewFormState {
  return {
    open: false,
    note: "",
    replacementValueText: answer.valueText ?? "",
    replacementAttachmentPath: answer.attachmentPath ?? "",
    replacementAttachmentLabel: answer.attachmentLabel ?? "",
  };
}

function createEmptyReviewFormState(): ReviewFormState {
  return {
    open: false,
    note: "",
    replacementValueText: "",
    replacementAttachmentPath: "",
    replacementAttachmentLabel: "",
  };
}

function getInstanceTags(instance: InstanceRecord) {
  const explicitTags = (instance as InstanceRecord & { tags?: string[] }).tags;
  if (explicitTags && explicitTags.length > 0) {
    return explicitTags;
  }

  const tags = new Set<string>();
  tags.add(instance.workspaceId === "personal" ? "#personal" : "#enterprise");

  if (instance.statusClass === "warn" || instance.statusClass === "danger") {
    tags.add("#approval");
  } else if (instance.statusClass === "success") {
    tags.add("#result");
  } else {
    tags.add("#running");
  }

  if (isLiveRunId(instance.id)) {
    tags.add("#live");
  }

  if (instance.targetPath.includes("tax")) {
    tags.add("#tax");
  } else if (instance.targetPath.includes("drama")) {
    tags.add("#drama");
  } else if (instance.targetPath.includes("poster") || instance.targetPath.includes("brand")) {
    tags.add("#image");
  }

  return Array.from(tags);
}

function getInstanceAttention(instance: InstanceRecord) {
  const attentionMode = (instance as InstanceRecord & { attentionMode?: "todo" | "running" | "done" })
    .attentionMode;
  if (attentionMode) {
    return {
      needsApproval: attentionMode === "todo",
      resultReady: attentionMode === "done",
      unreadCount: getUnreadCount(instance),
    };
  }

  return {
    needsApproval: instance.statusClass === "warn" || instance.statusClass === "danger",
    resultReady:
      instance.statusClass === "success" ||
      instance.files.items.some((item) => item.type === "output" || item.type === "bundle"),
    unreadCount: getUnreadCount(instance),
  };
}

function normalizeDirectoryPath(value: string) {
  if (!value) {
    return "/";
  }

  const nextValue = value.replace(/\\/g, "/");
  return nextValue.endsWith("/") ? nextValue : `${nextValue}/`;
}

function resolveDirectoryPath(rootPath: string, value: string) {
  if (!value) {
    return normalizeDirectoryPath(rootPath);
  }

  if (value.startsWith("/")) {
    return normalizeDirectoryPath(value);
  }

  return normalizeDirectoryPath(`${normalizeDirectoryPath(rootPath)}${value.replace(/^\/+/, "")}`);
}

function buildBreadcrumbs(path: string) {
  const normalizedPath = normalizeDirectoryPath(path);
  const segments = normalizedPath.split("/").filter(Boolean);
  const crumbs: Array<{ label: string; path: string }> = [];

  let current = "/";
  crumbs.push({ label: "/", path: current });

  for (const segment of segments) {
    current = current === "/" ? `/${segment}/` : `${current}${segment}/`;
    crumbs.push({ label: segment, path: current });
  }

  return crumbs;
}

function toTestIdSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function InstanceTabPanel({ instance, liveMode }: { instance: InstanceRecord; liveMode: boolean }) {
  const lang = useDashboardUiStore((state) => state.lang);
  const instanceTab = useDashboardUiStore((state) => state.instanceTab);
  const [selectedFilePath, setSelectedFilePath] = useState(instance.files.items[0]?.path ?? null);
  const [currentPath, setCurrentPath] = useState(
    normalizeDirectoryPath(instance.files.currentPath || instance.targetPath)
  );
  const [pathInput, setPathInput] = useState(
    normalizeDirectoryPath(instance.files.currentPath || instance.targetPath)
  );
  const [pathError, setPathError] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [downloadingPath, setDownloadingPath] = useState("");

  useEffect(() => {
    setSelectedFilePath(instance.files.items[0]?.path ?? null);
    const nextPath = normalizeDirectoryPath(instance.files.currentPath || instance.targetPath);
    setCurrentPath(nextPath);
    setPathInput(nextPath);
    setPathError("");
    setFileSearch("");
    setDownloadingPath("");
  }, [instance.files.currentPath, instance.files.items, instance.id, instance.targetPath]);

  const rootPath = normalizeDirectoryPath(instance.targetPath);
  const pathOptions = useMemo(() => {
    const collected = new Set<string>([rootPath, normalizeDirectoryPath(instance.files.currentPath || rootPath)]);

    for (const path of instance.files.paths) {
      collected.add(resolveDirectoryPath(rootPath, path));
    }

    for (const item of instance.files.items) {
      const lastSlash = item.path.lastIndexOf("/");
      if (lastSlash > 0) {
        collected.add(normalizeDirectoryPath(item.path.slice(0, lastSlash + 1)));
      }
    }

    return Array.from(collected);
  }, [instance.files.currentPath, instance.files.items, instance.files.paths, rootPath]);

  const visibleFiles = useMemo(() => {
    return instance.files.items.filter((item) => {
      if (!item.path.startsWith(currentPath)) {
        return false;
      }

      return matchesSearchQuery(fileSearch, [item.name, item.path, item.type, t(lang, item.note)]);
    });
  }, [currentPath, fileSearch, instance.files.items, lang]);

  useEffect(() => {
    if (!selectedFilePath || !visibleFiles.some((item) => item.path === selectedFilePath)) {
      setSelectedFilePath(visibleFiles[0]?.path ?? null);
    }
  }, [selectedFilePath, visibleFiles]);

  const selectedFile =
    visibleFiles.find((item) => item.path === selectedFilePath) ?? visibleFiles[0] ?? null;

  const breadcrumbs = useMemo(() => buildBreadcrumbs(currentPath), [currentPath]);

  const applyCurrentPath = (value: string) => {
    const normalizedValue = normalizeDirectoryPath(value.trim());

    if (!normalizedValue.startsWith(rootPath)) {
      setPathError(
        t(lang, {
          zh: "路径必须保持在当前实例目标路径白名单内。",
          en: "The path must remain inside the allowlisted target path for this instance.",
        })
      );
      return;
    }

    setCurrentPath(normalizedValue);
    setPathInput(normalizedValue);
    setPathError("");
  };

  const filePreviewQuery = useQuery({
    enabled: liveMode && instanceTab === "files" && Boolean(selectedFile?.path),
    queryKey: ["dashboard", "runs", instance.id, "files", "preview", selectedFile?.path ?? ""],
    queryFn: async () => {
      if (!selectedFile?.path) {
        return null;
      }

      try {
        return await dashboardRunsApi.previewRunFile(instance.id, selectedFile.path);
      } catch {
        return null;
      }
    },
  });

  const billingSummaryQuery = useQuery({
    enabled: liveMode && instanceTab === "overview",
    queryKey: ["dashboard", "billing", "summary", "run", instance.id],
    queryFn: async () => {
      try {
        return await dashboardBillingApi.getSummary({ runId: instance.id });
      } catch {
        return null;
      }
    },
    refetchInterval: 10_000,
    retry: false,
  });

  const billingEntriesQuery = useQuery({
    enabled: liveMode && instanceTab === "overview",
    queryKey: ["dashboard", "billing", "entries", "run", instance.id],
    queryFn: async () => {
      try {
        return await dashboardBillingApi.listEntries({ runId: instance.id });
      } catch {
        return [];
      }
    },
    refetchInterval: 10_000,
    retry: false,
  });

  const mcpCallsQuery = useQuery({
    enabled: liveMode && instanceTab === "audit",
    queryKey: ["dashboard", "runs", instance.id, "mcp-calls"],
    queryFn: async () => {
      try {
        return await dashboardRunsApi.listRunMcpCalls(instance.id, { limit: 8 });
      } catch {
        return [];
      }
    },
    refetchInterval: 10_000,
    retry: false,
  });

  const topBillingMetric =
    [...(billingSummaryQuery.data?.metrics ?? [])].sort((left, right) => right.amountUsd - left.amountUsd)[0] ?? null;
  const recentBillingEntries = [...(billingEntriesQuery.data ?? [])]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 4);
  const recentMcpCalls = [...(mcpCallsQuery.data ?? [])]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 6);
  const latestMcpCall = recentMcpCalls[0] ?? null;
  const distinctMcpCount = new Set(recentMcpCalls.map((item) => item.mcpId)).size;
  const mcpIssueCount = recentMcpCalls.filter((item) => item.status !== "success").length;

  if (instanceTab === "files") {
    return (
      <div className="detail-body">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "文件", en: "Files" })}</div>
            <div className="tab-title">{t(lang, { zh: "当前路径", en: "Current path" })}</div>
          </div>
          <span className="pill active" data-testid="dashboard-instance-files-current-path">
            {currentPath}
          </span>
        </div>
        <div className="pill-row crumb-row">
          {breadcrumbs.map((crumb) => (
            <button
              className={`path-chip ${crumb.path === currentPath ? "active" : ""}`}
              key={crumb.path}
              type="button"
              onClick={() => applyCurrentPath(crumb.path)}
            >
              {crumb.label}
            </button>
          ))}
        </div>
        <div className="pill-row">
          {pathOptions.map((path) => (
            <button
              className={`path-chip ${path === currentPath ? "active" : ""}`}
              key={path}
              type="button"
              onClick={() => applyCurrentPath(path)}
            >
              {path === rootPath ? t(lang, { zh: "任务根目录", en: "Task root" }) : path.replace(rootPath, "")}
            </button>
          ))}
        </div>
        <div className="path-editor">
          <label className="fake-input">
            <svg
              className="icon"
              style={{ display: "inline-block", verticalAlign: -4, width: 14, height: 14, marginRight: 6 }}
            >
              <use href="#i-folder" />
            </svg>
            <input
              className="search-inline-input"
              type="text"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder={t(lang, {
                zh: "输入当前实例目标路径下的目录",
                en: "Type a directory under the current instance target path",
              })}
            />
          </label>
          <button className="route-btn active" type="button" onClick={() => applyCurrentPath(pathInput)}>
            {t(lang, { zh: "切换路径", en: "Apply path" })}
          </button>
        </div>
        {pathError ? <div className="section-note">{pathError}</div> : null}
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
            data-testid="dashboard-instance-files-search"
            value={fileSearch}
            onChange={(event) => setFileSearch(event.target.value)}
            placeholder={t(lang, {
              zh: "搜索当前目录中的文件名、类型或说明",
              en: "Search file names, kinds, or notes in the current directory",
            })}
          />
        </label>
        <div className="section-note">
          {t(lang, {
            zh: `当前目录下命中 ${visibleFiles.length} 个文件。文件浏览限制在 ${rootPath} 内，不允许越出任务白名单目录。`,
            en: `Matched ${visibleFiles.length} files in the current directory. File browsing is restricted to ${rootPath} and cannot leave the task allowlist.`,
          })}
        </div>
        {instance.files.items.length > 0 ? (
          visibleFiles.map((item) => (
            <button
              className={`file-select ${selectedFile?.path === item.path ? "active" : ""}`}
              data-testid={`dashboard-instance-file-select-${toTestIdSegment(item.name)}`}
              key={item.path}
              type="button"
              onClick={() => setSelectedFilePath(item.path)}
            >
              <div className="file-name">{item.name}</div>
              <div className="file-meta">{t(lang, item.note)}</div>
              <div className="pill-row">
                <span
                  className={`pill ${
                    item.type === "output"
                      ? "success"
                      : item.type === "archive"
                        ? "warn"
                        : item.type === "receipt"
                          ? "active"
                          : "active"
                  }`}
                >
                  {item.type}
                </span>
              </div>
            </button>
          ))
        ) : (
          <div className="detail-item">
            <div className="meta">
              {t(lang, {
                zh: "当前实例还没有可展示的文件变化。",
                en: "No file changes are available yet for this run.",
              })}
            </div>
          </div>
        )}
        {instance.files.items.length > 0 && visibleFiles.length === 0 ? (
          <div className="detail-item">
            <div className="meta">
              {t(lang, {
                zh: "当前目录下没有匹配文件。可以切换路径，或清空搜索词。",
                en: "There are no matched files in this directory. Switch the path or clear the query.",
              })}
            </div>
          </div>
        ) : null}
        {selectedFile ? (
          <div className="preview-panel" data-testid="dashboard-instance-file-preview">
            <div className="section-head">
              <div>
                <div className="eyebrow">{t(lang, { zh: "文件预览", en: "File Preview" })}</div>
                <div className="tab-title">{selectedFile.name}</div>
              </div>
              <div className="pill-row">
                <span className="pill active">{selectedFile.type}</span>
                {liveMode ? (
                  <button
                    className="route-btn active"
                    data-testid="dashboard-instance-file-download"
                    type="button"
                    disabled={downloadingPath === selectedFile.path}
                    onClick={async () => {
                      try {
                        setDownloadingPath(selectedFile.path);
                        const url =
                          filePreviewQuery.data?.downloadUrl ??
                          (await requestDashboardRunFileDownloadUrl(instance.id, selectedFile.path));
                        window.open(url, "_blank", "noopener,noreferrer");
                      } finally {
                        setDownloadingPath("");
                      }
                    }}
                  >
                    {downloadingPath === selectedFile.path
                      ? t(lang, { zh: "准备下载中", en: "Preparing download" })
                      : t(lang, { zh: "下载文件", en: "Download" })}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="meta preview-meta">{selectedFile.path}</div>
            <div className="meta">{t(lang, selectedFile.note)}</div>
            {liveMode ? (
              filePreviewQuery.isPending ? (
                <pre className="preview-code">
                  {t(lang, { zh: "正在读取文件内容...", en: "Reading file content..." })}
                </pre>
              ) : filePreviewQuery.data ? (
                filePreviewQuery.data.mode === "text" ? (
                  <pre className="preview-code">
                    {`${filePreviewQuery.data.content ?? ""}${
                      filePreviewQuery.data.truncated
                        ? `\n\n${t(lang, {
                            zh: "[内容过长，已截断。请下载完整文件。]",
                            en: "[The preview is truncated. Download the full file.]",
                          })}`
                        : ""
                    }`}
                  </pre>
                ) : filePreviewQuery.data.mode === "image" && filePreviewQuery.data.downloadUrl ? (
                  <div className="preview-media-shell">
                    <img
                      className="preview-media"
                      src={filePreviewQuery.data.downloadUrl}
                      alt={selectedFile.name}
                    />
                  </div>
                ) : filePreviewQuery.data.mode === "pdf" && filePreviewQuery.data.downloadUrl ? (
                  <div className="preview-embed-shell">
                    <iframe
                      className="preview-embed"
                      src={filePreviewQuery.data.downloadUrl}
                      title={selectedFile.name}
                    />
                  </div>
                ) : (
                  <pre className="preview-code">
                    {t(lang, {
                      zh: "当前文件更适合直接下载查看，或者后端尚未返回可预览内容。",
                      en: "This file is better inspected through download, or the backend did not return an inline preview.",
                    })}
                  </pre>
                )
              ) : (
                <pre className="preview-code">
                  {t(lang, {
                    zh: "当前文件更适合直接下载查看，或者后端尚未返回可预览内容。",
                    en: "This file is better inspected through download, or the backend did not return an inline preview.",
                  })}
                </pre>
              )
            ) : (
              <pre className="preview-code">
                {t(
                  lang,
                  selectedFile.preview ?? {
                    zh: "当前文件暂无可用预览内容，请直接下载或等待后端返回可内联预览的数据。",
                    en: "Inline preview is currently unavailable for this file. Download it directly or wait for the backend to return previewable content.",
                  }
                )}
              </pre>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  if (instanceTab === "runtime") {
    const runtimeRows = [
      {
        key: "runtime-lifecycle",
        label: t(lang, { zh: "Runtime 生命周期", en: "Runtime lifecycle" }),
        value: instance.lifecycle.runtimeStatus,
      },
      {
        key: "record-lifecycle",
        label: t(lang, { zh: "记录状态", en: "Record lifecycle" }),
        value: instance.lifecycle.recordStatus,
      },
      {
        key: "launch-mode",
        label: t(lang, { zh: "启动模式", en: "Launch mode" }),
        value: formatRuntimeLaunchMode(lang, instance.runtime.launchMode),
      },
      {
        key: "container-name",
        label: t(lang, { zh: "容器名", en: "Container name" }),
        value: instance.runtime.containerName ?? t(lang, { zh: "未上报", en: "Not reported" }),
      },
      {
        key: "provider-label",
        label: t(lang, { zh: "Provider", en: "Provider" }),
        value: instance.runtime.providerLabel ?? t(lang, { zh: "未解析", en: "Not resolved" }),
      },
      {
        key: "provider-model",
        label: t(lang, { zh: "模型", en: "Model" }),
        value: instance.runtime.providerModel ?? t(lang, { zh: "未上报", en: "Not reported" }),
      },
      {
        key: "provider-base-url",
        label: t(lang, { zh: "上游 Base URL", en: "Upstream base URL" }),
        value: instance.runtime.providerBaseUrl ?? t(lang, { zh: "未上报", en: "Not reported" }),
      },
      {
        key: "started-at",
        label: t(lang, { zh: "启动时间", en: "Started at" }),
        value: formatRuntimeTimestamp(lang, instance.runtime.startedAt),
      },
      {
        key: "ready-at",
        label: t(lang, { zh: "就绪时间", en: "Ready at" }),
        value: formatRuntimeTimestamp(lang, instance.runtime.readyAt),
      },
      {
        key: "finished-at",
        label: t(lang, { zh: "结束时间", en: "Finished at" }),
        value: formatRuntimeTimestamp(lang, instance.runtime.finishedAt),
      },
      {
        key: "stop-requested-at",
        label: t(lang, { zh: "停止请求时间", en: "Stop requested at" }),
        value: formatRuntimeTimestamp(lang, instance.lifecycle.stopRequestedAt),
      },
      {
        key: "released-at",
        label: t(lang, { zh: "资源释放时间", en: "Released at" }),
        value: formatRuntimeTimestamp(lang, instance.lifecycle.releasedAt),
      },
      {
        key: "billing-stopped-at",
        label: t(lang, { zh: "计费截止时间", en: "Billing stopped at" }),
        value: formatRuntimeTimestamp(lang, instance.lifecycle.billingStoppedAt),
      },
      {
        key: "cleanup-attempts",
        label: t(lang, { zh: "释放尝试次数", en: "Release attempts" }),
        value: String(instance.lifecycle.cleanupAttemptCount),
      },
      {
        key: "exit-code",
        label: t(lang, { zh: "退出码", en: "Exit code" }),
        value:
          instance.runtime.exitCode !== null
            ? String(instance.runtime.exitCode)
            : t(lang, { zh: "未上报", en: "Not reported" }),
      },
      {
        key: "exit-signal",
        label: t(lang, { zh: "退出信号", en: "Exit signal" }),
        value: instance.runtime.exitSignal ?? t(lang, { zh: "未上报", en: "Not reported" }),
      },
    ];
    const runtimeReady = hasRuntimeTelemetry(instance.runtime) || instance.lifecycle.runtimeStatus !== "NOT_STARTED";

    return (
      <div className="detail-body">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "运行", en: "Runtime" })}</div>
            <div className="tab-title">
              {t(lang, { zh: "正式运行元数据", en: "Formal runtime metadata" })}
            </div>
          </div>
          <span className={`pill ${runtimeReady ? "success" : "warn"}`}>
            {runtimeReady
              ? t(lang, { zh: "已接入", en: "Available" })
              : t(lang, { zh: "等待上报", en: "Pending" })}
          </span>
        </div>
        {!runtimeReady ? (
          <div className="panel-empty">
            {t(lang, {
              zh: "当前实例尚未上报正式运行元数据。该页不会再拼接容器镜像或挂载占位信息，只有后端写入真实字段后才会展示。",
              en: "This run has not reported formal runtime metadata yet. The dashboard keeps this view empty until the backend writes real runtime fields.",
            })}
          </div>
        ) : null}
        {runtimeReady
          ? runtimeRows.map((item) => (
              <div className="detail-item" key={item.key}>
                <div className="file-name">{item.label}</div>
                <div className="meta mono">{item.value}</div>
              </div>
            ))
          : null}
        {instance.lifecycle.releaseFailure ? (
          <div className="composer-error">
            {t(lang, { zh: "最近一次释放错误：", en: "Latest release error: " })}
            {instance.lifecycle.releaseFailure}
          </div>
        ) : null}
        {instance.lifecycle.deletionFailure ? (
          <div className="composer-error">
            {t(lang, { zh: "最近一次销毁错误：", en: "Latest deletion error: " })}
            {instance.lifecycle.deletionFailure}
          </div>
        ) : null}
      </div>
    );
  }

  if (instanceTab === "audit") {
    return (
      <div className="detail-body">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "审计", en: "Audit" })}</div>
            <div className="tab-title">{t(lang, { zh: "调用时间线与运行边界", en: "Call timeline and runtime boundaries" })}</div>
          </div>
          <span className={`pill ${recentMcpCalls.length > 0 ? "active" : "warn"}`}>
            {recentMcpCalls.length > 0
              ? t(lang, { zh: `${recentMcpCalls.length} 条 MCP 记录`, en: `${recentMcpCalls.length} MCP records` })
              : t(lang, { zh: "按需查看", en: "On demand" })}
          </span>
        </div>
        {liveMode ? (
          <div className="governance-stack">
            <article className="detail-item governance-card">
              <div className="card-row">
                <div>
                  <div className="file-name">{t(lang, { zh: "最近 MCP 调用", en: "Recent MCP activity" })}</div>
                  <div className="meta">
                    {t(lang, {
                      zh: "这里展示当前实例内真实发生的 connector/tool 调用、风险等级和审计状态。",
                      en: "This shows the real connector/tool calls, risk levels, and audit states recorded for the active run.",
                    })}
                  </div>
                </div>
                <span className={`pill ${mcpIssueCount > 0 ? "warn" : recentMcpCalls.length > 0 ? "success" : ""}`}>
                  {mcpCallsQuery.isFetching
                    ? t(lang, { zh: "同步中", en: "Syncing" })
                    : t(lang, { zh: `${recentMcpCalls.length} 条`, en: `${recentMcpCalls.length} items` })}
                </span>
              </div>

              {mcpCallsQuery.isPending && recentMcpCalls.length === 0 ? (
                <div className="panel-empty">
                  {t(lang, {
                    zh: "正在同步 MCP 审计记录。",
                    en: "Syncing MCP audit records.",
                  })}
                </div>
              ) : recentMcpCalls.length === 0 ? (
                <div className="panel-empty">
                  {t(lang, {
                    zh: "当前实例还没有记录到 MCP 调用。",
                    en: "No MCP call has been recorded for this run yet.",
                  })}
                </div>
              ) : (
                <>
                  <div className="quick-grid">
                    <div className="quick-box">
                      <div className="quick-label">{t(lang, { zh: "调用数", en: "Calls" })}</div>
                      <div className="quick-value">{String(recentMcpCalls.length)}</div>
                      <div className="tiny-note">
                        {t(lang, {
                          zh: "当前审计窗口内已采集的调用条目数。",
                          en: "Calls collected inside the current audit window.",
                        })}
                      </div>
                    </div>
                    <div className="quick-box">
                      <div className="quick-label">{t(lang, { zh: "连接器", en: "Connectors" })}</div>
                      <div className="quick-value">{String(distinctMcpCount)}</div>
                      <div className="tiny-note">
                        {latestMcpCall ? latestMcpCall.displayName : t(lang, { zh: "暂无", en: "None yet" })}
                      </div>
                    </div>
                    <div className="quick-box">
                      <div className="quick-label">{t(lang, { zh: "最近发生", en: "Latest" })}</div>
                      <div className="quick-value">{formatBillingOccurredAt(lang, latestMcpCall?.occurredAt ?? null)}</div>
                      <div className="tiny-note">
                        {latestMcpCall
                          ? `${latestMcpCall.toolName} / ${mcpCallStatusLabel(lang, latestMcpCall.status)}`
                          : t(lang, { zh: "尚无记录", en: "No activity yet" })}
                      </div>
                    </div>
                    <div className="quick-box">
                      <div className="quick-label">{t(lang, { zh: "异常/拦截", en: "Issues" })}</div>
                      <div className="quick-value">{String(mcpIssueCount)}</div>
                      <div className="tiny-note">
                        {t(lang, {
                          zh: "错误、取消和被策略拦截的调用会计入这里。",
                          en: "Errors, cancellations, and rejected calls are counted here.",
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="governance-stack">
                    {recentMcpCalls.map((call) => (
                      <article className="detail-item governance-card" key={call.callId}>
                        <div className="card-row">
                          <div>
                            <div className="file-name">{`${call.displayName} / ${call.toolName}`}</div>
                            <div className="meta">{call.callId}</div>
                          </div>
                          <div className="pill-row">
                            <span className={`pill ${mcpRiskTone(call.riskLevel)}`}>{mcpRiskLabel(lang, call.riskLevel)}</span>
                            <span className={`pill ${mcpCallStatusTone(call.status)}`}>{mcpCallStatusLabel(lang, call.status)}</span>
                          </div>
                        </div>
                        <div className="governance-form-grid">
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, { zh: "连接方式", en: "Transport" })}</span>
                            <div className="meta">{`${call.source} / ${call.transport}`}</div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, { zh: "耗时", en: "Duration" })}</span>
                            <div className="meta">{call.durationMs !== null ? `${call.durationMs} ms` : "--"}</div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, { zh: "输入/输出", en: "Input / Output" })}</span>
                            <div className="meta">{`${formatDataVolume(call.inputBytes)} / ${formatDataVolume(call.outputBytes)}`}</div>
                          </div>
                          <div className="fake-input governance-field">
                            <span className="tiny-note">{t(lang, { zh: "发生时间", en: "Occurred at" })}</span>
                            <div className="meta">{formatBillingOccurredAt(lang, call.occurredAt)}</div>
                          </div>
                        </div>
                        {call.inputSummary ? <div className="meta">{call.inputSummary}</div> : null}
                        {call.errorMessage ? <div className="meta">{call.errorMessage}</div> : null}
                      </article>
                    ))}
                  </div>
                </>
              )}
            </article>
          </div>
        ) : null}
        {instance.audit.timeline.map((item) => (
          <div className="audit-row" key={`${item.time}-${t(lang, item.text)}`}>
            <div className="file-name">{item.time}</div>
            <div className="meta">{t(lang, item.text)}</div>
          </div>
        ))}
        {instance.audit.boundaries.map((item, index) => (
          <div className="audit-row" key={`${index}-${t(lang, item)}`}>
            <div className="file-name">
              {t(lang, {
                zh: `边界 ${String(index + 1).padStart(2, "0")}`,
                en: `Rule ${String(index + 1).padStart(2, "0")}`,
              })}
            </div>
            <div className="meta">{t(lang, item)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="detail-body">
      <div className="section-head">
        <div>
          <div className="eyebrow">{t(lang, { zh: "概览", en: "Overview" })}</div>
          <div className="tab-title">{t(lang, { zh: "当前实例最需要看的信息", en: "What matters most right now" })}</div>
        </div>
        <span className={`pill ${instance.statusClass}`}>{t(lang, instance.status)}</span>
      </div>
      {liveMode ? (
        <>
          <div className="quick-grid">
            <div className="quick-box">
              <div className="quick-label">{t(lang, { zh: "已计量金额", en: "Metered amount" })}</div>
              <div className="quick-value">
                {formatBillingUsd(billingSummaryQuery.data?.totalAmountUsd ?? 0)}
              </div>
              <div className="tiny-note">
                {t(lang, {
                  zh: "当前实例累计的账单金额。",
                  en: "Cumulative metered amount for this run.",
                })}
              </div>
            </div>
            <div className="quick-box">
              <div className="quick-label">{t(lang, { zh: "计量事件", en: "Billing events" })}</div>
              <div className="quick-value">{String(billingSummaryQuery.data?.totalEntriesCount ?? 0)}</div>
              <div className="tiny-note">
                {t(lang, {
                  zh: "消息、上传、文件访问和运行时长都会计入。",
                  en: "Messages, uploads, file access, and runtime all contribute.",
                })}
              </div>
            </div>
            <div className="quick-box">
              <div className="quick-label">{t(lang, { zh: "最高成本项", en: "Top metric" })}</div>
              <div className="quick-value">
                {topBillingMetric ? t(lang, topBillingMetric.label) : "--"}
              </div>
              <div className="tiny-note">
                {topBillingMetric
                  ? `${formatBillingQuantity(topBillingMetric.quantity)} / ${formatBillingUsd(topBillingMetric.amountUsd)}`
                  : t(lang, { zh: "尚未产生计量。", en: "No billing yet." })}
              </div>
            </div>
            <div className="quick-box">
              <div className="quick-label">{t(lang, { zh: "最近计量", en: "Latest metering" })}</div>
              <div className="quick-value">
                {formatBillingOccurredAt(lang, billingSummaryQuery.data?.updatedAt ?? null)}
              </div>
              <div className="tiny-note">
                {billingSummaryQuery.isFetching
                  ? t(lang, { zh: "正在同步账单状态。", en: "Syncing billing state." })
                  : t(lang, {
                      zh: "每次新的运行行为都会刷新这里。",
                      en: "This refreshes whenever the run produces new billable activity.",
                    })}
              </div>
            </div>
          </div>

          <div className="governance-stack">
            <article className="detail-item governance-card">
              <div className="card-row">
                <div>
                  <div className="file-name">{t(lang, { zh: "最近计量事件", en: "Recent metering events" })}</div>
                  <div className="meta">
                    {t(lang, {
                      zh: "用于复核当前实例哪些行为正在消耗额度和成本。",
                      en: "Review which run actions are currently consuming quota and cost.",
                    })}
                  </div>
                </div>
                <span className={`pill ${recentBillingEntries.length > 0 ? "active" : ""}`}>
                  {billingSummaryQuery.isFetching ? t(lang, { zh: "同步中", en: "Syncing" }) : recentBillingEntries.length}
                </span>
              </div>

              {recentBillingEntries.length === 0 ? (
                <div className="panel-empty">
                  {t(lang, {
                    zh: "当前实例还没有产生可展示的计量记录。",
                    en: "No billable activity has been recorded for this run yet.",
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
                          <span className="tiny-note">{t(lang, { zh: "单价", en: "Unit price" })}</span>
                          <div className="meta">{formatBillingUsd(entry.unitPriceUsd)}</div>
                        </div>
                        <div className="fake-input governance-field">
                          <span className="tiny-note">{t(lang, { zh: "发生时间", en: "Occurred at" })}</span>
                          <div className="meta">{formatBillingOccurredAt(lang, entry.occurredAt)}</div>
                        </div>
                      </div>
                      {entry.note ? <div className="meta">{entry.note}</div> : null}
                    </article>
                  ))}
                </div>
              )}
            </article>
          </div>
        </>
      ) : null}
      {instance.overview.cards.map((card) => (
        <div className="detail-item" key={t(lang, card.label)}>
          <div className="file-name">{t(lang, card.label)}</div>
          <div className="meta">{t(lang, card.value)}</div>
        </div>
      ))}
    </div>
  );
}

export function InstancesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { instanceId, detailTab } = useParams();
  const lang = useDashboardUiStore((state) => state.lang);
  const currentWorkspaceId = useDashboardUiStore((state) => state.currentWorkspaceId);
  const authWorkspaces = useDashboardAuthStore((state) => state.workspaces);
  const authCurrentWorkspace = useDashboardAuthStore((state) => state.currentWorkspace);
  const activeInstanceId = useDashboardUiStore((state) => state.activeInstanceId);
  const setActiveInstanceId = useDashboardUiStore((state) => state.setActiveInstanceId);
  const instanceTab = useDashboardUiStore((state) => state.instanceTab);
  const setInstanceTab = useDashboardUiStore((state) => state.setInstanceTab);
  const instanceDrafts = useDashboardUiStore((state) => state.instanceDrafts);
  const setInstanceDraft = useDashboardUiStore((state) => state.setInstanceDraft);
  const clearInstanceDraft = useDashboardUiStore((state) => state.clearInstanceDraft);
  const [searchQuery, setSearchQuery] = useState("");
  const [listMode, setListMode] = useState<InstanceListMode>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "warn" | "success" | "failed" | "cancelled">("all");
  const [recordFilter, setRecordFilter] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [tagFilter, setTagFilter] = useState("all");
  const [newInstanceOpen, setNewInstanceOpen] = useState(false);
  const currentWorkspace = useMemo(
    () =>
      resolveDashboardWorkspaceView({
        selectionId: currentWorkspaceId,
        workspaces: authWorkspaces.length > 0 ? authWorkspaces : undefined,
        fallbackWorkspace: authCurrentWorkspace,
      }),
    [authCurrentWorkspace, authWorkspaces, currentWorkspaceId]
  );
  const workspaceDataReady = hasAuthoritativeDashboardWorkspaceContext(currentWorkspace);

  const runsQuery = useQuery({
    queryKey: ["dashboard", "runs"],
    queryFn: async () => {
      try {
        return await dashboardRunsApi.listRuns();
      } catch {
        return [];
      }
    },
    enabled: workspaceDataReady,
    refetchInterval: 10_000,
  });

  const filteredRunsQuery = useQuery({
    queryKey: [
      "dashboard",
      "runs",
      "filtered",
      currentWorkspace.selectionId,
      currentWorkspace.id,
      listMode,
      statusFilter,
      recordFilter,
      tagFilter,
      searchQuery,
    ],
    queryFn: async () => {
      try {
        return await dashboardRunsApi.listRuns({
          q: searchQuery.trim() || undefined,
          attentionMode: toListAttentionModeFilter(listMode),
          viewStatus: toListViewStatusFilter(statusFilter),
          tag: tagFilter === "all" ? undefined : tagFilter,
          recordStatus: recordFilter,
        });
      } catch {
        return [];
      }
    },
    enabled: workspaceDataReady,
    refetchInterval: 10_000,
    retry: false,
  });

  const runsSummaryQuery = useQuery({
    queryKey: ["dashboard", "runs", "summary", currentWorkspace.selectionId, currentWorkspace.id],
    queryFn: async () => {
      try {
        return await dashboardRunsApi.getRunsSummary();
      } catch {
        return null;
      }
    },
    enabled: workspaceDataReady,
    refetchInterval: 10_000,
    retry: false,
  });

  const liveRunDetailQuery = useQuery({
    enabled: isLiveRunId(instanceId ?? activeInstanceId),
    queryKey: ["dashboard", "runs", instanceId ?? activeInstanceId],
    queryFn: async () => {
      const targetId = instanceId ?? activeInstanceId;
      if (!isLiveRunId(targetId)) {
        return null;
      }

      try {
        return await dashboardRunsApi.getRun(targetId);
      } catch {
        return null;
      }
    },
    refetchInterval: 10_000,
  });

  const liveRunFilesQuery = useQuery({
    enabled: isLiveRunId(instanceId ?? activeInstanceId),
    queryKey: ["dashboard", "runs", instanceId ?? activeInstanceId, "files"],
    queryFn: async () => {
      const targetId = instanceId ?? activeInstanceId;
      if (!isLiveRunId(targetId)) {
        return [];
      }

      try {
        return await dashboardRunsApi.listRunFileTree(targetId);
      } catch {
        return [];
      }
    },
    refetchInterval: 10_000,
  });

  const liveInstances = useMemo(() => {
    const list = runsQuery.data ?? [];
    const mapped = list
      .map((snapshot) => mapRunSnapshotToInstanceRecord(snapshot, undefined, currentWorkspace))
      .filter((item) => item.workspaceId === currentWorkspace.id);

    return Object.fromEntries(mapped.map((item) => [item.id, item])) as Record<string, InstanceRecord>;
  }, [currentWorkspace, runsQuery.data]);

  const filteredLiveInstances = useMemo(() => {
    const list = filteredRunsQuery.data ?? [];
    return list
      .map((snapshot) => mapRunSnapshotToInstanceRecord(snapshot, undefined, currentWorkspace))
      .filter((item) => item.workspaceId === currentWorkspace.id)
      .sort((left, right) => {
        const leftLive = Number(isLiveRunId(left.id));
        const rightLive = Number(isLiveRunId(right.id));

        if (leftLive !== rightLive) {
          return rightLive - leftLive;
        }

        return left.id.localeCompare(right.id);
      });
  }, [currentWorkspace, filteredRunsQuery.data]);

  const detailedLiveInstance = useMemo(() => {
    if (!liveRunDetailQuery.data) {
      return null;
    }

    const mapped = mapRunSnapshotToInstanceRecord(
      liveRunDetailQuery.data,
      liveRunFilesQuery.data,
      currentWorkspace
    );

    return mapped.workspaceId === currentWorkspace.id ? mapped : null;
  }, [currentWorkspace, liveRunDetailQuery.data, liveRunFilesQuery.data]);

  const instanceDataMode =
    (runsSummaryQuery.data?.total ?? 0) > 0 || Object.keys(liveInstances).length > 0 || filteredLiveInstances.length > 0 || Boolean(detailedLiveInstance)
      ? "live"
      : "empty";

  const mergedInstances = useMemo(() => {
    const next: Record<string, InstanceRecord> =
      instanceDataMode === "live"
        ? { ...liveInstances }
        : {};

    if (detailedLiveInstance) {
      next[detailedLiveInstance.id] = detailedLiveInstance;
    }

    for (const filteredInstance of filteredLiveInstances) {
      next[filteredInstance.id] = filteredInstance;
    }

    return next;
  }, [detailedLiveInstance, filteredLiveInstances, instanceDataMode, liveInstances]);

  const sortedInstances = useMemo(() => {
    const all = Object.values(mergedInstances);
    return all.sort((left, right) => {
      const leftLive = Number(isLiveRunId(left.id));
      const rightLive = Number(isLiveRunId(right.id));

      if (leftLive !== rightLive) {
        return rightLive - leftLive;
      }

      return left.id.localeCompare(right.id);
    });
  }, [mergedInstances]);

  const filteredInstances = useMemo(() => {
    if (instanceDataMode === "live") {
      return filteredLiveInstances;
    }

    return [];
  }, [filteredLiveInstances, instanceDataMode]);

  const availableTags = useMemo(() => {
    if (runsSummaryQuery.data) {
      return runsSummaryQuery.data.byTag.map((item) => item.key).filter((tag) => tag.startsWith("#")).slice(0, 6);
    }

    return Array.from(new Set(sortedInstances.flatMap((item) => getInstanceTags(item)))).slice(0, 6);
  }, [runsSummaryQuery.data, sortedInstances]);

  const groupedInstances = useMemo(() => {
    const groups = [
      {
        key: "todo",
        title: t(lang, { zh: "待我处理", en: "Needs action" }),
        note: t(lang, { zh: "待审批、失败恢复、有人提及", en: "Approvals, failures, mentions" }),
        items: filteredInstances.filter((item) => getInstanceAttention(item).needsApproval),
      },
      {
        key: "running",
        title: t(lang, { zh: "运行中", en: "Running" }),
        note: t(lang, { zh: "仍在持续推进的实例", en: "Runs still progressing" }),
        items: filteredInstances.filter((item) => item.statusClass === "active"),
      },
      {
        key: "done",
        title: t(lang, { zh: "已产出", en: "Output ready" }),
        note: t(lang, { zh: "已有结果、回执或归档", en: "Outputs, receipts, or archives ready" }),
        items: filteredInstances.filter((item) => {
          const attention = getInstanceAttention(item);
          return attention.resultReady && !attention.needsApproval && item.statusClass !== "active";
        }),
      },
    ];

    return groups.filter((group) => group.items.length > 0);
  }, [filteredInstances, lang]);

  useEffect(() => {
    if (instanceId) {
      const routeInstance = mergedInstances[instanceId];
      if (routeInstance?.workspaceId === currentWorkspace.id) {
        setActiveInstanceId(instanceId);
      } else if (activeInstanceId) {
        setActiveInstanceId("");
      }
      return;
    }

    if (sortedInstances.length === 0) {
      if (activeInstanceId) {
        setActiveInstanceId("");
      }
      return;
    }

    const currentActive = mergedInstances[activeInstanceId];
    if (currentActive?.workspaceId === currentWorkspace.id) {
      return;
    }

    const fallbackId = sortedInstances[0].id;
    setActiveInstanceId(fallbackId);
    navigate(dashboardRoutes.instance(fallbackId), { replace: true });
  }, [
    activeInstanceId,
    currentWorkspace,
    instanceId,
    mergedInstances,
    navigate,
    setActiveInstanceId,
    sortedInstances,
  ]);

  useEffect(() => {
    if (isInstanceTab(detailTab)) {
      setInstanceTab(detailTab);
      return;
    }

    if (instanceId) {
      setInstanceTab("overview");
    }
  }, [detailTab, instanceId, setInstanceTab]);

  const routeInstance = instanceId ? mergedInstances[instanceId] ?? null : null;
  const routeInstanceOutOfScope = Boolean(instanceId) && routeInstance == null;
  const instance =
    routeInstance ??
    (!instanceId
      ? sortedInstances.find((item) => item.id === activeInstanceId) ??
        sortedInstances[0] ??
        null
      : null);
  const liveMode = Boolean(instance && isLiveRunId(instance.id));
  useDashboardRecentRecorder(
    instance && liveMode && currentWorkspace.source === "auth"
      ? {
          resourceType: "run",
          runId: instance.id,
          interaction: "resume",
          sourceSurface: "dashboard",
        }
      : null,
    currentWorkspace.source === "auth"
  );
  const runStream = useDashboardRunStream(instance?.id ?? null, liveMode);
  const [attachmentDraftsByInstance, setAttachmentDraftsByInstance] = useState<
    Record<string, BrowserAttachmentDraft[]>
  >({});
  const [composerError, setComposerError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [captureDrawerOpen, setCaptureDrawerOpen] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<"stop" | "archive" | "restore" | "delete" | "release" | null>(null);
  const [lifecycleError, setLifecycleError] = useState("");
  const [reviewFormsByAnswerId, setReviewFormsByAnswerId] = useState<
    Record<string, ReviewFormState>
  >({});
  const draft = instance ? instanceDrafts[instance.id] ?? "" : "";
  const attachmentDrafts = instance ? attachmentDraftsByInstance[instance.id] ?? [] : [];
  const liveSnapshot =
    liveMode && liveRunDetailQuery.data?.run.runId === instance?.id
      ? liveRunDetailQuery.data
      : null;
  const runTerminal = Boolean(
    liveSnapshot && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(liveSnapshot.run.status)
  );
  const runtimeTransitioning = Boolean(
    liveSnapshot && ["STOP_REQUESTED", "STOPPING"].includes(liveSnapshot.lifecycle.runtimeStatus)
  );
  const runInteractive = Boolean(liveSnapshot && !runTerminal && !runtimeTransitioning);
  const informationCollection = liveSnapshot?.informationCollection ?? null;
  const informationCollectionVisible = useMemo(
    () => hasInformationCollectionData(informationCollection),
    [informationCollection]
  );
  const informationCollectionItems = useMemo(
    () =>
      informationCollection
        ? buildInformationCollectionItems(lang, informationCollection)
        : [],
    [informationCollection, lang]
  );
  const reviewableInformationAnswers = useMemo<ReviewableInformationAnswer[]>(
    () =>
      informationCollection
        ? [...informationCollection.answers]
            .filter((answer) => answer.reviewStatus !== "superseded")
            .map((answer) => ({
              ...answer,
              slotTitle:
                informationCollection.slots.find((slot) => slot.key === answer.slotKey)?.title ??
                answer.slotKey,
            }))
            .sort((left, right) => {
              const rank = (status: ReviewableInformationAnswer["reviewStatus"]) => {
                switch (status) {
                  case "pending":
                    return 0;
                  case "rejected":
                    return 1;
                  case "approved":
                    return 2;
                  case "superseded":
                  default:
                    return 3;
                }
              };

              const rankDiff = rank(left.reviewStatus) - rank(right.reviewStatus);
              if (rankDiff !== 0) {
                return rankDiff;
              }

              return right.createdAt.localeCompare(left.createdAt);
            })
        : [],
    [informationCollection]
  );
  const pendingApprovals = useMemo(
    () => liveSnapshot?.approvals.filter((item) => item.state === "pending") ?? [],
    [liveSnapshot]
  );
  const pendingApproval = pendingApprovals[0] ?? null;

  const setInstanceAttachments = (instanceId: string, next: BrowserAttachmentDraft[]) => {
    setAttachmentDraftsByInstance((current) => ({
      ...current,
      [instanceId]: next,
    }));
  };

  const clearInstanceAttachments = (instanceId: string) => {
    setAttachmentDraftsByInstance((current) => {
      const next = { ...current };
      delete next[instanceId];
      return next;
    });
  };

  const updateReviewForm = (
    answerId: string,
    updater: (current: ReviewFormState) => ReviewFormState
  ) => {
    setReviewFormsByAnswerId((current) => {
      const nextCurrent = current[answerId] ?? createEmptyReviewFormState();
      return {
        ...current,
        [answerId]: updater(nextCurrent),
      };
    });
  };

  const openReviewForm = (answer: ReviewableInformationAnswer) => {
    setReviewError("");
    setReviewFormsByAnswerId((current) => ({
      ...current,
      [answer.answerId]: {
        ...(current[answer.answerId] ?? createDefaultReviewFormState(answer)),
        open: true,
      },
    }));
  };

  const closeReviewForm = (answer: ReviewableInformationAnswer) => {
    setReviewFormsByAnswerId((current) => ({
      ...current,
      [answer.answerId]: {
        ...(current[answer.answerId] ?? createDefaultReviewFormState(answer)),
        open: false,
      },
    }));
  };

  useEffect(() => {
    setComposerError("");
    setReviewError("");
    setReviewFormsByAnswerId({});
    setCaptureDrawerOpen(false);
    setLifecycleAction(null);
    setLifecycleError("");
  }, [instance?.id]);

  const approvalMutation = useMutation({
    mutationFn: async (input: ApproveRunInput) => {
      if (!instance) {
        throw new Error(
          t(lang, {
            zh: "当前工作区没有可用实例。",
            en: "There is no available run in the current workspace.",
          })
        );
      }

      if (liveMode && runStream.connected) {
        await runStream.approveAwaitAck(input);
        return null;
      }

      return await dashboardRunsApi.approveRun(instance.id, input);
    },
    onSuccess: async (snapshot) => {
      if (instance && snapshot) {
        queryClient.setQueryData(["dashboard", "runs", instance.id], snapshot);
        queryClient.setQueryData(["dashboard", "runs", instance.id, "files"], snapshot.files);
      }

      setComposerError("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "billing"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "me", "recent"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "notifications"] }),
      ]);
    },
    onError: (error) => {
      setComposerError(
        error instanceof Error
          ? error.message
          : t(lang, { zh: "审批失败，请稍后重试。", en: "Approval failed. Please try again." })
      );
    },
  });

  const approvalModeMutation = useMutation({
    mutationFn: async (approvalMode: "manual" | "auto_all") => {
      if (!instance) {
        throw new Error(t(lang, { zh: "当前没有可配置的实例。", en: "No instance is available." }));
      }
      return await dashboardRunsApi.setRunApprovalMode(instance.id, { approvalMode });
    },
    onSuccess: async (snapshot) => {
      if (instance) {
        queryClient.setQueryData(["dashboard", "runs", instance.id], snapshot);
      }
      setComposerError("");
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] });
    },
    onError: (error) => {
      setComposerError(
        error instanceof Error
          ? error.message
          : t(lang, { zh: "自动审批设置更新失败。", en: "Failed to update automatic approval." })
      );
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (input: {
      answer: ReviewableInformationAnswer;
      decision: ReviewRunInformationAnswerDecision;
      note?: string;
      replacementValueText?: string;
      replacementAttachmentPath?: string;
      replacementAttachmentLabel?: string;
    }) => {
      if (!instance) {
        throw new Error(
          t(lang, {
            zh: "当前工作区没有可用实例。",
            en: "There is no available run in the current workspace.",
          })
        );
      }

      return await dashboardRunsApi.reviewRunInformationAnswer(instance.id, {
        answerId: input.answer.answerId,
        decision: input.decision,
        note: input.note?.trim() || undefined,
        replacementValueText: input.replacementValueText?.trim() || undefined,
        replacementAttachmentPath: input.replacementAttachmentPath?.trim() || undefined,
        replacementAttachmentLabel: input.replacementAttachmentLabel?.trim() || undefined,
      });
    },
    onSuccess: async (snapshot, variables) => {
      if (instance) {
        queryClient.setQueryData(["dashboard", "runs", instance.id], snapshot);
        queryClient.setQueryData(["dashboard", "runs", instance.id, "files"], snapshot.files);
      }

      setReviewError("");
      setReviewFormsByAnswerId((current) => {
        const next = { ...current };
        delete next[variables.answer.answerId];
        return next;
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs", instance?.id] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs", instance?.id, "files"] }),
      ]);
    },
    onError: (error) => {
      setReviewError(
        error instanceof Error
          ? error.message
          : t(lang, {
              zh: "复核提交失败，请稍后重试。",
              en: "Review submission failed. Please try again.",
            })
      );
    },
  });

  const handleApprovalDecision = (approved: boolean) => {
    if (!pendingApproval) {
      return;
    }

    setComposerError("");
    approvalMutation.mutate({
      approvalId: pendingApproval.approvalId,
      approved,
      note: approved
        ? "Approved from the dashboard conversation."
        : "Rejected from the dashboard conversation.",
    });
  };

  const handleQuickReviewDecision = (
    answer: ReviewableInformationAnswer,
    decision: Exclude<ReviewRunInformationAnswerDecision, "revise">
  ) => {
    setReviewError("");
    reviewMutation.mutate({
      answer,
      decision,
      note:
        decision === "approve"
          ? "Approved from the dashboard review panel."
          : "Rejected from the dashboard review panel.",
    });
  };

  const handleRevisionSubmit = (answer: ReviewableInformationAnswer) => {
    const form = reviewFormsByAnswerId[answer.answerId] ?? createDefaultReviewFormState(answer);

    if (answer.kind === "text" && !form.replacementValueText.trim()) {
      setReviewError(
        t(lang, {
          zh: "文本答案改写必须填写替换内容。",
          en: "Text answer revisions require replacement content.",
        })
      );
      return;
    }

    if (answer.kind === "attachment" && !form.replacementAttachmentPath.trim()) {
      setReviewError(
        t(lang, {
          zh: "附件答案改写必须填写新的文件路径。",
          en: "Attachment answer revisions require a replacement file path.",
        })
      );
      return;
    }

    setReviewError("");
    reviewMutation.mutate({
      answer,
      decision: "revise",
      note: form.note,
      replacementValueText: form.replacementValueText,
      replacementAttachmentPath: form.replacementAttachmentPath,
      replacementAttachmentLabel: form.replacementAttachmentLabel,
    });
  };

  const sendMessageMutation = useMutation({
    mutationFn: async (input: {
      instanceId: string;
      text: string;
      drafts: BrowserAttachmentDraft[];
    }) => {
      if (!instance) {
        throw new Error(
          t(lang, { zh: "当前工作区没有可用实例。", en: "There is no available run in the current workspace." })
        );
      }

      const attachments = await Promise.all(
        input.drafts.map(async (draftAttachment) =>
          uploadRunAttachment(dashboardRunsApi, instance.id, {
            fileName: draftAttachment.file.name,
            contentType: draftAttachment.contentType,
            sizeBytes: draftAttachment.sizeBytes,
            content: await draftAttachment.file.arrayBuffer(),
            label: draftAttachment.label,
          })
        )
      );

      const payload = {
        text: input.text.trim() || t(lang, {
          zh: "我补充了附件，请读取并继续。",
          en: "I added attachments. Please read them and continue.",
        }),
        attachments,
        slotValues: [],
      };

      if (liveMode && runStream.connected) {
        await runStream.sendMessageAwaitAck(payload);
        return {
          mode: "ws" as const,
          snapshot: null,
        };
      }

      return {
        mode: "http" as const,
        snapshot: await dashboardRunsApi.sendRunMessage(instance.id, payload),
      };
    },
    onSuccess: async (result, variables) => {
      if (result.mode === "http" && result.snapshot) {
        queryClient.setQueryData(["dashboard", "runs", variables.instanceId], result.snapshot);
        queryClient.setQueryData(["dashboard", "runs", variables.instanceId, "files"], result.snapshot.files);
      }

      const currentDraft =
        useDashboardUiStore.getState().instanceDrafts[variables.instanceId] ?? "";
      if (currentDraft === variables.text || (!currentDraft.trim() && !variables.text.trim())) {
        clearInstanceDraft(variables.instanceId);
      }
      clearInstanceAttachments(variables.instanceId);
      setComposerError("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs", variables.instanceId] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs", variables.instanceId, "files"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "billing"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "me", "recent"] }),
      ]);
    },
    onError: (error) => {
      setComposerError(
        error instanceof Error
          ? error.message
          : t(lang, { zh: "发送失败，请稍后重试。", en: "Sending failed. Please try again." })
      );
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: async (input: { action: "stop" | "archive" | "restore" | "delete" | "release"; runId: string }) => {
      switch (input.action) {
        case "stop":
        case "release":
          return { action: input.action, snapshot: await dashboardRunsApi.stopRun(input.runId, t(lang, { zh: "用户从 Dashboard 请求停止并释放实例", en: "User requested run stop and release from Dashboard" })) };
        case "archive":
          return { action: input.action, snapshot: await dashboardRunsApi.archiveRun(input.runId, t(lang, { zh: "用户从 Dashboard 归档实例", en: "User archived the run from Dashboard" })) };
        case "restore":
          return { action: input.action, snapshot: await dashboardRunsApi.restoreRun(input.runId) };
        case "delete":
          await dashboardRunsApi.deleteRun(input.runId, t(lang, { zh: "用户确认从 Dashboard 永久删除实例", en: "User confirmed permanent run deletion from Dashboard" }));
          return { action: input.action, snapshot: null };
      }
    },
    onSuccess: async (result, variables) => {
      setLifecycleError("");
      setLifecycleAction(null);
      if (result.snapshot) {
        queryClient.setQueryData(["dashboard", "runs", variables.runId], result.snapshot);
        queryClient.setQueryData(["dashboard", "runs", variables.runId, "files"], result.snapshot.files);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "billing"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "me", "recent"] }),
      ]);
      if (result.action === "delete") {
        clearInstanceDraft(variables.runId);
        navigate(dashboardRoutes.instances, { replace: true });
      }
    },
    onError: (error) => {
      setLifecycleError(
        error instanceof Error
          ? error.message
          : t(lang, { zh: "实例生命周期操作失败。", en: "Run lifecycle operation failed." })
      );
    },
  });

  return (
    <section className="view" data-testid="dashboard-instances-page">
      <article className="filter-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "实例筛选", en: "Instance Filters" })}</div>
            <h3 className="detail-title">{t(lang, { zh: "多任务列表", en: "Multi-run list" })}</h3>
          </div>
          <button
            className="route-btn active"
            data-testid="dashboard-new-instance"
            type="button"
            disabled={!workspaceDataReady}
            onClick={() => setNewInstanceOpen(true)}
          >
            <svg className="icon"><use href="#i-terminal" /></svg>
            {t(lang, { zh: "新建实例", en: "New instance" })}
          </button>
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
              zh: "搜索任务名、按状态筛选、按标签或工作区过滤",
              en: "Search by task name, filter by status, tags, or workspace",
            })}
          />
        </label>
        <div className="pill-row">
          {[
            { key: "all" as const, label: { zh: "全部实例", en: "All runs" } },
            { key: "todo" as const, label: { zh: "待我处理", en: "Needs action" } },
            { key: "running" as const, label: { zh: "运行中", en: "Running" } },
            { key: "done" as const, label: { zh: "已产出", en: "Output ready" } },
          ].map((chip) => (
            <button
              className={`path-chip ${listMode === chip.key ? "active" : ""}`}
              key={chip.key}
              type="button"
              onClick={() => setListMode(chip.key)}
            >
              {t(lang, chip.label)}
            </button>
          ))}
        </div>
        <div className="pill-row">
          {[
            { key: "ACTIVE" as const, label: { zh: "当前实例", en: "Current" } },
            { key: "ARCHIVED" as const, label: { zh: "已归档", en: "Archived" } },
          ].map((chip) => (
            <button
              className={`path-chip ${recordFilter === chip.key ? "active" : ""}`}
              key={chip.key}
              type="button"
              onClick={() => {
                setRecordFilter(chip.key);
                setListMode("all");
                setStatusFilter("all");
              }}
            >
              {t(lang, chip.label)}
            </button>
          ))}
        </div>
        <div className="pill-row">
          {[
            { key: "all" as const, label: { zh: "全部", en: "All" }, tone: "" },
            { key: "active" as const, label: { zh: "运行中", en: "Running" }, tone: "" },
            { key: "warn" as const, label: { zh: "待审批", en: "Approval" }, tone: "warn" },
            { key: "success" as const, label: { zh: "回流完成", en: "Callback" }, tone: "success" },
            { key: "failed" as const, label: { zh: "失败", en: "Failed" }, tone: "danger" },
            { key: "cancelled" as const, label: { zh: "已取消", en: "Cancelled" }, tone: "warn" },
          ].map((chip) => (
            <button
              className={`path-chip ${statusFilter === chip.key ? "active" : chip.tone}`}
              key={chip.key}
              type="button"
              onClick={() => setStatusFilter(chip.key)}
            >
              {t(lang, chip.label)}
            </button>
          ))}
          <button
            className={`path-chip ${tagFilter === "all" ? "active" : ""}`}
            type="button"
            onClick={() => setTagFilter("all")}
          >
            {t(lang, { zh: "全部标签", en: "All tags" })}
          </button>
          {availableTags.map((tag) => (
            <button
              className={`path-chip ${tagFilter === tag ? "active" : ""}`}
              key={tag}
              type="button"
              onClick={() => setTagFilter(tag)}
            >
              {tag}
            </button>
          ))}
          <span className="path-chip">{t(lang, currentWorkspace.name)}</span>
        </div>
        <div className="section-note">
          {workspaceDataReady
            ? t(lang, {
                zh: `当前工作区根路径：${currentWorkspace.root}。筛选后保留 ${filteredInstances.length} 个实例；多实例切换保留当前输入草稿，右侧详情保持同一实例上下文。`,
                en: `Current workspace root: ${currentWorkspace.root}. Filters keep ${filteredInstances.length} runs; switching instances preserves the input draft while the right detail pane keeps the same run context.`,
              })
            : t(lang, {
                zh: "正在等待当前工作区上下文恢复。实例列表在此期间不会再用前端占位 workspace 去请求正式后端。",
                en: "Waiting for the current workspace context to recover. The instance list stays paused instead of querying the formal backend with a placeholder workspace.",
              })}
        </div>
        {routeInstanceOutOfScope ? (
          <div className="section-note">
            {t(lang, {
              zh: "当前 URL 指向的实例不在这个工作区内，面板不会再静默跳转到别的实例。请从左侧列表重新选择，或切换到对应工作区。",
              en: "The URL points to a run outside this workspace. The panel no longer silently switches to another run; choose one from the list or switch workspaces.",
            })}
          </div>
        ) : null}
        {workspaceDataReady && instanceDataMode === "empty" ? (
          <div className="section-note">
            {t(lang, {
              zh: "当前工作区还没有真实实例记录。认证工作区不会再混入样例实例，实例列表会在首个 run 建立后直接切到 live 数据主链。",
              en: "No live run has been recorded in this workspace yet. Authenticated workspaces no longer mix in sample runs, and the list will switch directly to the live data chain after the first run is created.",
            })}
          </div>
        ) : null}
      </article>

      <div className="instance-layout">
        <div className="conversation-stack">
          {filteredInstances.length === 0 ? (
            <article className="list-card">
              <div className="list-title">{t(lang, { zh: "没有匹配实例", en: "No matched instances" })}</div>
              <div className="section-note">
                {t(lang, {
                  zh: instanceDataMode === "empty" ? "创建一个空白 Codex，或清空筛选条件。" : "可以清空搜索词，或切换状态筛选。当前打开的实例不会因为筛选而被关闭。",
                  en: instanceDataMode === "empty" ? "Create a blank Codex or clear the filters." : "Clear the query or switch the status filter. The currently open instance stays active.",
                })}
              </div>
              {instanceDataMode === "empty" ? (
                <button className="route-btn active" type="button" onClick={() => setNewInstanceOpen(true)}>
                  <svg className="icon"><use href="#i-terminal" /></svg>
                  {t(lang, { zh: "新建空白实例", en: "New blank instance" })}
                </button>
              ) : null}
            </article>
          ) : null}
          {groupedInstances.map((group) => (
            <section className="list-group" key={group.key}>
              <div className="list-group-head">
                <div>
                  <div className="list-group-title">{group.title}</div>
                  <div className="list-group-note">{group.note}</div>
                </div>
                <span className="list-count">{String(group.items.length).padStart(2, "0")}</span>
              </div>
              {group.items.map((item) => {
                const unreadCount = getUnreadCount(item);
                const tags = getInstanceTags(item);
                const attention = getInstanceAttention(item);

                return (
                  <article
                    className={`list-card ${item.id === activeInstanceId ? "active" : ""} ${
                      attention.needsApproval ? "attention-warn" : attention.resultReady ? "attention-success" : ""
                    }`}
                    key={item.id}
                  >
                    <button className="card-hit" type="button" onClick={() => navigate(dashboardRoutes.instance(item.id))}>
                      <div className="instance-head">
                        <div className="list-title">{t(lang, item.title)}</div>
                        <div className="pill-row">
                          {unreadCount > 0 ? <span className="unread-badge">{unreadCount}</span> : null}
                          <span className={`pill ${item.statusClass}`}>{t(lang, item.status)}</span>
                        </div>
                      </div>
                      <div className="instance-card-meta">
                        <div className="meta">{t(lang, item.workshop)}</div>
                        <div className="meta">{`${t(lang, item.workspace)} / ${getInstanceUpdatedAt(item)}`}</div>
                      </div>
                      <div className="section-note">{t(lang, item.summary)}</div>
                      <div className="instance-card-foot">
                        <div className="pill-row">
                          <span className="path-chip active">{t(lang, item.nextAction)}</span>
                          {tags.slice(0, 3).map((tag) => (
                            <span className="path-chip" key={`${item.id}-${tag}`}>
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className="pill-row">
                          {attention.needsApproval ? (
                            <span className="attention-chip warn">{t(lang, { zh: "待处理", en: "Needs action" })}</span>
                          ) : null}
                          {attention.resultReady ? (
                            <span className="attention-chip success">{t(lang, { zh: "有结果", en: "Output ready" })}</span>
                          ) : null}
                          {isLiveRunId(item.id) ? <span className="attention-chip active">live</span> : null}
                        </div>
                      </div>
                    </button>
                  </article>
                );
              })}
            </section>
          ))}
        </div>

        <div className="conversation-shell">
          {instance ? (
            <details className="summary-panel" open>
              <summary>
                <div className="section-head">
                  <div>
                    <div className="eyebrow">{t(lang, { zh: "当前实例", en: "Active Instance" })}</div>
                    <div className="detail-title">{t(lang, instance.title)}</div>
                    <div className="meta">{t(lang, instance.summary)}</div>
                  </div>
                  <div className="pill-row">
                    {runInteractive ? (
                      <button
                        className="route-btn active session-capture-trigger"
                        type="button"
                        data-testid="dashboard-instance-capture-session"
                        onClick={(event) => {
                          event.preventDefault();
                          setCaptureDrawerOpen(true);
                        }}
                      >
                        <svg className="icon"><use href="#i-archive" /></svg>
                        {t(lang, { zh: "固化会话", en: "Capture session" })}
                      </button>
                    ) : null}
                    {runInteractive ? (
                      <button
                        className="route-btn danger"
                        type="button"
                        data-testid="dashboard-instance-stop"
                        onClick={(event) => {
                          event.preventDefault();
                          setLifecycleAction("stop");
                        }}
                      >
                        <svg className="icon"><use href="#i-x" /></svg>
                        {t(lang, { zh: "停止实例", en: "Stop run" })}
                      </button>
                    ) : null}
                    {liveSnapshot && ["RELEASE_FAILED", "ORPHANED"].includes(liveSnapshot.lifecycle.runtimeStatus) ? (
                      <button className="route-btn danger" type="button" onClick={(event) => { event.preventDefault(); setLifecycleAction("release"); }}>
                        <svg className="icon"><use href="#i-refresh" /></svg>
                        {t(lang, { zh: "重试释放", en: "Retry release" })}
                      </button>
                    ) : null}
                    {liveSnapshot?.lifecycle.recordStatus === "ARCHIVED" ? (
                      <button className="route-btn" type="button" onClick={(event) => { event.preventDefault(); setLifecycleAction("restore"); }}>
                        <svg className="icon"><use href="#i-refresh" /></svg>
                        {t(lang, { zh: "恢复归档", en: "Restore" })}
                      </button>
                    ) : liveSnapshot?.lifecycle.runtimeStatus === "RELEASED" && runTerminal ? (
                      <button className="route-btn" type="button" onClick={(event) => { event.preventDefault(); setLifecycleAction("archive"); }}>
                        <svg className="icon"><use href="#i-archive" /></svg>
                        {t(lang, { zh: "归档", en: "Archive" })}
                      </button>
                    ) : null}
                    {liveSnapshot?.lifecycle.runtimeStatus === "RELEASED" && runTerminal ? (
                      <button className="route-btn danger" type="button" onClick={(event) => { event.preventDefault(); setLifecycleAction("delete"); }}>
                        <svg className="icon"><use href="#i-trash" /></svg>
                        {t(lang, { zh: "删除", en: "Delete" })}
                      </button>
                    ) : null}
                    {liveSnapshot ? (
                      <span className={`pill ${liveSnapshot.lifecycle.runtimeStatus === "RELEASED" ? "success" : ["RELEASE_FAILED", "ORPHANED"].includes(liveSnapshot.lifecycle.runtimeStatus) ? "danger" : runtimeTransitioning ? "warn" : "active"}`}>
                        {liveSnapshot.lifecycle.runtimeStatus}
                      </span>
                    ) : null}
                    <span className={`pill ${instance.statusClass}`}>{t(lang, instance.status)}</span>
                    <span className="pill active">{t(lang, instance.workspace)}</span>
                  </div>
                </div>
              </summary>
              <div className="summary-panel-body">
                <div className="pill-row">
                  <span className="path-chip active">{instance.route}</span>
                  <span className="path-chip">{instance.targetPath}</span>
                  <span className="path-chip warn">{t(lang, instance.nextAction)}</span>
                </div>
                <div className="quick-grid">
                  {instance.metrics.map((item) => (
                    <div className="quick-box" key={t(lang, item.label)}>
                      <div className="quick-label">{t(lang, item.label)}</div>
                      <div className="quick-value">{t(lang, item.value)}</div>
                    </div>
                  ))}
                </div>
                {liveMode && informationCollectionVisible && informationCollection ? (
                  <div
                    className="detail-item"
                    data-testid="dashboard-instance-information-collection-summary"
                  >
                    <div className="instance-head">
                      <div className="file-name">
                        {t(lang, { zh: "信息采集", en: "Input collection" })}
                      </div>
                      <span
                        className={`pill ${
                          informationCollection.status === "completed"
                            ? "success"
                            : informationCollection.status === "in_progress"
                              ? "active"
                              : "warn"
                        }`}
                      >
                        {informationCollectionStatusLabel(lang, informationCollection.status)}
                      </span>
                    </div>
                    <div className="meta">{informationCollection.prompt}</div>
                    <div className="pill-row">
                      <span className="path-chip active">
                        {t(lang, {
                          zh: `必填 ${informationCollection.requiredCount}`,
                          en: `Required ${informationCollection.requiredCount}`,
                        })}
                      </span>
                      <span className="path-chip">
                        {t(lang, {
                          zh: `已满足 ${informationCollection.satisfiedCount}`,
                          en: `Satisfied ${informationCollection.satisfiedCount}`,
                        })}
                      </span>
                      <span className="path-chip warn">
                        {t(lang, {
                          zh: `缺失 ${informationCollection.missingCount}`,
                          en: `Missing ${informationCollection.missingCount}`,
                        })}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          ) : (
            <article className="filter-card">
              <div className="section-head">
                <div>
                  <div className="eyebrow">{t(lang, { zh: "当前实例", en: "Active Instance" })}</div>
                  <div className="detail-title">
                    {routeInstanceOutOfScope
                      ? t(lang, { zh: "实例超出当前工作区", en: "Run is outside the current workspace" })
                      : t(lang, { zh: "当前工作区暂无实例", en: "No runs in this workspace" })}
                  </div>
                </div>
              </div>
              <div className="section-note">
                {routeInstanceOutOfScope
                  ? t(lang, {
                      zh: "这个实例链接已经越过当前工作区边界。你可以从左侧重新选择一个实例，或切换回它所属的工作区。",
                      en: "This run link crossed the current workspace boundary. Pick another run from the list or switch back to the workspace that owns it.",
                    })
                  : t(lang, {
                      zh: "先回到工坊启动一个实例，或者切换到已有实例的工作区。",
                      en: "Return to workshops to launch a run, or switch to a workspace that already has runs.",
                    })}
              </div>
            </article>
          )}

          <div className="thread">
            {liveMode && informationCollectionVisible && informationCollection ? (
              <article
                className="message-card system"
                data-testid="dashboard-instance-information-collection"
              >
                <div className="message-head">
                  <div className="message-title">
                    {t(lang, { zh: "输入采集进度", en: "Input collection progress" })}
                  </div>
                  <div className="pill-row">
                    <span
                      className={`pill ${
                        informationCollection.status === "completed"
                          ? "success"
                          : informationCollection.status === "in_progress"
                            ? "active"
                            : "warn"
                      }`}
                    >
                      {informationCollectionStatusLabel(lang, informationCollection.status)}
                    </span>
                    <span className="pill">
                      {t(lang, {
                        zh: `附件 ${informationCollection.attachmentCount}`,
                        en: `Attachments ${informationCollection.attachmentCount}`,
                      })}
                    </span>
                  </div>
                </div>
                <div className="message-body">{informationCollection.prompt}</div>
                {informationCollectionItems.length > 0 ? (
                  <div className="message-attachment-list">
                    {informationCollectionItems.map((item) => (
                      <div className="message-attachment-chip" key={item}>
                        <div className="message-attachment-label">{item}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {reviewableInformationAnswers.length > 0 ? (
                  <div
                    style={{
                      display: "grid",
                      gap: "12px",
                      marginTop: "12px",
                    }}
                  >
                    <div className="pill-row">
                      <span
                        className={`pill ${
                          informationCollection.pendingReviewCount > 0 ? "warn" : ""
                        }`}
                        data-testid="dashboard-instance-review-count-pending"
                      >
                        {t(lang, {
                          zh: `待复核 ${informationCollection.pendingReviewCount}`,
                          en: `Pending ${informationCollection.pendingReviewCount}`,
                        })}
                      </span>
                      <span
                        className="pill"
                        data-testid="dashboard-instance-review-count-approved"
                      >
                        {t(lang, {
                          zh: `已批准 ${informationCollection.approvedReviewCount}`,
                          en: `Approved ${informationCollection.approvedReviewCount}`,
                        })}
                      </span>
                      <span
                        className={`pill ${
                          informationCollection.rejectedReviewCount > 0 ? "warn" : ""
                        }`}
                        data-testid="dashboard-instance-review-count-rejected"
                      >
                        {t(lang, {
                          zh: `已驳回 ${informationCollection.rejectedReviewCount}`,
                          en: `Rejected ${informationCollection.rejectedReviewCount}`,
                        })}
                      </span>
                    </div>
                    {reviewError ? <div className="composer-error">{reviewError}</div> : null}
                    {reviewableInformationAnswers.slice(0, 6).map((answer) => {
                      const form =
                        reviewFormsByAnswerId[answer.answerId] ??
                        createDefaultReviewFormState(answer);
                      const preview = informationCollectionAnswerPreview(lang, answer);
                      return (
                        <div
                          key={answer.answerId}
                          data-testid={`dashboard-instance-review-answer-${answer.answerId}`}
                          style={{
                            border: "1px solid var(--line)",
                            borderRadius: "14px",
                            background: "var(--surface-3)",
                            padding: "12px",
                            display: "grid",
                            gap: "10px",
                          }}
                        >
                          <div className="message-head">
                            <div className="message-title">{answer.slotTitle}</div>
                            <div className="pill-row">
                              <span
                                className={`pill ${informationCollectionAnswerReviewTone(answer.reviewStatus)}`}
                              >
                                {informationCollectionAnswerReviewStatusLabel(
                                  lang,
                                  answer.reviewStatus
                                )}
                              </span>
                              <span className="pill">
                                {informationCollectionAnswerSourceLabel(lang, answer.source)}
                              </span>
                            </div>
                          </div>
                          <div className="meta">{preview}</div>
                          {answer.reviewNote ? (
                            <div className="section-note">
                              {t(lang, { zh: "上一条复核备注", en: "Latest review note" })}:{" "}
                              {answer.reviewNote}
                            </div>
                          ) : null}
                          <div className="pill-row">
                            <button
                              className="route-btn active"
                              data-testid={`dashboard-instance-review-approve-${answer.answerId}`}
                              type="button"
                              disabled={reviewMutation.isPending}
                              onClick={() => handleQuickReviewDecision(answer, "approve")}
                            >
                              {t(lang, { zh: "批准", en: "Approve" })}
                            </button>
                            <button
                              className="path-chip warn"
                              data-testid={`dashboard-instance-review-reject-${answer.answerId}`}
                              type="button"
                              disabled={reviewMutation.isPending}
                              onClick={() => handleQuickReviewDecision(answer, "reject")}
                            >
                              {t(lang, { zh: "驳回", en: "Reject" })}
                            </button>
                            <button
                              className="path-chip"
                              data-testid={`dashboard-instance-review-revise-${answer.answerId}`}
                              type="button"
                              disabled={reviewMutation.isPending}
                              onClick={() =>
                                form.open ? closeReviewForm(answer) : openReviewForm(answer)
                              }
                            >
                              {form.open
                                ? t(lang, { zh: "收起改写", en: "Hide revision" })
                                : t(lang, { zh: "改写并替换", en: "Revise and replace" })}
                            </button>
                          </div>
                          {form.open ? (
                            <div style={{ display: "grid", gap: "8px" }}>
                              {answer.kind === "text" ? (
                                <textarea
                                  className="composer-box composer-input"
                                  data-testid={`dashboard-instance-review-text-${answer.answerId}`}
                                  value={form.replacementValueText}
                                  onChange={(event) =>
                                    updateReviewForm(answer.answerId, (current) => ({
                                      ...current,
                                      replacementValueText: event.target.value,
                                    }))
                                  }
                                  placeholder={t(lang, {
                                    zh: "输入新的文本答案",
                                    en: "Enter the replacement text answer",
                                  })}
                                  style={{ minHeight: "96px" }}
                                />
                              ) : (
                                <>
                                  <label className="fake-input">
                                    <input
                                      className="search-inline-input"
                                      data-testid={`dashboard-instance-review-path-${answer.answerId}`}
                                      type="text"
                                      value={form.replacementAttachmentPath}
                                      onChange={(event) =>
                                        updateReviewForm(answer.answerId, (current) => ({
                                          ...current,
                                          replacementAttachmentPath: event.target.value,
                                        }))
                                      }
                                      placeholder={t(lang, {
                                        zh: "输入新的附件路径",
                                        en: "Enter the replacement attachment path",
                                      })}
                                    />
                                  </label>
                                  <label className="fake-input">
                                    <input
                                      className="search-inline-input"
                                      type="text"
                                      value={form.replacementAttachmentLabel}
                                      onChange={(event) =>
                                        updateReviewForm(answer.answerId, (current) => ({
                                          ...current,
                                          replacementAttachmentLabel: event.target.value,
                                        }))
                                      }
                                      placeholder={t(lang, {
                                        zh: "输入新的附件标签（可选）",
                                        en: "Enter the replacement attachment label (optional)",
                                      })}
                                    />
                                  </label>
                                </>
                              )}
                              <label className="fake-input">
                                <input
                                  className="search-inline-input"
                                  type="text"
                                  value={form.note}
                                  onChange={(event) =>
                                    updateReviewForm(answer.answerId, (current) => ({
                                      ...current,
                                      note: event.target.value,
                                    }))
                                  }
                                  placeholder={t(lang, {
                                    zh: "填写复核备注（可选）",
                                    en: "Add a review note (optional)",
                                  })}
                                />
                              </label>
                              <div className="pill-row">
                                <button
                                  className="route-btn active"
                                  data-testid={`dashboard-instance-review-submit-${answer.answerId}`}
                                  type="button"
                                  disabled={reviewMutation.isPending}
                                  onClick={() => handleRevisionSubmit(answer)}
                                >
                                  {reviewMutation.isPending
                                    ? t(lang, { zh: "提交中", en: "Submitting" })
                                    : t(lang, { zh: "提交改写", en: "Submit revision" })}
                                </button>
                                <button
                                  className="path-chip"
                                  type="button"
                                  disabled={reviewMutation.isPending}
                                  onClick={() => closeReviewForm(answer)}
                                >
                                  {t(lang, { zh: "取消", en: "Cancel" })}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div className="pill-row">
                  <button
                    className="route-btn active"
                    type="button"
                    onClick={() =>
                      setInstanceDraft(
                        instance.id,
                        t(lang, {
                          zh: "请逐项告诉我当前还缺哪些信息，并按顺序引导我补齐。",
                          en: "Please tell me which inputs are still missing and guide me through them one by one.",
                        })
                      )
                    }
                  >
                    {t(lang, { zh: "查看缺口", en: "List missing inputs" })}
                  </button>
                  <button
                    className="path-chip"
                    type="button"
                    onClick={() => setInstanceDraft(instance.id, informationCollection.prompt)}
                  >
                    {t(lang, { zh: "继续引导", en: "Continue guided intake" })}
                  </button>
                </div>
              </article>
            ) : null}
            {liveMode && pendingApproval ? (
              <article
                className="message-card system approval-inline-card"
                data-testid="dashboard-instance-pending-approval"
              >
                <div className="message-head">
                  <div className="message-title">
                    {t(lang, { zh: "待处理审批", en: "Pending approval" })}
                  </div>
                  <div className="pill-row">
                    <span
                      className={`pill ${
                        pendingApproval.kind === "quota-override" ? "warn" : "active"
                      }`}
                    >
                      {approvalKindLabel(lang, pendingApproval.kind)}
                    </span>
                    {pendingApprovals.length > 1 ? (
                      <span className="pill">
                        {t(lang, {
                          zh: `其余 ${pendingApprovals.length - 1} 项`,
                          en: `${pendingApprovals.length - 1} more`,
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="message-body">{pendingApproval.prompt}</div>
                {pendingApproval.note ? (
                  <div className="meta approval-inline-note">{pendingApproval.note}</div>
                ) : null}
                <div className="pill-row">
                  {pendingApproval.relatedResourceRef ? (
                    <span className="path-chip">{pendingApproval.relatedResourceRef}</span>
                  ) : null}
                  <span className="path-chip">
                    {t(lang, {
                      zh: `发起于 ${formatBillingOccurredAt(lang, pendingApproval.requestedAt)}`,
                      en: `Requested ${formatBillingOccurredAt(lang, pendingApproval.requestedAt)}`,
                    })}
                  </span>
                </div>
                <div className="approval-action-row">
                  <button
                    className="route-btn active"
                    data-testid="dashboard-instance-approve-button"
                    type="button"
                    disabled={approvalMutation.isPending}
                    onClick={() => handleApprovalDecision(true)}
                  >
                    {approvalMutation.isPending
                      ? t(lang, { zh: "提交中", en: "Submitting" })
                      : t(lang, { zh: "批准", en: "Approve" })}
                  </button>
                  <button
                    className="path-chip warn"
                    data-testid="dashboard-instance-reject-button"
                    type="button"
                    disabled={approvalMutation.isPending}
                    onClick={() => handleApprovalDecision(false)}
                  >
                    {t(lang, { zh: "驳回", en: "Reject" })}
                  </button>
                  <button
                    className="path-chip"
                    data-testid="dashboard-instance-ask-approval"
                    type="button"
                    onClick={() =>
                      setInstanceDraft(
                        instance.id,
                        t(lang, {
                          zh: "请先解释这个审批请求的影响范围、执行对象和后续动作，我再决定是否批准。",
                          en: "Please explain the approval scope, execution target, and downstream action before I decide.",
                        })
                      )
                    }
                  >
                    {t(lang, { zh: "询问 Codex", en: "Ask Codex" })}
                  </button>
                </div>
              </article>
            ) : null}
            {instance ? instance.messages.map((message, index) => (
              <article className={`message-card ${message.kind}`} key={`${message.time}-${index}`}>
                <div className="message-head">
                  <div className="message-title">{t(lang, message.title)}</div>
                  <div className="message-meta">{message.time}</div>
                </div>
                <div className="message-body">{t(lang, message.body)}</div>
                {message.attachments?.length ? (
                  <div className="message-attachment-list">
                    {message.attachments.map((attachment) => (
                      <div
                        className="message-attachment-chip"
                        key={`${attachment.path}-${attachment.label}`}
                      >
                        <div className="message-attachment-label">{attachment.label}</div>
                        <div className="message-attachment-meta">{attachment.path}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            )) : null}
          </div>

          <div className="composer">
            <div className="section-head">
              <div>
                <div className="eyebrow">{runInteractive ? t(lang, { zh: "继续对话", en: "Continue Conversation" }) : t(lang, { zh: "生命周期", en: "Lifecycle" })}</div>
                <div className="detail-title">
                  {runInteractive
                    ? t(lang, { zh: "运行期间保持完整对话模式", en: "The run remains a full conversation" })
                    : t(lang, { zh: "实例终态与资源释放", en: "Terminal state and resource release" })}
                </div>
              </div>
              <span className={`pill ${runInteractive ? "active" : liveSnapshot?.lifecycle.runtimeStatus === "RELEASED" ? "success" : "warn"}`}>
                {runInteractive ? t(lang, { zh: "中央主视图", en: "Primary focus" }) : liveSnapshot?.lifecycle.runtimeStatus ?? "--"}
              </span>
            </div>
            {instance ? liveMode ? runInteractive ? (
              <>
                <textarea
                  className="composer-box composer-input"
                  data-testid="dashboard-instance-composer-input"
                  value={draft}
                  onChange={(event) => setInstanceDraft(instance.id, event.target.value)}
                  placeholder={t(lang, {
                    zh: "继续追问、补充材料说明、要求继续执行，或者告诉 Codex 你现在希望它做什么。",
                    en: "Ask follow-up questions, add material notes, request the next step, or tell Codex what to do now.",
                  })}
                />
                {composerError ? <div className="composer-error">{composerError}</div> : null}
                <div className="approval-mode-control" data-testid="dashboard-approval-mode-control">
                  <div>
                    <strong>{t(lang, { zh: "全自动审批", en: "Automatic approval" })}</strong>
                    <span>
                      {liveSnapshot?.run.approvalMode === "auto_all"
                        ? t(lang, { zh: "所有审批请求将自动通过", en: "All approval requests are accepted automatically" })
                        : t(lang, { zh: "敏感操作等待人工确认", en: "Sensitive actions wait for confirmation" })}
                    </span>
                  </div>
                  <label className="approval-mode-switch">
                    <input
                      data-testid="dashboard-approval-mode-toggle"
                      type="checkbox"
                      checked={liveSnapshot?.run.approvalMode === "auto_all"}
                      disabled={approvalModeMutation.isPending}
                      onChange={(event) => {
                        setComposerError("");
                        approvalModeMutation.mutate(event.target.checked ? "auto_all" : "manual");
                      }}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
                {attachmentDrafts.length > 0 ? (
                  <div className="attachment-draft-list" data-testid="dashboard-instance-attachment-drafts">
                    {attachmentDrafts.map((attachment) => (
                      <div
                        className="attachment-draft-card"
                        data-testid={`dashboard-instance-attachment-draft-${attachment.id}`}
                        key={attachment.id}
                      >
                        <div>
                          <div className="attachment-draft-title">{attachment.label}</div>
                          <div className="attachment-draft-meta">
                            {formatAttachmentSize(attachment.sizeBytes)}
                            {attachment.contentType ? ` / ${attachment.contentType}` : ""}
                          </div>
                        </div>
                        <button
                          className="path-chip warn"
                          data-testid={`dashboard-instance-attachment-remove-${attachment.id}`}
                          type="button"
                          onClick={() =>
                            setInstanceAttachments(
                              instance.id,
                              attachmentDrafts.filter((item) => item.id !== attachment.id)
                            )
                          }
                        >
                          {t(lang, { zh: "移除", en: "Remove" })}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="pill-row">
                  <span className="path-chip">{t(lang, { zh: "追问结果", en: "Ask about results" })}</span>
                  <button
                    className="path-chip"
                    data-testid="dashboard-instance-add-attachments"
                    type="button"
                    disabled={sendMessageMutation.isPending}
                    onClick={async () => {
                      try {
                        setComposerError("");
                        const picked = await pickBrowserAttachments({ multiple: true });
                        if (!picked.length) {
                          return;
                        }

                        setInstanceAttachments(instance.id, [...attachmentDrafts, ...picked]);
                      } catch (error) {
                        setComposerError(
                          error instanceof Error
                            ? error.message
                            : t(lang, {
                                zh: "当前环境暂不支持选择附件。",
                                en: "The current environment does not support local file selection.",
                              })
                        );
                      }
                    }}
                  >
                    {t(lang, { zh: "补充材料", en: "Add materials" })}
                  </button>
                  <button
                    className="path-chip"
                    type="button"
                    onClick={() =>
                      setInstanceDraft(
                        instance.id,
                        t(lang, {
                          zh: "请告诉我当前待审批动作是什么，并引导我逐项确认。",
                          en: "Please explain the pending approval items and guide me through them one by one.",
                        })
                      )
                    }
                  >
                    {t(lang, { zh: "审批说明", en: "Explain approvals" })}
                  </button>
                  <button
                    className="route-btn active"
                    data-testid="dashboard-instance-send-button"
                    type="button"
                    disabled={
                      sendMessageMutation.isPending ||
                      (!draft.trim() && attachmentDrafts.length === 0)
                    }
                    onClick={() => {
                      if (!draft.trim() && attachmentDrafts.length === 0) {
                        return;
                      }
                      setComposerError("");
                      sendMessageMutation.mutate({
                        instanceId: instance.id,
                        text: draft,
                        drafts: attachmentDrafts,
                      });
                    }}
                  >
                    {sendMessageMutation.isPending
                      ? attachmentDrafts.length > 0
                        ? t(lang, { zh: "上传并发送中", en: "Uploading and sending" })
                        : t(lang, { zh: "发送中", en: "Sending" })
                      : runStream.connected
                        ? t(lang, { zh: "通过实时链路发送", en: "Send via realtime channel" })
                        : t(lang, { zh: "发送消息", en: "Send message" })}
                  </button>
                </div>
              </>
            ) : (
              <div className="lifecycle-composer-state" data-testid="dashboard-instance-terminal-actions">
                <div>
                  <div className="detail-title">
                    {liveSnapshot?.lifecycle.deletionFailure
                      ? t(lang, { zh: "实例销毁未完成", en: "Run deletion incomplete" })
                      : runtimeTransitioning
                      ? t(lang, { zh: "正在停止并释放运行环境", en: "Stopping and releasing runtime" })
                      : liveSnapshot && ["RELEASE_FAILED", "ORPHANED"].includes(liveSnapshot.lifecycle.runtimeStatus)
                        ? t(lang, { zh: "运行环境释放失败", en: "Runtime release failed" })
                        : t(lang, { zh: "实例已结束", en: "Run finished" })}
                  </div>
                  <div className="meta">
                    {liveSnapshot?.lifecycle.deletionFailure ?? liveSnapshot?.lifecycle.releaseFailure ?? t(lang, {
                      zh: "当前实例已锁定对话操作，可继续查看文件、运行记录和审计信息。",
                      en: "Conversation actions are locked. Files, runtime records, and audit data remain available.",
                    })}
                  </div>
                </div>
                <div className="pill-row">
                  <button className="route-btn" type="button" onClick={() => setInstanceTab("files")}>
                    <svg className="icon"><use href="#i-folder" /></svg>
                    {t(lang, { zh: "查看文件", en: "View files" })}
                  </button>
                  {liveSnapshot && ["RELEASE_FAILED", "ORPHANED"].includes(liveSnapshot.lifecycle.runtimeStatus) ? (
                    <button className="route-btn danger" type="button" onClick={() => setLifecycleAction("release")}>
                      <svg className="icon"><use href="#i-refresh" /></svg>
                      {t(lang, { zh: "重试释放", en: "Retry release" })}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <div className="composer-box">
                  {t(lang, {
                    zh: "在这里继续追问、补充材料、确认审批、要求重新解释结果，或者让 Codex 继续执行下一轮动作。",
                    en: "Continue here to ask follow-up questions, upload missing materials, confirm approvals, request clearer explanations, or ask Codex to continue the next step.",
                  })}
                </div>
                <div className="pill-row">
                  <span className="path-chip">{t(lang, { zh: "追问结果", en: "Ask about results" })}</span>
                  <span className="path-chip">{t(lang, { zh: "补充材料", en: "Add materials" })}</span>
                  <span className="path-chip">{t(lang, { zh: "生成摘要", en: "Generate brief" })}</span>
                </div>
              </>
            ) : (
              <div className="composer-box">
                {routeInstanceOutOfScope
                  ? t(lang, {
                      zh: "当前链接指向的实例不在这个工作区里。请先从列表选择一个可见实例，再继续完整对话。",
                      en: "The linked run is not visible in this workspace. Select a visible run from the list before continuing the full conversation.",
                    })
                  : t(lang, {
                      zh: "当前没有可继续对话的实例。请先从工坊启动一个真实实例。",
                      en: "There is no run to continue here yet. Launch a real run from the workshop first.",
                    })}
              </div>
            )}
          </div>
        </div>

        <div className="detail-stack">
          <article className="detail-card">
            <div className="section-head">
              <div>
                <div className="eyebrow">{t(lang, { zh: "实例详情", en: "Instance Detail" })}</div>
                <div className="detail-title">{t(lang, { zh: "右侧二级信息区", en: "Secondary detail surface" })}</div>
              </div>
              <span className="pill">{t(lang, { zh: "按需展开", en: "On demand" })}</span>
            </div>
            <div className="subtab-row">
              {instanceTabs.map(({ key, label }) => (
                <button
                  className={`subtab-btn ${instanceTab === key ? "active" : ""}`}
                  key={key}
                  type="button"
                  onClick={() => {
                    setInstanceTab(key);
                    if (instance) {
                      navigate(dashboardRoutes.instance(instance.id, key));
                    }
                  }}
                >
                  {t(lang, label)}
                </button>
              ))}
            </div>
            {instance ? (
              <InstanceTabPanel instance={instance} liveMode={liveMode} />
            ) : (
              <div className="detail-body">
                <div className="detail-item">
                  <div className="meta">
                    {routeInstanceOutOfScope
                      ? t(lang, {
                          zh: "当前实例链接不属于这个工作区，因此不会加载右侧详情。",
                          en: "The current run link does not belong to this workspace, so the right-side detail panel stays empty.",
                        })
                      : t(lang, {
                          zh: "当前工作区没有可展开的实例详情。",
                          en: "There is no instance detail to expand in the current workspace.",
                        })}
                  </div>
                </div>
              </div>
            )}
          </article>
        </div>
      </div>
      {lifecycleAction && instance ? (
        <div className="instance-lifecycle-layer" role="presentation">
          <button className="instance-lifecycle-backdrop" type="button" aria-label={t(lang, { zh: "关闭确认窗口", en: "Close confirmation" })} onClick={() => { if (!lifecycleMutation.isPending) { setLifecycleAction(null); setLifecycleError(""); } }} />
          <section className="instance-lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="instance-lifecycle-title">
            <header>
              <div>
                <div className="eyebrow">RUN LIFECYCLE</div>
                <h2 id="instance-lifecycle-title">
                  {lifecycleAction === "stop"
                    ? t(lang, { zh: "停止并释放实例", en: "Stop and release run" })
                    : lifecycleAction === "release"
                      ? t(lang, { zh: "重试释放运行环境", en: "Retry runtime release" })
                      : lifecycleAction === "archive"
                        ? t(lang, { zh: "归档实例", en: "Archive run" })
                        : lifecycleAction === "restore"
                          ? t(lang, { zh: "恢复归档实例", en: "Restore archived run" })
                          : t(lang, { zh: "永久删除实例", en: "Permanently delete run" })}
                </h2>
              </div>
              <span className="pill">{instance.id}</span>
            </header>
            <div className="instance-lifecycle-copy">
              {lifecycleAction === "stop"
                ? t(lang, { zh: "当前执行将被中断。已写入目标目录的文件继续保留，运行环境释放后不再占用计算资源。", en: "The current execution will stop. Files already written to the target remain available after compute resources are released." })
                : lifecycleAction === "delete"
                  ? t(lang, { zh: "消息、工作目录、文件索引和运行记录将被清理。该操作无法撤销。", en: "Messages, workspace data, file indexes, and run records will be cleared. This action cannot be undone." })
                  : lifecycleAction === "archive"
                    ? t(lang, { zh: "实例会从当前列表移入归档，消息和结果继续保留。", en: "The run moves to the archive while messages and results remain available." })
                    : lifecycleAction === "restore"
                      ? t(lang, { zh: "实例会恢复到当前任务列表，运行环境保持已释放状态。", en: "The run returns to the current list while its runtime remains released." })
                      : t(lang, { zh: "系统将重新调用 Worker 核验并回收残留运行资源。", en: "The system will ask the Worker to verify and release residual runtime resources." })}
            </div>
            {lifecycleError ? <div className="composer-error">{lifecycleError}</div> : null}
            <footer>
              <button className="route-btn" type="button" disabled={lifecycleMutation.isPending} onClick={() => { setLifecycleAction(null); setLifecycleError(""); }}>
                {t(lang, { zh: "取消", en: "Cancel" })}
              </button>
              <button
                className={`route-btn ${lifecycleAction === "stop" || lifecycleAction === "delete" || lifecycleAction === "release" ? "danger" : "active"}`}
                type="button"
                disabled={lifecycleMutation.isPending}
                onClick={() => lifecycleMutation.mutate({ action: lifecycleAction, runId: instance.id })}
              >
                {lifecycleMutation.isPending
                  ? t(lang, { zh: "处理中", en: "Processing" })
                  : t(lang, { zh: "确认执行", en: "Confirm" })}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {liveSnapshot ? (
        <SessionCaptureDrawer
          open={captureDrawerOpen}
          run={liveSnapshot}
          lang={lang}
          onClose={() => setCaptureDrawerOpen(false)}
        />
      ) : null}
      <NewInstanceDrawer
        open={newInstanceOpen}
        lang={lang}
        onClose={() => setNewInstanceOpen(false)}
        onCreated={(runId) => {
          setNewInstanceOpen(false);
          navigate(dashboardRoutes.instance(runId));
        }}
      />
    </section>
  );
}
