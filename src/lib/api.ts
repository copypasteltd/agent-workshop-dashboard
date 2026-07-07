import { createRunsApiClient } from "@lingban/api-sdk";

export const dashboardApiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "http://127.0.0.1:3100";

export const dashboardRunsApi = createRunsApiClient({
  baseUrl: dashboardApiBaseUrl,
});

export function buildDashboardRunFileDownloadUrl(runId: string, filePath: string) {
  return `${dashboardApiBaseUrl}/v1/runs/${runId}/files/download?path=${encodeURIComponent(filePath)}`;
}
