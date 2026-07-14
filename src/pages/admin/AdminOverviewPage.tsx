import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardProvidersApi } from "../../lib/api";
import { adminRoutes, workspaceRoutes } from "../../lib/routes";
import { l, t } from "../../lib/i18n";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";
import { Link } from "react-router-dom";

export function AdminOverviewPage() {
  const lang = useDashboardUiStore((state) => state.lang);
  const providersQuery = useQuery({
    queryKey: ["admin", "providers", "overview"],
    queryFn: async () => dashboardProvidersApi.listProviders(),
    retry: false,
    staleTime: 30_000,
  });

  const stats = useMemo(() => {
    const providers = providersQuery.data ?? [];
    const activeProviders = providers.filter((item) => item.enabled).length;
    const healthyProviders = providers.filter(
      (item) => item.lastHealthcheck?.status === "healthy"
    ).length;

    return {
      total: providers.length,
      active: activeProviders,
      healthy: healthyProviders,
    };
  }, [providersQuery.data]);

  return (
    <section className="view" data-testid="admin-overview-page">
      <section className="hero-card">
        <div className="card-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="eyebrow">admin://overview</div>
            <h2 className="hero-title">
              {t(lang, l("平台控制面已经拆分", "The platform console is now isolated"))}
            </h2>
            <div className="section-note" style={{ maxWidth: "72ch" }}>
              {t(
                lang,
                l(
                  "平台管理员入口只保留平台侧职责：维护 Provider 总目录、检查上游健康状态、定义全局运行策略。工作区工坊、任务会话、文件与 Creator 发布流已经回归用户侧控制台。",
                  "The platform entry is now limited to platform duties: managing the provider catalog, checking upstream health, and defining global runtime policy. Workspace workshops, task conversations, files, and creator release flows now live in the user-side console."
                )
              )}
            </div>
          </div>
          <div className="pill-row">
            <span className="pill active">admin://providers</span>
            <span className="pill">{workspaceRoutes.workshops}</span>
          </div>
        </div>

        <div className="metric-grid">
          {[
            {
              label: t(lang, l("Provider 总数", "Provider profiles")),
              value: String(stats.total).padStart(2, "0"),
              note: t(lang, l("平台登记的上游模板档案。", "Reusable upstream templates registered on the platform.")),
            },
            {
              label: t(lang, l("启用中的 Provider", "Enabled providers")),
              value: String(stats.active).padStart(2, "0"),
              note: t(lang, l("允许被工作区绑定的上游。", "Upstreams eligible for workspace binding.")),
            },
            {
              label: t(lang, l("健康检查通过", "Healthy providers")),
              value: String(stats.healthy).padStart(2, "0"),
              note: t(lang, l("最近一次健康检查状态为 healthy。", "Providers whose latest health check status is healthy.")),
            },
          ].map((item) => (
            <article className="metric-card" key={item.label}>
              <div className="metric-label">{item.label}</div>
              <div className="metric-value">{item.value}</div>
              <div className="meta">{item.note}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="page-grid">
        <article className="detail-card">
          <div className="section-head">
            <div>
              <div className="eyebrow">{t(lang, l("平台职责", "Platform scope"))}</div>
              <h3 className="detail-title">
                {t(lang, l("Admin 只处理平台级对象", "Admin handles only platform-level objects"))}
              </h3>
            </div>
            <span className="path-chip active">Platform only</span>
          </div>
          <div className="list-group">
            {[
              t(lang, l("Provider catalog / healthcheck / upstream policy", "Provider catalog / healthcheck / upstream policy")),
              t(lang, l("全局运行策略与平台治理说明", "Global runtime policy and platform governance notes")),
              t(lang, l("不再在此页展示任务会话、文件树、工坊浏览", "Task conversations, file trees, and workshop browsing are no longer shown here")),
            ].map((item) => (
              <div className="panel-item static" key={item}>
                <div className="panel-item-note">{item}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="detail-card">
          <div className="section-head">
            <div>
              <div className="eyebrow">{t(lang, l("快速入口", "Quick entry"))}</div>
              <h3 className="detail-title">
                {t(lang, l("拆分后的两个控制台", "The two isolated consoles"))}
              </h3>
            </div>
          </div>
          <div className="list-group">
            <Link className="panel-item" to={adminRoutes.providers}>
              <div className="panel-item-top">
                <span className="pill active">admin://providers</span>
                <span className="panel-item-route">{adminRoutes.providers}</span>
              </div>
              <div className="panel-item-title">
                {t(lang, l("进入 Provider 总目录", "Open provider catalog"))}
              </div>
              <div className="panel-item-note">
                {t(lang, l("执行平台级 Provider 档案维护与健康检查。", "Maintain platform-level provider profiles and run health checks."))}
              </div>
            </Link>

            <Link className="panel-item" to={workspaceRoutes.workshops}>
              <div className="panel-item-top">
                <span className="pill">workspace://workshops</span>
                <span className="panel-item-route">{workspaceRoutes.workshops}</span>
              </div>
              <div className="panel-item-title">
                {t(lang, l("回到用户工作区控制台", "Open workspace console"))}
              </div>
              <div className="panel-item-note">
                {t(lang, l("工坊、任务会话、文件和 Creator 均留在用户侧。", "Workshops, task conversations, files, and creator flows now stay on the user side."))}
              </div>
            </Link>
          </div>
        </article>
      </section>

      {providersQuery.error instanceof Error ? (
        <article className="detail-card">
          <div className="eyebrow">{t(lang, l("读取异常", "Read error"))}</div>
          <div className="detail-title">{providersQuery.error.message}</div>
        </article>
      ) : null}
    </section>
  );
}
