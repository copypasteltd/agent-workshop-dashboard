import {
  createAuthApiClient,
  createBatchRunsApiClient,
  createBillingApiClient,
  createCredentialsApiClient,
  createCreatorApiClient,
  createMeApiClient,
  createMcpGovernanceApiClient,
  createNotificationsApiClient,
  createQuotaApiClient,
  createRunsApiClient,
  createSearchApiClient,
  createSessionsApiClient,
  createSessionRefreshFetch,
  getRunFileDownloadUrl,
  createWorkshopCatalogApiClient,
} from "@lingban/api-sdk";
import {
  createProviderInputSchema,
  createWorkspaceProviderBindingInputSchema,
  listProvidersQuerySchema,
  listWorkspaceProviderBindingsQuerySchema,
  providerIdParamsSchema,
  providerProfileSchema,
  updateProviderInputSchema,
  updateWorkspaceProviderBindingInputSchema,
  workspaceProviderBindingIdParamsSchema,
  workspaceProviderBindingSchema,
  type CreateProviderInput,
  type CreateWorkspaceProviderBindingInput,
  type ListProvidersQuery,
  type ListWorkspaceProviderBindingsQuery,
  type ProviderHealthcheckResult,
  type ProviderProfile,
  type UpdateProviderInput,
  type UpdateWorkspaceProviderBindingInput,
  type WorkspaceProviderBinding,
  providerHealthcheckResultSchema,
} from "@lingban/contracts";
import { useDashboardAuthStore } from "../stores/dashboardAuthStore";

type DashboardRuntimeWindow = Window & {
  __LINGBAN_RUNTIME_CONFIG__?: {
    apiBaseUrl?: string;
  };
};

function normalizeApiBaseUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

function resolveDashboardApiBaseUrl() {
  if (typeof window !== "undefined") {
    const runtimeBaseUrl = normalizeApiBaseUrl(
      (window as DashboardRuntimeWindow).__LINGBAN_RUNTIME_CONFIG__?.apiBaseUrl
    );
    if (runtimeBaseUrl) {
      return runtimeBaseUrl;
    }
  }

  const configuredBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL as string | undefined);
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname, port, host } = window.location;
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

    if (isLocalHost) {
      return `${protocol}//${hostname}:3100`;
    }

    if (port === "38110" || port === "38120") {
      return `${protocol}//${hostname}:38130`;
    }

    return `${protocol}//${host}`;
  }

  return "http://127.0.0.1:3100";
}

export const dashboardApiBaseUrl = resolveDashboardApiBaseUrl();

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

export const dashboardBatchRunsApi = createBatchRunsApiClient({
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

export const dashboardSessionsApi = createSessionsApiClient({
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

async function requestDashboardJson(input: {
  path: string;
  method?: string;
  body?: unknown;
}) {
  const response = await dashboardAuthFetch(new URL(input.path, dashboardApiBaseUrl), {
    method: input.method ?? "GET",
    headers: input.body ? { "content-type": "application/json" } : undefined,
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return text ? JSON.parse(text) : null;
}

function buildQueryString(query?: Record<string, string | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) {
      continue;
    }
    search.set(key, String(value));
  }

  const raw = search.toString();
  return raw.length > 0 ? `?${raw}` : "";
}

export const dashboardProvidersApi = {
  async listProviders(query?: ListProvidersQuery) {
    const parsed = listProvidersQuerySchema.parse(query ?? {});
    const result = await requestDashboardJson({
      path: `/v1/providers${buildQueryString({
        enabled: parsed.enabled,
      })}`,
    });
    return providerProfileSchema.array().parse(result) as ProviderProfile[];
  },
  async createProvider(input: CreateProviderInput) {
    const parsed = createProviderInputSchema.parse(input);
    const result = await requestDashboardJson({
      path: "/v1/providers",
      method: "POST",
      body: parsed,
    });
    return providerProfileSchema.parse(result) as ProviderProfile;
  },
  async updateProvider(providerId: string, input: UpdateProviderInput) {
    const params = providerIdParamsSchema.parse({ providerId });
    const parsed = updateProviderInputSchema.parse(input);
    const result = await requestDashboardJson({
      path: `/v1/providers/${params.providerId}`,
      method: "PATCH",
      body: parsed,
    });
    return providerProfileSchema.parse(result) as ProviderProfile;
  },
  async checkProviderHealth(providerId: string) {
    const params = providerIdParamsSchema.parse({ providerId });
    const result = await requestDashboardJson({
      path: `/v1/providers/${params.providerId}/healthcheck`,
      method: "POST",
    });
    return providerHealthcheckResultSchema.parse(result) as ProviderHealthcheckResult;
  },
  async listBindings(query?: ListWorkspaceProviderBindingsQuery) {
    const parsed = listWorkspaceProviderBindingsQuerySchema.parse(query ?? {});
    const result = await requestDashboardJson({
      path: `/v1/provider-bindings${buildQueryString({
        providerId: parsed.providerId,
        enabled: parsed.enabled,
      })}`,
    });
    return workspaceProviderBindingSchema.array().parse(result) as WorkspaceProviderBinding[];
  },
  async createBinding(input: CreateWorkspaceProviderBindingInput) {
    const parsed = createWorkspaceProviderBindingInputSchema.parse(input);
    const result = await requestDashboardJson({
      path: "/v1/provider-bindings",
      method: "POST",
      body: parsed,
    });
    return workspaceProviderBindingSchema.parse(result) as WorkspaceProviderBinding;
  },
  async updateBinding(bindingId: string, input: UpdateWorkspaceProviderBindingInput) {
    const params = workspaceProviderBindingIdParamsSchema.parse({ bindingId });
    const parsed = updateWorkspaceProviderBindingInputSchema.parse(input);
    const result = await requestDashboardJson({
      path: `/v1/provider-bindings/${params.bindingId}`,
      method: "PATCH",
      body: parsed,
    });
    return workspaceProviderBindingSchema.parse(result) as WorkspaceProviderBinding;
  },
};

export function requestDashboardRunFileDownloadUrl(runId: string, filePath: string) {
  return getRunFileDownloadUrl(dashboardRunsApi, dashboardApiBaseUrl, runId, filePath);
}
