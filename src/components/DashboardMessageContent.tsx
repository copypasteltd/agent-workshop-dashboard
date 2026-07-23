import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { dashboardRunsApi, requestDashboardRunFileDownloadUrl } from "../lib/api";
import {
  isAgentMediaAttachment,
  parseAgentMessageMedia,
  type AgentMessageMediaReference,
} from "../lib/agentMessageMedia";
import type { Lang } from "../lib/i18n";

type Props = {
  enabled: boolean;
  lang: Lang;
  runId: string;
  targetPath: string;
  text: string;
  attachments?: Array<{ label: string; path: string }>;
};

function DashboardMessageMedia({
  enabled,
  lang,
  runId,
  media,
}: {
  enabled: boolean;
  lang: Lang;
  runId: string;
  media: AgentMessageMediaReference;
}) {
  const [renderFailed, setRenderFailed] = useState(false);
  const pendingPollCount = useRef(0);
  const previewQuery = useQuery({
    enabled,
    queryKey: ["dashboard", "runs", runId, "message-media", media.filePath],
    queryFn: async () => {
      pendingPollCount.current += 1;
      return dashboardRunsApi.previewRunFile(runId, media.filePath);
    },
    retry: 3,
    retryDelay: (attempt) => Math.min(750 * 2 ** attempt, 4_000),
    refetchInterval: (query) => {
      const preview = query.state.data;
      if (preview?.mode === media.kind && preview.downloadUrl) {
        const expiresAt = preview.downloadExpiresAt ? Date.parse(preview.downloadExpiresAt) : Number.NaN;
        return Number.isFinite(expiresAt) ? Math.max(5_000, expiresAt - Date.now() - 30_000) : false;
      }
      return pendingPollCount.current < 15 ? 2_000 : false;
    },
    staleTime: 45_000,
  });
  const previewUrl = previewQuery.data?.mode === media.kind ? previewQuery.data.downloadUrl : null;

  useEffect(() => setRenderFailed(false), [previewUrl]);

  const loading = enabled && (previewQuery.isPending || previewQuery.isFetching);
  const unavailable = !previewUrl || renderFailed || previewQuery.isError;

  return (
    <section className={`message-media-card ${media.kind}`} data-testid={`dashboard-message-${media.kind}`}>
      <header className="message-media-head">
        <strong>{media.label}</strong>
        <span>{media.filePath}</span>
      </header>
      {previewUrl && !renderFailed ? (
        media.kind === "image" ? (
          <img className="message-media-image" src={previewUrl} alt={media.label} onError={() => setRenderFailed(true)} />
        ) : (
          <video
            className="message-media-video"
            src={previewUrl}
            controls
            playsInline
            preload="metadata"
            onError={() => setRenderFailed(true)}
          />
        )
      ) : (
        <div className="message-media-state">
          {loading
            ? lang === "zh"
              ? `正在读取${media.kind === "video" ? "视频" : "图片"}...`
              : `Loading ${media.kind}...`
            : lang === "zh"
              ? "当前媒体暂时无法预览。"
              : "This media cannot be previewed right now."}
        </div>
      )}
      {unavailable && !loading ? (
        <div className="message-media-actions">
          <button
            className="path-chip active"
            type="button"
            onClick={() => {
              pendingPollCount.current = 0;
              void previewQuery.refetch();
            }}
          >
            {lang === "zh" ? "重新加载" : "Retry"}
          </button>
          <button
            className="path-chip"
            type="button"
            onClick={async () => {
              const url = await requestDashboardRunFileDownloadUrl(runId, media.filePath);
              window.open(url, "_blank", "noopener,noreferrer");
            }}
          >
            {lang === "zh" ? "下载文件" : "Download"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function DashboardMessageContent({
  enabled,
  lang,
  runId,
  targetPath,
  text,
  attachments = [],
}: Props) {
  const parsed = useMemo(
    () => parseAgentMessageMedia(text, targetPath, attachments),
    [attachments, targetPath, text]
  );
  const otherAttachments = attachments.filter(
    (attachment) => !isAgentMediaAttachment(attachment.path, targetPath)
  );

  return (
    <>
      {parsed.displayText ? <div className="message-body">{parsed.displayText}</div> : null}
      {parsed.media.length > 0 ? (
        <div className="message-media-list">
          {parsed.media.map((media) => (
            <DashboardMessageMedia
              enabled={enabled}
              key={media.key}
              lang={lang}
              media={media}
              runId={runId}
            />
          ))}
        </div>
      ) : null}
      {otherAttachments.length > 0 ? (
        <div className="message-attachment-list">
          {otherAttachments.map((attachment) => (
            <div className="message-attachment-chip" key={`${attachment.path}-${attachment.label}`}>
              <div>
                <div className="message-attachment-label">{attachment.label}</div>
                <div className="message-attachment-meta">{attachment.path}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
