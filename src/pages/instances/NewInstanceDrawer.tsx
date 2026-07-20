import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  dashboardCredentialsApi,
  dashboardMcpApi,
  dashboardProvidersApi,
  dashboardSessionProjectsApi,
} from "../../lib/api";
import { t } from "../../lib/i18n";

function createOperationId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NewInstanceDrawer({
  open,
  lang,
  onClose,
  onCreated,
}: {
  open: boolean;
  lang: "zh" | "en";
  onClose: () => void;
  onCreated: (runId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
  const [selectedCredentialIds, setSelectedCredentialIds] = useState<string[]>([]);
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [autoApproval, setAutoApproval] = useState(false);
  const [sessionProjectId, setSessionProjectId] = useState<string | null>(null);
  const [operationId, setOperationId] = useState(() => createOperationId());

  const providersQuery = useQuery({
    enabled: open,
    queryKey: ["dashboard", "new-instance", "providers"],
    queryFn: async () => dashboardProvidersApi.listProviders({ enabled: true }),
  });
  const providerBindingsQuery = useQuery({
    enabled: open,
    queryKey: ["dashboard", "new-instance", "provider-bindings"],
    queryFn: async () => dashboardProvidersApi.listBindings({ enabled: true }),
  });
  const mcpsQuery = useQuery({
    enabled: open,
    queryKey: ["dashboard", "new-instance", "mcps"],
    queryFn: async () => dashboardMcpApi.listMcps({ status: "active" }),
  });
  const mcpBindingsQuery = useQuery({
    enabled: open,
    queryKey: ["dashboard", "new-instance", "mcp-bindings"],
    queryFn: async () => dashboardMcpApi.listBindings({ status: "active" }),
  });
  const credentialsQuery = useQuery({
    enabled: open,
    queryKey: ["dashboard", "new-instance", "credentials"],
    queryFn: async () => dashboardCredentialsApi.listCredentials({ status: "active" }),
  });

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setAdvancedOpen(false);
    setProviderId("");
    setModel("");
    setSelectedMcpIds([]);
    setSelectedCredentialIds([]);
    setDefaultsApplied(false);
    setAutoApproval(false);
    setSessionProjectId(null);
    setOperationId(createOperationId());
  }, [open]);

  useEffect(() => {
    if (!open || defaultsApplied || !mcpsQuery.data || !mcpBindingsQuery.data) return;
    const activeMcpIds = new Set(mcpsQuery.data.map((entry) => entry.mcpId));
    const autoBindings = mcpBindingsQuery.data.filter(
      (binding) => binding.autoAttach && activeMcpIds.has(binding.mcpId)
    );
    setSelectedMcpIds([...new Set(autoBindings.map((binding) => binding.mcpId))]);
    setSelectedCredentialIds([
      ...new Set(
        autoBindings
          .map((binding) => binding.credentialId)
          .filter((credentialId): credentialId is string => Boolean(credentialId))
      ),
    ]);
    setDefaultsApplied(true);
  }, [defaultsApplied, mcpBindingsQuery.data, mcpsQuery.data, open]);

  const availableProviders = [
    ...new Map(
      [...(providerBindingsQuery.data ?? [])]
        .sort((left, right) => {
          if (left.scope === right.scope) return left.priority - right.priority;
          return left.scope === "workspace" ? -1 : 1;
        })
        .map((binding) => [
          binding.providerId,
          {
            binding,
            provider: providersQuery.data?.find(
              (provider) => provider.providerId === binding.providerId
            ),
          },
        ])
    ).values(),
  ].filter((item) => Boolean(item.provider));
  const selectedProvider = providersQuery.data?.find((provider) => provider.providerId === providerId) ?? null;

  const createMutation = useMutation({
    mutationFn: async () => {
      let projectId = sessionProjectId;
      if (!projectId) {
        const project = await dashboardSessionProjectsApi.create({
          name: name.trim(),
          description: description.trim(),
        }, { idempotencyKey: `dashboard:${operationId}:project` });
        projectId = project.sessionProjectId;
        setSessionProjectId(projectId);
      }
      const selectedEntries = (mcpsQuery.data ?? []).filter((entry) =>
        selectedMcpIds.includes(entry.mcpId)
      );
      return dashboardSessionProjectsApi.createSourceRun({
        sessionProjectId: projectId,
        title: name.trim(),
        entrySurface: "dashboard",
        approvalMode: autoApproval ? "auto_all" : "manual",
        providerSelection: providerId
          ? { providerId, ...(model.trim() ? { model: model.trim() } : {}) }
          : null,
        bindings: {
          firstPartyMcpIds: selectedEntries
            .filter((entry) => entry.source === "first-party")
            .map((entry) => entry.mcpId),
          externalConnectorRefs: selectedEntries
            .filter((entry) => entry.source !== "first-party")
            .map((entry) => entry.ref),
          credentialIds: selectedCredentialIds,
        },
      }, { idempotencyKey: `dashboard:${operationId}:source-run` });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "creator", "session-projects"] }),
      ]);
      onCreated(result.run.runId);
    },
  });

  if (!open) return null;

  const capabilityConfigReady =
    providersQuery.isSuccess &&
    providerBindingsQuery.isSuccess &&
    mcpsQuery.isSuccess &&
    mcpBindingsQuery.isSuccess &&
    credentialsQuery.isSuccess;
  const capabilityConfigError =
    providersQuery.error ??
    providerBindingsQuery.error ??
    mcpsQuery.error ??
    mcpBindingsQuery.error ??
    credentialsQuery.error;
  const providerRouteReady = availableProviders.length > 0;
  const canSubmit =
    name.trim().length > 0 &&
    capabilityConfigReady &&
    providerRouteReady &&
    !createMutation.isPending;

  return (
    <div className="session-capture-layer" role="presentation">
      <button
        className="session-capture-backdrop"
        type="button"
        aria-label={t(lang, { zh: "关闭新建实例", en: "Close new instance" })}
        onClick={onClose}
      />
      <aside
        className="session-capture-drawer new-instance-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-instance-title"
      >
        <header className="session-capture-header">
          <div>
            <div className="eyebrow">CREATOR SOURCE RUN</div>
            <h2 className="detail-title" id="new-instance-title">
              {t(lang, { zh: "新建空白 Codex", en: "New blank Codex" })}
            </h2>
          </div>
          <button
            className="icon-btn"
            type="button"
            title={t(lang, { zh: "关闭", en: "Close" })}
            onClick={onClose}
          >
            <svg className="icon"><use href="#i-x" /></svg>
          </button>
        </header>

        <div className="session-capture-content new-instance-content">
          <div className="capture-source-band new-instance-source-band">
            <div>
              <span>{t(lang, { zh: "启动类型", en: "Launch type" })}</span>
              <strong>{t(lang, { zh: "空白录制实例", en: "Blank recording run" })}</strong>
            </div>
            <div>
              <span>Session Bootstrap</span>
              <strong className="mono">blank</strong>
            </div>
          </div>

          <div className="capture-form-stack">
            <label className="capture-field">
              <span>{t(lang, { zh: "实例名称", en: "Instance name" })}</span>
              <input
                autoFocus
                data-testid="dashboard-new-instance-name"
                value={name}
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                placeholder={t(lang, { zh: "例如：短剧生产流程录制", en: "Example: drama production recording" })}
              />
            </label>
            <label className="capture-field">
              <span>{t(lang, { zh: "项目说明（可选）", en: "Project description (optional)" })}</span>
              <textarea
                value={description}
                maxLength={4000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t(lang, { zh: "记录本次工作流目标", en: "Record the workflow objective" })}
              />
            </label>
          </div>

          <section className={`new-instance-advanced ${advancedOpen ? "open" : ""}`}>
            <button
              className="new-instance-advanced-trigger"
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((current) => !current)}
            >
              <span><svg className="icon"><use href="#i-sliders" /></svg>{t(lang, { zh: "运行能力", en: "Runtime capabilities" })}</span>
              <svg className="icon new-instance-chevron"><use href="#i-chevron-down" /></svg>
            </button>
            {advancedOpen ? <div className="new-instance-advanced-body">
              <label className="new-instance-approval-option">
                <input
                  type="checkbox"
                  checked={autoApproval}
                  onChange={(event) => setAutoApproval(event.target.checked)}
                />
                <span>
                  <strong>{t(lang, { zh: "全自动审批", en: "Automatic approval" })}</strong>
                  <small>{t(lang, { zh: "实例中的审批请求自动通过", en: "Automatically approve requests in this instance" })}</small>
                </span>
              </label>
              <label className="capture-field">
                <span>Provider</span>
                <select value={providerId} onChange={(event) => { setProviderId(event.target.value); setModel(""); }}>
                  <option value="">{t(lang, { zh: "当前有效默认路由", en: "Effective default route" })}</option>
                  {availableProviders.map(({ binding, provider }) => provider ? <option value={provider.providerId} key={binding.bindingId}>{provider.displayName}{binding.isDefault ? " / Default" : ""}{binding.scope === "platform" ? " / Platform" : " / Workspace"}</option> : null)}
                </select>
              </label>
              {selectedProvider ? <label className="capture-field">
                <span>{t(lang, { zh: "模型", en: "Model" })}</span>
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  <option value="">{selectedProvider.defaultModel} / Default</option>
                  {selectedProvider.models.filter((item) => item.enabled).map((item) => <option value={item.model} key={item.model}>{item.label ?? item.model}</option>)}
                </select>
              </label> : null}
              <fieldset className="new-instance-binding-group">
                <legend>MCP</legend>
                {(mcpsQuery.data ?? []).map((entry) => <label key={entry.mcpId}>
                  <input type="checkbox" checked={selectedMcpIds.includes(entry.mcpId)} onChange={(event) => setSelectedMcpIds((current) => event.target.checked ? [...new Set([...current, entry.mcpId])] : current.filter((id) => id !== entry.mcpId))} />
                  <span><strong>{entry.displayName}</strong><small>{entry.source} / {entry.transport} / {entry.riskLevel}</small></span>
                </label>)}
                {!mcpsQuery.isLoading && !mcpsQuery.data?.length ? <div className="section-note">{t(lang, { zh: "当前工作区没有可用 MCP。", en: "No MCP is available in this workspace." })}</div> : null}
              </fieldset>
              <fieldset className="new-instance-binding-group">
                <legend>{t(lang, { zh: "附加凭证引用", en: "Additional credential references" })}</legend>
                {(credentialsQuery.data ?? []).map((credential) => <label key={credential.credentialId}>
                  <input type="checkbox" checked={selectedCredentialIds.includes(credential.credentialId)} onChange={(event) => setSelectedCredentialIds((current) => event.target.checked ? [...new Set([...current, credential.credentialId])] : current.filter((id) => id !== credential.credentialId))} />
                  <span><strong>{credential.displayName}</strong><small>{credential.provider} / {credential.mountMode}</small></span>
                </label>)}
                {!credentialsQuery.isLoading && !credentialsQuery.data?.length ? <div className="section-note">{t(lang, { zh: "当前工作区没有可选凭证。", en: "No credential is available in this workspace." })}</div> : null}
              </fieldset>
              <div className="section-note">{t(lang, { zh: "仅保存 Provider、MCP 和 Credential 引用。Secret 明文由 Credential Broker 注入独立运行环境。", en: "Only Provider, MCP, and Credential references are stored. Secret values are injected into the isolated runtime by Credential Broker." })}</div>
            </div> : null}
          </section>

          <div className="new-instance-runtime-row">
            <svg className="icon"><use href="#i-terminal" /></svg>
            <div>
              <strong>{t(lang, { zh: "工作区默认运行配置", en: "Workspace runtime defaults" })}</strong>
              <span>{t(lang, { zh: "Provider、模型、自动挂载 MCP 与凭证策略", en: "Provider, model, auto-attached MCPs, and credential policy" })}</span>
            </div>
          </div>

          {createMutation.error ? (
            <div className="capture-alert warn" role="alert">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : t(lang, { zh: "实例创建失败。", en: "Instance creation failed." })}
            </div>
          ) : null}
          {sessionProjectId ? (
            <div className="capture-alert">
              {t(lang, { zh: "Session Project 已创建，重试将继续启动同一个 Source Run。", en: "The Session Project exists; retrying will resume the same Source Run." })}
              <span className="mono">{sessionProjectId}</span>
            </div>
          ) : null}
          {capabilityConfigError ? (
            <div className="capture-alert warn" role="alert">
              {t(lang, { zh: "运行能力配置加载失败，请刷新后重试。", en: "Runtime capability configuration failed to load. Refresh and retry." })}
            </div>
          ) : null}
          {capabilityConfigReady && !providerRouteReady ? (
            <div className="capture-alert warn" role="alert">
              <span>{t(lang, { zh: "当前工作区没有可用 Provider 路由，请先完成 Provider 凭证绑定。", en: "No Provider route is available. Configure a Provider credential binding first." })}</span>
              <a className="route-btn" href="/workspace/settings/providers">
                {t(lang, { zh: "前往 Provider 设置", en: "Open Provider settings" })}
              </a>
            </div>
          ) : null}
        </div>

        <footer className="session-capture-footer">
          <button className="route-btn" type="button" onClick={onClose}>
            {t(lang, { zh: "取消", en: "Cancel" })}
          </button>
          <button
            className="route-btn active"
            data-testid="dashboard-create-blank-instance"
            type="button"
            disabled={!canSubmit}
            onClick={() => createMutation.mutate()}
          >
            <svg className="icon"><use href="#i-terminal" /></svg>
            {createMutation.isPending
              ? t(lang, { zh: "正在启动", en: "Starting" })
              : !capabilityConfigReady
                ? t(lang, { zh: "正在加载能力", en: "Loading capabilities" })
                : !providerRouteReady
                  ? t(lang, { zh: "需要 Provider 路由", en: "Provider route required" })
                : t(lang, { zh: "启动空白 Codex", en: "Start blank Codex" })}
          </button>
        </footer>
      </aside>
    </div>
  );
}
