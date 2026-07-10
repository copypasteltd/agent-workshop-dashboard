import type {
  CreatorReleaseActivationState,
  CreatorReleaseGateChecklistItem,
  CreatorReleaseGateChecklistStatus,
  CreatorReleaseGateStatus,
  CreatorReleaseGateType,
  CreatorReleaseState,
  CreatorReplayState,
  LocalizedText,
} from "@lingban/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { dashboardCreatorApi } from "../../lib/api";
import { l, t } from "../../lib/i18n";
import { useDashboardAuthStore } from "../../stores/dashboardAuthStore";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

type ReleasePanelProps = {
  packageId: string;
  packageStatusClass: string;
  availableWorkspaceContextKeys: string[];
  defaultWorkspaceContextKey: string;
};

type ReplayPanelProps = {
  packageId: string;
};

type GateDecisionStatus = "passed" | "failed" | "waived";
type GateDecisionDraft = {
  noteZh: string;
  noteEn: string;
  evidenceRef: string;
  recommendedZh: string;
  recommendedEn: string;
  checklist: CreatorReleaseGateChecklistItem[];
};

function releaseStateLabel(state: CreatorReleaseState) {
  switch (state) {
    case "private":
      return l("私有", "Private");
    case "staged":
      return l("灰度", "Staged");
    case "production":
    default:
      return l("正式", "Production");
  }
}

function releaseTone(state: CreatorReleaseState) {
  switch (state) {
    case "private":
      return "success";
    case "staged":
      return "warn";
    case "production":
    default:
      return "active";
  }
}

function replayStateLabel(state: CreatorReplayState) {
  switch (state) {
    case "ready":
      return l("就绪", "Ready");
    case "running":
      return l("运行中", "Running");
    case "failed":
    default:
      return l("失败", "Failed");
  }
}

function replayTone(state: CreatorReplayState) {
  switch (state) {
    case "ready":
      return "success";
    case "running":
      return "active";
    case "failed":
    default:
      return "warn";
  }
}

function gateTypeLabel(type: CreatorReleaseGateType) {
  switch (type) {
    case "desensitization":
      return l("脱敏门", "Desensitization gate");
    case "replay":
      return l("回放门", "Replay gate");
    case "credential":
      return l("凭证门", "Credential gate");
    case "manual_approval":
    default:
      return l("人工审核门", "Manual approval gate");
  }
}

function gateStatusLabel(status: CreatorReleaseGateStatus) {
  switch (status) {
    case "passed":
      return l("已通过", "Passed");
    case "failed":
      return l("已失败", "Failed");
    case "waived":
      return l("已豁免", "Waived");
    case "running":
      return l("执行中", "Running");
    case "pending":
    default:
      return l("待处理", "Pending");
  }
}

function gateTone(status: CreatorReleaseGateStatus) {
  switch (status) {
    case "passed":
      return "success";
    case "failed":
      return "warn";
    case "waived":
      return "active";
    case "running":
      return "active";
    case "pending":
    default:
      return "warn";
  }
}

function activationStateLabel(state: CreatorReleaseActivationState) {
  switch (state) {
    case "rolled_back":
      return l("已回滚", "Rolled back");
    case "failed":
      return l("失败", "Failed");
    case "active":
    default:
      return l("激活中", "Active");
  }
}

function activationTone(state: CreatorReleaseActivationState) {
  switch (state) {
    case "rolled_back":
      return "warn";
    case "failed":
      return "warn";
    case "active":
    default:
      return "success";
  }
}

function formatIsoLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 16).replace("T", " ");
}

function splitLocalizedLines(primary: string, secondary: string) {
  const primaryLines = primary
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const secondaryLines = secondary
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  return primaryLines.map((zh, index) => ({
    zh,
    en: secondaryLines[index] || zh,
  }));
}

function joinLocalizedLines(items: LocalizedText[]) {
  return {
    zh: items.map((item) => item.zh).join("\n"),
    en: items.map((item) => item.en).join("\n"),
  };
}

function createGateDecisionDraft(input: {
  resultSummary: LocalizedText;
  evidenceRef: string | null;
  recommendedActions: LocalizedText[];
  checklist: CreatorReleaseGateChecklistItem[];
}): GateDecisionDraft {
  const recommended = joinLocalizedLines(input.recommendedActions);

  return {
    noteZh: input.resultSummary.zh,
    noteEn: input.resultSummary.en,
    evidenceRef: input.evidenceRef ?? "",
    recommendedZh: recommended.zh,
    recommendedEn: recommended.en,
    checklist: input.checklist,
  };
}

function queryErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function authNote(authReady: boolean, lang: "zh" | "en") {
  if (authReady) {
    return null;
  }

  return (
    <div className="composer-error">
      {t(lang, {
        zh: "当前未进入可写登录态，只展示真实读取结果；创建和状态变更按钮会被锁定。",
        en: "The current session is not authenticated for write actions. Real read results remain visible while create and state-change actions stay locked.",
      })}
    </div>
  );
}

type ReleaseOpsProps = {
  packageId: string;
  releaseId: string;
  authReady: boolean;
};

function ReleaseOps({ packageId, releaseId, authReady }: ReleaseOpsProps) {
  const lang = useDashboardUiStore((state) => state.lang);
  const queryClient = useQueryClient();
  const [gateDrafts, setGateDrafts] = useState<Record<string, GateDecisionDraft>>({});

  const gatesQuery = useQuery({
    queryKey: ["dashboard", "creator", "release-gates", releaseId],
    queryFn: async () => dashboardCreatorApi.listReleaseGates(releaseId),
    enabled: Boolean(releaseId),
    retry: false,
    staleTime: 30_000,
  });

  const activationsQuery = useQuery({
    queryKey: ["dashboard", "creator", "release-activations", releaseId],
    queryFn: async () => dashboardCreatorApi.listReleaseActivations(releaseId),
    enabled: Boolean(releaseId),
    retry: false,
    staleTime: 30_000,
  });

  const decideGateMutation = useMutation({
    mutationFn: async (input: {
      gateId: string;
      status: GateDecisionStatus;
      note: LocalizedText | null;
      evidenceRef: string | null;
      checklist: CreatorReleaseGateChecklistItem[];
      recommendedActions: LocalizedText[];
    }) =>
      dashboardCreatorApi.decideReleaseGate(releaseId, input.gateId, {
        status: input.status,
        note: input.note,
        evidenceRef: input.evidenceRef,
        checklist: input.checklist,
        recommendedActions: input.recommendedActions,
      }),
    onSuccess: async (gate) => {
      setGateDrafts((current) => ({
        ...current,
        [gate.gateId]: createGateDecisionDraft(gate),
      }));
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "release-gates", releaseId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "package", packageId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "packages"],
          exact: false,
        }),
      ]);
    },
  });

  const activateReleaseMutation = useMutation({
    mutationFn: async () => dashboardCreatorApi.activateRelease(releaseId, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "release-activations", releaseId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "release-gates", releaseId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "releases", packageId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "package", packageId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "packages"],
          exact: false,
        }),
      ]);
    },
  });

  const gateRows = useMemo(() => gatesQuery.data ?? [], [gatesQuery.data]);
  const activationRows = useMemo(() => activationsQuery.data ?? [], [activationsQuery.data]);
  const canActivate =
    gateRows.length > 0 &&
    gateRows.every((item) => item.status === "passed" || item.status === "waived");

  return (
    <div className="detail-item" style={{ marginTop: 12 }}>
      <div className="card-row">
        <div className="file-name">{t(lang, { zh: "正式 Gate 与激活", en: "Formal gates and activation" })}</div>
        <span className="path-chip">{releaseId}</span>
      </div>
      {gatesQuery.error ? <div className="composer-error">{queryErrorMessage(gatesQuery.error)}</div> : null}
      {activationsQuery.error ? <div className="composer-error">{queryErrorMessage(activationsQuery.error)}</div> : null}
      {gateRows.map((gate) => {
        const gateDraft = gateDrafts[gate.gateId] ?? createGateDecisionDraft(gate);

        return (
          <div className="detail-item" key={gate.gateId}>
            <div className="card-row">
              <div>
                <div className="file-name">{t(lang, gateTypeLabel(gate.gateType))}</div>
                <div className="meta">
                  {gate.gateId} / {gate.requiredRole} / {formatIsoLabel(gate.updatedAt)}
                </div>
              </div>
              <span className={`pill ${gateTone(gate.status)}`}>{t(lang, gateStatusLabel(gate.status))}</span>
            </div>
            <div className="meta">{t(lang, gate.resultSummary)}</div>
            {gate.evidenceRef ? (
              <div className="meta">
                {t(lang, { zh: "证据引用", en: "Evidence ref" })}: {gate.evidenceRef}
              </div>
            ) : null}
            {gate.checklist.length > 0 ? (
              <div className="detail-item">
                <div className="file-name">
                  {t(lang, { zh: "正式复核清单", en: "Formal review checklist" })}
                </div>
                {gateDraft.checklist.map((item) => (
                  <div className="detail-item" key={`${gate.gateId}-${item.itemId}`}>
                    <div className="card-row">
                      <div className="meta">{t(lang, item.label)}</div>
                      <span className={`pill ${gateTone(item.status as CreatorReleaseGateStatus)}`}>
                        {t(lang, gateStatusLabel(item.status as CreatorReleaseGateStatus))}
                      </span>
                    </div>
                    {item.note ? <div className="meta">{t(lang, item.note)}</div> : null}
                    <div className="pill-row">
                      {(["pending", "passed", "failed", "waived"] as CreatorReleaseGateChecklistStatus[]).map((status) => (
                        <button
                          className={`path-chip ${item.status === status ? "active" : ""}`}
                          key={status}
                          type="button"
                          disabled={!authReady || decideGateMutation.isPending}
                          onClick={() =>
                            setGateDrafts((current) => ({
                              ...current,
                              [gate.gateId]: {
                                ...(current[gate.gateId] ?? createGateDecisionDraft(gate)),
                                checklist: (current[gate.gateId] ?? createGateDecisionDraft(gate)).checklist.map(
                                  (entry) =>
                                    entry.itemId === item.itemId
                                      ? {
                                          ...entry,
                                          status,
                                        }
                                      : entry
                                ),
                              },
                            }))
                          }
                        >
                          {t(lang, gateStatusLabel(status as CreatorReleaseGateStatus))}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {gate.recommendedActions.length > 0 ? (
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "建议动作", en: "Recommended actions" })}</div>
                {gate.recommendedActions.map((item, index) => (
                  <div className="meta" key={`${gate.gateId}-action-${index}`}>
                    {t(lang, item)}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="governance-form-grid">
              <label className="fake-input governance-field">
                <span className="tiny-note">
                  {t(lang, { zh: "审核摘要（中文）", en: "Review summary (ZH)" })}
                </span>
                <input
                  className="search-inline-input"
                  type="text"
                  value={gateDraft.noteZh}
                  onChange={(event) =>
                    setGateDrafts((current) => ({
                      ...current,
                      [gate.gateId]: {
                        ...(current[gate.gateId] ?? createGateDecisionDraft(gate)),
                        noteZh: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label className="fake-input governance-field">
                <span className="tiny-note">
                  {t(lang, { zh: "审核摘要（英文）", en: "Review summary (EN)" })}
                </span>
                <input
                  className="search-inline-input"
                  type="text"
                  value={gateDraft.noteEn}
                  onChange={(event) =>
                    setGateDrafts((current) => ({
                      ...current,
                      [gate.gateId]: {
                        ...(current[gate.gateId] ?? createGateDecisionDraft(gate)),
                        noteEn: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label className="fake-input governance-field">
                <span className="tiny-note">{t(lang, { zh: "证据引用", en: "Evidence ref" })}</span>
                <input
                  className="search-inline-input"
                  type="text"
                  value={gateDraft.evidenceRef}
                  onChange={(event) =>
                    setGateDrafts((current) => ({
                      ...current,
                      [gate.gateId]: {
                        ...(current[gate.gateId] ?? createGateDecisionDraft(gate)),
                        evidenceRef: event.target.value,
                      },
                    }))
                  }
                  placeholder={t(lang, {
                    zh: "例如 evidence://replay/trace-001",
                    en: "For example: evidence://replay/trace-001",
                  })}
                />
              </label>
            </div>
            <label className="fake-input governance-field">
              <span className="tiny-note">
                {t(lang, { zh: "建议动作（中文，每行一项）", en: "Recommended actions (ZH, one item per line)" })}
              </span>
              <textarea
                className="composer-input governance-textarea"
                value={gateDraft.recommendedZh}
                onChange={(event) =>
                  setGateDrafts((current) => ({
                    ...current,
                    [gate.gateId]: {
                      ...(current[gate.gateId] ?? createGateDecisionDraft(gate)),
                      recommendedZh: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <label className="fake-input governance-field">
              <span className="tiny-note">
                {t(lang, { zh: "建议动作（英文，每行一项）", en: "Recommended actions (EN, one item per line)" })}
              </span>
              <textarea
                className="composer-input governance-textarea"
                value={gateDraft.recommendedEn}
                onChange={(event) =>
                  setGateDrafts((current) => ({
                    ...current,
                    [gate.gateId]: {
                      ...(current[gate.gateId] ?? createGateDecisionDraft(gate)),
                      recommendedEn: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <div className="pill-row">
              {(["passed", "failed", "waived"] as GateDecisionStatus[]).map((status) => (
                <button
                  className={`path-chip ${gate.status === status ? "active" : ""}`}
                  key={status}
                  type="button"
                  disabled={!authReady || decideGateMutation.isPending}
                  onClick={() =>
                    void decideGateMutation.mutateAsync({
                      gateId: gate.gateId,
                      status,
                      note: gateDraft.noteZh.trim()
                        ? {
                            zh: gateDraft.noteZh.trim(),
                            en: gateDraft.noteEn.trim() || gateDraft.noteZh.trim(),
                          }
                        : null,
                      evidenceRef: gateDraft.evidenceRef.trim() || null,
                      checklist: gateDraft.checklist,
                      recommendedActions: splitLocalizedLines(
                        gateDraft.recommendedZh,
                        gateDraft.recommendedEn
                      ),
                    })
                  }
                >
                  {t(lang, gateStatusLabel(status))}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {activationRows.length > 0 ? (
        <div className="detail-item">
          <div className="file-name">{t(lang, { zh: "激活台账", en: "Activation ledger" })}</div>
          {activationRows.map((activation) => (
            <div className="card-row" key={activation.activationId}>
              <div className="meta">
                {activation.activationId} / {activation.targetWorkspaceContextKey} / {formatIsoLabel(activation.updatedAt)}
              </div>
              <span className={`pill ${activationTone(activation.state)}`}>
                {t(lang, activationStateLabel(activation.state))}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {decideGateMutation.error ? (
        <div className="composer-error">{queryErrorMessage(decideGateMutation.error)}</div>
      ) : null}
      {activateReleaseMutation.error ? (
        <div className="composer-error">{queryErrorMessage(activateReleaseMutation.error)}</div>
      ) : null}
      <div className="governance-form-actions">
        <button
          className="route-btn active"
          type="button"
          disabled={!authReady || !canActivate || activateReleaseMutation.isPending}
          onClick={() => void activateReleaseMutation.mutateAsync()}
        >
          {activateReleaseMutation.isPending
            ? t(lang, { zh: "激活中...", en: "Activating..." })
            : t(lang, { zh: "激活发布", en: "Activate release" })}
        </button>
        {!canActivate ? (
          <div className="tiny-note">
            {t(lang, {
              zh: "只有所有 Gate 通过或豁免后才能激活。",
              en: "Activation is available only after every gate is passed or waived.",
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CreatorReleasePanel({
  packageId,
  packageStatusClass,
  availableWorkspaceContextKeys,
  defaultWorkspaceContextKey,
}: ReleasePanelProps) {
  const lang = useDashboardUiStore((state) => state.lang);
  const authMode = useDashboardAuthStore((state) => state.authMode);
  const authenticated = useDashboardAuthStore((state) => state.authenticated);
  const authReady = authMode === "required" && authenticated;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    targetWorkspaceContextKey:
      availableWorkspaceContextKeys[0] ?? defaultWorkspaceContextKey,
    state: "private" as CreatorReleaseState,
    channelZh: "",
    channelEn: "",
    gateSummaryZh: "",
    gateSummaryEn: "",
  });

  const releasesQuery = useQuery({
    queryKey: ["dashboard", "creator", "releases", packageId],
    queryFn: async () => dashboardCreatorApi.listPackageReleases(packageId),
    enabled: Boolean(packageId),
    retry: false,
    staleTime: 30_000,
  });

  const createReleaseMutation = useMutation({
    mutationFn: async () =>
      dashboardCreatorApi.createPackageRelease(packageId, {
        targetWorkspaceContextKey: draft.targetWorkspaceContextKey,
        state: draft.state,
        channelLabel: {
          zh: draft.channelZh.trim(),
          en: draft.channelEn.trim() || draft.channelZh.trim(),
        },
        gateSummary: splitLocalizedLines(draft.gateSummaryZh, draft.gateSummaryEn),
      }),
    onSuccess: async () => {
      setDraft((current) => ({
        ...current,
        channelZh: "",
        channelEn: "",
        gateSummaryZh: "",
        gateSummaryEn: "",
      }));
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "releases", packageId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "package", packageId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "packages"],
          exact: false,
        }),
      ]);
    },
  });

  const updateReleaseMutation = useMutation({
    mutationFn: async (input: { releaseId: string; state: CreatorReleaseState }) =>
      dashboardCreatorApi.updatePackageRelease(packageId, input.releaseId, {
        state: input.state,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "releases", packageId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "package", packageId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "packages"],
          exact: false,
        }),
      ]);
    },
  });

  const releaseRows = useMemo(() => releasesQuery.data ?? [], [releasesQuery.data]);
  const releaseSummaryText = useMemo(() => {
    if (releaseRows.length === 0) {
      return t(lang, {
        zh: "当前 package 还没有正式 release 记录。先创建一条 release 通道，再进入 Gate 决策和 activation。",
        en: "This package does not have a formal release record yet. Create a release channel first, then continue into gate decisions and activation.",
      });
    }

    const productionCount = releaseRows.filter((item) => item.state === "production").length;
    const stagedCount = releaseRows.filter((item) => item.state === "staged").length;
    const privateCount = releaseRows.filter((item) => item.state === "private").length;

    return t(lang, {
      zh: `当前共有 ${releaseRows.length} 条正式 release 记录，其中 production ${productionCount} 条、staged ${stagedCount} 条、private ${privateCount} 条。`,
      en: `There are ${releaseRows.length} formal release records: ${productionCount} production, ${stagedCount} staged, and ${privateCount} private.`,
    });
  }, [lang, releaseRows]);

  return (
    <div className="detail-body">
      <div className="section-head">
        <div>
          <div className="eyebrow">{t(lang, { zh: "发布与审计", en: "Release & Audit" })}</div>
          <div className="tab-title">{t(lang, { zh: "真实发布通道与 Gate 列表", en: "Real release channels and gate ledger" })}</div>
        </div>
        <span className={`pill ${packageStatusClass}`}>{releaseRows.length}</span>
      </div>
      <div className="section-note">{releaseSummaryText}</div>

      {authNote(authReady, lang)}
      {releasesQuery.error ? <div className="composer-error">{queryErrorMessage(releasesQuery.error)}</div> : null}

      <div className="governance-stack">
        <article className="detail-item governance-card">
          <div className="card-row">
            <div className="file-name">{t(lang, { zh: "发布通道列表", en: "Release channel ledger" })}</div>
            <span className="path-chip active">{packageId}</span>
          </div>
          {releaseRows.length === 0 ? (
            <div className="panel-empty">
              {t(lang, {
                zh: "当前 package 还没有正式写入的发布通道。",
                en: "No formal release channels have been written for this package yet.",
              })}
            </div>
          ) : (
            releaseRows.map((release) => (
              <div className="detail-item" key={release.releaseId}>
                <div className="card-row">
                  <div>
                    <div className="file-name">{t(lang, release.channelLabel)}</div>
                    <div className="meta">
                      {release.releaseId} / {release.targetWorkspaceContextKey} / {formatIsoLabel(release.updatedAt)}
                    </div>
                  </div>
                  <span className={`pill ${releaseTone(release.state)}`}>{t(lang, releaseStateLabel(release.state))}</span>
                </div>
                <div className="pill-row">
                  {(["private", "staged", "production"] as CreatorReleaseState[]).map((state) => (
                    <button
                      className={`path-chip ${release.state === state ? "active" : ""}`}
                      key={state}
                      type="button"
                      disabled={!authReady || updateReleaseMutation.isPending}
                      onClick={() => void updateReleaseMutation.mutateAsync({ releaseId: release.releaseId, state })}
                    >
                      {t(lang, releaseStateLabel(state))}
                    </button>
                  ))}
                </div>
                {release.gateSummary.map((item, index) => (
                  <div className="meta" key={`${release.releaseId}-${index}`}>
                    {t(lang, item)}
                  </div>
                ))}
                <ReleaseOps
                  packageId={packageId}
                  releaseId={release.releaseId}
                  authReady={authReady}
                />
              </div>
            ))
          )}
        </article>

        <article className="detail-item governance-card">
          <div className="file-name">{t(lang, { zh: "新增发布通道", en: "Create release channel" })}</div>
          <div className="meta">
            {t(lang, {
              zh: "这会落一条真实 release 对象，并同步刷新 package 的发布状态与通道摘要。",
              en: "This writes a real release record and refreshes the package release state plus channel summary.",
            })}
          </div>
          <div className="governance-form-grid">
            <label className="fake-input governance-field">
              <span className="tiny-note">{t(lang, { zh: "目标工作区上下文", en: "Target workspace context" })}</span>
              <select
                className="governance-select"
                value={draft.targetWorkspaceContextKey}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    targetWorkspaceContextKey: event.target.value,
                  }))
                }
              >
                {(availableWorkspaceContextKeys.length > 0
                  ? availableWorkspaceContextKeys
                  : [defaultWorkspaceContextKey]
                ).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="fake-input governance-field">
              <span className="tiny-note">{t(lang, { zh: "发布状态", en: "Release state" })}</span>
              <select
                className="governance-select"
                value={draft.state}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    state: event.target.value as CreatorReleaseState,
                  }))
                }
              >
                {(["private", "staged", "production"] as CreatorReleaseState[]).map((item) => (
                  <option key={item} value={item}>
                    {t(lang, releaseStateLabel(item))}
                  </option>
                ))}
              </select>
            </label>
            <label className="fake-input governance-field">
              <span className="tiny-note">{t(lang, { zh: "通道名称（中文）", en: "Channel label (ZH)" })}</span>
              <input
                className="search-inline-input"
                type="text"
                value={draft.channelZh}
                onChange={(event) => setDraft((current) => ({ ...current, channelZh: event.target.value }))}
                placeholder={t(lang, { zh: "例如：品牌内容工坊 / 灰度", en: "For example: Brand content workshop / staged" })}
              />
            </label>
            <label className="fake-input governance-field">
              <span className="tiny-note">{t(lang, { zh: "通道名称（英文）", en: "Channel label (EN)" })}</span>
              <input
                className="search-inline-input"
                type="text"
                value={draft.channelEn}
                onChange={(event) => setDraft((current) => ({ ...current, channelEn: event.target.value }))}
                placeholder={t(lang, { zh: "例如：Brand content workshop / staged", en: "For example: Brand content workshop / staged" })}
              />
            </label>
          </div>
          <label className="fake-input governance-field">
            <span className="tiny-note">{t(lang, { zh: "Gate 摘要（中文，每行一项）", en: "Gate summary (ZH, one item per line)" })}</span>
            <textarea
              className="composer-input governance-textarea"
              value={draft.gateSummaryZh}
              onChange={(event) => setDraft((current) => ({ ...current, gateSummaryZh: event.target.value }))}
            />
          </label>
          <label className="fake-input governance-field">
            <span className="tiny-note">{t(lang, { zh: "Gate 摘要（英文，每行一项）", en: "Gate summary (EN, one item per line)" })}</span>
            <textarea
              className="composer-input governance-textarea"
              value={draft.gateSummaryEn}
              onChange={(event) => setDraft((current) => ({ ...current, gateSummaryEn: event.target.value }))}
            />
          </label>
          {createReleaseMutation.error ? (
            <div className="composer-error">{queryErrorMessage(createReleaseMutation.error)}</div>
          ) : null}
          <div className="governance-form-actions">
            <button
              className="route-btn active"
              type="button"
              disabled={!authReady || createReleaseMutation.isPending}
              onClick={() => void createReleaseMutation.mutateAsync()}
            >
              {createReleaseMutation.isPending
                ? t(lang, { zh: "写入中...", en: "Writing..." })
                : t(lang, { zh: "写入发布通道", en: "Create release" })}
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}

export function CreatorReplayPanel({
  packageId,
}: ReplayPanelProps) {
  const lang = useDashboardUiStore((state) => state.lang);
  const authMode = useDashboardAuthStore((state) => state.authMode);
  const authenticated = useDashboardAuthStore((state) => state.authenticated);
  const authReady = authMode === "required" && authenticated;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    sourceRunId: "",
    state: "ready" as CreatorReplayState,
    summaryZh: "",
    summaryEn: "",
  });

  const replaysQuery = useQuery({
    queryKey: ["dashboard", "creator", "replays", packageId],
    queryFn: async () => dashboardCreatorApi.listPackageReplays(packageId),
    enabled: Boolean(packageId),
    retry: false,
    staleTime: 30_000,
  });

  const createReplayMutation = useMutation({
    mutationFn: async () =>
      dashboardCreatorApi.createPackageReplay(packageId, {
        sourceRunId: draft.sourceRunId.trim(),
        state: draft.state,
        summary: {
          zh: draft.summaryZh.trim(),
          en: draft.summaryEn.trim() || draft.summaryZh.trim(),
        },
      }),
    onSuccess: async () => {
      setDraft({
        sourceRunId: "",
        state: "ready",
        summaryZh: "",
        summaryEn: "",
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "replays", packageId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "package", packageId],
        }),
      ]);
    },
  });

  const updateReplayMutation = useMutation({
    mutationFn: async (input: { replayId: string; state: CreatorReplayState }) =>
      dashboardCreatorApi.updatePackageReplay(packageId, input.replayId, {
        state: input.state,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "replays", packageId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "creator", "package", packageId],
        }),
      ]);
    },
  });

  const replayRows = useMemo(() => replaysQuery.data ?? [], [replaysQuery.data]);
  const replaySummaryText = useMemo(() => {
    if (replayRows.length === 0) {
      return t(lang, {
        zh: "当前 package 还没有 replay 记录。登记一次真实 run 回放后，调试链路、消息时序和差异定位会沉淀到这里。",
        en: "This package does not have a replay record yet. Once a real run replay is registered, debug traces, message order, and diff tracking will accumulate here.",
      });
    }

    const readyCount = replayRows.filter((item) => item.state === "ready").length;
    const runningCount = replayRows.filter((item) => item.state === "running").length;
    const failedCount = replayRows.filter((item) => item.state === "failed").length;

    return t(lang, {
      zh: `当前共有 ${replayRows.length} 条 replay 记录，其中 ready ${readyCount} 条、running ${runningCount} 条、failed ${failedCount} 条。`,
      en: `There are ${replayRows.length} replay records: ${readyCount} ready, ${runningCount} running, and ${failedCount} failed.`,
    });
  }, [lang, replayRows]);

  return (
    <div className="detail-body">
      <div className="section-head">
        <div>
          <div className="eyebrow">{t(lang, { zh: "调试回放", en: "Debug Replay" })}</div>
          <div className="tab-title">{t(lang, { zh: "真实回放台账与状态推进", en: "Real replay ledger and state progression" })}</div>
        </div>
        <span className="pill warn">{replayRows.length}</span>
      </div>
      <div className="section-note">{replaySummaryText}</div>

      {authNote(authReady, lang)}
      {replaysQuery.error ? <div className="composer-error">{queryErrorMessage(replaysQuery.error)}</div> : null}

      <div className="governance-stack">
        <article className="detail-item governance-card">
          <div className="card-row">
            <div className="file-name">{t(lang, { zh: "回放清单", en: "Replay ledger" })}</div>
            <span className="path-chip active">{packageId}</span>
          </div>
          {replayRows.length === 0 ? (
            <div className="panel-empty">
              {t(lang, {
                zh: "当前 package 还没有正式写入的回放对象。",
                en: "No formal replay records have been written for this package yet.",
              })}
            </div>
          ) : (
            replayRows.map((replay) => (
              <div className="detail-item" key={replay.replayId}>
                <div className="card-row">
                  <div>
                    <div className="file-name">{t(lang, replay.summary)}</div>
                    <div className="meta">
                      {replay.replayId} / {replay.sourceRunId} / {formatIsoLabel(replay.updatedAt)}
                    </div>
                  </div>
                  <span className={`pill ${replayTone(replay.state)}`}>{t(lang, replayStateLabel(replay.state))}</span>
                </div>
                <div className="pill-row">
                  {(["ready", "running", "failed"] as CreatorReplayState[]).map((state) => (
                    <button
                      className={`path-chip ${replay.state === state ? "active" : ""}`}
                      key={state}
                      type="button"
                      disabled={!authReady || updateReplayMutation.isPending}
                      onClick={() => void updateReplayMutation.mutateAsync({ replayId: replay.replayId, state })}
                    >
                      {t(lang, replayStateLabel(state))}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </article>

        <article className="detail-item governance-card">
          <div className="file-name">{t(lang, { zh: "登记新回放", en: "Register replay" })}</div>
          <div className="meta">
            {t(lang, {
              zh: "用真实 run 作为回放来源，把审核和差异定位留在 Creator 域内。",
              en: "Use a real run as the replay source so review and diff tracing stay inside the Creator domain.",
            })}
          </div>
          <div className="governance-form-grid">
            <label className="fake-input governance-field">
              <span className="tiny-note">{t(lang, { zh: "来源 Run ID", en: "Source run ID" })}</span>
              <input
                className="search-inline-input"
                type="text"
                value={draft.sourceRunId}
                onChange={(event) => setDraft((current) => ({ ...current, sourceRunId: event.target.value }))}
                placeholder={t(lang, { zh: "例如：run_00000021", en: "For example: run_00000021" })}
              />
            </label>
            <label className="fake-input governance-field">
              <span className="tiny-note">{t(lang, { zh: "回放状态", en: "Replay state" })}</span>
              <select
                className="governance-select"
                value={draft.state}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    state: event.target.value as CreatorReplayState,
                  }))
                }
              >
                {(["ready", "running", "failed"] as CreatorReplayState[]).map((item) => (
                  <option key={item} value={item}>
                    {t(lang, replayStateLabel(item))}
                  </option>
                ))}
              </select>
            </label>
            <label className="fake-input governance-field">
              <span className="tiny-note">{t(lang, { zh: "回放摘要（中文）", en: "Replay summary (ZH)" })}</span>
              <input
                className="search-inline-input"
                type="text"
                value={draft.summaryZh}
                onChange={(event) => setDraft((current) => ({ ...current, summaryZh: event.target.value }))}
              />
            </label>
            <label className="fake-input governance-field">
              <span className="tiny-note">{t(lang, { zh: "回放摘要（英文）", en: "Replay summary (EN)" })}</span>
              <input
                className="search-inline-input"
                type="text"
                value={draft.summaryEn}
                onChange={(event) => setDraft((current) => ({ ...current, summaryEn: event.target.value }))}
              />
            </label>
          </div>
          {createReplayMutation.error ? (
            <div className="composer-error">{queryErrorMessage(createReplayMutation.error)}</div>
          ) : null}
          <div className="governance-form-actions">
            <button
              className="route-btn active"
              type="button"
              disabled={!authReady || createReplayMutation.isPending}
              onClick={() => void createReplayMutation.mutateAsync()}
            >
              {createReplayMutation.isPending
                ? t(lang, { zh: "登记中...", en: "Creating..." })
                : t(lang, { zh: "写入回放", en: "Create replay" })}
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
