import type { RunSnapshot, SessionCaptureMode, SessionCaptureRecord } from "@lingban/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { dashboardSessionCapturesApi } from "../../lib/api";
import { t } from "../../lib/i18n";

const defaultExcludes = [
  ".git/**",
  "**/node_modules/**",
  "**/.env",
  "**/.env.*",
  "**/secrets/**",
  "**/codex-home/**",
  "**/tmp/**",
  "**/.cache/**",
];

const steps = [
  { zh: "来源", en: "Source" },
  { zh: "文件", en: "Files" },
  { zh: "目标", en: "Destination" },
  { zh: "确认", en: "Confirm" },
] as const;

const terminalCaptureStates = new Set(["CAPTURED", "FAILED", "CANCELLED"]);

function formatBytes(value: number) {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function captureTone(status: SessionCaptureRecord["status"]) {
  if (status === "CAPTURED") return "success";
  if (status === "FAILED" || status === "CANCELLED") return "warn";
  return "active";
}

export function SessionCaptureDrawer({
  open,
  run,
  lang,
  onClose,
}: {
  open: boolean;
  run: RunSnapshot;
  lang: "zh" | "en";
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<SessionCaptureMode>("terminal");
  const [includeText, setIncludeText] = useState("**/*");
  const [excludeText, setExcludeText] = useState(defaultExcludes.join("\n"));
  const [includeArtifacts, setIncludeArtifacts] = useState(true);
  const [destinationSessionId, setDestinationSessionId] = useState("");
  const [createDraft, setCreateDraft] = useState(true);
  const [submittedCaptureId, setSubmittedCaptureId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSubmittedCaptureId(null);
    setMode("terminal");
  }, [open, run.run.runId]);

  const capturesQuery = useQuery({
    enabled: open,
    queryKey: ["dashboard", "session-captures", "run", run.run.runId],
    queryFn: async () => (await dashboardSessionCapturesApi.list(run.run.runId)).items,
    refetchInterval: (query) =>
      query.state.data?.some((capture) => !terminalCaptureStates.has(capture.status)) ? 1_500 : 5_000,
  });
  const activeCapture = useMemo(
    () => capturesQuery.data?.find((capture) => capture.captureId === submittedCaptureId) ?? null,
    [capturesQuery.data, submittedCaptureId]
  );

  const createMutation = useMutation({
    mutationFn: async () =>
      dashboardSessionCapturesApi.create(run.run.runId, {
        mode,
        throughTurnId: run.agentThread?.currentTurnId ?? null,
        workspaceSelection: {
          targetPath: run.run.targetPath,
          includeGlobs: includeText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
          excludeGlobs: excludeText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
          includeArtifacts,
          maxFiles: 100_000,
          maxBytes: 5 * 1024 * 1024 * 1024,
        },
        destinationSessionId: destinationSessionId.trim() || null,
        createDraft,
        idempotencyKey: `dashboard:${run.run.runId}:${Date.now()}`,
      }),
    onSuccess: async (result) => {
      setSubmittedCaptureId(result.capture.captureId);
      setStep(3);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "session-captures"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs", run.run.runId] }),
      ]);
    },
  });

  if (!open) return null;
  const threadReady =
    Boolean(run.agentThread?.threadId) &&
    Boolean(run.agentThread?.currentTurnId) &&
    run.agentThread?.currentTurnState === "completed";
  const canSubmit = threadReady && includeText.trim().length > 0;

  return (
    <div className="session-capture-layer" role="presentation">
      <button className="session-capture-backdrop" type="button" aria-label={t(lang, { zh: "关闭固化面板", en: "Close capture panel" })} onClick={onClose} />
      <aside className="session-capture-drawer" role="dialog" aria-modal="true" aria-labelledby="session-capture-title">
        <header className="session-capture-header">
          <div>
            <div className="eyebrow">SESSION CAPTURE</div>
            <h2 className="detail-title" id="session-capture-title">{t(lang, { zh: "固化当前会话", en: "Capture this session" })}</h2>
            <div className="meta mono">{run.run.runId}</div>
          </div>
          <button className="icon-btn" type="button" title={t(lang, { zh: "关闭", en: "Close" })} onClick={onClose}>
            <svg className="icon"><use href="#i-x" /></svg>
          </button>
        </header>

        <nav className="session-capture-steps" aria-label={t(lang, { zh: "固化步骤", en: "Capture steps" })}>
          {steps.map((label, index) => (
            <button className={`capture-step ${step === index ? "active" : ""} ${step > index ? "done" : ""}`} type="button" key={label.en} onClick={() => !submittedCaptureId && setStep(index)}>
              <span>{step > index ? <svg className="icon"><use href="#i-check" /></svg> : index + 1}</span>
              {t(lang, label)}
            </button>
          ))}
        </nav>

        <div className="session-capture-content">
          {step === 0 ? (
            <div className="capture-form-stack">
              <div className="capture-source-band">
                <div><span>{t(lang, { zh: "Thread", en: "Thread" })}</span><strong className="mono">{run.agentThread?.threadId ?? "--"}</strong></div>
                <div><span>{t(lang, { zh: "边界 Turn", en: "Boundary turn" })}</span><strong className="mono">{run.agentThread?.currentTurnId ?? "--"}</strong></div>
                <div><span>{t(lang, { zh: "事件高水位", en: "Event watermark" })}</span><strong>{run.agentThread?.eventHighWatermark ?? 0}</strong></div>
                <div><span>Provider / Model</span><strong>{run.provider ? `${run.provider.providerId} / ${run.provider.model}` : "--"}</strong></div>
              </div>
              <label className="capture-field">
                <span>{t(lang, { zh: "固化模式", en: "Capture mode" })}</span>
                <div className="capture-segmented">
                  <button type="button" className={mode === "terminal" ? "active" : ""} onClick={() => setMode("terminal")}>{t(lang, { zh: "固化并结束", en: "Capture and finish" })}</button>
                  <button type="button" className={mode === "checkpoint" ? "active" : ""} onClick={() => setMode("checkpoint")}>{t(lang, { zh: "建立检查点", en: "Create checkpoint" })}</button>
                </div>
              </label>
              {!threadReady ? <div className="capture-alert warn">{t(lang, { zh: "当前 Turn 尚未完成。等待 Codex 完成回复后再建立边界。", en: "The current turn is still active. Wait for Codex to complete it before creating a boundary." })}</div> : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="capture-form-stack">
              <label className="capture-field"><span>{t(lang, { zh: "目标路径", en: "Target path" })}</span><input value={run.run.targetPath} disabled /></label>
              <label className="capture-field"><span>{t(lang, { zh: "包含规则", en: "Include patterns" })}</span><textarea value={includeText} onChange={(event) => setIncludeText(event.target.value)} /></label>
              <label className="capture-field"><span>{t(lang, { zh: "排除规则", en: "Exclude patterns" })}</span><textarea value={excludeText} onChange={(event) => setExcludeText(event.target.value)} /></label>
              <label className="capture-toggle"><input type="checkbox" checked={includeArtifacts} onChange={(event) => setIncludeArtifacts(event.target.checked)} /><span>{t(lang, { zh: "包含运行产物", en: "Include runtime artifacts" })}</span></label>
              <div className="capture-alert">{t(lang, { zh: "上限 100,000 个文件 / 5 GB。符号链接、路径越界与敏感默认目录会被阻断。", en: "Limit: 100,000 files / 5 GB. Symbolic links, path escapes, and sensitive default directories are blocked." })}</div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="capture-form-stack">
              <label className="capture-field"><span>{t(lang, { zh: "目标 Session ID（可选）", en: "Destination Session ID (optional)" })}</span><input value={destinationSessionId} onChange={(event) => setDestinationSessionId(event.target.value)} placeholder="ses_..." /></label>
              <label className="capture-toggle"><input type="checkbox" checked={createDraft} onChange={(event) => setCreateDraft(event.target.checked)} /><span>{t(lang, { zh: "Capture 完成后创建 Draft 与初始 Revision", en: "Create a Draft and initial Revision after capture" })}</span></label>
              <div className="capture-destination-preview"><svg className="icon"><use href="#i-archive" /></svg><div><strong>{destinationSessionId.trim() || t(lang, { zh: "新建 Session", en: "New Session" })}</strong><span>{createDraft ? t(lang, { zh: "进入 Creator 脱敏审核", en: "Continue to Creator redaction review" }) : t(lang, { zh: "仅保留 Raw Capture", en: "Keep Raw Capture only" })}</span></div></div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="capture-form-stack">
              {activeCapture ? (
                <>
                  <div className="capture-progress-head"><div><div className="eyebrow">{t(lang, { zh: "固化进度", en: "Capture progress" })}</div><strong>{activeCapture.status}</strong></div><span className={`pill ${captureTone(activeCapture.status)}`}>{formatBytes(activeCapture.capturedBytes)}</span></div>
                  <div className="capture-progress-track"><span style={{ width: activeCapture.status === "CAPTURED" ? "100%" : activeCapture.status === "VERIFYING" ? "88%" : activeCapture.status === "UPLOADING" ? "68%" : activeCapture.status === "CAPTURING_WORKSPACE" ? "48%" : "24%" }} /></div>
                  <div className="capture-source-band"><div><span>Capture ID</span><strong className="mono">{activeCapture.captureId}</strong></div><div><span>{t(lang, { zh: "事件", en: "Events" })}</span><strong>{activeCapture.eventCount}</strong></div><div><span>{t(lang, { zh: "文件", en: "Files" })}</span><strong>{activeCapture.fileCount}</strong></div><div><span>{t(lang, { zh: "安全状态", en: "Security" })}</span><strong>{activeCapture.securityState}</strong></div></div>
                  {activeCapture.statusReason ? <div className="capture-alert warn">{activeCapture.errorCode ? `${activeCapture.errorCode}: ` : ""}{activeCapture.statusReason}</div> : null}
                  {activeCapture.status === "FAILED" ? <button className="route-btn" type="button" onClick={() => dashboardSessionCapturesApi.retry(activeCapture.captureId).then(() => capturesQuery.refetch())}><svg className="icon"><use href="#i-refresh" /></svg>{t(lang, { zh: "重试固化", en: "Retry capture" })}</button> : null}
                  {activeCapture.status === "CAPTURED" ? <div className="capture-alert success"><svg className="icon"><use href="#i-check" /></svg>{t(lang, { zh: "Capture 已验证。Draft 正在进入 Creator 工作台。", en: "Capture verified. The Draft is entering Creator Studio." })}</div> : null}
                </>
              ) : (
                <>
                  <div className="capture-confirm-list">
                    <div><span>{t(lang, { zh: "边界", en: "Boundary" })}</span><strong className="mono">{run.agentThread?.currentTurnId ?? "--"}</strong></div>
                    <div><span>{t(lang, { zh: "路径", en: "Path" })}</span><strong className="mono">{run.run.targetPath}</strong></div>
                    <div><span>{t(lang, { zh: "模式", en: "Mode" })}</span><strong>{mode}</strong></div>
                    <div><span>{t(lang, { zh: "去向", en: "Destination" })}</span><strong>{destinationSessionId.trim() || t(lang, { zh: "新 Session", en: "New Session" })}</strong></div>
                  </div>
                  {createMutation.error ? <div className="capture-alert warn">{createMutation.error.message}</div> : null}
                </>
              )}
            </div>
          ) : null}
        </div>

        <footer className="session-capture-footer">
          <button className="route-btn" type="button" disabled={step === 0 || Boolean(submittedCaptureId)} onClick={() => setStep((value) => Math.max(0, value - 1))}><svg className="icon"><use href="#i-arrow-left" /></svg>{t(lang, { zh: "上一步", en: "Back" })}</button>
          {step < 3 ? <button className="route-btn active" type="button" disabled={step === 0 && !threadReady} onClick={() => setStep((value) => Math.min(3, value + 1))}>{t(lang, { zh: "下一步", en: "Continue" })}<svg className="icon"><use href="#i-arrow-right" /></svg></button> : !activeCapture ? <button className="route-btn active" type="button" disabled={!canSubmit || createMutation.isPending} onClick={() => createMutation.mutate()}><svg className="icon"><use href="#i-archive" /></svg>{createMutation.isPending ? t(lang, { zh: "提交中", en: "Submitting" }) : t(lang, { zh: "开始固化", en: "Start capture" })}</button> : <button className="route-btn active" type="button" onClick={onClose}>{t(lang, { zh: "完成", en: "Done" })}</button>}
        </footer>
      </aside>
    </div>
  );
}
