import type {
  CreateProviderInput,
  CredentialSummary,
  ProviderAdapterMode,
  ProviderApiStyle,
  ProviderHealthcheckResult,
  ProviderModel,
  ProviderProfile,
  UpdateProviderInput,
  UpdateWorkspaceProviderBindingInput,
  WorkspaceProviderBinding,
} from "@lingban/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { dashboardCredentialsApi, dashboardProvidersApi } from "../../lib/api";
import { l, t } from "../../lib/i18n";
import {
  listDashboardWorkspaceViews,
  resolveDashboardWorkspaceView,
} from "../../lib/workspaceContext";
import { useDashboardAuthStore } from "../../stores/dashboardAuthStore";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

const inputStyle = {
  width: "100%",
  minHeight: "40px",
  borderRadius: "12px",
  border: "1px solid var(--line)",
  background: "var(--surface-elevated)",
  color: "var(--text)",
  padding: "10px 12px",
  font: "inherit",
} as const;

const sectionStyle = {
  border: "1px solid var(--line)",
  borderRadius: "18px",
  background: "var(--surface)",
  boxShadow: "var(--shadow-card)",
  padding: "20px",
} as const;

const actionButtonStyle = {
  border: "1px solid var(--line)",
  borderRadius: "10px",
  background: "var(--surface)",
  color: "var(--text)",
  padding: "8px 10px",
  cursor: "pointer",
  font: "inherit",
} as const;

type ProviderDraft = {
  displayName: string;
  description: string;
  enabled: boolean;
  adapterMode: ProviderAdapterMode;
  apiStyle: ProviderApiStyle;
  baseUrl: string;
  authEnvName: string;
  baseUrlEnvName: string;
  modelEnvName: string;
  defaultModel: string;
  modelsText: string;
  allowCustomModel: boolean;
  extraAllowedBaseUrlsText: string;
  healthcheckPath: string;
};

type BindingDraft = {
  providerId: string;
  credentialId: string;
  enabled: boolean;
  isDefault: boolean;
  priority: string;
  allowUserOverride: boolean;
  notes: string;
};

function emptyProviderDraft(): ProviderDraft {
  return {
    displayName: "",
    description: "",
    enabled: true,
    adapterMode: "openai-compatible",
    apiStyle: "openai-compatible",
    baseUrl: "",
    authEnvName: "OPENAI_API_KEY",
    baseUrlEnvName: "OPENAI_BASE_URL",
    modelEnvName: "OPENAI_MODEL",
    defaultModel: "",
    modelsText: "",
    allowCustomModel: false,
    extraAllowedBaseUrlsText: "",
    healthcheckPath: "/models",
  };
}

function emptyBindingDraft(): BindingDraft {
  return {
    providerId: "",
    credentialId: "",
    enabled: true,
    isDefault: true,
    priority: "100",
    allowUserOverride: true,
    notes: "",
  };
}

function parseLines(lines: string) {
  return [...new Set(lines.split(/\r?\n/g).map((item) => item.trim()).filter(Boolean))];
}

function buildModels(lines: string, defaultModel: string): ProviderModel[] {
  const normalizedDefaultModel = defaultModel.trim();
  const models = parseLines(lines);
  if (normalizedDefaultModel && !models.includes(normalizedDefaultModel)) {
    models.unshift(normalizedDefaultModel);
  }

  return models.map((model) => ({
    model,
    label: null,
    enabled: true,
    isDefault: model === normalizedDefaultModel,
    capabilities: {
      stream: true,
      toolCalling: true,
      responsesApi: true,
      longSession: true,
    },
  }));
}

function buildUrls(lines: string) {
  return parseLines(lines);
}

function modelsToText(models: ProviderModel[]) {
  return models.map((item) => item.model).join("\n");
}

function urlsToText(urls: string[]) {
  return urls.join("\n");
}

function workspaceRoleCanManageBindings(role: string | undefined) {
  return role === "owner" || role === "admin";
}

function providerStatusTone(provider: ProviderProfile) {
  return provider.enabled ? "var(--accent-emerald-soft)" : "var(--surface-elevated)";
}

function bindingStatusTone(binding: WorkspaceProviderBinding) {
  return binding.enabled ? "var(--accent-blue-soft)" : "var(--surface-elevated)";
}

function providerHealthStatusTone(result: ProviderHealthcheckResult | null | undefined) {
  switch (result?.healthcheck.status) {
    case "healthy":
      return "var(--accent-emerald-soft)";
    case "auth_required":
      return "var(--accent-blue-soft)";
    case "degraded":
      return "var(--accent-amber-soft)";
    case "unreachable":
      return "var(--accent-rose-soft)";
    default:
      return "var(--surface-elevated)";
  }
}

function providerHealthStatusLabel(
  lang: "zh" | "en",
  result: ProviderHealthcheckResult | null | undefined
) {
  if (!result) {
    return t(lang, l("未检查", "Unchecked"));
  }

  switch (result.healthcheck.status) {
    case "healthy":
      return t(lang, l("健康", "Healthy"));
    case "auth_required":
      return t(lang, l("需鉴权", "Auth required"));
    case "degraded":
      return t(lang, l("异常响应", "Unexpected response"));
    case "unreachable":
      return t(lang, l("不可达", "Unreachable"));
    default:
      return result.healthcheck.status;
  }
}

function providerHealthFromProfile(provider: ProviderProfile): ProviderHealthcheckResult | null {
  if (!provider.lastHealthcheck) {
    return null;
  }

  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    healthcheck: provider.lastHealthcheck,
  };
}

function providerDraftFromProfile(provider: ProviderProfile): ProviderDraft {
  return {
    displayName: provider.displayName,
    description: provider.description ?? "",
    enabled: provider.enabled,
    adapterMode: provider.adapterMode,
    apiStyle: provider.apiStyle,
    baseUrl: provider.baseUrl,
    authEnvName: provider.authEnvName,
    baseUrlEnvName: provider.baseUrlEnvName,
    modelEnvName: provider.modelEnvName,
    defaultModel: provider.defaultModel,
    modelsText: modelsToText(provider.models),
    allowCustomModel: provider.allowCustomModel,
    extraAllowedBaseUrlsText: urlsToText(provider.extraAllowedBaseUrls),
    healthcheckPath: provider.healthcheckPath ?? "/models",
  };
}

function bindingDraftFromRecord(binding: WorkspaceProviderBinding): BindingDraft {
  return {
    providerId: binding.providerId,
    credentialId: binding.credentialId,
    enabled: binding.enabled,
    isDefault: binding.isDefault,
    priority: String(binding.priority),
    allowUserOverride: binding.allowUserOverride,
    notes: binding.notes ?? "",
  };
}

function bindingSummary(
  binding: WorkspaceProviderBinding,
  providerLookup: Map<string, ProviderProfile>,
  credentialLookup: Map<string, CredentialSummary>,
  lang: "zh" | "en"
) {
  const provider = providerLookup.get(binding.providerId);
  const credential = credentialLookup.get(binding.credentialId);
  return {
    providerLabel: provider ? provider.displayName : binding.providerId,
    credentialLabel: credential ? credential.displayName : binding.credentialId,
    note: binding.isDefault
      ? t(lang, l("默认运行链路", "Default runtime route"))
      : t(lang, l("候选可选路由", "Alternate selectable route")),
  };
}

function buildProviderUpdateInput(draft: ProviderDraft): UpdateProviderInput {
  return {
    displayName: draft.displayName.trim(),
    description: draft.description.trim() || null,
    enabled: draft.enabled,
    adapterMode: draft.adapterMode,
    apiStyle: draft.apiStyle,
    baseUrl: draft.baseUrl.trim(),
    authEnvName: draft.authEnvName.trim(),
    baseUrlEnvName: draft.baseUrlEnvName.trim(),
    modelEnvName: draft.modelEnvName.trim(),
    defaultModel: draft.defaultModel.trim(),
    models: buildModels(draft.modelsText, draft.defaultModel),
    allowCustomModel: draft.allowCustomModel,
    extraAllowedBaseUrls: buildUrls(draft.extraAllowedBaseUrlsText),
    healthcheckPath: draft.healthcheckPath.trim() || null,
  };
}

function buildProviderCreateInput(draft: ProviderDraft): CreateProviderInput {
  return {
    displayName: draft.displayName.trim(),
    description: draft.description.trim() || null,
    enabled: draft.enabled,
    adapterMode: draft.adapterMode,
    apiStyle: draft.apiStyle,
    baseUrl: draft.baseUrl.trim(),
    authEnvName: draft.authEnvName.trim(),
    baseUrlEnvName: draft.baseUrlEnvName.trim(),
    modelEnvName: draft.modelEnvName.trim(),
    defaultModel: draft.defaultModel.trim(),
    models: buildModels(draft.modelsText, draft.defaultModel),
    allowCustomModel: draft.allowCustomModel,
    extraAllowedBaseUrls: buildUrls(draft.extraAllowedBaseUrlsText),
    healthcheckPath: draft.healthcheckPath.trim() || null,
  };
}

function buildBindingUpdateInput(draft: BindingDraft): UpdateWorkspaceProviderBindingInput {
  return {
    credentialId: draft.credentialId,
    enabled: draft.enabled,
    isDefault: draft.isDefault,
    priority: Number(draft.priority.trim() || "100"),
    allowUserOverride: draft.allowUserOverride,
    notes: draft.notes.trim() || null,
  };
}

export function ProvidersPage() {
  const queryClient = useQueryClient();
  const lang = useDashboardUiStore((state) => state.lang);
  const currentWorkspaceId = useDashboardUiStore((state) => state.currentWorkspaceId);
  const authMode = useDashboardAuthStore((state) => state.authMode);
  const authenticated = useDashboardAuthStore((state) => state.authenticated);
  const authCurrentWorkspace = useDashboardAuthStore((state) => state.currentWorkspace);
  const authWorkspaces = useDashboardAuthStore((state) => state.workspaces);
  const platformAccess = useDashboardAuthStore((state) => state.platformAccess);

  const currentWorkspace = useMemo(
    () =>
      resolveDashboardWorkspaceView({
        selectionId: currentWorkspaceId,
        workspaces: authMode === "required" ? authWorkspaces : undefined,
        fallbackWorkspace: authCurrentWorkspace,
      }),
    [authCurrentWorkspace, authMode, authWorkspaces, currentWorkspaceId]
  );
  const workspaceOptions = useMemo(
    () => listDashboardWorkspaceViews(authMode === "required" ? authWorkspaces : undefined),
    [authMode, authWorkspaces]
  );
  const authReady = authMode === "disabled" || authenticated;
  const canManagePlatformProviders = Boolean(platformAccess?.isPlatformAdmin);
  const canManageWorkspaceBindings = workspaceRoleCanManageBindings(
    currentWorkspace.role ?? undefined
  );

  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingBindingId, setEditingBindingId] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(() => emptyProviderDraft());
  const [bindingDraft, setBindingDraft] = useState<BindingDraft>(() => emptyBindingDraft());
  const [providerHealthById, setProviderHealthById] = useState<
    Record<string, ProviderHealthcheckResult>
  >({});
  const [providerHealthRefreshingIds, setProviderHealthRefreshingIds] = useState<string[]>([]);

  const providersQuery = useQuery({
    queryKey: ["dashboard", "providers"],
    queryFn: async () => dashboardProvidersApi.listProviders(),
    enabled: authReady,
  });
  const bindingsQuery = useQuery({
    queryKey: ["dashboard", "provider-bindings", currentWorkspace.id],
    queryFn: async () => dashboardProvidersApi.listBindings(),
    enabled: authReady,
  });
  const credentialsQuery = useQuery({
    queryKey: ["dashboard", "provider-credentials", currentWorkspace.id],
    queryFn: async () => dashboardCredentialsApi.listCredentials({ scope: "workspace" }),
    enabled: authReady,
  });

  const providerLookup = useMemo(
    () => new Map((providersQuery.data ?? []).map((item) => [item.providerId, item])),
    [providersQuery.data]
  );
  const credentialLookup = useMemo(
    () => new Map((credentialsQuery.data ?? []).map((item) => [item.credentialId, item])),
    [credentialsQuery.data]
  );

  useEffect(() => {
    if (!providersQuery.data) {
      return;
    }

    const nextHealth = providersQuery.data.reduce<Record<string, ProviderHealthcheckResult>>(
      (acc, provider) => {
        const mapped = providerHealthFromProfile(provider);
        if (mapped) {
          acc[provider.providerId] = mapped;
        }
        return acc;
      },
      {}
    );

    setProviderHealthById(nextHealth);
  }, [providersQuery.data]);

  useEffect(() => {
    if (editingBindingId) {
      return;
    }

    if (!bindingDraft.providerId && providersQuery.data?.[0]?.providerId) {
      setBindingDraft((current) => ({
        ...current,
        providerId: providersQuery.data?.[0]?.providerId ?? current.providerId,
      }));
    }
  }, [bindingDraft.providerId, editingBindingId, providersQuery.data]);

  useEffect(() => {
    if (editingBindingId) {
      return;
    }

    if (!bindingDraft.credentialId && credentialsQuery.data?.[0]?.credentialId) {
      setBindingDraft((current) => ({
        ...current,
        credentialId: credentialsQuery.data?.[0]?.credentialId ?? current.credentialId,
      }));
    }
  }, [bindingDraft.credentialId, credentialsQuery.data, editingBindingId]);

  const createProviderMutation = useMutation({
    mutationFn: async () =>
      dashboardProvidersApi.createProvider(buildProviderCreateInput(providerDraft)),
    onSuccess: async (provider) => {
      setEditingProviderId(provider.providerId);
      setProviderDraft(providerDraftFromProfile(provider));
      setBindingDraft((current) => ({
        ...current,
        providerId: provider.providerId,
      }));
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "providers"] });
    },
  });

  const updateProviderMutation = useMutation({
    mutationFn: async (input: { providerId: string; body: UpdateProviderInput }) =>
      dashboardProvidersApi.updateProvider(input.providerId, input.body),
    onSuccess: async (provider) => {
      if (editingProviderId === provider.providerId) {
        setProviderDraft(providerDraftFromProfile(provider));
      }
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "providers"] });
    },
  });

  const createBindingMutation = useMutation({
    mutationFn: async () =>
      dashboardProvidersApi.createBinding({
        providerId: bindingDraft.providerId,
        credentialId: bindingDraft.credentialId,
        enabled: bindingDraft.enabled,
        isDefault: bindingDraft.isDefault,
        priority: Number(bindingDraft.priority.trim() || "100"),
        allowUserOverride: bindingDraft.allowUserOverride,
        notes: bindingDraft.notes.trim() || null,
      }),
    onSuccess: async (binding) => {
      setEditingBindingId(binding.bindingId);
      setBindingDraft(bindingDraftFromRecord(binding));
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "provider-bindings", currentWorkspace.id],
      });
    },
  });

  const updateBindingMutation = useMutation({
    mutationFn: async (input: { bindingId: string; body: UpdateWorkspaceProviderBindingInput }) =>
      dashboardProvidersApi.updateBinding(input.bindingId, input.body),
    onSuccess: async (binding) => {
      if (editingBindingId === binding.bindingId) {
        setBindingDraft(bindingDraftFromRecord(binding));
      }
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "provider-bindings", currentWorkspace.id],
      });
    },
  });

  const activeProviders = (providersQuery.data ?? []).filter((item) => item.enabled).length;
  const activeBindings = (bindingsQuery.data ?? []).filter((item) => item.enabled).length;
  const defaultBindings = (bindingsQuery.data ?? []).filter((item) => item.isDefault).length;
  const providerHealthRefreshing = providerHealthRefreshingIds.length > 0;
  const hasProviderDraft =
    providerDraft.displayName.trim().length > 0 &&
    providerDraft.baseUrl.trim().length > 0 &&
    providerDraft.defaultModel.trim().length > 0;
  const hasBindingDraft = Boolean(bindingDraft.providerId && bindingDraft.credentialId);
  const providerBusy = createProviderMutation.isPending || updateProviderMutation.isPending;
  const bindingBusy = createBindingMutation.isPending || updateBindingMutation.isPending;

  async function refreshProviderHealth(providerIds: string[]) {
    if (!canManagePlatformProviders || providerIds.length === 0) {
      return;
    }

    setProviderHealthRefreshingIds((current) => Array.from(new Set([...current, ...providerIds])));
    const settled = await Promise.allSettled(
      providerIds.map((providerId) => dashboardProvidersApi.checkProviderHealth(providerId))
    );

    setProviderHealthById((current) => {
      const next = { ...current };
      for (const result of settled) {
        if (result.status === "fulfilled") {
          next[result.value.providerId] = result.value;
        }
      }
      return next;
    });
    setProviderHealthRefreshingIds((current) =>
      current.filter((providerId) => !providerIds.includes(providerId))
    );
    await queryClient.invalidateQueries({ queryKey: ["dashboard", "providers"] });
  }

  function resetProviderEditor() {
    setEditingProviderId(null);
    setProviderDraft(emptyProviderDraft());
  }

  function resetBindingEditor() {
    setEditingBindingId(null);
    setBindingDraft((current) => ({
      ...emptyBindingDraft(),
      providerId: current.providerId || providersQuery.data?.[0]?.providerId || "",
      credentialId: credentialsQuery.data?.[0]?.credentialId || "",
    }));
  }

  function handleProviderSubmit() {
    if (!editingProviderId) {
      createProviderMutation.mutate();
      return;
    }

    updateProviderMutation.mutate({
      providerId: editingProviderId,
      body: buildProviderUpdateInput(providerDraft),
    });
  }

  function handleBindingSubmit() {
    if (!editingBindingId) {
      createBindingMutation.mutate();
      return;
    }

    updateBindingMutation.mutate({
      bindingId: editingBindingId,
      body: buildBindingUpdateInput(bindingDraft),
    });
  }

  return (
    <div
      style={{
        padding: "24px clamp(16px, 2vw, 28px) 32px",
        display: "grid",
        gap: "20px",
      }}
    >
      <section style={sectionStyle}>
        <div
          style={{
            display: "grid",
            gap: "16px",
            gridTemplateColumns: "minmax(0, 1.7fr) minmax(260px, 0.9fr)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "12px",
                textTransform: "uppercase",
                color: "var(--muted)",
                marginBottom: "8px",
              }}
            >
              {t(lang, l("模型 Provider 控制面", "Model provider control plane"))}
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, marginBottom: "10px" }}>
              {t(lang, l("多 Provider 总后台配置", "Multi-provider admin settings"))}
            </div>
            <div style={{ color: "var(--muted)", lineHeight: 1.7, maxWidth: "72ch" }}>
              {t(
                lang,
                l(
                  "这里管理平台级 Provider 档案、工作区绑定关系、默认模型与运行时凭证挂载。新开的 Codex 实例会在启动时解析这些配置，并把结果固化进 run 快照。",
                  "This page separates the platform provider catalog from workspace bindings. The catalog defines reusable upstream templates, while each workspace binding attaches its own credential and default route. New Codex runs resolve the final provider, model, and credential path at launch time and persist that decision into the run snapshot."
                )
              )}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gap: "12px",
              alignContent: "start",
            }}
          >
            <div className="mini-card">
              <div className="eyebrow">{t(lang, l("当前工作区", "Current workspace"))}</div>
              <div style={{ fontWeight: 700 }}>{t(lang, currentWorkspace.name)}</div>
              <div className="muted">
                {currentWorkspace.id} / {currentWorkspace.role ?? "viewer"}
              </div>
            </div>
            <div className="mini-card">
              <div className="eyebrow">{t(lang, l("配置范围", "Scope"))}</div>
              <div style={{ fontWeight: 700 }}>
                {t(lang, l("平台档案 + 工作区绑定", "Platform profiles + workspace bindings"))}
              </div>
              <div className="muted">
                {workspaceOptions.length > 1
                  ? t(
                      lang,
                      l(
                        "切换左侧工作区后，这里的绑定列表会跟随后端鉴权上下文切换。",
                        "Switching workspace from the shell updates the backend auth context and reloads the binding list."
                      )
                    )
                  : t(
                      lang,
                      l("当前会话只暴露一个工作区视图。", "The current session exposes one workspace view.")
                    )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gap: "16px",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        }}
      >
        {[
          {
            label: t(lang, l("Provider 总数", "Providers")),
            value: String(providersQuery.data?.length ?? 0).padStart(2, "0"),
            note: t(lang, l("平台登记的 Provider 档案。", "Provider profiles registered on the platform.")),
          },
          {
            label: t(lang, l("启用中的 Provider", "Active providers")),
            value: String(activeProviders).padStart(2, "0"),
            note: t(lang, l("允许被工作区绑定的上游。", "Providers eligible for workspace binding.")),
          },
          {
            label: t(lang, l("当前工作区启用绑定", "Active bindings")),
            value: String(activeBindings).padStart(2, "0"),
            note: t(lang, l("当前工作区可用于新 run 的链路。", "Runtime routes available to this workspace.")),
          },
          {
            label: t(lang, l("默认绑定", "Default bindings")),
            value: String(defaultBindings).padStart(2, "0"),
            note: t(
              lang,
              l("未显式选 Provider 时的主路由。", "Primary route when a run does not explicitly select a provider.")
            ),
          },
        ].map((item) => (
          <div key={item.label} style={sectionStyle}>
            <div className="eyebrow">{item.label}</div>
            <div style={{ fontSize: "28px", fontWeight: 700, margin: "8px 0 6px" }}>{item.value}</div>
            <div className="muted">{item.note}</div>
          </div>
        ))}
      </section>

      <section
        style={{
          display: "grid",
          gap: "18px",
          gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1.25fr) minmax(340px, 1fr)",
          alignItems: "start",
        }}
      >
        <div style={sectionStyle}>
          <div className="card-row" style={{ justifyContent: "space-between", marginBottom: "14px" }}>
            <div>
              <div className="eyebrow">{t(lang, l("Provider Registry", "Provider Registry"))}</div>
              <div style={{ fontSize: "18px", fontWeight: 700 }}>
                {t(lang, l("平台 Provider 档案", "Platform provider profiles"))}
              </div>
            </div>
            <div className="card-row" style={{ gap: "8px" }}>
              <div className="path-chip">{providersQuery.data?.length ?? 0}</div>
              <button
                type="button"
                style={actionButtonStyle}
                disabled={!canManagePlatformProviders || providerHealthRefreshing || !providersQuery.data?.length}
                onClick={() =>
                  void refreshProviderHealth((providersQuery.data ?? []).map((provider) => provider.providerId))
                }
              >
                {providerHealthRefreshing
                  ? t(lang, l("检查中", "Checking"))
                  : t(lang, l("检查全部", "Check all"))}
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gap: "12px" }}>
            {(providersQuery.data ?? []).map((provider) => {
              const selected = editingProviderId === provider.providerId;
              const healthResult = providerHealthById[provider.providerId];
              const providerIsRefreshing = providerHealthRefreshingIds.includes(provider.providerId);
              return (
                <div
                  key={provider.providerId}
                  style={{
                    border: selected ? "1px solid var(--accent-blue)" : "1px solid var(--line)",
                    borderRadius: "14px",
                    background: selected ? "var(--surface)" : "var(--surface-elevated)",
                    padding: "14px",
                  }}
                >
                  <div className="card-row" style={{ justifyContent: "space-between", marginBottom: "8px" }}>
                    <div style={{ fontWeight: 700 }}>{provider.displayName}</div>
                    <span className="path-chip" style={{ background: providerStatusTone(provider) }}>
                      {provider.enabled ? t(lang, l("启用", "Enabled")) : t(lang, l("停用", "Disabled"))}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: "12px", marginBottom: "6px" }}>
                    {provider.providerId}
                  </div>
                  <div className="muted" style={{ marginBottom: "10px", wordBreak: "break-all" }}>
                    {provider.baseUrl}
                  </div>
                  <div className="pill-row" style={{ marginBottom: "10px" }}>
                    <span className="path-chip">{provider.defaultModel}</span>
                    <span className="path-chip">{provider.adapterMode}</span>
                    <span className="path-chip">{provider.authEnvName}</span>
                  </div>
                  <div className="card-row" style={{ gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
                    <span
                      className="path-chip"
                      style={{ background: providerHealthStatusTone(healthResult) }}
                    >
                      {healthResult
                        ? providerHealthStatusLabel(lang, healthResult)
                        : providerIsRefreshing
                          ? t(lang, l("检查中..", "Checking..."))
                          : providerHealthStatusLabel(lang, healthResult)}
                    </span>
                    {healthResult?.healthcheck.httpStatus != null ? (
                      <span className="path-chip">
                        {healthResult.healthcheck.httpStatus} / {healthResult.healthcheck.responseTimeMs ?? 0}ms
                      </span>
                    ) : null}
                  </div>
                  {healthResult?.healthcheck.checkedAt ? (
                    <div className="muted" style={{ marginBottom: "6px" }}>
                      {new Date(healthResult.healthcheck.checkedAt).toLocaleString(
                        lang === "zh" ? "zh-CN" : "en-US",
                        {
                          hour12: false,
                        }
                      )}
                    </div>
                  ) : null}
                  {healthResult?.healthcheck.errorMessage ? (
                    <div className="muted" style={{ marginBottom: "10px", lineHeight: 1.6 }}>
                      {healthResult.healthcheck.errorMessage}
                    </div>
                  ) : null}
                  <div className="card-row" style={{ gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={actionButtonStyle}
                      disabled={!canManagePlatformProviders}
                      onClick={() => {
                        setEditingProviderId(provider.providerId);
                        setProviderDraft(providerDraftFromProfile(provider));
                        setBindingDraft((current) => ({ ...current, providerId: provider.providerId }));
                      }}
                    >
                      {t(lang, l("编辑", "Edit"))}
                    </button>
                    <button
                      type="button"
                      style={actionButtonStyle}
                      disabled={!canManagePlatformProviders || providerIsRefreshing}
                      onClick={() => void refreshProviderHealth([provider.providerId])}
                    >
                      {providerIsRefreshing
                        ? t(lang, l("检查中", "Checking"))
                        : t(lang, l("检查健康", "Check health"))}
                    </button>
                    <button
                      type="button"
                      style={actionButtonStyle}
                      disabled={updateProviderMutation.isPending || !canManagePlatformProviders}
                      onClick={() =>
                        updateProviderMutation.mutate({
                          providerId: provider.providerId,
                          body: { enabled: !provider.enabled },
                        })
                      }
                    >
                      {provider.enabled
                        ? t(lang, l("停用", "Disable"))
                        : t(lang, l("启用", "Enable"))}
                    </button>
                  </div>
                </div>
              );
            })}
            {providersQuery.data?.length === 0 ? (
              <div className="muted">
                {t(lang, l("当前还没有 Provider 档案。", "No provider profile exists yet."))}
              </div>
            ) : null}
          </div>
        </div>

        <div style={sectionStyle}>
          <div className="card-row" style={{ justifyContent: "space-between", marginBottom: "14px" }}>
            <div>
              <div className="eyebrow">{t(lang, l("Workspace Bindings", "Workspace Bindings"))}</div>
              <div style={{ fontSize: "18px", fontWeight: 700 }}>
                {t(lang, l("当前工作区绑定", "Current workspace bindings"))}
              </div>
            </div>
            <div className="path-chip">{bindingsQuery.data?.length ?? 0}</div>
          </div>
          <div style={{ display: "grid", gap: "12px" }}>
            {(bindingsQuery.data ?? []).map((binding) => {
              const summary = bindingSummary(binding, providerLookup, credentialLookup, lang);
              const selected = editingBindingId === binding.bindingId;
              return (
                <div
                  key={binding.bindingId}
                  style={{
                    border: selected ? "1px solid var(--accent-blue)" : "1px solid var(--line)",
                    borderRadius: "14px",
                    background: selected ? "var(--surface)" : "var(--surface-elevated)",
                    padding: "14px",
                  }}
                >
                  <div className="card-row" style={{ justifyContent: "space-between", marginBottom: "8px" }}>
                    <div style={{ fontWeight: 700 }}>{summary.providerLabel}</div>
                    <span className="path-chip" style={{ background: bindingStatusTone(binding) }}>
                      {binding.enabled ? t(lang, l("生效中", "Active")) : t(lang, l("已停用", "Disabled"))}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: "12px", marginBottom: "6px" }}>
                    {binding.bindingId}
                  </div>
                  <div className="muted" style={{ marginBottom: "6px" }}>
                    {summary.credentialLabel}
                  </div>
                  <div className="pill-row" style={{ marginBottom: "10px" }}>
                    <span className="path-chip">
                      {binding.isDefault
                        ? t(lang, l("默认链路", "Default route"))
                        : t(lang, l("候选可选路由", "Alternate route"))}
                    </span>
                    <span className="path-chip">
                      {t(lang, l(`优先级 ${binding.priority}`, `Priority ${binding.priority}`))}
                    </span>
                    <span className="path-chip">
                      {binding.allowUserOverride
                        ? t(lang, l("可改模型", "Model override on"))
                        : t(lang, l("锁定模型", "Model override off"))}
                    </span>
                  </div>
                  <div className="muted" style={{ marginBottom: "10px" }}>
                    {summary.note}
                  </div>
                  <div className="card-row" style={{ gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={actionButtonStyle}
                      disabled={!canManageWorkspaceBindings}
                      onClick={() => {
                        setEditingBindingId(binding.bindingId);
                        setBindingDraft(bindingDraftFromRecord(binding));
                      }}
                    >
                      {t(lang, l("编辑", "Edit"))}
                    </button>
                    <button
                      type="button"
                      style={actionButtonStyle}
                      disabled={updateBindingMutation.isPending || !canManageWorkspaceBindings}
                      onClick={() =>
                        updateBindingMutation.mutate({
                          bindingId: binding.bindingId,
                          body: { enabled: !binding.enabled },
                        })
                      }
                    >
                      {binding.enabled
                        ? t(lang, l("停用", "Disable"))
                        : t(lang, l("启用", "Enable"))}
                    </button>
                  </div>
                </div>
              );
            })}
            {bindingsQuery.data?.length === 0 ? (
              <div className="muted">
                {t(lang, l("当前工作区还没有 Provider 绑定。", "This workspace does not have provider bindings yet."))}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "grid", gap: "16px" }}>
          <section style={sectionStyle}>
            <div className="card-row" style={{ justifyContent: "space-between", marginBottom: "12px" }}>
              <div>
                <div className="eyebrow">{t(lang, l("Provider Editor", "Provider Editor"))}</div>
                <div style={{ fontSize: "18px", fontWeight: 700 }}>
                  {editingProviderId
                    ? t(lang, l("编辑 Provider 档案", "Edit provider profile"))
                    : t(lang, l("新建 Provider 档案", "Create provider profile"))}
                </div>
              </div>
              {editingProviderId ? <span className="path-chip">{editingProviderId}</span> : null}
            </div>
            <div style={{ display: "grid", gap: "10px" }}>
              <input
                disabled={!canManagePlatformProviders}
                placeholder={t(lang, l("显示名称", "Display name"))}
                style={inputStyle}
                value={providerDraft.displayName}
                onChange={(event) =>
                  setProviderDraft((current) => ({ ...current, displayName: event.target.value }))
                }
              />
              <textarea
                disabled={!canManagePlatformProviders}
                placeholder={t(lang, l("说明描述", "Description"))}
                style={{ ...inputStyle, minHeight: "72px", resize: "vertical" }}
                value={providerDraft.description}
                onChange={(event) =>
                  setProviderDraft((current) => ({ ...current, description: event.target.value }))
                }
              />
              <input
                disabled={!canManagePlatformProviders}
                placeholder="https://provider.example.com/v1"
                style={inputStyle}
                value={providerDraft.baseUrl}
                onChange={(event) =>
                  setProviderDraft((current) => ({ ...current, baseUrl: event.target.value }))
                }
              />
              <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <select
                  disabled={!canManagePlatformProviders}
                  style={inputStyle}
                  value={providerDraft.adapterMode}
                  onChange={(event) =>
                    setProviderDraft((current) => ({
                      ...current,
                      adapterMode: event.target.value as ProviderAdapterMode,
                    }))
                  }
                >
                  <option value="openai-compatible">openai-compatible</option>
                  <option value="gateway">gateway</option>
                </select>
                <select
                  disabled={!canManagePlatformProviders}
                  style={inputStyle}
                  value={providerDraft.apiStyle}
                  onChange={(event) =>
                    setProviderDraft((current) => ({
                      ...current,
                      apiStyle: event.target.value as ProviderApiStyle,
                    }))
                  }
                >
                  <option value="openai-compatible">openai-compatible</option>
                  <option value="gateway">gateway</option>
                </select>
              </div>
              <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <input
                  disabled={!canManagePlatformProviders}
                  placeholder={t(lang, l("默认模型", "Default model"))}
                  style={inputStyle}
                  value={providerDraft.defaultModel}
                  onChange={(event) =>
                    setProviderDraft((current) => ({ ...current, defaultModel: event.target.value }))
                  }
                />
                <input
                  disabled={!canManagePlatformProviders}
                  placeholder={t(lang, l("健康检查路径", "Healthcheck path"))}
                  style={inputStyle}
                  value={providerDraft.healthcheckPath}
                  onChange={(event) =>
                    setProviderDraft((current) => ({ ...current, healthcheckPath: event.target.value }))
                  }
                />
              </div>
              <textarea
                disabled={!canManagePlatformProviders}
                placeholder={t(lang, l("每行一个模型名", "One model per line"))}
                style={{ ...inputStyle, minHeight: "96px", resize: "vertical" }}
                value={providerDraft.modelsText}
                onChange={(event) =>
                  setProviderDraft((current) => ({ ...current, modelsText: event.target.value }))
                }
              />
              <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                <input
                  disabled={!canManagePlatformProviders}
                  placeholder="OPENAI_API_KEY"
                  style={inputStyle}
                  value={providerDraft.authEnvName}
                  onChange={(event) =>
                    setProviderDraft((current) => ({ ...current, authEnvName: event.target.value }))
                  }
                />
                <input
                  disabled={!canManagePlatformProviders}
                  placeholder="OPENAI_BASE_URL"
                  style={inputStyle}
                  value={providerDraft.baseUrlEnvName}
                  onChange={(event) =>
                    setProviderDraft((current) => ({
                      ...current,
                      baseUrlEnvName: event.target.value,
                    }))
                  }
                />
                <input
                  disabled={!canManagePlatformProviders}
                  placeholder="OPENAI_MODEL"
                  style={inputStyle}
                  value={providerDraft.modelEnvName}
                  onChange={(event) =>
                    setProviderDraft((current) => ({ ...current, modelEnvName: event.target.value }))
                  }
                />
              </div>
              <textarea
                disabled={!canManagePlatformProviders}
                placeholder={t(lang, l("额外放行的 Base URL，每行一条", "Extra allowed base URLs, one per line"))}
                style={{ ...inputStyle, minHeight: "72px", resize: "vertical" }}
                value={providerDraft.extraAllowedBaseUrlsText}
                onChange={(event) =>
                  setProviderDraft((current) => ({
                    ...current,
                    extraAllowedBaseUrlsText: event.target.value,
                  }))
                }
              />
              <label className="card-row" style={{ gap: "8px" }}>
                <input
                  type="checkbox"
                  disabled={!canManagePlatformProviders}
                  checked={providerDraft.enabled}
                  onChange={(event) =>
                    setProviderDraft((current) => ({ ...current, enabled: event.target.checked }))
                  }
                />
                <span>{t(lang, l("Provider 启用", "Provider enabled"))}</span>
              </label>
              <label className="card-row" style={{ gap: "8px" }}>
                <input
                  type="checkbox"
                  disabled={!canManagePlatformProviders}
                  checked={providerDraft.allowCustomModel}
                  onChange={(event) =>
                    setProviderDraft((current) => ({
                      ...current,
                      allowCustomModel: event.target.checked,
                    }))
                  }
                />
                <span>{t(lang, l("允许自定义模型", "Allow custom model"))}</span>
              </label>
              <div className="card-row" style={{ gap: "10px", flexWrap: "wrap" }}>
                <button
                  className="route-btn active"
                  type="button"
                  disabled={!canManagePlatformProviders || providerBusy || !hasProviderDraft}
                  onClick={handleProviderSubmit}
                >
                  {providerBusy
                    ? t(lang, l("保存中...", "Saving..."))
                    : editingProviderId
                      ? t(lang, l("更新 Provider", "Update provider"))
                      : t(lang, l("创建 Provider", "Create provider"))}
                </button>
                <button
                  type="button"
                  style={actionButtonStyle}
                  onClick={resetProviderEditor}
                >
                  {t(lang, l("清空编辑器", "Reset editor"))}
                </button>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <div className="card-row" style={{ justifyContent: "space-between", marginBottom: "12px" }}>
              <div>
                <div className="eyebrow">{t(lang, l("Binding Editor", "Binding Editor"))}</div>
                <div style={{ fontSize: "18px", fontWeight: 700 }}>
                  {editingBindingId
                    ? t(lang, l("编辑工作区绑定", "Edit workspace binding"))
                    : t(lang, l("新建工作区绑定", "Create workspace binding"))}
                </div>
              </div>
              {editingBindingId ? <span className="path-chip">{editingBindingId}</span> : null}
            </div>
            <div style={{ display: "grid", gap: "10px" }}>
              <select
                disabled={!canManageWorkspaceBindings}
                style={inputStyle}
                value={bindingDraft.providerId}
                onChange={(event) =>
                  setBindingDraft((current) => ({ ...current, providerId: event.target.value }))
                }
              >
                <option value="">{t(lang, l("选择 Provider", "Select provider"))}</option>
                {(providersQuery.data ?? []).map((provider) => (
                  <option key={provider.providerId} value={provider.providerId}>
                    {provider.displayName}
                  </option>
                ))}
              </select>
              <select
                disabled={!canManageWorkspaceBindings}
                style={inputStyle}
                value={bindingDraft.credentialId}
                onChange={(event) =>
                  setBindingDraft((current) => ({ ...current, credentialId: event.target.value }))
                }
              >
                <option value="">{t(lang, l("选择工作区凭证", "Select workspace credential"))}</option>
                {(credentialsQuery.data ?? []).map((credential) => (
                  <option key={credential.credentialId} value={credential.credentialId}>
                    {credential.displayName}
                  </option>
                ))}
              </select>
              {credentialsQuery.data?.length === 0 ? (
                <div className="muted">
                  {t(
                    lang,
                    l(
                      "当前工作区还没有可用于 Provider 注入的 env 凭证。请先在凭证管理中创建 workspace 范围、mountMode=env 的凭证。",
                      "No workspace env credential is available for provider injection. Create a workspace-scoped credential with mountMode=env first."
                    )
                  )}
                </div>
              ) : null}
              <label className="card-row" style={{ gap: "8px" }}>
                <input
                  type="checkbox"
                  disabled={!canManageWorkspaceBindings}
                  checked={bindingDraft.enabled}
                  onChange={(event) =>
                    setBindingDraft((current) => ({ ...current, enabled: event.target.checked }))
                  }
                />
                <span>{t(lang, l("绑定启用", "Binding enabled"))}</span>
              </label>
              <label className="card-row" style={{ gap: "8px" }}>
                <input
                  type="checkbox"
                  disabled={!canManageWorkspaceBindings}
                  checked={bindingDraft.isDefault}
                  onChange={(event) =>
                    setBindingDraft((current) => ({ ...current, isDefault: event.target.checked }))
                  }
                />
                <span>{t(lang, l("设为默认 Provider", "Set as default provider"))}</span>
              </label>
              <div>
                <div className="eyebrow" style={{ marginBottom: "6px" }}>
                  {t(lang, l("优先级", "Priority"))}
                </div>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  disabled={!canManageWorkspaceBindings}
                  style={inputStyle}
                  value={bindingDraft.priority}
                  onChange={(event) =>
                    setBindingDraft((current) => ({ ...current, priority: event.target.value }))
                  }
                />
              </div>
              <label className="card-row" style={{ gap: "8px" }}>
                <input
                  type="checkbox"
                  disabled={!canManageWorkspaceBindings}
                  checked={bindingDraft.allowUserOverride}
                  onChange={(event) =>
                    setBindingDraft((current) => ({
                      ...current,
                      allowUserOverride: event.target.checked,
                    }))
                  }
                />
                <span>{t(lang, l("允许运行时覆盖模型", "Allow run-time model override"))}</span>
              </label>
              <textarea
                disabled={!canManageWorkspaceBindings}
                placeholder={t(lang, l("绑定说明", "Binding notes"))}
                style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }}
                value={bindingDraft.notes}
                onChange={(event) =>
                  setBindingDraft((current) => ({ ...current, notes: event.target.value }))
                }
              />
              <div className="card-row" style={{ gap: "10px", flexWrap: "wrap" }}>
                <button
                  className="route-btn active"
                  type="button"
                  disabled={!canManageWorkspaceBindings || bindingBusy || !hasBindingDraft}
                  onClick={handleBindingSubmit}
                >
                  {bindingBusy
                    ? t(lang, l("保存中...", "Saving..."))
                    : editingBindingId
                      ? t(lang, l("更新绑定", "Update binding"))
                      : t(lang, l("创建绑定", "Create binding"))}
                </button>
                <button type="button" style={actionButtonStyle} onClick={resetBindingEditor}>
                  {t(lang, l("清空编辑器", "Reset editor"))}
                </button>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
