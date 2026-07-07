import { matchesSearchQuery } from "@lingban/domain-models";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { InstanceRecord, InstanceTab } from "../../data/dashboardData";
import { dashboardServices, dashboardWorkspaces, instances } from "../../data/dashboardData";
import { buildDashboardRunFileDownloadUrl, dashboardRunsApi } from "../../lib/api";
import { t } from "../../lib/i18n";
import { isLiveRunId, mapRunSnapshotToInstanceRecord } from "../../lib/liveRunAdapters";
import { dashboardRoutes, isInstanceTab } from "../../lib/routes";
import { useDashboardRunStream } from "../../lib/runStream";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

const instanceTabs: Array<{ key: InstanceTab; label: { zh: string; en: string } }> = [
  { key: "overview", label: { zh: "概览", en: "Overview" } },
  { key: "files", label: { zh: "文件", en: "Files" } },
  { key: "runtime", label: { zh: "运行", en: "Runtime" } },
  { key: "audit", label: { zh: "审计", en: "Audit" } },
];

type InstanceListMode = "all" | "todo" | "running" | "done";

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

function getInstanceTags(instance: InstanceRecord) {
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

  useEffect(() => {
    setSelectedFilePath(instance.files.items[0]?.path ?? null);
    const nextPath = normalizeDirectoryPath(instance.files.currentPath || instance.targetPath);
    setCurrentPath(nextPath);
    setPathInput(nextPath);
    setPathError("");
    setFileSearch("");
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
    queryKey: ["dashboard", "runs", instance.id, "files", "read", selectedFile?.path ?? ""],
    queryFn: async () => {
      if (!selectedFile?.path) {
        return null;
      }

      try {
        return await dashboardRunsApi.readRunFile(instance.id, selectedFile.path);
      } catch {
        return null;
      }
    },
  });

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
                    onClick={() => {
                      window.open(
                        buildDashboardRunFileDownloadUrl(instance.id, selectedFile.path),
                        "_blank",
                        "noopener,noreferrer"
                      );
                    }}
                  >
                    {t(lang, { zh: "下载文件", en: "Download" })}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="meta preview-meta">{selectedFile.path}</div>
            <div className="meta">{t(lang, selectedFile.note)}</div>
            <pre className="preview-code">
              {liveMode
                ? filePreviewQuery.isPending
                  ? t(lang, { zh: "正在读取文件内容...", en: "Reading file content..." })
                  : filePreviewQuery.data
                    ? `${filePreviewQuery.data.content}${
                        filePreviewQuery.data.truncated
                          ? `\n\n${t(lang, {
                              zh: "[内容过长，已截断。请下载完整文件。]",
                              en: "[The preview is truncated. Download the full file.]",
                            })}`
                          : ""
                      }`
                    : t(lang, {
                        zh: "当前文件更适合直接下载查看，或者后端尚未返回可预览文本。",
                        en: "This file is better inspected through download, or the backend did not return a text preview.",
                      })
                : t(
                    lang,
                    selectedFile.preview ?? {
                      zh: "当前为静态参照数据。正式接入 live run 后会在这里展示真实文本预览。",
                      en: "This is static reference data. Live runs will show real text previews here.",
                    }
                  )}
            </pre>
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
            <div className="tab-title">{t(lang, { zh: "时间线与边界", en: "Timeline and boundaries" })}</div>
          </div>
          <span className="pill warn">{t(lang, { zh: "按需查看", en: "On demand" })}</span>
        </div>
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
  const currentWorkspace =
    dashboardWorkspaces.find((item) => item.id === currentWorkspaceId) ?? dashboardWorkspaces[0];

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
    return Object.fromEntries(
      list.map((snapshot) => [snapshot.run.runId, mapRunSnapshotToInstanceRecord(snapshot)])
    ) as Record<string, InstanceRecord>;
  }, [runsQuery.data]);

  const mergedInstances = useMemo(() => {
    const next: Record<string, InstanceRecord> = { ...instances, ...liveInstances };

    if (liveRunDetailQuery.data) {
      next[liveRunDetailQuery.data.run.runId] = mapRunSnapshotToInstanceRecord(
        liveRunDetailQuery.data,
        liveRunFilesQuery.data
      );
    }

    return next;
  }, [liveInstances, liveRunDetailQuery.data, liveRunFilesQuery.data]);

  const sortedInstances = useMemo(() => {
    const all = Object.values(mergedInstances).filter((item) => item.workspaceId === currentWorkspace.id);
    return all.sort((left, right) => {
      const leftLive = Number(isLiveRunId(left.id));
      const rightLive = Number(isLiveRunId(right.id));

      if (leftLive !== rightLive) {
        return rightLive - leftLive;
      }

      return left.id.localeCompare(right.id);
    });
  }, [currentWorkspace, mergedInstances]);

  const filteredInstances = useMemo(() => {
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
  }, [listMode, searchQuery, sortedInstances, statusFilter, tagFilter]);

  const availableTags = useMemo(() => {
    return Array.from(new Set(sortedInstances.flatMap((item) => getInstanceTags(item)))).slice(0, 6);
  }, [sortedInstances]);

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
    if (instanceId && mergedInstances[instanceId]?.workspaceId === currentWorkspace.id) {
      setActiveInstanceId(instanceId);
      return;
    }

    if (sortedInstances.length === 0) {
      return;
    }

    if (instanceId && mergedInstances[instanceId]?.workspaceId !== currentWorkspace.id) {
      const fallbackId = sortedInstances[0].id;
      setActiveInstanceId(fallbackId);
      navigate(dashboardRoutes.instance(fallbackId), { replace: true });
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

  const instance = sortedInstances.find((item) => item.id === activeInstanceId) ?? sortedInstances[0] ?? instances["tax-q2"];
  const liveMode = isLiveRunId(instance.id);
  const runStream = useDashboardRunStream(liveMode ? instance.id : null, liveMode);
  const draft = instanceDrafts[instance.id] ?? "";

  const sendMessageMutation = useMutation({
    mutationFn: async (text: string) =>
      dashboardRunsApi.sendRunMessage(instance.id, {
        text,
        attachments: [],
      }),
    onSuccess: async () => {
      clearInstanceDraft(instance.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs", instance.id] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs", instance.id, "files"] }),
      ]);
    },
  });

  return (
    <section className="view">
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

          <div className="thread">
            {instance.messages.map((message, index) => (
              <article className={`message-card ${message.kind}`} key={`${message.time}-${index}`}>
                <div className="message-head">
                  <div className="message-title">{t(lang, message.title)}</div>
                  <div className="message-meta">{message.time}</div>
                </div>
                <div className="message-body">{t(lang, message.body)}</div>
              </article>
            ))}
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
            {liveMode ? (
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
                <div className="pill-row">
                  <span className="path-chip">{t(lang, { zh: "追问结果", en: "Ask about results" })}</span>
                  <span className="path-chip">{t(lang, { zh: "补充材料", en: "Add materials" })}</span>
                  <span className="path-chip">{t(lang, { zh: "生成摘要", en: "Generate brief" })}</span>
                  <button
                    className="route-btn active"
                    type="button"
                    disabled={!draft.trim() || sendMessageMutation.isPending}
                    onClick={() => {
                      if (!draft.trim()) {
                        return;
                      }

                      if (liveMode && runStream.sendMessage(draft.trim())) {
                        clearInstanceDraft(instance.id);
                        return;
                      }

                      sendMessageMutation.mutate(draft.trim());
                    }}
                  >
                    {sendMessageMutation.isPending
                      ? t(lang, { zh: "发送中", en: "Sending" })
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
                    navigate(dashboardRoutes.instance(instance.id, key));
                  }}
                >
                  {t(lang, label)}
                </button>
              ))}
            </div>
            <InstanceTabPanel instance={instance} liveMode={liveMode} />
          </article>
        </div>
      </div>
    </section>
  );
}
