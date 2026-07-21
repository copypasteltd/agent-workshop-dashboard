import type { LocalizedString } from "../lib/i18n";

export type Workshop = {
  id: string;
  cover: string;
  title: LocalizedString;
  badge: LocalizedString;
  audience: LocalizedString;
  summary: LocalizedString;
  route: string;
  next: LocalizedString;
  tags: string[];
  linkedService: string;
  linkedInstance: string;
};

export type DashboardService = {
  id: string;
  workshopId: string;
  name: LocalizedString;
  summary: LocalizedString;
  auth: LocalizedString;
  eta: string;
  targetPath: string;
  linkedInstance: string;
};

export type InstanceTab = "overview" | "files" | "runtime" | "audit";
export type CreatorTab = "session" | "runtime" | "connectors" | "release";

export type InstanceRecord = {
  id: string;
  title: LocalizedString;
  workshop: LocalizedString;
  workspaceId: string;
  workspace: LocalizedString;
  status: LocalizedString;
  statusClass: string;
  tags?: string[];
  attentionMode?: "todo" | "running" | "done";
  targetPath: string;
  route: string;
  summary: LocalizedString;
  nextAction: LocalizedString;
  metrics: Array<{ label: LocalizedString; value: LocalizedString | string }>;
  messages: Array<{
    kind: "system" | "user" | "agent";
    title: LocalizedString | string;
    time: string;
    body: LocalizedString;
    attachments?: Array<{ label: string; path: string }>;
  }>;
  overview: {
    cards: Array<{ label: LocalizedString; value: LocalizedString }>;
  };
  files: {
    currentPath: string;
    paths: string[];
    items: Array<{
      name: string;
      path: string;
      note: LocalizedString;
      preview?: LocalizedString;
      type: string;
    }>;
  };
  runtime: {
    launchMode: "local-process" | "docker" | null;
    containerName: string | null;
    providerLabel: string | null;
    providerModel: string | null;
    providerBaseUrl: string | null;
    startedAt: string | null;
    readyAt: string | null;
    finishedAt: string | null;
    exitCode: number | null;
    exitSignal: string | null;
  };
  lifecycle: {
    runtimeStatus: "NOT_STARTED" | "ACTIVE" | "STOP_REQUESTED" | "STOPPING" | "RELEASED" | "RELEASE_FAILED" | "ORPHANED";
    recordStatus: "ACTIVE" | "ARCHIVED" | "DELETION_PENDING" | "DELETED";
    stopMode: "graceful" | "force" | null;
    stopReason: string | null;
    stopRequestedAt: string | null;
    releasedAt: string | null;
    billingStoppedAt: string | null;
    releaseFailure: string | null;
    deletionFailure: string | null;
    cleanupAttemptCount: number;
    archivedAt: string | null;
    deletionRequestedAt: string | null;
    deletedAt: string | null;
  };
  audit: {
    timeline: Array<{ time: string; text: LocalizedString }>;
    boundaries: LocalizedString[];
  };
};

export const dashboardAssets = {
  logo: "/assets/logo.svg",
  tax: "/assets/workshop-tax.svg",
  drama: "/assets/workshop-drama.svg",
  image: "/assets/workshop-image.svg",
  runtime: "/assets/runtime-map.svg",
};
