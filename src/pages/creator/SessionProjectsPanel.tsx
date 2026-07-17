import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { dashboardSessionProjectsApi } from "../../lib/api";
import { t } from "../../lib/i18n";
import { dashboardRoutes } from "../../lib/routes";

function projectTone(status: string) {
  if (status === "PUBLISHED" || status === "SEALED" || status === "PACKAGED") return "success";
  if (status === "RECORDING" || status === "REPLAYING") return "active";
  if (status === "ARCHIVED") return "";
  return "warn";
}

function projectStatusLabel(lang: "zh" | "en", status: string) {
  const labels: Record<string, { zh: string; en: string }> = {
    DRAFT: { zh: "待启动", en: "Draft" },
    RECORDING: { zh: "录制中", en: "Recording" },
    CAPTURED: { zh: "已固化", en: "Captured" },
    EDITING: { zh: "资产编辑", en: "Editing" },
    REPLAYING: { zh: "回放中", en: "Replaying" },
    READY_TO_SEAL: { zh: "可密封", en: "Ready to seal" },
    SEALED: { zh: "已密封", en: "Sealed" },
    PACKAGED: { zh: "已封装", en: "Packaged" },
    PUBLISHED: { zh: "已发布", en: "Published" },
    ARCHIVED: { zh: "已归档", en: "Archived" },
  };
  return t(lang, labels[status] ?? { zh: status, en: status });
}

export function SessionProjectsPanel({
  enabled,
  lang,
  onCreate,
}: {
  enabled: boolean;
  lang: "zh" | "en";
  onCreate: () => void;
}) {
  const navigate = useNavigate();
  const projectsQuery = useQuery({
    queryKey: ["dashboard", "creator", "session-projects"],
    queryFn: async () => dashboardSessionProjectsApi.list({ limit: 50 }),
    enabled,
    retry: false,
    refetchInterval: 10_000,
  });
  const projects = projectsQuery.data?.items ?? [];

  return (
    <article className="detail-card creator-projects-panel" data-testid="dashboard-session-projects">
      <div className="section-head">
        <div>
          <div className="eyebrow">SESSION PROJECTS</div>
          <div className="detail-title">{t(lang, { zh: "Session 生产项目", en: "Session production projects" })}</div>
        </div>
        <button className="route-btn active" type="button" onClick={onCreate}>
          <svg className="icon"><use href="#i-terminal" /></svg>
          {t(lang, { zh: "新建 Session", en: "New Session" })}
        </button>
      </div>

      {projectsQuery.isLoading ? (
        <div className="session-asset-empty">{t(lang, { zh: "正在加载项目", en: "Loading projects" })}</div>
      ) : projectsQuery.error ? (
        <div className="capture-alert warn">{projectsQuery.error instanceof Error ? projectsQuery.error.message : t(lang, { zh: "项目加载失败", en: "Project loading failed" })}</div>
      ) : projects.length === 0 ? (
        <div className="session-project-empty">
          <svg className="icon"><use href="#i-terminal" /></svg>
          <strong>{t(lang, { zh: "尚未创建 Session 项目", en: "No Session Project yet" })}</strong>
          <button className="route-btn active" type="button" onClick={onCreate}>
            {t(lang, { zh: "启动空白 Codex", en: "Start blank Codex" })}
          </button>
        </div>
      ) : (
        <div className="session-project-list">
          {projects.map((project) => (
            <div className="session-project-row" key={project.sessionProjectId}>
              <div className="session-project-main">
                <div className="file-name">{project.name}</div>
                <div className="meta mono">{project.sessionProjectId}</div>
                {project.description ? <div className="section-note">{project.description}</div> : null}
              </div>
              <div className="session-project-assets">
                <span className={`pill ${projectTone(project.status)}`}>{projectStatusLabel(lang, project.status)}</span>
                {project.currentCaptureId ? <span className="path-chip mono">{project.currentCaptureId}</span> : null}
                {project.currentDraftId ? <span className="path-chip mono">{project.currentDraftId}</span> : null}
                {project.currentSessionVersionId ? <span className="path-chip success mono">{project.currentSessionVersionId}</span> : null}
                {project.packageId ? <span className="path-chip mono">{project.packageId}</span> : null}
                {project.workshopId ? <span className="path-chip mono">{project.workshopId}</span> : null}
                {project.serviceId ? <span className="path-chip mono">{project.serviceId}</span> : null}
                {project.sourceProviderSelection?.providerId ? <span className="path-chip mono">{project.sourceProviderSelection.providerId}</span> : null}
              </div>
              <div className="session-project-actions">
                {project.sourceRunId ? (
                  <button className="icon-btn" type="button" title={t(lang, { zh: "打开实例", en: "Open run" })} onClick={() => navigate(dashboardRoutes.instance(project.sourceRunId!))}>
                    <svg className="icon"><use href="#i-arrow-right" /></svg>
                  </button>
                ) : (
                  <button className="icon-btn" type="button" title={t(lang, { zh: "启动录制", en: "Start recording" })} onClick={onCreate}>
                    <svg className="icon"><use href="#i-terminal" /></svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
