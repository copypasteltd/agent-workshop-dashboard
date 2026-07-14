import { Link } from "react-router-dom";
import { dashboardAssets } from "../../data/dashboardData";
import { adminRoutes, workspaceRoutes } from "../../lib/routes";
import { t } from "../../lib/i18n";
import { useDashboardAuthStore } from "../../stores/dashboardAuthStore";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

export function PortalEntryPage() {
  const lang = useDashboardUiStore((state) => state.lang);
  const authenticated = useDashboardAuthStore((state) => state.authenticated);
  const user = useDashboardAuthStore((state) => state.user);
  const platformAccess = useDashboardAuthStore((state) => state.platformAccess);

  return (
    <div className="auth-shell">
      <div className="auth-panel" style={{ width: "min(1120px, calc(100vw - 40px))" }}>
        <div className="auth-brand">
          <div className="logo auth-logo">
            <img src={dashboardAssets.logo} alt="Lingban Ciyuan logo" />
          </div>
          <div>
            <div className="eyebrow">
              {t(lang, { zh: "控制台入口分流", en: "Console entry split" })}
            </div>
            <h1 className="auth-title">
              {t(lang, { zh: "灵办词元", en: "Lingban Ciyuan" })}
            </h1>
            <p className="auth-copy">
              {t(lang, {
                zh: "平台管理后台与用户工作区控制台已经拆开。请选择符合当前职责的入口。",
                en: "The platform admin console and the workspace console are now separated. Choose the entry that matches the current responsibility.",
              })}
            </p>
          </div>
        </div>

        <div className="page-grid">
          <Link className="detail-card" to={workspaceRoutes.workshops}>
            <div className="eyebrow">workspace://workshops</div>
            <div className="detail-title">
              {t(lang, { zh: "用户工作区控制台", en: "Workspace console" })}
            </div>
            <div className="section-note">
              {t(lang, {
                zh: "工坊浏览、任务会话、文件路径、运行对话、Creator 包与发布流。",
                en: "Workshop browsing, task conversations, file paths, run dialogue, creator packages, and release flows.",
              })}
            </div>
            <div className="pill-row">
              <span className="pill active">{workspaceRoutes.workshops}</span>
              <span className="pill">{workspaceRoutes.settingsProviders}</span>
            </div>
          </Link>

          <Link className="detail-card" to={adminRoutes.overview}>
            <div className="eyebrow">admin://overview</div>
            <div className="detail-title">
              {t(lang, { zh: "平台 Admin Console", en: "Platform admin console" })}
            </div>
            <div className="section-note">
              {t(lang, {
                zh: "平台 Provider 总目录、上游健康检查、全局运行策略与控制面治理。",
                en: "Platform provider catalog, upstream health checks, global runtime policy, and control-plane governance.",
              })}
            </div>
            <div className="pill-row">
              <span className="pill active">{adminRoutes.overview}</span>
              <span className="pill">{adminRoutes.providers}</span>
            </div>
          </Link>
        </div>

        {authenticated ? (
          <div className="auth-highlights">
            <div className="auth-highlight">
              <div className="file-name">{t(lang, { zh: "当前账号", en: "Current account" })}</div>
              <div className="file-meta">
                {user?.displayName ?? user?.email ?? "account"} /{" "}
                {platformAccess?.isPlatformAdmin
                  ? t(lang, { zh: "平台管理员", en: "Platform admin" })
                  : t(lang, { zh: "工作区账号", en: "Workspace account" })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
