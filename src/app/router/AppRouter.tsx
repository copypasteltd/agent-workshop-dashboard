import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardShell } from "../DashboardShell";
import { CreatorPage } from "../../pages/creator/CreatorPage";
import { InstancesPage } from "../../pages/instances/InstancesPage";
import { WorkshopsPage } from "../../pages/workshops/WorkshopsPage";
import { dashboardRoutes } from "../../lib/routes";

export function AppRouter() {
  return (
    <Routes>
      <Route element={<DashboardShell />}>
        <Route path="/" element={<Navigate to={dashboardRoutes.workshops} replace />} />
        <Route path="/dashboard" element={<Navigate to={dashboardRoutes.workshops} replace />} />
        <Route path="/workshops" element={<WorkshopsPage />} />
        <Route path="/workshops/:workshopId" element={<WorkshopsPage />} />
        <Route path="/services/:serviceId" element={<WorkshopsPage />} />
        <Route path={dashboardRoutes.workshops} element={<WorkshopsPage />} />
        <Route path="/dashboard/workshops/:workshopId" element={<WorkshopsPage />} />
        <Route path="/dashboard/services/:serviceId" element={<WorkshopsPage />} />
        <Route path="/instances" element={<InstancesPage />} />
        <Route path="/instances/:instanceId" element={<InstancesPage />} />
        <Route path="/instances/:instanceId/:detailTab" element={<InstancesPage />} />
        <Route path={dashboardRoutes.instances} element={<InstancesPage />} />
        <Route path="/dashboard/instances/:instanceId" element={<InstancesPage />} />
        <Route path="/dashboard/instances/:instanceId/:detailTab" element={<InstancesPage />} />
        <Route path="/creator" element={<CreatorPage />} />
        <Route path="/creator/:packageId" element={<CreatorPage />} />
        <Route path={dashboardRoutes.creator} element={<CreatorPage />} />
        <Route path="/dashboard/creator/packages/:packageId" element={<CreatorPage />} />
        <Route path="/dashboard/creator/packages/:packageId/debug" element={<CreatorPage />} />
        <Route path="/dashboard/creator/governance/:section" element={<CreatorPage />} />
      </Route>
    </Routes>
  );
}
