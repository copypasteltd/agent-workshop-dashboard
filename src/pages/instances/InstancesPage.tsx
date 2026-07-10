import { uploadRunAttachment } from "@lingban/api-sdk";
import { matchesSearchQuery } from "@lingban/domain-models";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { InstanceRecord, InstanceTab } from "../../data/dashboardData";
import { dashboardServices, instances } from "../../data/dashboardData";
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
import { resolveDashboardWorkspaceView } from "../../lib/workspaceContext";
import { useDashboardAuthStore } from "../../stores/dashboardAuthStore";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

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

function toListViewStatusFilter(statusFilter: "all" | "active" | "warn" | "success") {
  switch (statusFilter) {
    case "active":
      return "running" as const;
    case "warn":
      return "approval" as const;
    case "success":
      return "done" as const;
    case "all":
    default:
      return undefined;
  }
}

function inferInstanceService(instance: InstanceRecord) {
  return (
    dashboardServices.find(
      (item) => item.linkedInstance === instance.id || instance.targetPath.startsWith(item.targetPath)
    ) ?? null
  );
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
        return await dashboardBillingApi.listEntries({ runId: instance.id, limit: 6 });
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
          <span className="pill active">{currentPath}</span>
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
          <div className="preview-panel">
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
                    zh: "当前为静态参照数据。正式接入 live run 后会在这里展示真实文本预览。",
                    en: "This is static reference data. Live runs will show real text previews here.",
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
    return (
      <div className="detail-body">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "运行", en: "Runtime" })}</div>
            <div className="tab-title">{t(lang, { zh: "容器与挂载", en: "Container and mounts" })}</div>
          </div>
          <span className="pill success">{instance.runtime.container}</span>
        </div>
        <div className="detail-item">
          <div className="file-name">{instance.runtime.image}</div>
          <div className="meta">
            {t(lang, { zh: "当前实例使用的标准镜像。", en: "The standard image used by this instance." })}
          </div>
        </div>
        {instance.runtime.mounts.map((item) => (
          <div className="detail-item" key={t(lang, item)}>
            <div className="file-name">{t(lang, item)}</div>
          </div>
        ))}
        {instance.runtime.notes.map((item) => (
          <div className="detail-item" key={t(lang, item)}>
            <div className="meta">{t(lang, item)}</div>
          </div>
        ))}
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
  const authMode = useDashboardAuthStore((state) => state.authMode);
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
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "warn" | "success">("all");
  const [tagFilter, setTagFilter] = useState("all");
  const currentWorkspace = useMemo(
    () =>
      resolveDashboardWorkspaceView({
        selectionId: currentWorkspaceId,
        workspaces: authMode === "required" ? authWorkspaces : undefined,
        fallbackWorkspaceId: authCurrentWorkspace?.workspaceId,
      }),
    [authCurrentWorkspace?.workspaceId, authMode, authWorkspaces, currentWorkspaceId]
  );

  const runsQuery = useQuery({
    queryKey: ["dashboard", "runs"],
    queryFn: async () => {
      try {
        return await dashboardRunsApi.listRuns();
      } catch {
        return [];
      }
    },
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
        });
      } catch {
        return [];
      }
    },
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

  const staticWorkspaceInstances = useMemo(() => {
    return Object.fromEntries(
      Object.values(instances)
        .filter((item) => item.workspaceId === currentWorkspace.id)
        .map((item) => [item.id, item])
    ) as Record<string, InstanceRecord>;
  }, [currentWorkspace.id]);

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
    (runsSummaryQuery.data?.total ?? 0) > 0 || Object.keys(liveInstances).length > 0 || Boolean(detailedLiveInstance)
      ? "live"
      : currentWorkspace.source === "auth"
        ? "empty"
        : "static";

  const mergedInstances = useMemo(() => {
    const next: Record<string, InstanceRecord> =
      instanceDataMode === "live"
        ? { ...liveInstances }
        : instanceDataMode === "static"
          ? { ...staticWorkspaceInstances }
          : {};

    if (detailedLiveInstance) {
      next[detailedLiveInstance.id] = detailedLiveInstance;
    }

    return next;
  }, [detailedLiveInstance, instanceDataMode, liveInstances, staticWorkspaceInstances]);

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

    return sortedInstances.filter((item) => {
      const attention = getInstanceAttention(item);
      const tags = getInstanceTags(item);
      const service = inferInstanceService(item);
      const statusMatched = statusFilter === "all" || item.statusClass === statusFilter;
      const modeMatched =
        listMode === "all"
          ? true
          : listMode === "todo"
            ? attention.needsApproval
            : listMode === "running"
              ? item.statusClass === "active"
              : attention.resultReady;
      const tagMatched = tagFilter === "all" || tags.includes(tagFilter);

      if (!statusMatched || !modeMatched || !tagMatched) {
        return false;
      }

      return matchesSearchQuery(searchQuery, [
        item.id,
        item.route,
        item.targetPath,
        item.title.zh,
        item.title.en,
        item.workshop.zh,
        item.workshop.en,
        item.workspace.zh,
        item.workspace.en,
        item.status.zh,
        item.status.en,
        service?.name.zh,
        service?.name.en,
        item.summary.zh,
        item.summary.en,
        item.nextAction.zh,
        item.nextAction.en,
        ...tags,
      ]);
    });
  }, [filteredLiveInstances, instanceDataMode, listMode, searchQuery, sortedInstances, statusFilter, tagFilter]);

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

  const fallbackStaticInstance = Object.values(staticWorkspaceInstances)[0] ?? null;
  const routeInstance = instanceId ? mergedInstances[instanceId] ?? null : null;
  const routeInstanceOutOfScope = Boolean(instanceId) && routeInstance == null;
  const instance =
    routeInstance ??
    (!instanceId
      ? sortedInstances.find((item) => item.id === activeInstanceId) ??
        sortedInstances[0] ??
        fallbackStaticInstance
      : null);
  const liveMode = Boolean(instance && isLiveRunId(instance.id));
  const sampleMode = Boolean(instance && !liveMode);
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
  const draft = instance ? instanceDrafts[instance.id] ?? "" : "";
  const attachmentDrafts = instance ? attachmentDraftsByInstance[instance.id] ?? [] : [];

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

  useEffect(() => {
    setComposerError("");
  }, [instance?.id]);

  const sendMessageMutation = useMutation({
    mutationFn: async (input: { text: string; drafts: BrowserAttachmentDraft[] }) => {
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
      };

      if (liveMode && runStream.sendMessage(payload)) {
        return null;
      }

      return await dashboardRunsApi.sendRunMessage(instance.id, payload);
    },
    onSuccess: async () => {
      if (!instance) {
        return;
      }

      clearInstanceDraft(instance.id);
      clearInstanceAttachments(instance.id);
      setComposerError("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs", instance.id] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs", instance.id, "files"] }),
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

  return (
    <section className="view" data-testid="dashboard-instances-page">
      <article className="filter-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "实例筛选", en: "Instance Filters" })}</div>
            <h3 className="detail-title">{t(lang, { zh: "多任务列表", en: "Multi-run list" })}</h3>
          </div>
          <span className="pill active">{t(lang, { zh: "实例为中心", en: "Instance-centric" })}</span>
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
            { key: "all" as const, label: { zh: "全部", en: "All" }, tone: "" },
            { key: "active" as const, label: { zh: "运行中", en: "Running" }, tone: "" },
            { key: "warn" as const, label: { zh: "待审批", en: "Approval" }, tone: "warn" },
            { key: "success" as const, label: { zh: "回流完成", en: "Callback" }, tone: "success" },
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
          {t(lang, {
            zh: `当前工作区根路径：${currentWorkspace.root}。筛选后保留 ${filteredInstances.length} 个实例；多实例切换保留当前输入草稿，右侧详情保持同一实例上下文。`,
            en: `Current workspace root: ${currentWorkspace.root}. Filters keep ${filteredInstances.length} runs; switching instances preserves the input draft while the right detail pane keeps the same run context.`,
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
        {instanceDataMode === "static" ? (
          <div className="section-note">
            {t(lang, {
              zh: "当前工作区尚未检测到真实 run 列表，实例面板正在展示样例实例结构。真实实例建立后，列表会自动切换到 live 数据主链。",
              en: "No live run list was detected for the current workspace yet. The instance surface is showing sample structures and will switch to the live data chain automatically once real runs appear.",
            })}
          </div>
        ) : null}
        {instanceDataMode === "empty" ? (
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
                  zh: "可以清空搜索词，或切换状态筛选。当前打开的实例不会因为筛选而被关闭。",
                  en: "Clear the query or switch the status filter. The currently open instance stays active.",
                })}
              </div>
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
                const service = inferInstanceService(item);
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
                        <div className="meta">{t(lang, service?.name ?? item.workshop)}</div>
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
                    <span className={`pill ${instance.statusClass}`}>{t(lang, instance.status)}</span>
                    <span className="pill active">{t(lang, instance.workspace)}</span>
                    {sampleMode ? (
                      <span className="pill warn">{t(lang, { zh: "样例实例", en: "Sample run" })}</span>
                    ) : null}
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
                <div className="eyebrow">{t(lang, { zh: "继续对话", en: "Continue Conversation" })}</div>
                <div className="detail-title">
                  {t(lang, { zh: "运行期间保持完整对话模式", en: "The run remains a full conversation" })}
                </div>
              </div>
              <span className="pill active">{t(lang, { zh: "中央主视图", en: "Primary focus" })}</span>
            </div>
            {instance ? liveMode ? (
              <>
                <textarea
                  className="composer-box composer-input"
                  value={draft}
                  onChange={(event) => setInstanceDraft(instance.id, event.target.value)}
                  placeholder={t(lang, {
                    zh: "继续追问、补充材料说明、要求继续执行，或者告诉 Codex 你现在希望它做什么。",
                    en: "Ask follow-up questions, add material notes, request the next step, or tell Codex what to do now.",
                  })}
                />
                {composerError ? <div className="composer-error">{composerError}</div> : null}
                {attachmentDrafts.length > 0 ? (
                  <div className="attachment-draft-list">
                    {attachmentDrafts.map((attachment) => (
                      <div className="attachment-draft-card" key={attachment.id}>
                        <div>
                          <div className="attachment-draft-title">{attachment.label}</div>
                          <div className="attachment-draft-meta">
                            {formatAttachmentSize(attachment.sizeBytes)}
                            {attachment.contentType ? ` / ${attachment.contentType}` : ""}
                          </div>
                        </div>
                        <button
                          className="path-chip warn"
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
    </section>
  );
}
