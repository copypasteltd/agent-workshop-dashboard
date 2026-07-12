import { createUseRunStream } from "@lingban/realtime";
import { dashboardApiBaseUrl } from "./api";
import { useDashboardAuthStore } from "../stores/dashboardAuthStore";
export const useDashboardRunStream = createUseRunStream({
  baseUrl: dashboardApiBaseUrl,
  getAccessToken: () => useDashboardAuthStore.getState().tokens?.accessToken,
  detailQueryKey: (runId) => ["dashboard", "runs", runId],
  listQueryKey: ["dashboard", "runs"],
  filesQueryKey: (runId) => ["dashboard", "runs", runId, "files"],
});
