import {
  createAuthApiClient,
  createBillingApiClient,
  createCredentialsApiClient,
  createCreatorApiClient,
  createMeApiClient,
  createMcpGovernanceApiClient,
  createNotificationsApiClient,
  createQuotaApiClient,
  createRunsApiClient,
  createSearchApiClient,
  createSessionRefreshFetch,
  getRunFileDownloadUrl,
  createWorkshopCatalogApiClient,
} from "@lingban/api-sdk";
import { useDashboardAuthStore } from "../stores/dashboardAuthStore";

export const dashboardApiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "http://127.0.0.1:3100";

function getDashboardAccessToken() {
  return useDashboardAuthStore.getState().tokens?.accessToken;
}

function getDashboardRefreshToken() {
  return useDashboardAuthStore.getState().tokens?.refreshToken;
}

export const dashboardAuthFetch = createSessionRefreshFetch({
  baseUrl: dashboardApiBaseUrl,
  getAccessToken: getDashboardAccessToken,
  getRefreshToken: getDashboardRefreshToken,
  applySessionResponse(response) {
    useDashboardAuthStore.getState().applySessionResponse(response);
  },
  onAuthFailure(error) {
    useDashboardAuthStore
      .getState()
      .clearAuth(error instanceof Error ? error.message : "Dashboard auth expired.");
  },
});

export const dashboardAuthApi = createAuthApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export const dashboardRunsApi = createRunsApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export const dashboardCatalogApi = createWorkshopCatalogApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export const dashboardSearchApi = createSearchApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export const dashboardCreatorApi = createCreatorApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export const dashboardBillingApi = createBillingApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export const dashboardMeApi = createMeApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export const dashboardNotificationsApi = createNotificationsApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export const dashboardCredentialsApi = createCredentialsApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export const dashboardMcpApi = createMcpGovernanceApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export const dashboardQuotaApi = createQuotaApiClient({
  baseUrl: dashboardApiBaseUrl,
  fetcher: dashboardAuthFetch,
  getAccessToken: getDashboardAccessToken,
});

export function requestDashboardRunFileDownloadUrl(runId: string, filePath: string) {
  return getRunFileDownloadUrl(dashboardRunsApi, dashboardApiBaseUrl, runId, filePath);
}
