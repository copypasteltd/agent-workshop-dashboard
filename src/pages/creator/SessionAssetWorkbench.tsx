import type {
  SessionCaptureRecord,
  SessionCaptureObject,
  SessionDraftRevision,
  SessionPackRedactionStrategy,
  SessionPackRedactionTargetKind,
} from "@lingban/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  dashboardSessionCapturesApi,
  dashboardCreatorApi,
  dashboardSessionDraftsApi,
  dashboardSessionVersionsApi,
} from "../../lib/api";
import { t } from "../../lib/i18n";

function recordBoolean(value: Record<string, unknown>, key: string) {
  return value[key] === true;
}

function recordCount(value: Record<string, unknown>, key: string) {
  return Array.isArray(value[key]) ? value[key].length : 0;
}

function captureTone(status: SessionCaptureRecord["status"]) {
  if (status === "CAPTURED") return "success";
  if (status === "FAILED" || status === "CANCELLED") return "warn";
  return "active";
}

function revisionPassed(revision: SessionDraftRevision | null) {
  return revision ? recordBoolean(revision.securityReport, "passed") : false;
}

export function SessionAssetWorkbench({
  enabled,
  packageId,
  workspaceContextKey,
  availableServices = [],
  availableWorkshops = [],
  lang,
  onPackageCreated,
}: {
  enabled: boolean;
  packageId: string | null;
  workspaceContextKey: string;
  availableServices?: Array<{ serviceId: string; displayName: { zh: string; en: string } }>;
  availableWorkshops?: Array<{ workshopId: string; displayName: { zh: string; en: string } }>;
  lang: "zh" | "en";
  onPackageCreated?: (packageId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedCaptureId, setSelectedCaptureId] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [ruleKind, setRuleKind] = useState<SessionPackRedactionTargetKind>("text");
  const [ruleSelector, setRuleSelector] = useState("");
  const [ruleStrategy, setRuleStrategy] = useState<SessionPackRedactionStrategy>("mask");
  const [ruleReplacement, setRuleReplacement] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [signingPolicyId, setSigningPolicyId] = useState("default-production-signing");
  const [newPackageId, setNewPackageId] = useState("");
  const [newPackageTitle, setNewPackageTitle] = useState("");
  const [newPackageDescription, setNewPackageDescription] = useState("");
  const [newPackageServiceIds, setNewPackageServiceIds] = useState<string[]>([]);
  const [newPackageWorkshopIds, setNewPackageWorkshopIds] = useState<string[]>([]);
  const [rawAccessReason, setRawAccessReason] = useState("");

  const capturesQuery = useQuery({
    enabled,
    queryKey: ["dashboard", "creator", "session-captures"],
    queryFn: async () => (await dashboardSessionCapturesApi.listWorkspace()).items,
    refetchInterval: (query) => query.state.data?.some((item) => !["CAPTURED", "FAILED", "CANCELLED"].includes(item.status)) ? 2_000 : 15_000,
  });
  const draftsQuery = useQuery({
    enabled,
    queryKey: ["dashboard", "creator", "session-drafts"],
    queryFn: async () => (await dashboardSessionDraftsApi.list()).items,
    refetchInterval: 15_000,
  });
  const bindingsQuery = useQuery({
    enabled: enabled && Boolean(packageId),
    queryKey: ["dashboard", "creator", "session-bindings", packageId],
    queryFn: async () => dashboardSessionVersionsApi.getPackageBindings(packageId!),
  });
  const accessAuditQuery = useQuery({
    enabled: enabled && Boolean(selectedCaptureId),
    queryKey: ["dashboard", "creator", "session-capture-audit", selectedCaptureId],
    queryFn: async () => (await dashboardSessionCapturesApi.listAccessAudit(selectedCaptureId)).items,
  });

  useEffect(() => {
    const captures = capturesQuery.data ?? [];
    if (!selectedCaptureId || !captures.some((item) => item.captureId === selectedCaptureId)) {
      setSelectedCaptureId(captures[0]?.captureId ?? "");
    }
  }, [capturesQuery.data, selectedCaptureId]);
  useEffect(() => {
    const drafts = draftsQuery.data ?? [];
    if (!selectedDraftId || !drafts.some((item) => item.draftId === selectedDraftId)) {
      setSelectedDraftId(drafts[0]?.draftId ?? "");
    }
  }, [draftsQuery.data, selectedDraftId]);

  const detailQuery = useQuery({
    enabled: enabled && Boolean(selectedDraftId),
    queryKey: ["dashboard", "creator", "session-draft", selectedDraftId],
    queryFn: async () => dashboardSessionDraftsApi.get(selectedDraftId),
  });
  const selectedCapture = capturesQuery.data?.find((item) => item.captureId === selectedCaptureId) ?? null;
  const selectedDraft = detailQuery.data?.draft ?? null;
  const latestRevision = detailQuery.data?.revisions[0] ?? null;
  const latestReplay = detailQuery.data?.replays.find(
    (replay) => replay.revisionId === latestRevision?.revisionId
  ) ?? null;
  const latestVersion = detailQuery.data?.versions[0] ?? null;
  const draftByCapture = useMemo(
    () => new Map((draftsQuery.data ?? []).map((draft) => [draft.sourceCaptureId, draft])),
    [draftsQuery.data]
  );

  const invalidateAssets = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dashboard", "creator", "session-captures"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", "creator", "session-drafts"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", "creator", "session-draft"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", "creator", "session-bindings"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", "creator", "packages"] }),
    ]);
  };

  const createDraftMutation = useMutation({
    mutationFn: async (capture: SessionCaptureRecord) => dashboardSessionDraftsApi.createFromCapture(capture.captureId, {
      sessionId: capture.destinationSessionId,
      sessionName: null,
      sessionDescription: "",
      taskFamily: null,
      parentSessionVersionId: null,
      idempotencyKey: `creator:${capture.captureId}:draft`,
    }),
    onSuccess: async (result) => {
      setSelectedDraftId(result.draft.draftId);
      await invalidateAssets();
    },
  });

  const revisionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDraft || !latestRevision) throw new Error("A source revision is required.");
      return dashboardSessionDraftsApi.createRevision(selectedDraft.draftId, {
        expectedVersion: selectedDraft.version,
        workspaceSelection: latestRevision.workspaceSelection,
        redactionRules: ruleSelector.trim() ? [{
          ruleId: `rule_${Date.now()}`,
          targetKind: ruleKind,
          selector: ruleSelector.trim(),
          strategy: ruleStrategy,
          ...(ruleStrategy === "replace" ? { replacement: ruleReplacement.trim() } : {}),
          rationale: "Configured in Creator Session Asset Workbench",
        }] : [],
      });
    },
    onSuccess: async () => {
      setRuleSelector("");
      setRuleReplacement("");
      await invalidateAssets();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (decision: "approved" | "changes_requested") => {
      if (!selectedDraft || !latestRevision) throw new Error("A current revision is required.");
      return dashboardSessionDraftsApi.review(selectedDraft.draftId, {
        expectedVersion: selectedDraft.version,
        revisionId: latestRevision.revisionId,
        decision,
        note: reviewNote.trim() || null,
      });
    },
    onSuccess: invalidateAssets,
  });

  const replayMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDraft || !latestRevision) throw new Error("A current revision is required.");
      return dashboardSessionDraftsApi.replay(selectedDraft.draftId, {
        expectedVersion: selectedDraft.version,
        revisionId: latestRevision.revisionId,
      });
    },
    onSuccess: invalidateAssets,
  });

  const sealMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDraft || !latestRevision || latestReplay?.status !== "passed") {
        throw new Error("A passed replay is required.");
      }
      return dashboardSessionDraftsApi.seal(selectedDraft.draftId, {
        expectedVersion: selectedDraft.version,
        revisionId: latestRevision.revisionId,
        signingPolicyId,
        replayId: latestReplay.replayId,
      });
    },
    onSuccess: invalidateAssets,
  });

  const bindMutation = useMutation({
    mutationFn: async (state: "candidate" | "active") => {
      if (!packageId || !latestVersion) throw new Error("A package and sealed version are required.");
      const current = state === "active" ? bindingsQuery.data?.active : bindingsQuery.data?.candidate;
      return dashboardSessionVersionsApi.bindPackage(packageId, {
        sessionVersionId: latestVersion.sessionVersionId,
        state,
        expectedVersion: current?.version ?? 0,
      });
    },
    onSuccess: invalidateAssets,
  });

  const createPackageMutation = useMutation({
    mutationFn: async () => {
      if (!latestVersion) throw new Error("A sealed Session Version is required.");
      const normalizedPackageId = newPackageId.trim().toLowerCase();
      const title = newPackageTitle.trim();
      const description = newPackageDescription.trim() || title;
      const created = await dashboardCreatorApi.createPackage({
        packageId: normalizedPackageId,
        title: { zh: title, en: title },
        description: { zh: description, en: description },
        workspaceContextKey,
        linkedWorkshopIds: newPackageWorkshopIds,
        linkedServiceIds: newPackageServiceIds,
        currentTaskVersionId: detailQuery.data?.session?.taskFamily?.startsWith("tsv_")
          ? detailQuery.data.session.taskFamily
          : null,
      });
      await dashboardSessionVersionsApi.bindPackage(created.packageId, {
        sessionVersionId: latestVersion.sessionVersionId,
        state: "candidate",
        expectedVersion: 0,
      });
      return created;
    },
    onSuccess: async (created) => {
      await invalidateAssets();
      onPackageCreated?.(created.packageId);
    },
  });

  const rawDownloadMutation = useMutation({
    mutationFn: async (object: SessionCaptureObject) => {
      if (!selectedCapture) throw new Error("A Capture must be selected.");
      const response = await dashboardSessionCapturesApi.downloadObject(
        selectedCapture.captureId,
        object.objectType,
        { reason: rawAccessReason.trim() }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? `Download failed (${response.status})`);
      }
      if ((response.headers.get("content-type") ?? "").includes("application/json")) {
        const payload = await response.json() as { downloadUrl: string | null };
        if (!payload.downloadUrl) throw new Error("Signed download URL is unavailable.");
        const anchor = document.createElement("a");
        anchor.href = payload.downloadUrl;
        anchor.rel = "noopener noreferrer";
        anchor.click();
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${selectedCapture.captureId}-${object.objectType}`;
        anchor.click();
        URL.revokeObjectURL(url);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "creator", "session-capture-audit", selectedCaptureId] });
    },
  });

  const mutationError =
    createDraftMutation.error || revisionMutation.error || reviewMutation.error || replayMutation.error || sealMutation.error || bindMutation.error || createPackageMutation.error || rawDownloadMutation.error;

  return (
    <article className="session-asset-workbench" data-testid="dashboard-session-asset-workbench">
      <div className="session-workbench-head">
        <div>
          <div className="eyebrow">SESSION WORKSHOP</div>
          <h2 className="detail-title">{t(lang, { zh: "会话固化与发布", en: "Session capture and publication" })}</h2>
          <div className="section-note">{t(lang, { zh: "从原始 Capture 审核到不可变 Session Version，再绑定到 Creator Package。", en: "Review Raw Captures into immutable Session Versions, then bind them to a Creator Package." })}</div>
        </div>
        <div className="session-workbench-metrics">
          <span><strong>{capturesQuery.data?.length ?? 0}</strong>{t(lang, { zh: " Capture", en: " Captures" })}</span>
          <span><strong>{draftsQuery.data?.length ?? 0}</strong>{t(lang, { zh: " Draft", en: " Drafts" })}</span>
        </div>
      </div>

      <div className="session-workbench-grid">
        <section className="session-workbench-column">
          <header><span>01</span><strong>{t(lang, { zh: "待处理 Capture", en: "Capture queue" })}</strong></header>
          <div className="session-asset-list">
            {(capturesQuery.data ?? []).slice(0, 12).map((capture) => {
              const draft = draftByCapture.get(capture.captureId);
              return <button type="button" className={`session-asset-row ${selectedCaptureId === capture.captureId ? "active" : ""}`} key={capture.captureId} onClick={() => setSelectedCaptureId(capture.captureId)}>
                <span className={`status-mark ${captureTone(capture.status)}`} />
                <span><strong>{capture.status}</strong><small className="mono">{capture.captureId}</small></span>
                <em>{draft ? "DRAFT" : capture.mode.toUpperCase()}</em>
              </button>;
            })}
            {!capturesQuery.isLoading && !capturesQuery.data?.length ? <div className="session-asset-empty">{t(lang, { zh: "当前工作区暂无 Capture", en: "No Capture exists in this workspace" })}</div> : null}
          </div>
          {selectedCapture ? <div className="session-asset-inspector">
            <div><span>{t(lang, { zh: "安全状态", en: "Security" })}</span><strong>{selectedCapture.securityState}</strong></div>
            <div><span>{t(lang, { zh: "文件", en: "Files" })}</span><strong>{selectedCapture.fileCount}</strong></div>
            <div><span>{t(lang, { zh: "事件", en: "Events" })}</span><strong>{selectedCapture.eventCount}</strong></div>
            {selectedCapture.status === "CAPTURED" && !draftByCapture.has(selectedCapture.captureId) ? <button className="route-btn active" type="button" disabled={createDraftMutation.isPending} onClick={() => createDraftMutation.mutate(selectedCapture)}>{t(lang, { zh: "创建 Draft", en: "Create Draft" })}</button> : null}
            {selectedCapture.status === "CAPTURED" ? <div className="capture-raw-access">
              <div className="capture-raw-access-head"><span>{t(lang, { zh: "原始证据访问", en: "Raw evidence access" })}</span><strong>{accessAuditQuery.data?.length ?? 0}</strong></div>
              <label className="capture-field"><span>{t(lang, { zh: "访问原因", en: "Access reason" })}</span><input value={rawAccessReason} onChange={(event) => setRawAccessReason(event.target.value)} placeholder={t(lang, { zh: "填写审计用途，至少 8 个字符", en: "State the audited purpose, at least 8 characters" })} /></label>
              <div className="capture-object-grid">
                {selectedCapture.objects.map((object) => <button type="button" key={object.objectType} disabled={rawAccessReason.trim().length < 8 || rawDownloadMutation.isPending} onClick={() => rawDownloadMutation.mutate(object)} title={`${object.sha256} / ${object.sizeBytes} bytes`}><svg className="icon"><use href="#i-download" /></svg><span>{object.objectType}</span><small>{Math.max(1, Math.ceil(object.sizeBytes / 1024))} KB</small></button>)}
              </div>
              {(accessAuditQuery.data ?? []).slice(0, 3).map((audit) => <div className="capture-audit-row" key={audit.auditId}><span>{audit.objectType}</span><small>{new Date(audit.requestedAt).toLocaleString()}</small><em>{audit.accessMode}</em></div>)}
            </div> : null}
          </div> : null}
        </section>

        <section className="session-workbench-column">
          <header><span>02</span><strong>{t(lang, { zh: "Draft 与 Revision", en: "Draft and revisions" })}</strong></header>
          <div className="session-draft-tabs">
            {(draftsQuery.data ?? []).slice(0, 8).map((draft) => <button type="button" className={selectedDraftId === draft.draftId ? "active" : ""} key={draft.draftId} onClick={() => setSelectedDraftId(draft.draftId)}><span>{draft.status}</span><small className="mono">{draft.draftId}</small></button>)}
          </div>
          {selectedDraft && latestRevision ? <div className="session-revision-editor">
            <div className="session-version-line"><span>{t(lang, { zh: "当前 Revision", en: "Current revision" })}</span><strong className="mono">{latestRevision.revisionId}</strong><em>v{latestRevision.revisionNumber}</em></div>
            <div className="redaction-rule-grid">
              <select value={ruleKind} onChange={(event) => setRuleKind(event.target.value as SessionPackRedactionTargetKind)}><option value="text">text</option><option value="json-path">json-path</option><option value="file-path">file-path</option><option value="header">header</option><option value="cookie">cookie</option></select>
              <input value={ruleSelector} onChange={(event) => setRuleSelector(event.target.value)} placeholder={ruleKind === "json-path" ? "$.credentials.apiKey" : "selector"} />
              <select value={ruleStrategy} onChange={(event) => setRuleStrategy(event.target.value as SessionPackRedactionStrategy)}><option value="mask">mask</option><option value="remove">remove</option><option value="replace">replace</option><option value="hash">hash</option></select>
              {ruleStrategy === "replace" ? <input value={ruleReplacement} onChange={(event) => setRuleReplacement(event.target.value)} placeholder="replacement" /> : null}
            </div>
            <button className="route-btn" type="button" disabled={revisionMutation.isPending || (ruleStrategy === "replace" && !ruleReplacement.trim())} onClick={() => revisionMutation.mutate()}><svg className="icon"><use href="#i-refresh" /></svg>{t(lang, { zh: "生成新 Revision", en: "Build new revision" })}</button>
          </div> : <div className="session-asset-empty">{t(lang, { zh: "选择一个 Draft 查看 Revision", en: "Select a Draft to inspect revisions" })}</div>}
        </section>

        <section className="session-workbench-column">
          <header><span>03</span><strong>{t(lang, { zh: "审核、密封与绑定", en: "Review, seal, and bind" })}</strong></header>
          {selectedDraft && latestRevision ? <div className="session-release-stack">
            <div className="security-verdict"><svg className="icon"><use href={revisionPassed(latestRevision) ? "#i-check" : "#i-shield"} /></svg><div><span>{t(lang, { zh: "安全校验", en: "Security gate" })}</span><strong>{revisionPassed(latestRevision) ? "PASSED" : "ACTION REQUIRED"}</strong><small>{recordCount(latestRevision.securityReport, "findings")} findings / {recordCount(latestRevision.securityReport, "packIssues")} pack issues</small></div></div>
            <label className="capture-field"><span>{t(lang, { zh: "审核说明", en: "Review note" })}</span><input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label>
            <div className="panel-inline-actions"><button className="route-btn active" type="button" disabled={!revisionPassed(latestRevision) || reviewMutation.isPending || selectedDraft.status === "sealed"} onClick={() => reviewMutation.mutate("approved")}>{t(lang, { zh: "通过脱敏审核", en: "Approve redaction" })}</button><button className="route-btn" type="button" disabled={reviewMutation.isPending || selectedDraft.status === "sealed"} onClick={() => reviewMutation.mutate("changes_requested")}>{t(lang, { zh: "要求修改", en: "Request changes" })}</button></div>
            <div className="session-replay-gate">
              <div className="security-verdict"><svg className="icon"><use href={latestReplay?.status === "passed" ? "#i-check" : "#i-refresh"} /></svg><div><span>Replay Gate</span><strong>{latestReplay?.status.toUpperCase() ?? "NOT RUN"}</strong><small>{latestReplay ? `${latestReplay.restoredFileCount} files / ${latestReplay.eventCount} events` : t(lang, { zh: "等待恢复验证", en: "Restore validation pending" })}</small></div></div>
              <button className="route-btn" type="button" disabled={selectedDraft.status !== "ready_to_seal" || replayMutation.isPending} onClick={() => replayMutation.mutate()}><svg className="icon"><use href="#i-refresh" /></svg>{t(lang, { zh: "执行恢复验证", en: "Run restore validation" })}</button>
              {latestReplay ? <div className="session-replay-checks">{latestReplay.checks.map((check) => <div key={check.checkId} className={check.status}><span>{check.checkId}</span><strong>{check.status.toUpperCase()}</strong><small>{check.detail}</small></div>)}</div> : null}
            </div>
            <label className="capture-field"><span>{t(lang, { zh: "签名策略", en: "Signing policy" })}</span><input value={signingPolicyId} onChange={(event) => setSigningPolicyId(event.target.value)} /></label>
            <button className="route-btn active" type="button" disabled={selectedDraft.status !== "ready_to_seal" || latestReplay?.status !== "passed" || sealMutation.isPending} onClick={() => sealMutation.mutate()}><svg className="icon"><use href="#i-lock" /></svg>{t(lang, { zh: "密封 Session Version", en: "Seal Session Version" })}</button>
            {latestVersion ? <div className="sealed-version-band"><span>{t(lang, { zh: "已密封版本", en: "Sealed version" })}</span><strong className="mono">{latestVersion.sessionVersionId}</strong><small>{latestVersion.signatureAlgorithm} / {latestVersion.signatureKeyId}</small></div> : null}
            {latestVersion && packageId ? <div className="panel-inline-actions"><button className="route-btn" type="button" disabled={bindMutation.isPending} onClick={() => bindMutation.mutate("candidate")}>{t(lang, { zh: "设为候选版本", en: "Set as candidate" })}</button><button className="route-btn active" type="button" disabled={bindMutation.isPending} onClick={() => bindMutation.mutate("active")}>{t(lang, { zh: "设为当前版本", en: "Set as current" })}</button></div> : latestVersion ? <div className="session-package-create">
              <strong>{t(lang, { zh: "创建 Creator Package 并绑定候选版本", en: "Create a Creator Package and bind the candidate version" })}</strong>
              <label className="capture-field"><span>Package ID</span><input value={newPackageId} onChange={(event) => setNewPackageId(event.target.value)} placeholder="tax-filing-2026" /></label>
              <label className="capture-field"><span>{t(lang, { zh: "名称", en: "Title" })}</span><input value={newPackageTitle} onChange={(event) => setNewPackageTitle(event.target.value)} /></label>
              <label className="capture-field"><span>{t(lang, { zh: "说明", en: "Description" })}</span><input value={newPackageDescription} onChange={(event) => setNewPackageDescription(event.target.value)} /></label>
              {availableWorkshops.length > 0 ? <fieldset className="session-package-options"><legend>{t(lang, { zh: "关联工坊", en: "Linked workshops" })}</legend>{availableWorkshops.map((workshop) => <label key={workshop.workshopId}><input type="checkbox" checked={newPackageWorkshopIds.includes(workshop.workshopId)} onChange={(event) => setNewPackageWorkshopIds((current) => event.target.checked ? [...current, workshop.workshopId] : current.filter((id) => id !== workshop.workshopId))} /><span>{workshop.displayName[lang]}</span></label>)}</fieldset> : null}
              {availableServices.length > 0 ? <fieldset className="session-package-options"><legend>{t(lang, { zh: "关联服务", en: "Linked services" })}</legend>{availableServices.map((service) => <label key={service.serviceId}><input type="checkbox" checked={newPackageServiceIds.includes(service.serviceId)} onChange={(event) => setNewPackageServiceIds((current) => event.target.checked ? [...current, service.serviceId] : current.filter((id) => id !== service.serviceId))} /><span>{service.displayName[lang]}</span></label>)}</fieldset> : null}
              <button className="route-btn active" type="button" disabled={createPackageMutation.isPending || !/^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/.test(newPackageId.trim().toLowerCase()) || !newPackageTitle.trim()} onClick={() => createPackageMutation.mutate()}>{t(lang, { zh: "创建并绑定", en: "Create and bind" })}</button>
            </div> : null}
          </div> : <div className="session-asset-empty">{t(lang, { zh: "选择 Draft 后执行安全审核", en: "Select a Draft to run the security review" })}</div>}
        </section>
      </div>
      {mutationError ? <div className="capture-alert warn session-workbench-error">{mutationError.message}</div> : null}
    </article>
  );
}
