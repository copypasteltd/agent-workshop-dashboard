import { matchesSearchQuery } from "@lingban/domain-models";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { dashboardRunsApi } from "../../lib/api";
import { dashboardServices, dashboardWorkspaces, instances, workshops } from "../../data/dashboardData";
import { t } from "../../lib/i18n";
import { buildDashboardRunInput } from "../../lib/runTemplates";
import { dashboardRoutes } from "../../lib/routes";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

export function WorkshopsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workshopId, serviceId } = useParams();
  const lang = useDashboardUiStore((state) => state.lang);
  const [searchQuery, setSearchQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "enterprise" | "content" | "creative">(
    "all"
  );
  const currentWorkspaceId = useDashboardUiStore((state) => state.currentWorkspaceId);
  const currentWorkspace =
    dashboardWorkspaces.find((item) => item.id === currentWorkspaceId) ?? dashboardWorkspaces[0];
  const launchRunMutation = useMutation({
    mutationFn: async (targetServiceId: string) => {
      const input = buildDashboardRunInput(targetServiceId);

      if (!input) {
        throw new Error(`Missing run template for service ${targetServiceId}`);
      }

      return dashboardRunsApi.createRun(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] });
    },
  });

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

  const filteredWorkshops = useMemo(() => {
    return visibleWorkshops.filter((item) => {
      const scopeMatched =
        scopeFilter === "all" ||
        (scopeFilter === "enterprise" && item.id === "enterprise-tax") ||
        (scopeFilter === "content" && item.id === "creator-drama") ||
        (scopeFilter === "creative" && item.id === "brand-poster-suite");

      if (!scopeMatched) {
        return false;
      }

      return matchesSearchQuery(searchQuery, [
        item.id,
        item.route,
        item.title.zh,
        item.title.en,
        item.badge.zh,
        item.badge.en,
        item.audience.zh,
        item.audience.en,
        item.summary.zh,
        item.summary.en,
        item.next.zh,
        item.next.en,
        ...item.tags,
      ]);
    });
  }, [scopeFilter, searchQuery, visibleWorkshops]);

  const filteredServices = useMemo(() => {
    return visibleServices.filter((item) =>
      matchesSearchQuery(searchQuery, [
        item.id,
        item.eta,
        item.targetPath,
        item.name.zh,
        item.name.en,
        item.summary.zh,
        item.summary.en,
        item.auth.zh,
        item.auth.en,
      ])
    );
  }, [searchQuery, visibleServices]);

  const selectedService = useMemo(
    () => visibleServices.find((item) => item.id === serviceId) ?? null,
    [serviceId, visibleServices]
  );

  const selectedWorkshop = useMemo(() => {
    if (workshopId) {
      return visibleWorkshops.find((item) => item.id === workshopId) ?? null;
    }
    if (selectedService) {
      return visibleWorkshops.find((item) => item.id === selectedService.workshopId) ?? null;
    }
    return null;
  }, [selectedService, visibleWorkshops, workshopId]);

  const focusService =
    selectedService ??
    (selectedWorkshop ? visibleServices.find((item) => item.id === selectedWorkshop.linkedService) ?? null : null);

  return (
    <section className="view">
      <article className="hero-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "工坊总览", en: "Workshop Overview" })}</div>
            <h2 className="hero-title">{t(lang, { zh: "先选工坊，再进入实例对话", en: "Choose a workshop first, then enter the live instance conversation" })}</h2>
          </div>
          <span className="pill active">dashboard://workshops</span>
        </div>
        <div className="section-note">{t(lang, { zh: "这一页承担工坊浏览、工坊详情和服务启动台三类动作。重型运行细节留给实例页，Creator 只处理包与治理。", en: "This surface handles workshop browse, workshop detail, and the service launchpad. Heavy runtime detail stays in instances while Creator stays focused on packages and governance." })}</div>
        <div className="metric-grid">
          {[
            { label: { zh: "可见工坊", en: "Visible workshops" }, value: String(visibleWorkshops.length).padStart(2, "0"), note: { zh: "当前空间能直接消费的工坊集合。", en: "The workshop set directly consumable inside the current workspace." } },
            { label: { zh: "即开服务", en: "Runnable services" }, value: String(visibleServices.length).padStart(2, "0"), note: { zh: "启动后直接进入实例对话。", en: "Launches lead directly into the instance conversation." } },
            { label: { zh: "当前工作区", en: "Current workspace" }, value: t(lang, currentWorkspace.name), note: { zh: "切换工作区会同步收敛可见工坊、实例与 Creator 包。", en: "Switching workspaces simultaneously narrows visible workshops, instances, and creator packages." } },
          ].map((item) => (
            <div className="metric-card" key={t(lang, item.label)}>
              <div className="metric-label">{t(lang, item.label)}</div>
              <div className="metric-value">{item.value}</div>
              <div className="tiny-note">{t(lang, item.note)}</div>
            </div>
          ))}
        </div>
      </article>

      <div className="page-grid">
        <article className="filter-card">
          <div className="section-head">
            <div>
              <div className="eyebrow">{t(lang, { zh: "筛选与搜索", en: "Filters and Search" })}</div>
              <h3 className="detail-title">{t(lang, { zh: "工坊浏览", en: "Workshop Browse" })}</h3>
            </div>
            <span className="pill">{t(lang, { zh: "轻量首页", en: "Light landing" })}</span>
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
                zh: "搜索工坊名、行业标签或最近使用场景",
                en: "Search by workshop name, industry tag, or recent use case",
              })}
            />
          </label>
          <div className="pill-row">
            {[
              {
                key: "all" as const,
                label: { zh: "全部", en: "All" },
              },
              {
                key: "enterprise" as const,
                label: { zh: "企业", en: "Enterprise" },
              },
              {
                key: "content" as const,
                label: { zh: "内容", en: "Content" },
              },
              {
                key: "creative" as const,
                label: { zh: "创意", en: "Creative" },
              },
            ].map((chip) => (
              <button
                className={`path-chip ${scopeFilter === chip.key ? "active" : ""}`}
                key={chip.key}
                type="button"
                onClick={() => setScopeFilter(chip.key)}
              >
                {t(lang, chip.label)}
              </button>
            ))}
          </div>
          <div className="section-note">
            {t(lang, {
              zh: `当前命中 ${filteredWorkshops.length} 个工坊 / ${filteredServices.length} 个服务。工坊页只回答三件事：该选哪一类工坊、当前服务需要什么权限、启动后会把用户带到哪里。`,
              en: `Matched ${filteredWorkshops.length} workshops / ${filteredServices.length} services. The workshop page answers three questions: which workshop to choose, which permissions the service needs, and where the user lands after launch.`,
            })}
          </div>
          <div className="pill-row">
            <span className="path-chip active">{t(lang, currentWorkspace.name)}</span>
            <span className="path-chip">{currentWorkspace.root}</span>
          </div>
        </article>

        <article className="detail-card">
          <div className="section-head">
            <div>
              <div className="eyebrow">
                {selectedService
                  ? t(lang, { zh: "服务启动台", en: "Service Launchpad" })
                  : selectedWorkshop
                    ? t(lang, { zh: "工坊详情", en: "Workshop Detail" })
                    : t(lang, { zh: "最近实例", en: "Recent Instances" })}
              </div>
              <div className="detail-title">
                {selectedService
                  ? t(lang, selectedService.name)
                  : selectedWorkshop
                    ? t(lang, selectedWorkshop.title)
                    : t(lang, { zh: "继续上次工作", en: "Continue where you left off" })}
              </div>
            </div>
            <span className={`pill ${selectedService ? "active" : "success"}`}>
              {selectedService
                ? selectedService.eta
                : selectedWorkshop
                  ? t(lang, { zh: "工坊详情", en: "Workshop detail" })
                  : t(lang, { zh: "实例列表", en: "Instance list" })}
            </span>
          </div>

          {selectedService ? (
            <div className="detail-body">
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "服务说明", en: "Service Summary" })}</div>
                <div className="meta">{t(lang, selectedService.summary)}</div>
              </div>
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "授权要求", en: "Authorization" })}</div>
                <div className="meta">{t(lang, selectedService.auth)}</div>
              </div>
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "目标路径", en: "Target Path" })}</div>
                <div className="route-code">{selectedService.targetPath}</div>
              </div>
              <div className="pill-row">
                <span className="path-chip active">{t(lang, { zh: "启动后自动追问信息", en: "Prompts for missing info after launch" })}</span>
                <span className="path-chip">{t(lang, { zh: "任务会话继承当前工作区", en: "The run inherits the current workspace" })}</span>
              </div>
              <div className="task-row">
                {selectedWorkshop ? (
                  <button className="route-btn" type="button" onClick={() => navigate(dashboardRoutes.workshop(selectedWorkshop.id))}>
                    {t(lang, { zh: "查看工坊", en: "View workshop" })}
                  </button>
                ) : null}
                <button
                  className="route-btn active"
                  type="button"
                  onClick={async () => {
                    try {
                      const created = await launchRunMutation.mutateAsync(selectedService.id);
                      navigate(dashboardRoutes.instance(created.run.runId));
                    } catch {
                      navigate(dashboardRoutes.instance(selectedService.linkedInstance));
                    }
                  }}
                >
                  {launchRunMutation.isPending
                    ? t(lang, { zh: "启动中", en: "Launching" })
                    : t(lang, { zh: "打开实例对话", en: "Open instance conversation" })}
                </button>
              </div>
            </div>
          ) : selectedWorkshop && focusService ? (
            <div className="detail-body">
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "用户对象", en: "Audience" })}</div>
                <div className="meta">{t(lang, selectedWorkshop.audience)}</div>
              </div>
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "工坊摘要", en: "Workshop Summary" })}</div>
                <div className="meta">{t(lang, selectedWorkshop.summary)}</div>
              </div>
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "默认服务", en: "Default Service" })}</div>
                <div className="meta">{t(lang, focusService.name)}</div>
              </div>
              <div className="pill-row">
                {selectedWorkshop.tags.map((tag) => <span className="path-chip" key={tag}>{tag}</span>)}
              </div>
              <div className="task-row">
                <button className="route-btn" type="button" onClick={() => navigate(dashboardRoutes.instances)}>
                  {t(lang, { zh: "查看实例列表", en: "Open instances" })}
                </button>
                <button className="route-btn active" type="button" onClick={() => navigate(dashboardRoutes.service(focusService.id))}>
                  {t(lang, { zh: "进入服务启动台", en: "Open service launchpad" })}
                </button>
              </div>
            </div>
          ) : (
            <div className="detail-body">
              {visibleInstances.slice(0, 3).map((item) => (
                <div className="detail-item" key={item.id}>
                  <div className="instance-head">
                    <div className="list-title">{t(lang, item.title)}</div>
                    <span className={`pill ${item.statusClass}`}>{t(lang, item.status)}</span>
                  </div>
                  <div className="list-route">{item.route}</div>
                  <div className="meta">{t(lang, item.summary)}</div>
                </div>
              ))}
              <div className="task-row">
                <button className="route-btn active" type="button" onClick={() => navigate(dashboardRoutes.instances)}>
                  {t(lang, { zh: "进入实例页", en: "Open instances" })}
                </button>
              </div>
            </div>
          )}
        </article>
      </div>

      <div className="workshop-grid">
        {filteredWorkshops.length === 0 ? (
          <article className="workshop-card">
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "没有匹配结果", en: "No matches" })}</div>
              <div className="meta">
                {t(lang, {
                  zh: "请调整搜索词或切换工坊分类。当前工作区不展示跨工作区结果。",
                  en: "Adjust the query or switch the workshop scope. Results never spill across workspaces.",
                })}
              </div>
            </div>
          </article>
        ) : null}
        {filteredWorkshops.map((item) => {
          const service = visibleServices.find((entry) => entry.id === item.linkedService);
          return (
            <article className="workshop-card" key={item.id}>
              <img className="cover" src={item.cover} alt={t(lang, item.title)} />
              <div className="pill-row">
                <span className="pill active">{t(lang, item.badge)}</span>
                <span className="pill">{t(lang, { zh: "可实例化", en: "Runnable" })}</span>
              </div>
              <h3 className="workshop-title">{t(lang, item.title)}</h3>
              <div className="meta">{t(lang, item.audience)}</div>
              <div className="section-note">{t(lang, item.summary)}</div>
              <div className="pill-row">
                {item.tags.map((tag) => <span className="path-chip" key={tag}>{tag}</span>)}
              </div>
              <div className="section-note">{t(lang, item.next)}</div>
              <div className="task-row">
                <button className="route-btn" type="button" onClick={() => navigate(dashboardRoutes.workshop(item.id))}>
                  {t(lang, { zh: "查看工坊", en: "View workshop" })}
                </button>
                {service ? (
                  <button className="route-btn active" type="button" onClick={() => navigate(dashboardRoutes.service(service.id))}>
                    {t(lang, { zh: "服务启动台", en: "Launchpad" })}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <details className="tech-details">
        <summary>{t(lang, { zh: "查看技术详情", en: "Show technical details" })}</summary>
        <div className="tech-body">
          <div className="tech-note">{t(lang, { zh: "技术路径、工作区边界与跨端入口保留在折叠区，方便 creator 和重度用户查看。", en: "Technical routes, workspace boundaries, and cross-surface entry points live in this collapsed area for creators and power users." })}</div>
          <div className="tech-grid">
            <div className="tech-box">
              <h4>{t(lang, { zh: "当前工作区根路径", en: "Current workspace roots" })}</h4>
              <div className="route-code">{currentWorkspace.root}</div>
              <div className="route-code">{`${currentWorkspace.root}output/`}</div>
              <div className="route-code">{`${currentWorkspace.root}archive/`}</div>
            </div>
            <div className="tech-box">
              <h4>{t(lang, { zh: "跨端入口", en: "Cross-surface entries" })}</h4>
              <div className="route-code">h5://workshop/list</div>
              <div className="route-code">mini://workshop/home</div>
              <div className="route-code">dashboard://instances/&lt;task-id&gt;</div>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}
