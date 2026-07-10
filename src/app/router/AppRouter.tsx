import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardShell } from "../DashboardShell";
import { dashboardRoutes } from "../../lib/routes";
import { t } from "../../lib/i18n";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

const WorkshopsPage = lazy(async () =>
  import("../../pages/workshops/WorkshopsPage").then((module) => ({
    default: module.WorkshopsPage,
  }))
);
const InstancesPage = lazy(async () =>
  import("../../pages/instances/InstancesPage").then((module) => ({
    default: module.InstancesPage,
  }))
);
const CreatorPage = lazy(async () =>
  import("../../pages/creator/CreatorPage").then((module) => ({
    default: module.CreatorPage,
  }))
);

function RoutePendingView() {
  const lang = useDashboardUiStore((state) => state.lang);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "grid",
        placeItems: "center",
        padding: "32px",
      }}
    >
      <div
        style={{
          width: "min(440px, 100%)",
          border: "1px solid var(--line)",
          borderRadius: "16px",
          background: "var(--surface)",
          boxShadow: "var(--shadow-card)",
          padding: "20px",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            color: "var(--muted)",
            textTransform: "uppercase",
            marginBottom: "8px",
          }}
        >
          {t(lang, { zh: "加载中", en: "Loading" })}
        </div>
        <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "6px" }}>
          {t(lang, {
            zh: "正在准备控制台模块",
            en: "Preparing dashboard module",
          })}
        </div>
        <div style={{ color: "var(--muted)", lineHeight: 1.6 }}>
          {t(lang, {
            zh: "当前工作区视图对应的路由代码正在加载。",
            en: "Route code is loading for the current workspace view.",
          })}
        </div>
      </div>
    </div>
  );
}

function withRouteSuspense(node: ReactNode) {
  return <Suspense fallback={<RoutePendingView />}>{node}</Suspense>;
}

export function AppRouter() {
  const workshopsElement = withRouteSuspense(<WorkshopsPage />);
  const instancesElement = withRouteSuspense(<InstancesPage />);
  const creatorElement = withRouteSuspense(<CreatorPage />);

  return (
    <Routes>
      <Route element={<DashboardShell />}>
        <Route path="/" element={<Navigate to={dashboardRoutes.workshops} replace />} />
        <Route path="/dashboard" element={<Navigate to={dashboardRoutes.workshops} replace />} />
        <Route path="/workshops" element={workshopsElement} />
        <Route path="/workshops/:workshopId" element={workshopsElement} />
        <Route path="/services/:serviceId" element={workshopsElement} />
        <Route path={dashboardRoutes.workshops} element={workshopsElement} />
        <Route path="/dashboard/workshops/:workshopId" element={workshopsElement} />
        <Route path="/dashboard/services/:serviceId" element={workshopsElement} />
        <Route path="/instances" element={instancesElement} />
        <Route path="/instances/:instanceId" element={instancesElement} />
        <Route path="/instances/:instanceId/:detailTab" element={instancesElement} />
        <Route path={dashboardRoutes.instances} element={instancesElement} />
        <Route path="/dashboard/instances/:instanceId" element={instancesElement} />
        <Route path="/dashboard/instances/:instanceId/:detailTab" element={instancesElement} />
        <Route path="/creator" element={creatorElement} />
        <Route path="/creator/:packageId" element={creatorElement} />
        <Route path={dashboardRoutes.creator} element={creatorElement} />
        <Route path="/dashboard/creator/packages/:packageId" element={creatorElement} />
        <Route path="/dashboard/creator/packages/:packageId/debug" element={creatorElement} />
        <Route path="/dashboard/creator/governance/:section" element={creatorElement} />
      </Route>
    </Routes>
  );
}
