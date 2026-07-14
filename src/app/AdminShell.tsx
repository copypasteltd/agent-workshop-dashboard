import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminAccessDeniedScreen } from "../components/AdminAccessDeniedScreen";
import { AdminAuthScreen } from "../components/AdminAuthScreen";
import { IconSprite } from "../components/IconSprite";
import { dashboardAssets } from "../data/dashboardData";
import { dashboardAuthApi } from "../lib/api";
import { adminRoutes, workspaceRoutes } from "../lib/routes";
import { applyDashboardTheme } from "../lib/theme";
import { setDashboardLanguage, t } from "../lib/i18n";
import { useDashboardAuthStore } from "../stores/dashboardAuthStore";
import { useDashboardUiStore } from "../stores/dashboardUiStore";

type AdminView = "overview" | "providers";

export function AdminShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useDashboardUiStore((state) => state.theme);
  const lang = useDashboardUiStore((state) => state.lang);
  const setLang = useDashboardUiStore((state) => state.setLang);
  const toggleTheme = useDashboardUiStore((state) => state.toggleTheme);
  const authMode = useDashboardAuthStore((state) => state.authMode);
  const authenticated = useDashboardAuthStore((state) => state.authenticated);
  const bootstrapping = useDashboardAuthStore((state) => state.bootstrapping);
  const user = useDashboardAuthStore((state) => state.user);
  const platformAccess = useDashboardAuthStore((state) => state.platformAccess);
  const clearAuth = useDashboardAuthStore((state) => state.clearAuth);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth > 1240 : true
  );

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await dashboardAuthApi.logout();
    },
    onSettled: async () => {
      clearAuth();
      await queryClient.removeQueries({
        queryKey: ["dashboard"],
      });
      navigate(adminRoutes.overview, { replace: true });
    },
  });

  const view = useMemo<AdminView>(() => {
    if (location.pathname.includes("/providers")) {
      return "providers";
    }

    return "overview";
  }, [location.pathname]);

  const viewMeta = {
    overview: {
      eyebrow: "admin://overview",
      title: t(lang, { zh: "平台总览", en: "Platform overview" }),
      desc: t(lang, {
        zh: "平台控制面只承载全局治理、Provider 目录和上游策略，不再混入工作区任务会话。",
        en: "The platform control plane now holds only global governance, provider catalog operations, and upstream policy without mixing workspace task conversations.",
      }),
    },
    providers: {
      eyebrow: "admin://providers",
      title: t(lang, { zh: "Provider 总目录", en: "Provider catalog" }),
      desc: t(lang, {
        zh: "这里维护平台级 OpenAI-compatible Provider 档案与健康检查，不直接承担工作区任务交互。",
        en: "Manage platform-level OpenAI-compatible provider profiles and health checks here without carrying workspace task interactions.",
      }),
    },
  } satisfies Record<AdminView, { eyebrow: string; title: string; desc: string }>;

  useEffect(() => {
    setDashboardLanguage(lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title =
      view === "overview"
        ? t(lang, { zh: "灵办词元 Admin Console", en: "Lingban Ciyuan Admin Console" })
        : t(lang, { zh: "灵办词元 Provider Catalog", en: "Lingban Ciyuan Provider Catalog" });
    document.body.dataset.theme = theme;
    document.body.dataset.sidebar = sidebarOpen ? "open" : "closed";
    applyDashboardTheme(theme);
  }, [lang, sidebarOpen, theme, view]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 960) {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (bootstrapping || authMode === "unknown") {
    return (
      <>
        <IconSprite />
        <AdminAccessDeniedScreen
          title={t(lang, { zh: "正在恢复平台会话", en: "Restoring admin session" })}
          detail={t(lang, {
            zh: "正在检查当前平台管理员令牌与控制面上下文。",
            en: "Checking the current platform admin token and control-plane context.",
          })}
          actions={null}
        />
      </>
    );
  }

  if (authMode === "disabled") {
    return (
      <>
        <IconSprite />
        <AdminAccessDeniedScreen
          title={t(lang, { zh: "Admin Console 不可用", en: "Admin console unavailable" })}
          detail={t(lang, {
            zh: "当前部署未启用受保护认证模式，平台级控制面不会在公开预览模式下开放。",
            en: "Protected authentication is not enabled in this deployment, so the platform control plane is not exposed in public preview mode.",
          })}
          actions={
            <button
              className="route-btn active"
              type="button"
              onClick={() => navigate(workspaceRoutes.workshops)}
            >
              {t(lang, { zh: "进入工作区控制台", en: "Open workspace console" })}
            </button>
          }
        />
      </>
    );
  }

  if (!authenticated) {
    return (
      <>
        <IconSprite />
        <AdminAuthScreen />
      </>
    );
  }

  if (!platformAccess?.isPlatformAdmin) {
    return (
      <>
        <IconSprite />
        <AdminAccessDeniedScreen
          title={t(lang, { zh: "缺少平台管理员权限", en: "Platform admin access required" })}
          detail={t(lang, {
            zh: "当前账号已经登录，但它属于工作区侧身份，不能进入平台控制面。",
            en: "This account is signed in, but it belongs to a workspace-side identity and cannot enter the platform control plane.",
          })}
          actions={
            <>
              <button
                className="route-btn active"
                type="button"
                onClick={() => navigate(workspaceRoutes.workshops)}
              >
                {t(lang, { zh: "进入工作区控制台", en: "Open workspace console" })}
              </button>
              <button
                className="route-btn"
                type="button"
                disabled={logoutMutation.isPending}
                onClick={() => logoutMutation.mutate()}
              >
                {logoutMutation.isPending
                  ? t(lang, { zh: "退出中", en: "Signing out" })
                  : t(lang, { zh: "退出账号", en: "Sign out" })}
              </button>
            </>
          }
        />
      </>
    );
  }

  return (
    <>
      <IconSprite />
      <div className="shell">
        <aside className="rail">
          <button
            className={`rail-btn drawer-toggle ${sidebarOpen ? "active" : ""}`}
            type="button"
            onClick={() => setSidebarOpen((current) => !current)}
          >
            <svg className="icon">
              <use href="#i-panel-left" />
            </svg>
          </button>
          <div className="rail-nav">
            <button
              className={`rail-btn ${view === "overview" ? "active" : ""}`}
              type="button"
              onClick={() => navigate(adminRoutes.overview)}
            >
              <svg className="icon">
                <use href="#i-shield" />
              </svg>
            </button>
            <button
              className={`rail-btn ${view === "providers" ? "active" : ""}`}
              type="button"
              onClick={() => navigate(adminRoutes.providers)}
            >
              <svg className="icon">
                <use href="#i-network" />
              </svg>
            </button>
          </div>
        </aside>

        <aside className="sidebar">
          <div className="sidebar-header">
            <button
              className={`sidebar-close ${sidebarOpen ? "active" : ""}`}
              type="button"
              onClick={() => setSidebarOpen((current) => !current)}
            >
              <svg className="icon">
                <use href="#i-panel-left" />
              </svg>
            </button>
          </div>

          <div className="brand">
            <div className="brand-row">
              <div className="logo">
                <img src={dashboardAssets.logo} alt="Lingban Ciyuan logo" />
              </div>
              <div>
                <div className="brand-sub">Platform Console</div>
                <div className="brand-title">
                  {t(lang, { zh: "灵办词元 Admin", en: "Lingban Ciyuan Admin" })}
                </div>
              </div>
            </div>
            <div className="muted">
              {t(lang, {
                zh: "平台级控制面只负责全局治理，不再承载工作区任务与会话交互。",
                en: "The platform control plane is now dedicated to global governance and no longer carries workspace task interactions.",
              })}
            </div>
          </div>

          <nav className="nav">
            <NavLink className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`} to={adminRoutes.overview}>
              <svg className="icon">
                <use href="#i-shield" />
              </svg>
              <span className="nav-text">{t(lang, { zh: "总览", en: "Overview" })}</span>
            </NavLink>
            <NavLink className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`} to={adminRoutes.providers}>
              <svg className="icon">
                <use href="#i-network" />
              </svg>
              <span className="nav-text">{t(lang, { zh: "Provider", en: "Providers" })}</span>
            </NavLink>
          </nav>

          <div className="sidebar-foot">
            <div className="mini-card">
              <div className="eyebrow">{t(lang, { zh: "当前管理员", en: "Current administrator" })}</div>
              <div className="mono" style={{ fontWeight: 700 }}>
                {user?.displayName ?? user?.email ?? "platform-admin"}
              </div>
              <div className="muted">{user?.email ?? "platform-admin@example.com"}</div>
              <div className="path-chip active">{platformAccess.role ?? "platform_admin"}</div>
            </div>

            <div className="mini-card">
              <div className="eyebrow">{t(lang, { zh: "入口切换", en: "Surface switch" })}</div>
              <div className="pill-row">
                <button
                  className="route-btn active"
                  type="button"
                  onClick={() => navigate(adminRoutes.overview)}
                >
                  {t(lang, { zh: "留在 Admin", en: "Stay in admin" })}
                </button>
                <button
                  className="route-btn"
                  type="button"
                  onClick={() => navigate(workspaceRoutes.workshops)}
                >
                  {t(lang, { zh: "进入工作区", en: "Open workspace" })}
                </button>
              </div>
              <div className="muted">
                {t(lang, {
                  zh: "入口已经拆分。这里不会展示任务会话、运行对话或工坊浏览。",
                  en: "The entry points are now split. This surface no longer shows task conversations, live run dialogue, or workshop browsing.",
                })}
              </div>
            </div>

            <button className="theme-btn" type="button" onClick={toggleTheme}>
              <span className="card-row" style={{ justifyContent: "space-between", width: "100%" }}>
                <span className="mono">{t(lang, { zh: "主题", en: "Theme" })}</span>
                <span>
                  <svg className="icon moon">
                    <use href="#i-moon" />
                  </svg>
                  <svg className="icon sun">
                    <use href="#i-sun" />
                  </svg>
                </span>
              </span>
            </button>
          </div>
        </aside>

        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />

        <main className="main">
          <header className="topbar">
            <div className="title-row">
              <button
                className={`drawer-inline-toggle ${sidebarOpen ? "active" : ""}`}
                type="button"
                onClick={() => setSidebarOpen((current) => !current)}
              >
                <svg className="icon">
                  <use href="#i-panel-left" />
                </svg>
              </button>
              <div className="title-wrap">
                <div className="eyebrow">{viewMeta[view].eyebrow}</div>
                <h1>{viewMeta[view].title}</h1>
                <p>{viewMeta[view].desc}</p>
              </div>
            </div>

            <div className="toolbar">
              <div className="toolbar-group">
                <div className="lang-switch">
                  <button
                    className={`lang-btn ${lang === "zh" ? "active" : ""}`}
                    type="button"
                    onClick={() => setLang("zh")}
                  >
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
                      <use href="#i-globe" />
                    </svg>
                    中文
                  </button>
                  <button
                    className={`lang-btn ${lang === "en" ? "active" : ""}`}
                    type="button"
                    onClick={() => setLang("en")}
                  >
                    EN
                  </button>
                </div>
              </div>

              <div className="toolbar-group topbar-actions">
                <button className="icon-btn" type="button" onClick={toggleTheme}>
                  <svg className="icon">
                    <use href={theme === "dark" ? "#i-moon" : "#i-sun"} />
                  </svg>
                  <span>{t(lang, { zh: "主题", en: "Theme" })}</span>
                </button>
                <button className="icon-btn" type="button" onClick={() => navigate(workspaceRoutes.workshops)}>
                  <svg className="icon">
                    <use href="#i-home" />
                  </svg>
                  <span>{t(lang, { zh: "工作区控制台", en: "Workspace console" })}</span>
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  disabled={logoutMutation.isPending}
                  onClick={() => logoutMutation.mutate()}
                >
                  <svg className="icon">
                    <use href="#i-user" />
                  </svg>
                  <span>
                    {logoutMutation.isPending
                      ? t(lang, { zh: "退出中", en: "Signing out" })
                      : t(lang, { zh: "退出", en: "Sign out" })}
                  </span>
                </button>
              </div>
            </div>
          </header>

          <div className="views">
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}
