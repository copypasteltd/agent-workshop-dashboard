import { matchesSearchQuery } from "@lingban/domain-models";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  creatorPackages,
  dashboardAssets,
  dashboardServices,
  dashboardWorkspaces,
  instances,
  workshops,
} from "../data/dashboardData";
import { dashboardI18n, setDashboardLanguage, t } from "../lib/i18n";
import { dashboardRoutes } from "../lib/routes";
import { applyDashboardTheme } from "../lib/theme";
import { useDashboardUiStore } from "../stores/dashboardUiStore";
import { IconSprite } from "../components/IconSprite";

export function DashboardShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useDashboardUiStore((state) => state.theme);
  const lang = useDashboardUiStore((state) => state.lang);
  const currentWorkspaceId = useDashboardUiStore((state) => state.currentWorkspaceId);
  const sidebarOpen = useDashboardUiStore((state) => state.sidebarOpen);
  const activeInstanceId = useDashboardUiStore((state) => state.activeInstanceId);
  const activePackageId = useDashboardUiStore((state) => state.activePackageId);
  const setLang = useDashboardUiStore((state) => state.setLang);
  const setCurrentWorkspaceId = useDashboardUiStore((state) => state.setCurrentWorkspaceId);
  const toggleTheme = useDashboardUiStore((state) => state.toggleTheme);
  const toggleSidebar = useDashboardUiStore((state) => state.toggleSidebar);
  const setSidebarOpen = useDashboardUiStore((state) => state.setSidebarOpen);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const currentWorkspace =
    dashboardWorkspaces.find((item) => item.id === currentWorkspaceId) ?? dashboardWorkspaces[0];

  const visibleWorkshops = useMemo(
    () => workshops.filter((item) => currentWorkspace.workshopIds.includes(item.id)),
    [currentWorkspace]
  );

  const visibleServices = useMemo(
    () => dashboardServices.filter((item) => currentWorkspace.workshopIds.includes(item.workshopId)),
    [currentWorkspace]
  );

  const visibleInstances = useMemo(
    () => Object.values(instances).filter((item) => item.workspaceId === currentWorkspace.id),
    [currentWorkspace]
  );

  const visiblePackages = useMemo(
    () => Object.values(creatorPackages).filter((item) => currentWorkspace.packageIds.includes(item.id)),
    [currentWorkspace]
  );

  const view = useMemo<"workshops" | "instances" | "creator">(() => {
    if (location.pathname.includes("/instances")) {
      return "instances";
    }
    if (location.pathname.includes("/creator")) {
      return "creator";
    }
    return "workshops";
  }, [location.pathname]);

  const workspaceStats = useMemo(() => {
    return {
      workshops: currentWorkspace.workshopIds.length,
      instances: visibleInstances.length,
      packages: visiblePackages.length,
    };
  }, [currentWorkspace, visibleInstances.length, visiblePackages.length]);

  const viewMeta = {
    workshops: {
      label: "dashboard://workshops",
      title: t(lang, { zh: "工坊", en: "Workshops" }),
      desc: t(lang, {
        zh: "用于选择工作流、筛选工坊、快速实例化任务。首页只保留浏览和启动所需信息，技术路由与结构说明进入折叠详情。",
        en: "Used to choose workflows, filter workshops, and instantiate tasks quickly. The landing page keeps only browsing and launch-critical information while technical routes move into collapsed detail.",
      }),
    },
    instances: {
      label: `dashboard://instances/${activeInstanceId}`,
      title: t(lang, { zh: "实例", en: "Instances" }),
      desc: t(lang, {
        zh: "多任务列表在左，当前实例的完整对话在中，文件、运行、审计等深层信息进入右侧子页签。",
        en: "The task list stays on the left, the full conversation for the active instance stays in the center, and files, runtime, and audit move into right-side subtabs.",
      }),
    },
    creator: {
      label: `dashboard://creator/${activePackageId}`,
      title: t(lang, { zh: "Creator", en: "Creator" }),
      desc: t(lang, {
        zh: "Creator 页聚焦 package、runtime、connectors 与发布审核。重型工程信息进入子页签，首屏只保留选择和判断所需内容。",
        en: "The Creator page focuses on packages, runtime, connectors, and release reviews. Heavy engineering detail lives inside subtabs while the first screen keeps only selection and decision-critical content.",
      }),
    },
  }[view];

  const searchResults = useMemo(() => {
    if (!globalSearchQuery.trim()) {
      return [];
    }

    return [
      ...visibleWorkshops.map((item) => ({
        id: `workshop:${item.id}`,
        type: t(lang, { zh: "工坊", en: "Workshop" }),
        title: t(lang, item.title),
        note: t(lang, item.summary),
        route: dashboardRoutes.workshop(item.id),
      })),
      ...visibleServices.map((item) => ({
        id: `service:${item.id}`,
        type: t(lang, { zh: "服务", en: "Service" }),
        title: t(lang, item.name),
        note: t(lang, item.auth),
        route: dashboardRoutes.service(item.id),
      })),
      ...visibleInstances.map((item) => ({
        id: `instance:${item.id}`,
        type: t(lang, { zh: "实例", en: "Instance" }),
        title: t(lang, item.title),
        note: t(lang, item.nextAction),
        route: dashboardRoutes.instance(item.id),
      })),
      ...visiblePackages.map((item) => ({
        id: `package:${item.id}`,
        type: t(lang, { zh: "Package", en: "Package" }),
        title: t(lang, item.title),
        note: t(lang, item.source),
        route: dashboardRoutes.creatorPackage(item.id),
      })),
    ]
      .filter((item) =>
        matchesSearchQuery(globalSearchQuery, [item.id, item.type, item.title, item.note, item.route])
      )
      .slice(0, 8);
  }, [globalSearchQuery, lang, visibleInstances, visiblePackages, visibleServices, visibleWorkshops]);

  const notificationItems = useMemo(() => {
    const next = [
      ...visibleInstances
        .filter((item) => item.statusClass === "warn")
        .map((item) => ({
          id: `approval:${item.id}`,
          tone: "warn",
          title: t(lang, { zh: "待审批实例", en: "Approval pending" }),
          note: `${t(lang, item.title)} / ${t(lang, item.nextAction)}`,
          route: dashboardRoutes.instance(item.id, "audit"),
        })),
      ...visibleInstances
        .filter((item) => item.statusClass === "active")
        .slice(0, 2)
        .map((item) => ({
          id: `instance:${item.id}`,
          tone: "active",
          title: t(lang, { zh: "运行中实例", en: "Active instance" }),
          note: `${t(lang, item.title)} / ${t(lang, item.summary)}`,
          route: dashboardRoutes.instance(item.id),
        })),
      ...visiblePackages
        .filter((item) => item.statusClass !== "success")
        .map((item) => ({
          id: `package:${item.id}`,
          tone: item.statusClass,
          title:
            item.statusClass === "warn"
              ? t(lang, { zh: "待发布 package", en: "Pending package" })
              : t(lang, { zh: "可发布 package", en: "Release-ready package" }),
          note: `${t(lang, item.title)} / ${t(lang, item.status)}`,
          route: dashboardRoutes.creatorPackage(item.id),
        })),
    ];

    return next.slice(0, 6);
  }, [lang, visibleInstances, visiblePackages]);

  const accountActions = [
    {
      id: "workspace-root",
      label: t(lang, { zh: "工作区根路径", en: "Workspace root" }),
      value: currentWorkspace.root,
    },
    {
      id: "workspace-scope",
      label: t(lang, { zh: "当前空间身份", en: "Current workspace role" }),
      value: t(lang, currentWorkspace.meta),
    },
  ];

  useEffect(() => {
    setDashboardLanguage(lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = dashboardI18n.t("dashboard.title");
    document.body.dataset.theme = theme;
    document.body.dataset.sidebar = sidebarOpen ? "open" : "closed";
    applyDashboardTheme(theme);
  }, [lang, theme, sidebarOpen]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 960) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarOpen]);

  useEffect(() => {
    setSearchPanelOpen(false);
    setNoticeOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  return (
    <>
      <IconSprite />
      <div className="shell">
        <aside className="rail">
          <button className={`rail-btn drawer-toggle ${sidebarOpen ? "active" : ""}`} type="button" onClick={toggleSidebar}>
            <svg className="icon"><use href="#i-panel-left" /></svg>
          </button>
          <div className="rail-nav">
            <button className={`rail-btn ${view === "workshops" ? "active" : ""}`} type="button" onClick={() => navigate(dashboardRoutes.workshops)}><svg className="icon"><use href="#i-home" /></svg></button>
            <button className={`rail-btn ${view === "instances" ? "active" : ""}`} type="button" onClick={() => navigate(dashboardRoutes.instances)}><svg className="icon"><use href="#i-terminal" /></svg></button>
            <button className={`rail-btn ${view === "creator" ? "active" : ""}`} type="button" onClick={() => navigate(dashboardRoutes.creator)}><svg className="icon"><use href="#i-spark" /></svg></button>
          </div>
        </aside>

        <aside className="sidebar">
          <div className="sidebar-header">
            <button className={`sidebar-close ${sidebarOpen ? "active" : ""}`} type="button" onClick={toggleSidebar}>
              <svg className="icon"><use href="#i-panel-left" /></svg>
            </button>
          </div>
          <div className="brand">
            <div className="brand-row">
              <div className="logo"><img src={dashboardAssets.logo} alt="灵办词元 logo" /></div>
              <div>
                <div className="brand-sub">{t(lang, { zh: "多语言控制台", en: "Multilingual Console" })}</div>
                <div className="brand-title">{t(lang, { zh: "灵办词元 / Operator Dashboard", en: "Lingban Ciyuan / Operator Dashboard" })}</div>
              </div>
            </div>
            <div className="muted">
              {t(lang, { zh: "当前工作区根路径：", en: "Current workspace root: " })}
              {currentWorkspace.root}
            </div>
          </div>

          <nav className="nav">
            <NavLink className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`} to={dashboardRoutes.workshops}>
              <svg className="icon"><use href="#i-home" /></svg><span className="nav-text">{t(lang, { zh: "工坊", en: "Workshops" })}</span>
            </NavLink>
            <NavLink className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`} to={dashboardRoutes.instances}>
              <svg className="icon"><use href="#i-terminal" /></svg><span className="nav-text">{t(lang, { zh: "实例", en: "Instances" })}</span>
            </NavLink>
            <NavLink className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`} to={dashboardRoutes.creator}>
              <svg className="icon"><use href="#i-spark" /></svg><span className="nav-text">{t(lang, { zh: "Creator", en: "Creator" })}</span>
            </NavLink>
          </nav>

          <div className="sidebar-foot">
            <div className="mini-card">
              <div className="eyebrow">{t(lang, { zh: "工作区切换", en: "Workspace Switch" })}</div>
              <div className="pill-row">
                {dashboardWorkspaces.map((item) => (
                  <button
                    className={`path-chip ${item.id === currentWorkspace.id ? "active" : ""}`}
                    key={item.id}
                    type="button"
                    onClick={() => setCurrentWorkspaceId(item.id)}
                  >
                    {t(lang, item.name)}
                  </button>
                ))}
              </div>
              <div className="muted">
                {t(lang, currentWorkspace.meta)}
                {t(lang, { zh: "。工作区用于切换根路径、成员权限和可见工坊。", en: ". The workspace controls the root path, member scope, and visible workshops." })}
              </div>
            </div>
            <div className="mini-card">
              <div className="eyebrow">{t(lang, { zh: "当前重点", en: "Current Focus" })}</div>
              <div className="mono" style={{ fontWeight: 700 }}>
                {view === "workshops"
                  ? t(lang, { zh: "先选工坊", en: "Pick a workshop" })
                  : view === "instances"
                    ? t(lang, { zh: "当前实例对话", en: "Active instance conversation" })
                    : t(lang, { zh: "当前 package", en: "Selected package" })}
              </div>
              <div className="muted">
                {view === "workshops"
                  ? t(lang, { zh: "首页强调选择和启动。", en: "The landing page emphasizes choosing and launching." })
                  : view === "instances"
                    ? t(lang, { zh: "对话在中央，文件与审计转入右侧。", en: "Conversation stays central while files and audit move right." })
                    : t(lang, { zh: "镜像、凭证与发布拆到子页签。", en: "Runtime, secrets, and release are split into subtabs." })}
              </div>
            </div>
            <button className="theme-btn" type="button" onClick={toggleTheme}>
              <span className="card-row" style={{ justifyContent: "space-between", width: "100%" }}>
                <span className="mono">{t(lang, { zh: "主题", en: "Theme" })}</span>
                <span>
                  <svg className="icon moon"><use href="#i-moon" /></svg>
                  <svg className="icon sun"><use href="#i-sun" /></svg>
                </span>
              </span>
            </button>
          </div>
        </aside>

        <button className="sidebar-scrim" type="button" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />

        <main className="main">
          <header className="topbar">
            <div className="title-row">
              <button className={`drawer-inline-toggle ${sidebarOpen ? "active" : ""}`} type="button" onClick={toggleSidebar}>
                <svg className="icon"><use href="#i-panel-left" /></svg>
              </button>
              <div className="title-wrap">
                <div className="eyebrow">{viewMeta.label}</div>
                <h1>{viewMeta.title}</h1>
                <p>{viewMeta.desc}</p>
              </div>
            </div>
            <div className="toolbar">
              <div className="toolbar-group topbar-search-group">
                <div className="toolbar-pop-wrap">
                  <label className={`global-search ${searchPanelOpen ? "active" : ""}`}>
                    <svg className="icon"><use href="#i-search" /></svg>
                    <input
                      className="global-search-input"
                      type="text"
                      value={globalSearchQuery}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setGlobalSearchQuery(nextValue);
                        setSearchPanelOpen(nextValue.length > 0);
                      }}
                      onFocus={() => setSearchPanelOpen(true)}
                      placeholder={t(lang, {
                        zh: "搜索工坊、服务、实例、Package",
                        en: "Search workshops, services, instances, packages",
                      })}
                    />
                    {globalSearchQuery ? (
                      <button
                        className="icon-chip"
                        type="button"
                        onClick={() => {
                          setGlobalSearchQuery("");
                          setSearchPanelOpen(false);
                        }}
                      >
                        <svg className="icon"><use href="#i-x" /></svg>
                      </button>
                    ) : null}
                  </label>
                  {searchPanelOpen ? (
                    <div className="topbar-panel search-panel">
                      <div className="panel-head">
                        <div>
                          <div className="eyebrow">{t(lang, { zh: "全局搜索", en: "Global Search" })}</div>
                          <div className="panel-title">
                            {globalSearchQuery
                              ? t(lang, { zh: "搜索结果", en: "Search results" })
                              : t(lang, { zh: "可搜索对象", en: "Searchable surfaces" })}
                          </div>
                        </div>
                        <span className="pill active">{t(lang, currentWorkspace.name)}</span>
                      </div>
                      <div className="panel-list">
                        {globalSearchQuery ? (
                          searchResults.length > 0 ? (
                            searchResults.map((item) => (
                              <button
                                className="panel-item"
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  navigate(item.route);
                                  setSearchPanelOpen(false);
                                }}
                              >
                                <div className="panel-item-top">
                                  <span className="pill">{item.type}</span>
                                  <span className="panel-item-route">{item.route}</span>
                                </div>
                                <div className="panel-item-title">{item.title}</div>
                                <div className="panel-item-note">{item.note}</div>
                              </button>
                            ))
                          ) : (
                            <div className="panel-empty">
                              {t(lang, {
                                zh: "当前工作区没有匹配结果。你可以改搜服务名、实例标题或 package ID。",
                                en: "No match in the current workspace. Try a service name, instance title, or package ID.",
                              })}
                            </div>
                          )
                        ) : (
                          <>
                            {[
                              t(lang, { zh: "工坊和服务的用户侧名称", en: "User-facing workshop and service names" }),
                              t(lang, { zh: "实例标题、状态与目标路径", en: "Instance titles, states, and target paths" }),
                              t(lang, { zh: "Creator package、发布通道和版本线", en: "Creator packages, release channels, and version lines" }),
                            ].map((item) => (
                              <div className="panel-item static" key={item}>
                                <div className="panel-item-note">{item}</div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="toolbar-group">
                <div className="lang-switch">
                  <button className={`lang-btn ${lang === "zh" ? "active" : ""}`} type="button" onClick={() => setLang("zh")}>
                    <svg className="icon" style={{ display: "inline-block", verticalAlign: -4, width: 14, height: 14, marginRight: 6 }}><use href="#i-globe" /></svg>中文
                  </button>
                  <button className={`lang-btn ${lang === "en" ? "active" : ""}`} type="button" onClick={() => setLang("en")}>EN</button>
                </div>
              </div>
              <div className="toolbar-group">
                <div className="toolbar-chip active">
                  {t(lang, { zh: "工作区：", en: "Workspace: " })}
                  {t(lang, currentWorkspace.name)}
                </div>
                <div className="toolbar-chip">
                  {view === "workshops"
                    ? t(lang, { zh: `可见工坊 ${String(workspaceStats.workshops).padStart(2, "0")}`, en: `Visible workshops ${String(workspaceStats.workshops).padStart(2, "0")}` })
                    : view === "instances"
                      ? t(lang, { zh: `可见实例 ${String(workspaceStats.instances).padStart(2, "0")}`, en: `Visible instances ${String(workspaceStats.instances).padStart(2, "0")}` })
                      : t(lang, { zh: `可见包 ${String(workspaceStats.packages).padStart(2, "0")}`, en: `Visible packages ${String(workspaceStats.packages).padStart(2, "0")}` })}
                </div>
                <div className="toolbar-chip">
                  {view === "instances"
                    ? t(lang, { zh: "中央对话 + 右侧详情", en: "Center conversation + right detail" })
                    : view === "creator"
                      ? t(lang, { zh: "包详情 / 调试 / 治理", en: "Package / Debug / Governance" })
                      : t(lang, { zh: "启动后自动追问信息", en: "Prompts for missing info after launch" })}
                </div>
              </div>
              <div className="toolbar-group topbar-actions">
                <button className="icon-btn" type="button" onClick={toggleTheme}>
                  <svg className="icon"><use href={theme === "dark" ? "#i-moon" : "#i-sun"} /></svg>
                  <span>{t(lang, { zh: "主题", en: "Theme" })}</span>
                </button>

                <div className="toolbar-pop-wrap">
                  <button
                    className={`icon-btn ${noticeOpen ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setNoticeOpen((value) => !value);
                      setAccountOpen(false);
                    }}
                  >
                    <svg className="icon"><use href="#i-bell" /></svg>
                    <span>{t(lang, { zh: "通知", en: "Alerts" })}</span>
                    {notificationItems.length > 0 ? <span className="topbar-badge">{notificationItems.length}</span> : null}
                  </button>
                  {noticeOpen ? (
                    <div className="topbar-panel pop-panel">
                      <div className="panel-head">
                        <div>
                          <div className="eyebrow">{t(lang, { zh: "通知中心", en: "Notification Center" })}</div>
                          <div className="panel-title">{t(lang, { zh: "需要你处理的项", en: "Actionable items" })}</div>
                        </div>
                        <span className="pill warn">{notificationItems.length}</span>
                      </div>
                      <div className="panel-list">
                        {notificationItems.length > 0 ? (
                          notificationItems.map((item) => (
                            <button
                              className="panel-item"
                              key={item.id}
                              type="button"
                              onClick={() => {
                                navigate(item.route);
                                setNoticeOpen(false);
                              }}
                            >
                              <div className="panel-item-top">
                                <span className={`pill ${item.tone}`}>{item.title}</span>
                              </div>
                              <div className="panel-item-note">{item.note}</div>
                            </button>
                          ))
                        ) : (
                          <div className="panel-empty">
                            {t(lang, { zh: "当前没有待处理通知。", en: "There are no pending notifications right now." })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="toolbar-pop-wrap">
                  <button
                    className={`icon-btn ${accountOpen ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setAccountOpen((value) => !value);
                      setNoticeOpen(false);
                    }}
                  >
                    <svg className="icon"><use href="#i-user" /></svg>
                    <span>{t(lang, { zh: "账户", en: "Account" })}</span>
                    <svg className="icon chevron"><use href="#i-chevron-down" /></svg>
                  </button>
                  {accountOpen ? (
                    <div className="topbar-panel pop-panel">
                      <div className="panel-head">
                        <div>
                          <div className="eyebrow">{t(lang, { zh: "当前空间账户", en: "Active Workspace Account" })}</div>
                          <div className="panel-title">{t(lang, currentWorkspace.name)}</div>
                        </div>
                        <span className="pill active">{t(lang, currentWorkspace.type)}</span>
                      </div>
                      <div className="panel-list">
                        {accountActions.map((item) => (
                          <div className="panel-item static" key={item.id}>
                            <div className="panel-item-top">
                              <span className="pill">{item.label}</span>
                            </div>
                            <div className="panel-item-route">{item.value}</div>
                          </div>
                        ))}
                        <div className="panel-inline-actions">
                          <button className="route-btn" type="button" onClick={() => navigate(dashboardRoutes.workshops)}>
                            {t(lang, { zh: "回到工坊", en: "Go to workshops" })}
                          </button>
                          <button className="route-btn active" type="button" onClick={() => navigate(dashboardRoutes.instances)}>
                            {t(lang, { zh: "继续实例", en: "Open instances" })}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
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
