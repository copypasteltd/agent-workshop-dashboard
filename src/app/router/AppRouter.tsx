import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { DashboardShell } from "../DashboardShell";
import { adminConsoleUrl, workspaceRoutes } from "../../lib/routes";
import { t } from "../../lib/i18n";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

const PortalEntryPage = lazy(async () =>
  import("../../pages/portal/PortalEntryPage").then((module) => ({
    default: module.PortalEntryPage,
  }))
);
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
const WorkspaceProviderBindingsPage = lazy(async () =>
  import("../../pages/settings/WorkspaceProviderBindingsPage").then((module) => ({
    default: module.WorkspaceProviderBindingsPage,
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
            en: "Preparing console module",
          })}
        </div>
        <div style={{ color: "var(--muted)", lineHeight: 1.6 }}>
          {t(lang, {
            zh: "当前入口对应的路由代码正在加载。",
            en: "Route code for the current surface is loading.",
          })}
        </div>
      </div>
    </div>
  );
}

function withRouteSuspense(node: ReactNode) {
  return <Suspense fallback={<RoutePendingView />}>{node}</Suspense>;
}

function LegacyDashboardRedirect() {
  const location = useLocation();
  const legacyPath = location.pathname.replace(/^\/dashboard(?=\/|$)/, "");
  const destination =
    legacyPath === "/providers"
      ? workspaceRoutes.settingsProviders
      : legacyPath.length > 0
        ? `/workspace${legacyPath}`
        : workspaceRoutes.workshops;

  return (
    <Navigate
      to={`${destination}${location.search}${location.hash}`}
      replace
    />
  );
}

function ExternalAdminRedirect() {
  useEffect(() => {
    window.location.replace(adminConsoleUrl);
  }, []);
  return <RoutePendingView />;
}

export function AppRouter() {
  const portalElement = withRouteSuspense(<PortalEntryPage />);
  const workshopsElement = withRouteSuspense(<WorkshopsPage />);
  const instancesElement = withRouteSuspense(<InstancesPage />);
  const workspaceProviderBindingsElement = withRouteSuspense(
    <WorkspaceProviderBindingsPage />
  );
  const creatorElement = withRouteSuspense(<CreatorPage />);

  return (
    <Routes>
      <Route path="/" element={portalElement} />

      <Route element={<DashboardShell />}>
        <Route path={workspaceRoutes.root} element={<Navigate to={workspaceRoutes.workshops} replace />} />
        <Route path={workspaceRoutes.workshops} element={workshopsElement} />
        <Route path="/workspace/workshops/:workshopId" element={workshopsElement} />
        <Route path="/workspace/services/:serviceId" element={workshopsElement} />
        <Route
          path="/workspace/services/:serviceId/batches/:batchJobId"
          element={workshopsElement}
        />
        <Route path={workspaceRoutes.instances} element={instancesElement} />
        <Route path="/workspace/instances/:instanceId" element={instancesElement} />
        <Route path="/workspace/instances/:instanceId/:detailTab" element={instancesElement} />
        <Route path={workspaceRoutes.settingsProviders} element={workspaceProviderBindingsElement} />
        <Route path={workspaceRoutes.creator} element={creatorElement} />
        <Route path="/workspace/creator/packages/:packageId" element={creatorElement} />
        <Route path="/workspace/creator/packages/:packageId/debug" element={creatorElement} />
        <Route path="/workspace/creator/governance/:section" element={creatorElement} />

        <Route path="/workshops" element={workshopsElement} />
        <Route path="/workshops/:workshopId" element={workshopsElement} />
        <Route path="/services/:serviceId" element={workshopsElement} />
        <Route path="/services/:serviceId/batches/:batchJobId" element={workshopsElement} />
        <Route path="/instances" element={instancesElement} />
        <Route path="/instances/:instanceId" element={instancesElement} />
        <Route path="/instances/:instanceId/:detailTab" element={instancesElement} />
        <Route path="/creator" element={creatorElement} />
        <Route path="/creator/:packageId" element={creatorElement} />
      </Route>

      <Route path="/admin/*" element={<ExternalAdminRedirect />} />

      <Route path="/dashboard/*" element={<LegacyDashboardRedirect />} />
    </Routes>
  );
}
