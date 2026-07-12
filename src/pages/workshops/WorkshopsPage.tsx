import type {
  BatchRunDraftItemInput,
  BatchRunImportFieldMapping,
  ImportBatchRunFileResponse,
  ServiceCatalogEntry,
  WorkshopCatalogEntry,
} from "@lingban/contracts";
import { matchesSearchQuery } from "@lingban/domain-models";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  dashboardBatchRunsApi,
  dashboardCatalogApi,
  dashboardMeApi,
  dashboardRunsApi,
} from "../../lib/api";
import {
  type DashboardService,
  type Workshop,
} from "../../data/dashboardData";
import { t } from "../../lib/i18n";
import { useDashboardRecentRecorder } from "../../lib/recent";
import { mapRunSnapshotToInstanceRecord } from "../../lib/liveRunAdapters";
import { dashboardRoutes } from "../../lib/routes";
import { resolveDashboardWorkspaceView } from "../../lib/workspaceContext";
import { useDashboardAuthStore } from "../../stores/dashboardAuthStore";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";

type FavoriteWorkshopMutationInput = {
  workshopId: string;
  favorited: boolean;
};

type BatchDraftRow = {
  rowId: string;
  title: string;
  pathSuffix: string;
  initialMessage: string;
  contextText: string;
};

type BatchImportFieldKey = "title" | "pathSuffix" | "targetPath" | "initialMessage" | "rowKey";

type BatchImportMappingDraft = Record<BatchImportFieldKey, string> & {
  ignoreColumns: string[];
};

type BatchGovernanceDraft = {
  maxParallelRuns: string;
  budgetLimit: string;
  retryLimit: string;
};

type BatchGovernanceInput = {
  maxParallelRuns: number;
  budgetLimit: number | null;
  retryLimit: number;
};

type BatchRunDraftSubmission = {
  targetServiceId: string;
  title?: string;
  items: BatchRunDraftItemInput[];
  governance: BatchGovernanceInput;
};

type BatchRunEstimateRequest = BatchRunDraftSubmission & {
  signature: string;
};

const batchImportFieldKeys: BatchImportFieldKey[] = [
  "title",
  "pathSuffix",
  "targetPath",
  "initialMessage",
  "rowKey",
];

let batchDraftRowSequence = 1;

function nextBatchDraftRowId() {
  const current = batchDraftRowSequence;
  batchDraftRowSequence += 1;
  return `batch_row_${current}`;
}

function createBatchDraftRow(seed?: Partial<Omit<BatchDraftRow, "rowId">>): BatchDraftRow {
  return {
    rowId: nextBatchDraftRowId(),
    title: seed?.title ?? "",
    pathSuffix: seed?.pathSuffix ?? "",
    initialMessage: seed?.initialMessage ?? "",
    contextText: seed?.contextText ?? "",
  };
}

function parseBatchContextText(input: string) {
  return input
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, line) => {
      const separatorIndex = line.includes(":") ? line.indexOf(":") : line.indexOf("=");
      if (separatorIndex <= 0) {
        return accumulator;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (!key || !value) {
        return accumulator;
      }

      accumulator[key] = value;
      return accumulator;
    }, {});
}

function serializeBatchContext(context: Record<string, string>) {
  return Object.entries(context)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function mapImportedBatchDraftRow(item: BatchRunDraftItemInput): BatchDraftRow {
  return {
    rowId: nextBatchDraftRowId(),
    title: item.title,
    pathSuffix: item.pathSuffix ?? "",
    initialMessage: item.initialMessage ?? "",
    contextText: serializeBatchContext(item.context ?? {}),
  };
}

function createBatchImportMappingDraft(
  seed?: Partial<ImportBatchRunFileResponse["effectiveMapping"]>
): BatchImportMappingDraft {
  return {
    title: seed?.title ?? "",
    pathSuffix: seed?.pathSuffix ?? "",
    targetPath: seed?.targetPath ?? "",
    initialMessage: seed?.initialMessage ?? "",
    rowKey: seed?.rowKey ?? "",
    ignoreColumns: Array.from(new Set(seed?.ignoreColumns ?? [])),
  };
}

function buildBatchImportMappingInput(draft: BatchImportMappingDraft): BatchRunImportFieldMapping {
  const mapping: BatchRunImportFieldMapping = {
    ignoreColumns: Array.from(new Set(draft.ignoreColumns)),
  };

  if (draft.title.trim()) {
    mapping.title = draft.title.trim();
  }
  if (draft.pathSuffix.trim()) {
    mapping.pathSuffix = draft.pathSuffix.trim();
  }
  if (draft.targetPath.trim()) {
    mapping.targetPath = draft.targetPath.trim();
  }
  if (draft.initialMessage.trim()) {
    mapping.initialMessage = draft.initialMessage.trim();
  }
  if (draft.rowKey.trim()) {
    mapping.rowKey = draft.rowKey.trim();
  }

  return mapping;
}

function createBatchGovernanceDraft(
  seed?: Partial<BatchGovernanceInput | { maxParallelRuns: string; budgetLimit: string; retryLimit: string }>
): BatchGovernanceDraft {
  return {
    maxParallelRuns:
      typeof seed?.maxParallelRuns === "number"
        ? String(seed.maxParallelRuns)
        : seed?.maxParallelRuns?.trim() || "3",
    budgetLimit:
      typeof seed?.budgetLimit === "number"
        ? String(seed.budgetLimit)
        : seed?.budgetLimit?.trim() || "",
    retryLimit:
      typeof seed?.retryLimit === "number"
        ? String(seed.retryLimit)
        : seed?.retryLimit?.trim() || "0",
  };
}

function formatNumericRange(low: number, high: number, digits = 1) {
  return low === high ? low.toFixed(digits) : `${low.toFixed(digits)} - ${high.toFixed(digits)}`;
}

function formatUsdAmount(value: number | null | undefined) {
  return value == null ? "-" : `$${value.toFixed(2)}`;
}

function formatUsdRange(low: number, high: number) {
  return low === high ? formatUsdAmount(low) : `${formatUsdAmount(low)} - ${formatUsdAmount(high)}`;
}

function inferBatchImportFormat(fileName: string) {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".csv")) {
    return "csv" as const;
  }
  if (normalized.endsWith(".xlsx") || normalized.endsWith(".xlsm") || normalized.endsWith(".xls")) {
    return "xlsx" as const;
  }
  return undefined;
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read batch import file."));
        return;
      }

      const contentBase64 = reader.result.includes(",")
        ? reader.result.slice(reader.result.indexOf(",") + 1)
        : reader.result;
      if (!contentBase64) {
        reject(new Error("Batch import file was empty."));
        return;
      }

      resolve(contentBase64);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read batch import file."));
    };
    reader.readAsDataURL(file);
  });
}

function mapCatalogWorkshopToDashboardWorkshop(item: WorkshopCatalogEntry): Workshop {
  return {
    id: item.workshopId,
    cover: item.coverAssetUrl,
    title: item.displayName,
    badge: item.badge,
    audience: item.audience,
    summary: item.summary,
    route: `dashboard://workshops/${item.workshopId}`,
    next: item.nextStepSummary,
    tags: item.tagList,
    linkedService: item.defaultServiceId,
    linkedInstance: "",
  };
}

function mapCatalogServiceToDashboardService(item: ServiceCatalogEntry): DashboardService {
  return {
    id: item.serviceId,
    workshopId: item.workshopId,
    name: item.displayName,
    summary: item.summary,
    auth: item.authRequirementText,
    eta: item.estimatedDuration,
    targetPath: item.targetPathHint,
    linkedInstance: item.linkedInstanceHint ?? "",
  };
}

export function WorkshopsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workshopId, serviceId, batchJobId } = useParams();
  const lang = useDashboardUiStore((state) => state.lang);
  const [searchQuery, setSearchQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "enterprise" | "content" | "creative">(
    "all"
  );
  const [batchTitleDraft, setBatchTitleDraft] = useState("");
  const [batchGovernanceDraft, setBatchGovernanceDraft] = useState<BatchGovernanceDraft>(() =>
    createBatchGovernanceDraft()
  );
  const [batchImportFile, setBatchImportFile] = useState<File | null>(null);
  const [batchImportSheetName, setBatchImportSheetName] = useState("");
  const [batchImportMappingDraft, setBatchImportMappingDraft] = useState<BatchImportMappingDraft>(
    () => createBatchImportMappingDraft()
  );
  const [batchDraftRows, setBatchDraftRows] = useState<BatchDraftRow[]>([
    createBatchDraftRow({
      title: "Poster A",
      pathSuffix: "poster-a",
      contextText: "region: hk\nformat: portrait",
    }),
    createBatchDraftRow({
      title: "Poster B",
      pathSuffix: "poster-b",
      contextText: "region: sg\nformat: square",
    }),
  ]);
  const currentWorkspaceId = useDashboardUiStore((state) => state.currentWorkspaceId);
  const authMode = useDashboardAuthStore((state) => state.authMode);
  const authenticated = useDashboardAuthStore((state) => state.authenticated);
  const authWorkspaces = useDashboardAuthStore((state) => state.workspaces);
  const authCurrentWorkspace = useDashboardAuthStore((state) => state.currentWorkspace);
  const currentWorkspace = useMemo(
    () =>
      resolveDashboardWorkspaceView({
        selectionId: currentWorkspaceId,
        workspaces: authMode === "required" ? authWorkspaces : undefined,
        fallbackWorkspaceId: authCurrentWorkspace?.workspaceId,
      }),
    [authCurrentWorkspace?.workspaceId, authMode, authWorkspaces, currentWorkspaceId]
  );
  const favoritesEnabled = currentWorkspace.source === "auth";

  const workshopsQuery = useQuery({
    queryKey: [
      "dashboard",
      "catalog",
      "workshops",
      currentWorkspace.selectionId,
      currentWorkspace.id,
    ],
    queryFn: async () =>
      dashboardCatalogApi.listWorkshops({
        workspaceContextKey: currentWorkspace.id,
        entrySurface: "dashboard",
      }),
    retry: false,
    staleTime: 30_000,
  });
  const servicesQuery = useQuery({
    queryKey: [
      "dashboard",
      "catalog",
      "services",
      currentWorkspace.selectionId,
      currentWorkspace.id,
    ],
    queryFn: async () =>
      dashboardCatalogApi.listServices({
        workspaceContextKey: currentWorkspace.id,
        entrySurface: "dashboard",
      }),
    retry: false,
    staleTime: 30_000,
  });
  const runsQuery = useQuery({
    queryKey: ["dashboard", "runs", "workshops", currentWorkspace.selectionId, currentWorkspace.id],
    queryFn: async () => {
      try {
        return await dashboardRunsApi.listRuns();
      } catch {
        return [];
      }
    },
    retry: false,
    refetchInterval: 10_000,
  });
  const batchRunsQuery = useQuery({
    queryKey: [
      "dashboard",
      "batch-runs",
      currentWorkspace.selectionId,
      currentWorkspace.id,
      serviceId ?? null,
    ],
    queryFn: async () => {
      if (!serviceId) {
        return [];
      }

      try {
        return await dashboardBatchRunsApi.listBatchRuns({
          workspaceContextKey: currentWorkspace.id,
          serviceId,
        });
      } catch {
        return [];
      }
    },
    enabled: Boolean(serviceId),
    retry: false,
    refetchInterval: 10_000,
  });
  const batchDetailQuery = useQuery({
    queryKey: [
      "dashboard",
      "batch-run",
      currentWorkspace.selectionId,
      currentWorkspace.id,
      batchJobId ?? null,
    ],
    queryFn: async () => {
      if (!batchJobId) {
        return null;
      }

      return dashboardBatchRunsApi.getBatchRun(batchJobId);
    },
    enabled: Boolean(batchJobId),
    retry: false,
    refetchInterval: 10_000,
  });
  const batchItemsQuery = useQuery({
    queryKey: [
      "dashboard",
      "batch-run",
      "items",
      currentWorkspace.selectionId,
      currentWorkspace.id,
      batchJobId ?? null,
    ],
    queryFn: async () => {
      if (!batchJobId) {
        return null;
      }

      return dashboardBatchRunsApi.listBatchItems(batchJobId);
    },
    enabled: Boolean(batchJobId),
    retry: false,
    refetchInterval: 10_000,
  });
  const favoriteWorkshopsQuery = useQuery({
    queryKey: ["dashboard", "me", "favorites", currentWorkspace.selectionId, currentWorkspace.id],
    queryFn: async () => dashboardMeApi.listFavoriteWorkshops({ limit: 50 }),
    enabled: authMode === "required" && authenticated && favoritesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const recentActivitiesQuery = useQuery({
    queryKey: ["dashboard", "me", "recent", currentWorkspace.selectionId, currentWorkspace.id],
    queryFn: async () =>
      dashboardMeApi.listRecentActivities({
        limit: 3,
        types: ["run"],
      }),
    enabled: authMode === "required" && authenticated && favoritesEnabled,
    retry: false,
    staleTime: 15_000,
  });
  const catalogError = workshopsQuery.error ?? servicesQuery.error;
  const launchRunMutation = useMutation({
    mutationFn: async (targetServiceId: string) => {
      const template = await dashboardCatalogApi.createLaunchTemplate(targetServiceId, {
        workspaceContextKey: currentWorkspace.id,
        workspaceId:
          currentWorkspace.source === "auth"
            ? currentWorkspace.runtimeWorkspaceId
            : undefined,
        entrySurface: "dashboard",
      });
      return dashboardRunsApi.createRun(template.createRunInput);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "me", "recent"] }),
      ]);
    },
  });
  const createBatchRunMutation = useMutation({
    mutationFn: async (input: BatchRunDraftSubmission) =>
      dashboardBatchRunsApi.createBatchRun({
        workspaceContextKey: currentWorkspace.id,
        workspaceId:
          currentWorkspace.source === "auth"
            ? currentWorkspace.runtimeWorkspaceId
            : undefined,
        serviceId: input.targetServiceId,
        entrySurface: "dashboard",
        title: input.title,
        items: input.items,
        governance: input.governance,
      }),
    onSuccess: async (created, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "batch-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
      ]);
      navigate(dashboardRoutes.serviceBatch(variables.targetServiceId, created.job.batchJobId));
    },
  });
  const estimateBatchRunMutation = useMutation({
    mutationFn: async (input: BatchRunEstimateRequest) =>
      dashboardBatchRunsApi.estimateBatchRun({
        workspaceContextKey: currentWorkspace.id,
        workspaceId:
          currentWorkspace.source === "auth"
            ? currentWorkspace.runtimeWorkspaceId
            : undefined,
        serviceId: input.targetServiceId,
        entrySurface: "dashboard",
        items: input.items,
        governance: input.governance,
      }),
  });
  const validateBatchRunMutation = useMutation({
    mutationFn: async (targetBatchJobId: string) =>
      dashboardBatchRunsApi.validateBatchRun(targetBatchJobId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "batch-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "batch-run"] }),
      ]);
    },
  });
  const startBatchRunMutation = useMutation({
    mutationFn: async (targetBatchJobId: string) =>
      dashboardBatchRunsApi.startBatchRun(targetBatchJobId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "batch-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "batch-run"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
      ]);
    },
  });
  const retryBatchRunMutation = useMutation({
    mutationFn: async (targetBatchJobId: string) =>
      dashboardBatchRunsApi.retryBatchRun(targetBatchJobId, {
        onlyFailed: true,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "batch-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "batch-run"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
      ]);
    },
  });
  const cancelBatchRunMutation = useMutation({
    mutationFn: async (targetBatchJobId: string) =>
      dashboardBatchRunsApi.cancelBatchRun(targetBatchJobId, {
        reason: "dashboard operator cancelled remaining items",
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "batch-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "batch-run"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "runs"] }),
      ]);
    },
  });
  const importBatchRunFileMutation = useMutation({
    mutationFn: async (input: {
      file: File;
      mapping?: BatchRunImportFieldMapping;
      sheetName?: string;
    }) => {
      const { file, mapping, sheetName } = input;
      const contentBase64 = await readFileAsBase64(file);
      return dashboardBatchRunsApi.importBatchRunFile({
        workspaceContextKey: currentWorkspace.id,
        workspaceId:
          currentWorkspace.source === "auth"
            ? currentWorkspace.runtimeWorkspaceId
            : undefined,
        fileName: file.name,
        contentBase64,
        format: inferBatchImportFormat(file.name),
        sheetName: sheetName?.trim() || undefined,
        mapping: mapping ?? buildBatchImportMappingInput(batchImportMappingDraft),
      });
    },
    onSuccess: (imported) => {
      setBatchImportSheetName(imported.activeSheetName ?? "");
      setBatchImportMappingDraft(createBatchImportMappingDraft(imported.effectiveMapping));
      if (imported.items.length > 0) {
        setBatchDraftRows(imported.items.map(mapImportedBatchDraftRow));
      }
    },
  });
  const favoriteWorkshopMutation = useMutation({
    mutationFn: async (input: FavoriteWorkshopMutationInput) =>
      dashboardMeApi.setFavoriteWorkshop(input.workshopId, {
        favorited: input.favorited,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "me", "favorites"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "me", "summary"] }),
      ]);
    },
  });

  const visibleWorkshops = useMemo(
    () => (workshopsQuery.data ?? []).map(mapCatalogWorkshopToDashboardWorkshop),
    [workshopsQuery.data]
  );

  const visibleServices = useMemo(
    () => (servicesQuery.data ?? []).map(mapCatalogServiceToDashboardService),
    [servicesQuery.data]
  );

  const visibleInstances = useMemo(
    () =>
      runsQuery.isSuccess
        ? runsQuery.data
            .map((snapshot) => mapRunSnapshotToInstanceRecord(snapshot, undefined, currentWorkspace))
            .filter((item) => item.workspaceId === currentWorkspace.id)
        : [],
    [currentWorkspace, runsQuery.data, runsQuery.isSuccess]
  );

  const favoritedWorkshopIds = useMemo(
    () => new Set((favoriteWorkshopsQuery.data?.items ?? []).map((item) => item.workshopId)),
    [favoriteWorkshopsQuery.data]
  );
  const recentVisibleInstances = useMemo(() => {
    const recentRunIds =
      recentActivitiesQuery.data?.items
        .map((item) => item.runId)
        .filter((item): item is string => typeof item === "string" && item.length > 0) ?? [];

    if (recentRunIds.length === 0) {
      return visibleInstances.slice(0, 3);
    }

    const instanceById = new Map(visibleInstances.map((item) => [item.id, item] as const));
    const ordered = recentRunIds
      .map((runId) => instanceById.get(runId))
      .filter((item): item is (typeof visibleInstances)[number] => item != null);
    const seen = new Set(ordered.map((item) => item.id));

    return [...ordered, ...visibleInstances.filter((item) => !seen.has(item.id))].slice(0, 3);
  }, [recentActivitiesQuery.data, visibleInstances]);

  const filteredWorkshops = useMemo(() => {
    return visibleWorkshops.filter((item) => {
      const scopeMatched =
        scopeFilter === "all" ||
        (scopeFilter === "enterprise" && item.id === "enterprise-tax") ||
        (scopeFilter === "content" && item.id === "creator-drama") ||
        (scopeFilter === "creative" && item.id === "brand-poster-suite");

      if (!scopeMatched) {
        return false;
      }

      return matchesSearchQuery(searchQuery, [
        item.id,
        item.route,
        item.title.zh,
        item.title.en,
        item.badge.zh,
        item.badge.en,
        item.audience.zh,
        item.audience.en,
        item.summary.zh,
        item.summary.en,
        item.next.zh,
        item.next.en,
        ...item.tags,
      ]);
    });
  }, [scopeFilter, searchQuery, visibleWorkshops]);

  const filteredServices = useMemo(() => {
    return visibleServices.filter((item) =>
      matchesSearchQuery(searchQuery, [
        item.id,
        item.eta,
        item.targetPath,
        item.name.zh,
        item.name.en,
        item.summary.zh,
        item.summary.en,
        item.auth.zh,
        item.auth.en,
      ])
    );
  }, [searchQuery, visibleServices]);

  const selectedService = useMemo(
    () => visibleServices.find((item) => item.id === serviceId) ?? null,
    [serviceId, visibleServices]
  );

  const selectedWorkshop = useMemo(() => {
    if (workshopId) {
      return visibleWorkshops.find((item) => item.id === workshopId) ?? null;
    }

    if (selectedService) {
      return visibleWorkshops.find((item) => item.id === selectedService.workshopId) ?? null;
    }

    return null;
  }, [selectedService, visibleWorkshops, workshopId]);

  const focusService =
    selectedService ??
    (selectedWorkshop
      ? visibleServices.find((item) => item.id === selectedWorkshop.linkedService) ?? null
      : null);
  const selectedBatch = batchDetailQuery.data;
  const selectedBatchItems = batchItemsQuery.data?.items ?? [];
  const recentBatchRuns = batchRunsQuery.data ?? [];
  const importedBatchPreview = importBatchRunFileMutation.data;
  const batchImportDetectedColumns = useMemo(
    () => importedBatchPreview?.detectedColumns ?? [],
    [importedBatchPreview]
  );
  const batchImportMappedColumns = useMemo(
    () =>
      batchImportFieldKeys
        .map((fieldKey) => batchImportMappingDraft[fieldKey].trim())
        .filter((value): value is string => value.length > 0),
    [batchImportMappingDraft]
  );
  const batchImportIgnoredColumns = useMemo(
    () =>
      Array.from(
        new Set(
          batchImportMappingDraft.ignoreColumns.filter((column) =>
            batchImportDetectedColumns.includes(column)
          )
        )
      ),
    [batchImportDetectedColumns, batchImportMappingDraft.ignoreColumns]
  );
  const batchImportContextColumns = useMemo(() => {
    const reserved = new Set([...batchImportMappedColumns, ...batchImportIgnoredColumns]);
    return batchImportDetectedColumns.filter((column) => !reserved.has(column));
  }, [batchImportDetectedColumns, batchImportIgnoredColumns, batchImportMappedColumns]);
  const batchImportDuplicateColumns = useMemo(() => {
    const counts = new Map<string, number>();
    for (const column of batchImportMappedColumns) {
      counts.set(column, (counts.get(column) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([column]) => column);
  }, [batchImportMappedColumns]);
  const normalizedBatchDraftRows = useMemo(
    () =>
      batchDraftRows.map((row) => ({
        rowId: row.rowId,
        title: row.title.trim(),
        pathSuffix: row.pathSuffix.trim(),
        initialMessage: row.initialMessage.trim(),
        context: parseBatchContextText(row.contextText),
      })),
    [batchDraftRows]
  );
  const batchDraftItems = useMemo<BatchRunDraftItemInput[]>(
    () =>
      normalizedBatchDraftRows.map((row) => ({
        rowKey: null,
        title: row.title,
        targetPath: null,
        pathSuffix: row.pathSuffix || null,
        initialMessage: row.initialMessage || null,
        context: row.context,
      })),
    [normalizedBatchDraftRows]
  );
  const batchDraftValidationErrors = useMemo(() => {
    const errors: string[] = [];
    const missingTitleRows = normalizedBatchDraftRows
      .map((row, index) => (!row.title ? index + 1 : null))
      .filter((value): value is number => value != null);

    if (missingTitleRows.length > 0) {
      errors.push(
        t(lang, {
          zh: `请补齐第 ${missingTitleRows.join("、")} 行的标题后再估算或创建批次。`,
          en: `Add titles to row ${missingTitleRows.join(", ")} before estimating or creating the batch.`,
        })
      );
    }

    const pathSuffixCounts = new Map<string, number>();
    for (const row of normalizedBatchDraftRows) {
      if (!row.pathSuffix) {
        continue;
      }
      pathSuffixCounts.set(row.pathSuffix, (pathSuffixCounts.get(row.pathSuffix) ?? 0) + 1);
    }
    const duplicatedPathSuffixes = Array.from(pathSuffixCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([suffix]) => suffix);

    if (duplicatedPathSuffixes.length > 0) {
      errors.push(
        t(lang, {
          zh: `路径后缀必须唯一，当前重复项：${duplicatedPathSuffixes.join(", ")}。`,
          en: `Path suffixes must be unique. Duplicate values: ${duplicatedPathSuffixes.join(", ")}.`,
        })
      );
    }

    return errors;
  }, [lang, normalizedBatchDraftRows]);
  const batchGovernanceValidation = useMemo(() => {
    const errors: string[] = [];

    const maxParallelRaw = batchGovernanceDraft.maxParallelRuns.trim();
    const retryLimitRaw = batchGovernanceDraft.retryLimit.trim();
    const budgetLimitRaw = batchGovernanceDraft.budgetLimit.trim();

    let maxParallelRuns = Number.NaN;
    let retryLimit = Number.NaN;
    let budgetLimit: number | null = null;

    if (!maxParallelRaw) {
      errors.push(
        t(lang, {
          zh: "请填写并发上限。",
          en: "Set a max concurrency value.",
        })
      );
    } else {
      maxParallelRuns = Number(maxParallelRaw);
      if (!Number.isInteger(maxParallelRuns) || maxParallelRuns < 1 || maxParallelRuns > 50) {
        errors.push(
          t(lang, {
            zh: "并发上限必须是 1 到 50 之间的整数。",
            en: "Max concurrency must be an integer between 1 and 50.",
          })
        );
      }
    }

    if (!retryLimitRaw) {
      errors.push(
        t(lang, {
          zh: "请填写失败重试次数。",
          en: "Set a retry limit.",
        })
      );
    } else {
      retryLimit = Number(retryLimitRaw);
      if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 10) {
        errors.push(
          t(lang, {
            zh: "失败重试次数必须是 0 到 10 之间的整数。",
            en: "Retry limit must be an integer between 0 and 10.",
          })
        );
      }
    }

    if (budgetLimitRaw) {
      const parsedBudgetLimit = Number(budgetLimitRaw);
      if (!Number.isFinite(parsedBudgetLimit) || parsedBudgetLimit < 0) {
        errors.push(
          t(lang, {
            zh: "预算上限必须为空或大于等于 0。",
            en: "Budget limit must be blank or a non-negative number.",
          })
        );
      } else {
        budgetLimit = parsedBudgetLimit;
      }
    }

    return {
      governance:
        errors.length === 0
          ? {
              maxParallelRuns,
              budgetLimit,
              retryLimit,
            }
          : null,
      errors,
    };
  }, [batchGovernanceDraft.budgetLimit, batchGovernanceDraft.maxParallelRuns, batchGovernanceDraft.retryLimit, lang]);
  const batchLaunchValidationErrors = useMemo(
    () => [...batchDraftValidationErrors, ...batchGovernanceValidation.errors],
    [batchDraftValidationErrors, batchGovernanceValidation.errors]
  );
  const batchEstimatePayload = useMemo<BatchRunEstimateRequest | null>(() => {
    if (!selectedService || !batchGovernanceValidation.governance || batchLaunchValidationErrors.length > 0) {
      return null;
    }

    return {
      signature: JSON.stringify({
        workspaceId: currentWorkspace.runtimeWorkspaceId ?? null,
        workspaceContextKey: currentWorkspace.id,
        serviceId: selectedService.id,
        items: batchDraftItems,
        governance: batchGovernanceValidation.governance,
      }),
      targetServiceId: selectedService.id,
      items: batchDraftItems,
      governance: batchGovernanceValidation.governance,
      title: batchTitleDraft.trim() || undefined,
    };
  }, [
    batchDraftItems,
    batchGovernanceValidation.governance,
    batchLaunchValidationErrors.length,
    batchTitleDraft,
    currentWorkspace.id,
    currentWorkspace.runtimeWorkspaceId,
    selectedService,
  ]);
  const batchEstimateIsStale =
    estimateBatchRunMutation.data != null &&
    batchEstimatePayload != null &&
    estimateBatchRunMutation.variables?.signature !== batchEstimatePayload.signature;
  const canCreateBatchDraft =
    selectedService != null &&
    batchGovernanceValidation.governance != null &&
    batchLaunchValidationErrors.length === 0;
  const selectedWorkshopFavorited = selectedWorkshop
    ? favoritedWorkshopIds.has(selectedWorkshop.id)
    : false;
  const favoriteCountLabel = favoritesEnabled
    ? String(favoriteWorkshopsQuery.data?.totalCount ?? 0).padStart(2, "0")
    : "--";
  const favoriteMutationTargetId = favoriteWorkshopMutation.variables?.workshopId ?? null;

  useDashboardRecentRecorder(
    favoritesEnabled && selectedService
      ? {
          resourceType: "service",
          serviceId: selectedService.id,
          interaction: "open",
          sourceSurface: "dashboard",
        }
      : favoritesEnabled && selectedWorkshop
        ? {
            resourceType: "workshop",
            workshopId: selectedWorkshop.id,
            interaction: "open",
            sourceSurface: "dashboard",
          }
        : null,
    favoritesEnabled
  );

  const handleFavoriteToggle = async (targetWorkshopId: string, favorited: boolean) => {
    try {
      await favoriteWorkshopMutation.mutateAsync({
        workshopId: targetWorkshopId,
        favorited,
      });
    } catch {
      return;
    }
  };

  const renderFavoriteButton = (targetWorkshopId: string, favorited: boolean) => {
    const busy =
      favoriteWorkshopMutation.isPending && favoriteMutationTargetId === targetWorkshopId;

    return (
      <button
        aria-pressed={favorited}
        className={`route-btn favorite-action ${favorited ? "active" : ""}`}
        disabled={busy}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void handleFavoriteToggle(targetWorkshopId, !favorited);
        }}
      >
        <svg className="icon inline-icon">
          <use href="#i-heart" />
        </svg>
        {busy
          ? t(lang, { zh: "同步中", en: "Saving" })
          : favorited
            ? t(lang, { zh: "已收藏", en: "Favorited" })
            : t(lang, { zh: "收藏工坊", en: "Favorite workshop" })}
      </button>
    );
  };

  const batchImportFieldUsedByOtherMapping = (
    currentField: BatchImportFieldKey,
    column: string
  ) =>
    batchImportFieldKeys.some(
      (fieldKey) => fieldKey !== currentField && batchImportMappingDraft[fieldKey] === column
    );

  const setBatchImportField = (fieldKey: BatchImportFieldKey, value: string) => {
    setBatchImportMappingDraft((current) => ({
      ...current,
      ignoreColumns: current.ignoreColumns.filter((column) => column !== value),
      [fieldKey]: value,
    }));
  };

  const toggleBatchImportIgnoredColumn = (column: string) => {
    setBatchImportMappingDraft((current) => {
      const ignoreColumns = current.ignoreColumns.includes(column)
        ? current.ignoreColumns.filter((item) => item !== column)
        : [...current.ignoreColumns, column];
      const next: BatchImportMappingDraft = {
        ...current,
        ignoreColumns,
      };

      for (const fieldKey of batchImportFieldKeys) {
        if (next[fieldKey] === column) {
          next[fieldKey] = "";
        }
      }

      return next;
    });
  };

  const runBatchImport = async (
    overrides?: Partial<{
      mapping: BatchRunImportFieldMapping;
      sheetName: string;
    }>
  ) => {
    if (!batchImportFile) {
      return;
    }

    try {
      await importBatchRunFileMutation.mutateAsync({
        file: batchImportFile,
        mapping: overrides?.mapping,
        sheetName: overrides?.sheetName,
      });
    } catch {
      return;
    }
  };

  const updateBatchDraftRow = (
    rowId: string,
    key: keyof Omit<BatchDraftRow, "rowId">,
    value: string
  ) => {
    setBatchDraftRows((current) =>
      current.map((item) => (item.rowId === rowId ? { ...item, [key]: value } : item))
    );
  };
  const addBatchDraftRow = () => {
    setBatchDraftRows((current) => [...current, createBatchDraftRow()]);
  };
  const removeBatchDraftRow = (rowId: string) => {
    setBatchDraftRows((current) =>
      current.length <= 1 ? current : current.filter((item) => item.rowId !== rowId)
    );
  };

  return (
    <section className="view" data-testid="dashboard-workshops-page">
      <article className="hero-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t(lang, { zh: "工坊总览", en: "Workshop Overview" })}</div>
            <h2 className="hero-title">
              {t(lang, {
                zh: "先选工坊，再进入实例对话",
                en: "Choose a workshop first, then enter the live instance conversation",
              })}
            </h2>
          </div>
          <span className="pill active">dashboard://workshops</span>
        </div>
        <div className="section-note">
          {t(lang, {
            zh: "这一页承担工坊浏览、工坊详情和服务启动台三类动作。重型运行细节留给实例页，Creator 只处理包与治理。",
            en: "This surface handles workshop browse, workshop detail, and the service launchpad. Heavy runtime detail stays in instances while Creator stays focused on packages and governance.",
          })}
        </div>
        <div className="metric-grid">
          {[
            {
              label: { zh: "可见工坊", en: "Visible workshops" },
              value: String(visibleWorkshops.length).padStart(2, "0"),
              note: {
                zh: "当前空间能直接消费的工坊集合。",
                en: "The workshop set directly consumable inside the current workspace.",
              },
            },
            {
              label: { zh: "即开服务", en: "Runnable services" },
              value: String(visibleServices.length).padStart(2, "0"),
              note: {
                zh: "启动后直接进入实例对话。",
                en: "Launches lead directly into the instance conversation.",
              },
            },
            {
              label: { zh: "收藏工坊", en: "Favorite workshops" },
              value: favoriteCountLabel,
              note: favoritesEnabled
                ? {
                    zh: "已与正式账户收藏同步。",
                    en: "Synced with the formal account favorites.",
                  }
                : {
                    zh: "预览工作区不写入账户收藏。",
                    en: "Preview workspaces do not persist account favorites.",
                  },
            },
            {
              label: { zh: "当前工作区", en: "Current workspace" },
              value: t(lang, currentWorkspace.name),
              note: {
                zh: "切换工作区会同步收敛可见工坊、实例与 Creator 包。",
                en: "Switching workspaces simultaneously narrows visible workshops, instances, and creator packages.",
              },
            },
          ].map((item) => (
            <div className="metric-card" key={t(lang, item.label)}>
              <div className="metric-label">{t(lang, item.label)}</div>
              <div className="metric-value">{item.value}</div>
              <div className="tiny-note">{t(lang, item.note)}</div>
            </div>
          ))}
        </div>
      </article>

      <div className="page-grid">
        <article className="filter-card">
          <div className="section-head">
            <div>
              <div className="eyebrow">{t(lang, { zh: "筛选与搜索", en: "Filters and Search" })}</div>
              <h3 className="detail-title">{t(lang, { zh: "工坊浏览", en: "Workshop Browse" })}</h3>
            </div>
            <span className="pill">{t(lang, { zh: "轻量首页", en: "Light landing" })}</span>
          </div>
          <label className="fake-input">
            <svg
              className="icon"
              style={{
                display: "inline-block",
                verticalAlign: -4,
                width: 14,
                height: 14,
                marginRight: 6,
              }}
            >
              <use href="#i-search" />
            </svg>
            <input
              className="search-inline-input"
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t(lang, {
                zh: "搜索工坊名、行业标签或最近使用场景",
                en: "Search by workshop name, industry tag, or recent use case",
              })}
            />
          </label>
          <div className="pill-row">
            {[
              {
                key: "all" as const,
                label: { zh: "全部", en: "All" },
              },
              {
                key: "enterprise" as const,
                label: { zh: "企业", en: "Enterprise" },
              },
              {
                key: "content" as const,
                label: { zh: "内容", en: "Content" },
              },
              {
                key: "creative" as const,
                label: { zh: "创意", en: "Creative" },
              },
            ].map((chip) => (
              <button
                className={`path-chip ${scopeFilter === chip.key ? "active" : ""}`}
                key={chip.key}
                type="button"
                onClick={() => setScopeFilter(chip.key)}
              >
                {t(lang, chip.label)}
              </button>
            ))}
          </div>
          <div className="section-note">
            {t(lang, {
              zh: `当前命中 ${filteredWorkshops.length} 个工坊 / ${filteredServices.length} 个服务。工坊页只回答三件事：该选哪一类工坊、当前服务需要什么权限、启动后会把用户带到哪里。`,
              en: `Matched ${filteredWorkshops.length} workshops / ${filteredServices.length} services. The workshop page answers three questions: which workshop to choose, which permissions the service needs, and where the user lands after launch.`,
            })}
          </div>
          {catalogError ? (
            <div className="section-note">
              {t(lang, {
                zh: `工坊目录暂时不可用：${catalogError.message}`,
                en: `Catalog is temporarily unavailable: ${catalogError.message}`,
              })}
            </div>
          ) : null}
          {favoritesEnabled ? (
            <div className="pill-row">
              <span className="path-chip success">
                {t(lang, { zh: "收藏已接入正式账户", en: "Favorites use the formal account" })}
              </span>
              <span className="path-chip active">
                {t(lang, {
                  zh: `当前已收藏 ${favoriteWorkshopsQuery.data?.totalCount ?? 0} 个工坊`,
                  en: `${favoriteWorkshopsQuery.data?.totalCount ?? 0} workshops are favorited`,
                })}
              </span>
            </div>
          ) : (
            <div className="pill-row">
              <span className="path-chip">
                {t(lang, {
                  zh: "预览工作区不写入收藏",
                  en: "Preview workspaces do not persist favorites",
                })}
              </span>
            </div>
          )}
          {favoriteWorkshopsQuery.error instanceof Error ? (
            <div className="section-note">
              {t(lang, {
                zh: `收藏状态暂时不可用：${favoriteWorkshopsQuery.error.message}`,
                en: `Favorite status is temporarily unavailable: ${favoriteWorkshopsQuery.error.message}`,
              })}
            </div>
          ) : null}
          {favoriteWorkshopMutation.error instanceof Error ? (
            <div className="section-note">
              {t(lang, {
                zh: `收藏同步失败：${favoriteWorkshopMutation.error.message}`,
                en: `Favorite sync failed: ${favoriteWorkshopMutation.error.message}`,
              })}
            </div>
          ) : null}
          <div className="pill-row">
            <span className="path-chip active">{t(lang, currentWorkspace.name)}</span>
            <span className="path-chip">{currentWorkspace.root}</span>
          </div>
        </article>

        <article className="detail-card">
          <div className="section-head">
            <div>
              <div className="eyebrow">
                {selectedService
                  ? t(lang, { zh: "服务启动台", en: "Service Launchpad" })
                  : selectedWorkshop
                    ? t(lang, { zh: "工坊详情", en: "Workshop Detail" })
                    : t(lang, { zh: "最近实例", en: "Recent Instances" })}
              </div>
              <div className="detail-title">
                {selectedService
                  ? t(lang, selectedService.name)
                  : selectedWorkshop
                    ? t(lang, selectedWorkshop.title)
                    : t(lang, { zh: "继续上次工作", en: "Continue where you left off" })}
              </div>
            </div>
            <span className={`pill ${selectedService ? "active" : "success"}`}>
              {selectedService
                ? selectedService.eta
                : selectedWorkshop
                  ? t(lang, { zh: "工坊详情", en: "Workshop detail" })
                  : t(lang, { zh: "实例列表", en: "Instance list" })}
            </span>
          </div>

          {selectedService ? (
            <div className="detail-body">
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "服务说明", en: "Service Summary" })}</div>
                <div className="meta">{t(lang, selectedService.summary)}</div>
              </div>
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "授权要求", en: "Authorization" })}</div>
                <div className="meta">{t(lang, selectedService.auth)}</div>
              </div>
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "目标路径", en: "Target Path" })}</div>
                <div className="route-code">{selectedService.targetPath}</div>
              </div>
              {selectedWorkshop && favoritesEnabled ? (
                <div className="detail-item">
                  <div className="file-name">
                    {t(lang, { zh: "收藏状态", en: "Favorite status" })}
                  </div>
                  <div className="meta">
                    {selectedWorkshopFavorited
                      ? t(lang, {
                          zh: "该工坊已写入当前账户收藏。",
                          en: "This workshop is already saved to the current account favorites.",
                        })
                      : t(lang, {
                          zh: "该工坊尚未写入当前账户收藏。",
                          en: "This workshop is not yet saved to the current account favorites.",
                        })}
                  </div>
                </div>
              ) : null}
              <div className="pill-row">
                <span className="path-chip active">
                  {t(lang, {
                    zh: "启动后自动追问信息",
                    en: "Prompts for missing info after launch",
                  })}
                </span>
                <span className="path-chip">
                  {t(lang, {
                    zh: "任务会话继承当前工作区",
                    en: "The run inherits the current workspace",
                  })}
                </span>
              </div>
              <div className="task-row">
                {selectedWorkshop ? (
                  <button
                    className="route-btn"
                    type="button"
                    onClick={() => navigate(dashboardRoutes.workshop(selectedWorkshop.id))}
                  >
                    {t(lang, { zh: "查看工坊", en: "View workshop" })}
                  </button>
                ) : null}
                {selectedWorkshop && favoritesEnabled
                  ? renderFavoriteButton(selectedWorkshop.id, selectedWorkshopFavorited)
                  : null}
                <button
                  className="route-btn active"
                  data-testid="dashboard-launch-run-button"
                  type="button"
                  onClick={async () => {
                    try {
                      const created = await launchRunMutation.mutateAsync(selectedService.id);
                      navigate(dashboardRoutes.instance(created.run.runId));
                    } catch {
                      return;
                    }
                  }}
                >
                  {launchRunMutation.isPending
                    ? t(lang, { zh: "启动中", en: "Launching" })
                    : t(lang, { zh: "打开实例对话", en: "Open instance conversation" })}
                </button>
              </div>
              {launchRunMutation.error instanceof Error ? (
                <div className="section-note">{launchRunMutation.error.message}</div>
              ) : null}
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "批量启动台", en: "Batch Launchpad" })}</div>
                <div className="meta">
                  {t(lang, {
                    zh: "这里先整理批次草稿、导入 CSV / Excel、设置治理参数并刷新预算预估，再进入批次看板执行校验、启动、失败重试和取消剩余项。",
                    en: "Prepare the draft rows, import CSV / Excel, set governance, and refresh the budget estimate here before moving into the batch board for validation, launch, retry, and cancellation.",
                  })}
                </div>
              </div>
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "批次标题", en: "Batch title" })}</div>
                <label className="fake-input">
                  <input
                    className="search-inline-input"
                    type="text"
                    value={batchTitleDraft}
                    onChange={(event) => setBatchTitleDraft(event.target.value)}
                    placeholder={t(lang, {
                      zh: "例如：品牌海报 7 月首轮批次",
                      en: "For example: July poster wave 1",
                    })}
                  />
                </label>
              </div>
              <div className="detail-item">
                <div className="instance-head">
                  <div className="file-name">{t(lang, { zh: "导入批次文件", en: "Import batch file" })}</div>
                  <span className="pill">{t(lang, { zh: "CSV / XLSX", en: "CSV / XLSX" })}</span>
                </div>
                <div className="section-note">
                  {t(lang, {
                    zh: "使用首行作为表头。系统会自动识别 `title`、`path_suffix`、`target_path`、`initial_message`、`row_key`，其余列自动写入 context。",
                    en: "The first row is used as headers. The system auto-detects `title`, `path_suffix`, `target_path`, `initial_message`, and `row_key`, then lets you override mappings and ignored columns after the first parse.",
                  })}
                </div>
                <label className="fake-input" style={{ marginBottom: 10 }}>
                  <input
                    className="search-inline-input"
                    type="file"
                    accept=".csv,.xlsx,.xlsm,.xls"
                    onChange={(event) => {
                      importBatchRunFileMutation.reset();
                      setBatchImportFile(event.target.files?.[0] ?? null);
                      setBatchImportSheetName("");
                      setBatchImportMappingDraft(createBatchImportMappingDraft());
                    }}
                  />
                </label>
                <div className="meta">
                  {batchImportFile
                    ? t(lang, {
                        zh: `已选择 ${batchImportFile.name}`,
                        en: `Selected ${batchImportFile.name}`,
                      })
                    : t(lang, {
                        zh: "尚未选择文件",
                        en: "No file selected yet",
                      })}
                </div>
                <div className="task-row">
                  <button
                    className="route-btn active"
                    disabled={!batchImportFile || importBatchRunFileMutation.isPending}
                    type="button"
                    onClick={() => {
                      void runBatchImport();
                    }}
                  >
                    {importBatchRunFileMutation.isPending
                      ? t(lang, { zh: "导入中", en: "Importing" })
                      : t(lang, { zh: "导入为批次行", en: "Import as batch rows" })}
                  </button>
                </div>
                {importedBatchPreview ? (
                  <div className="section-note">
                    {t(lang, {
                      zh: `\u5bfc\u5165 ${importedBatchPreview.importedRowCount} \u884c\uff0c\u8df3\u8fc7 ${importedBatchPreview.skippedRowCount} \u884c\uff0c\u5f53\u524d\u5de5\u4f5c\u8868 ${importedBatchPreview.activeSheetName ?? "default"}\uff0c\u8bc6\u522b\u5217\uff1a${importedBatchPreview.detectedColumns.join(", ") || "none"}`,
                      en: `Imported ${importedBatchPreview.importedRowCount} rows, skipped ${importedBatchPreview.skippedRowCount}, active sheet ${importedBatchPreview.activeSheetName ?? "default"}, detected columns: ${importedBatchPreview.detectedColumns.join(", ") || "none"}`,
                    })}
                  </div>
                ) : null}
                {importedBatchPreview?.truncated ? (
                  <div className="section-note">
                    {t(lang, {
                      zh: "\u5f53\u524d\u53ea\u663e\u793a\u9884\u89c8\u884c\uff0c\u8d85\u51fa preview limit \u7684\u6570\u636e\u672a\u5199\u5165\u8349\u7a3f\uff0c\u8bf7\u5148\u786e\u8ba4\u6620\u5c04\u3002",
                      en: "The current preview is truncated. Review the field mapping before creating the batch draft.",
                    })}
                  </div>
                ) : null}
                {importedBatchPreview?.warnings.map((warning) => (
                  <div className="section-note" key={warning}>
                    {warning}
                  </div>
                ))}
                {importBatchRunFileMutation.error instanceof Error ? (
                  <div className="section-note">{importBatchRunFileMutation.error.message}</div>
                ) : null}
                {batchImportDetectedColumns.length > 0 ? (
                  <div className="detail-item">
                    <div className="instance-head">
                      <div className="file-name">{t(lang, { zh: "\u5b57\u6bb5\u6620\u5c04", en: "Field mapping" })}</div>
                      <span className="pill">
                        {String(batchImportDetectedColumns.length).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="section-note">
                      {t(lang, {
                        zh: "\u5b57\u6bb5\u7559\u7a7a\u65f6\u7ee7\u7eed\u4f7f\u7528\u81ea\u52a8\u8bc6\u522b\u3002\u70b9\u51fb\u4e0b\u65b9\u5217\u540d\u53ef\u4ee5\u5207\u6362\u8be5\u5217\u662f\u5426\u5199\u5165 context\u3002",
                        en: "Leave a field empty to keep auto-detection. Click the detected columns below to decide whether they stay in context.",
                      })}
                    </div>
                    {importedBatchPreview.sheetNames.length > 1 ? (
                      <label className="fake-input governance-field">
                        <span>{t(lang, { zh: "\u5de5\u4f5c\u8868", en: "Worksheet" })}</span>
                        <select
                          className="governance-select"
                          value={batchImportSheetName}
                          onChange={(event) => setBatchImportSheetName(event.target.value)}
                        >
                          {importedBatchPreview.sheetNames.map((sheetName) => (
                            <option key={sheetName} value={sheetName}>
                              {sheetName}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <div className="governance-form-grid">
                      {batchImportFieldKeys.map((fieldKey) => (
                        <label className="fake-input governance-field" key={fieldKey}>
                          <span>
                            {fieldKey === "title"
                              ? t(lang, { zh: "\u6807\u9898", en: "Title" })
                              : fieldKey === "pathSuffix"
                                ? t(lang, { zh: "\u8def\u5f84\u540e\u7f00", en: "Path suffix" })
                                : fieldKey === "targetPath"
                                  ? t(lang, { zh: "\u76ee\u6807\u8def\u5f84", en: "Target path" })
                                  : fieldKey === "initialMessage"
                                    ? t(lang, { zh: "\u9996\u6761\u6d88\u606f", en: "Initial message" })
                                    : t(lang, { zh: "\u884c\u952e", en: "Row key" })}
                          </span>
                          <select
                            className="governance-select"
                            value={batchImportMappingDraft[fieldKey]}
                            onChange={(event) => setBatchImportField(fieldKey, event.target.value)}
                          >
                            <option value="">
                              {t(lang, { zh: "\u81ea\u52a8\u8bc6\u522b", en: "Auto-detect" })}
                            </option>
                            {batchImportDetectedColumns.map((column) => (
                              <option
                                disabled={batchImportFieldUsedByOtherMapping(fieldKey, column)}
                                key={`${fieldKey}-${column}`}
                                value={column}
                              >
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <div className="pill-row">
                      {batchImportDetectedColumns.map((column) => {
                        const mapped = batchImportMappedColumns.includes(column);
                        const ignored = batchImportIgnoredColumns.includes(column);
                        const tone = ignored ? "warn" : mapped ? "active" : "success";
                        return (
                          <button
                            className={`path-chip ${tone}`}
                            key={column}
                            type="button"
                            onClick={() => toggleBatchImportIgnoredColumn(column)}
                          >
                            {column}
                          </button>
                        );
                      })}
                    </div>
                    <div className="meta">
                      {t(lang, {
                        zh: `context \u5217\uff1a${batchImportContextColumns.join(", ") || "none"} / \u5ffd\u7565\u5217\uff1a${batchImportIgnoredColumns.join(", ") || "none"}` ,
                        en: `Context columns: ${batchImportContextColumns.join(", ") || "none"} / Ignored columns: ${batchImportIgnoredColumns.join(", ") || "none"}` ,
                      })}
                    </div>
                    {batchImportDuplicateColumns.length > 0 ? (
                      <div className="section-note">
                        {t(lang, {
                          zh: `\u4ee5\u4e0b\u5217\u88ab\u91cd\u590d\u6620\u5c04\uff1a${batchImportDuplicateColumns.join(", ")}` ,
                          en: `These columns are mapped more than once: ${batchImportDuplicateColumns.join(", ")}` ,
                        })}
                      </div>
                    ) : null}
                    <div className="task-row">
                      <button
                        className="route-btn"
                        disabled={!batchImportFile || importBatchRunFileMutation.isPending}
                        type="button"
                        onClick={() => {
                          const resetDraft = createBatchImportMappingDraft();
                          const resetSheetName =
                            importedBatchPreview.activeSheetName ??
                            importedBatchPreview.sheetNames[0] ??
                            "";
                          setBatchImportMappingDraft(resetDraft);
                          setBatchImportSheetName(resetSheetName);
                          void runBatchImport({
                            mapping: buildBatchImportMappingInput(resetDraft),
                            sheetName: resetSheetName,
                          });
                        }}
                      >
                        {t(lang, { zh: "\u6062\u590d\u81ea\u52a8\u6620\u5c04", en: "Reset to auto-detect" })}
                      </button>
                      <button
                        className="route-btn active"
                        disabled={!batchImportFile || importBatchRunFileMutation.isPending}
                        type="button"
                        onClick={() => {
                          void runBatchImport({
                            mapping: buildBatchImportMappingInput(batchImportMappingDraft),
                            sheetName: batchImportSheetName,
                          });
                        }}
                      >
                        {importBatchRunFileMutation.isPending
                          ? t(lang, { zh: "\u91cd\u65b0\u89e3\u6790\u4e2d", en: "Refreshing" })
                          : t(lang, { zh: "\u5e94\u7528\u6620\u5c04\u5e76\u5237\u65b0", en: "Apply mapping and refresh" })}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="detail-item governance-card" data-testid="dashboard-batch-governance">
                <div className="instance-head">
                  <div className="file-name">{t(lang, { zh: "批次治理与预算预估", en: "Batch governance and estimate" })}</div>
                  <span className="pill active">
                    {batchEstimatePayload
                      ? t(lang, { zh: "可估算", en: "Estimable" })
                      : t(lang, { zh: "待补齐", en: "Needs input" })}
                  </span>
                </div>
                <div className="section-note">
                  {t(lang, {
                    zh: "这里直接调用正式 `/v1/batch-runs/estimate` 契约，用当前批次行、并发、预算和重试策略生成预算区间与墙钟时间预估。",
                    en: "This section calls the formal `/v1/batch-runs/estimate` contract with the current rows, concurrency, budget cap, and retry policy to calculate budget and wall-clock ranges.",
                  })}
                </div>
                <div className="governance-form-grid">
                  <label className="fake-input governance-field">
                    <span>{t(lang, { zh: "并发上限", en: "Max concurrency" })}</span>
                    <input
                      className="search-inline-input"
                      data-testid="dashboard-batch-max-parallel-runs"
                      inputMode="numeric"
                      min={1}
                      max={50}
                      step={1}
                      type="number"
                      value={batchGovernanceDraft.maxParallelRuns}
                      onChange={(event) =>
                        setBatchGovernanceDraft((current) => ({
                          ...current,
                          maxParallelRuns: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="fake-input governance-field">
                    <span>{t(lang, { zh: "失败重试次数", en: "Retry limit" })}</span>
                    <input
                      className="search-inline-input"
                      data-testid="dashboard-batch-retry-limit"
                      inputMode="numeric"
                      min={0}
                      max={10}
                      step={1}
                      type="number"
                      value={batchGovernanceDraft.retryLimit}
                      onChange={(event) =>
                        setBatchGovernanceDraft((current) => ({
                          ...current,
                          retryLimit: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="fake-input governance-field">
                    <span>{t(lang, { zh: "预算上限 (USD)", en: "Budget cap (USD)" })}</span>
                    <input
                      className="search-inline-input"
                      data-testid="dashboard-batch-budget-limit"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      type="number"
                      value={batchGovernanceDraft.budgetLimit}
                      onChange={(event) =>
                        setBatchGovernanceDraft((current) => ({
                          ...current,
                          budgetLimit: event.target.value,
                        }))
                      }
                      placeholder={t(lang, {
                        zh: "留空表示不设预算上限",
                        en: "Leave blank to keep the batch uncapped",
                      })}
                    />
                  </label>
                  <div className="detail-item">
                    <div className="file-name">{t(lang, { zh: "草稿摘要", en: "Draft summary" })}</div>
                    <div className="pill-row">
                      <span className="path-chip active">
                        {t(lang, {
                          zh: `批次行 ${batchDraftRows.length}`,
                          en: `Rows ${batchDraftRows.length}`,
                        })}
                      </span>
                      <span className="path-chip">
                        {t(lang, {
                          zh: `预算 ${batchGovernanceDraft.budgetLimit.trim() ? `$${batchGovernanceDraft.budgetLimit.trim()}` : "open"}`,
                          en: `Budget ${batchGovernanceDraft.budgetLimit.trim() ? `$${batchGovernanceDraft.budgetLimit.trim()}` : "open"}`,
                        })}
                      </span>
                    </div>
                    <div className="meta">
                      {t(lang, {
                        zh: "估算结果只反映当前草稿输入；修改任意行或治理参数后需要重新刷新。",
                        en: "Estimates reflect the current draft only. Refresh after any row or governance change.",
                      })}
                    </div>
                  </div>
                </div>
                {batchLaunchValidationErrors.map((message) => (
                  <div className="section-note" key={message}>
                    {message}
                  </div>
                ))}
                <div className="governance-form-actions">
                  <button
                    className="route-btn"
                    data-testid="dashboard-batch-estimate-refresh"
                    disabled={!batchEstimatePayload || estimateBatchRunMutation.isPending}
                    type="button"
                    onClick={async () => {
                      if (!batchEstimatePayload) {
                        return;
                      }

                      try {
                        await estimateBatchRunMutation.mutateAsync(batchEstimatePayload);
                      } catch {
                        return;
                      }
                    }}
                  >
                    {estimateBatchRunMutation.isPending
                      ? t(lang, { zh: "估算中", en: "Estimating" })
                      : t(lang, { zh: "刷新预算预估", en: "Refresh estimate" })}
                  </button>
                </div>
                {estimateBatchRunMutation.error instanceof Error ? (
                  <div className="section-note">{estimateBatchRunMutation.error.message}</div>
                ) : null}
                {estimateBatchRunMutation.data ? (
                  <div className="detail-item" data-testid="dashboard-batch-estimate-result">
                    <div className="instance-head">
                      <div className="file-name">{t(lang, { zh: "预估结果", en: "Estimate result" })}</div>
                      <span className={`pill ${estimateBatchRunMutation.data.withinBudget ? "active" : "warn"}`}>
                        {estimateBatchRunMutation.data.withinBudget
                          ? t(lang, { zh: "预算内", en: "Within budget" })
                          : t(lang, { zh: "超出预算", en: "Over budget" })}
                      </span>
                    </div>
                    {batchEstimateIsStale ? (
                      <div className="section-note">
                        {t(lang, {
                          zh: "当前输入已经变化，下面的预估结果需要重新刷新后才可作为最新参考。",
                          en: "The inputs have changed. Refresh the estimate before treating the numbers below as current.",
                        })}
                      </div>
                    ) : null}
                    <div className="metric-grid">
                      {[
                        {
                          label: t(lang, { zh: "总成本区间", en: "Total cost range" }),
                          value: formatUsdRange(
                            estimateBatchRunMutation.data.estimatedTotalAmountUsdLow,
                            estimateBatchRunMutation.data.estimatedTotalAmountUsdHigh
                          ),
                          note: t(lang, { zh: "按当前草稿批次估算", en: "Calculated from the current draft" }),
                        },
                        {
                          label: t(lang, { zh: "墙钟时间", en: "Wall-clock time" }),
                          value: `${formatNumericRange(
                            estimateBatchRunMutation.data.estimatedWallClockMinutesLow,
                            estimateBatchRunMutation.data.estimatedWallClockMinutesHigh
                          )} min`,
                          note: t(lang, { zh: "已考虑并发上限", en: "Includes the current concurrency cap" }),
                        },
                        {
                          label: t(lang, { zh: "单行时长", en: "Per-row runtime" }),
                          value: `${formatNumericRange(
                            estimateBatchRunMutation.data.estimatedMinutesPerItemLow,
                            estimateBatchRunMutation.data.estimatedMinutesPerItemHigh
                          )} min`,
                          note: t(lang, { zh: "用于估算运行主链耗时", en: "Used for runtime-chain cost projection" }),
                        },
                        {
                          label: t(lang, { zh: "剩余预算", en: "Budget remaining" }),
                          value:
                            estimateBatchRunMutation.data.budgetLimit == null
                              ? t(lang, { zh: "未设上限", en: "Uncapped" })
                              : formatUsdRange(
                                  estimateBatchRunMutation.data.budgetRemainingUsdLow ?? 0,
                                  estimateBatchRunMutation.data.budgetRemainingUsdHigh ?? 0
                                ),
                          note: t(lang, { zh: "高区间先用于阻断判断", en: "The high range is used for budget gating" }),
                        },
                      ].map((item) => (
                        <div className="metric-card" key={item.label}>
                          <div className="metric-label">{item.label}</div>
                          <div className="metric-value">{item.value}</div>
                          <div className="tiny-note">{item.note}</div>
                        </div>
                      ))}
                    </div>
                    {estimateBatchRunMutation.data.metrics.length > 0 ? (
                      <div className="detail-item">
                        <div className="file-name">{t(lang, { zh: "计费指标拆分", en: "Cost metric breakdown" })}</div>
                        {estimateBatchRunMutation.data.metrics.map((metric) => (
                          <div className="detail-item" key={metric.metric}>
                            <div className="instance-head">
                              <div className="file-name">{t(lang, metric.label)}</div>
                              <span className="pill active">{metric.metric}</span>
                            </div>
                            <div className="meta">
                              {t(lang, {
                                zh: `数量 ${formatNumericRange(metric.quantityLow, metric.quantityHigh, 2)} / 单价 ${formatUsdAmount(metric.unitPriceUsd)} / 金额 ${formatUsdRange(metric.amountUsdLow, metric.amountUsdHigh)}`,
                                en: `Quantity ${formatNumericRange(metric.quantityLow, metric.quantityHigh, 2)} / Unit price ${formatUsdAmount(metric.unitPriceUsd)} / Amount ${formatUsdRange(metric.amountUsdLow, metric.amountUsdHigh)}`,
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {estimateBatchRunMutation.data.warnings.map((warning) => (
                      <div className="section-note" key={warning}>
                        {warning}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="detail-item">
                <div className="instance-head">
                  <div className="file-name">{t(lang, { zh: "批次行编辑", en: "Batch row editor" })}</div>
                  <span className="pill">{String(batchDraftRows.length).padStart(2, "0")}</span>
                </div>
                <div className="section-note">
                  {t(lang, {
                    zh: "每一行会创建一个独立实例。路径后缀拼到服务 target root 下；上下文字段使用 `key: value` 每行一项。",
                    en: "Each row creates an independent instance. Path suffixes append under the service target root, and context fields use one `key: value` line each.",
                  })}
                </div>
                {batchDraftRows.map((row, index) => (
                  <div className="detail-item" key={row.rowId}>
                    <div className="instance-head">
                      <div className="file-name">
                        {t(lang, {
                          zh: `第 ${String(index + 1).padStart(2, "0")} 行`,
                          en: `Row ${String(index + 1).padStart(2, "0")}`,
                        })}
                      </div>
                      <button
                        className="route-btn"
                        disabled={batchDraftRows.length <= 1}
                        type="button"
                        onClick={() => removeBatchDraftRow(row.rowId)}
                      >
                        {t(lang, { zh: "删除", en: "Remove" })}
                      </button>
                    </div>
                    <label className="fake-input" style={{ marginBottom: 10 }}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={row.title}
                        onChange={(event) => updateBatchDraftRow(row.rowId, "title", event.target.value)}
                        placeholder={t(lang, {
                          zh: "实例标题，例如：Poster A",
                          en: "Run title, for example Poster A",
                        })}
                      />
                    </label>
                    <label className="fake-input" style={{ marginBottom: 10 }}>
                      <input
                        className="search-inline-input"
                        type="text"
                        value={row.pathSuffix}
                        onChange={(event) =>
                          updateBatchDraftRow(row.rowId, "pathSuffix", event.target.value)
                        }
                        placeholder={t(lang, {
                          zh: "路径后缀，例如：poster-a",
                          en: "Path suffix, for example poster-a",
                        })}
                      />
                    </label>
                    <label className="fake-input" style={{ marginBottom: 10 }}>
                      <textarea
                        style={{
                          width: "100%",
                          minHeight: 72,
                          border: "none",
                          background: "transparent",
                          color: "inherit",
                          resize: "vertical",
                          outline: "none",
                          font: "inherit",
                        }}
                        value={row.contextText}
                        onChange={(event) =>
                          updateBatchDraftRow(row.rowId, "contextText", event.target.value)
                        }
                        placeholder={t(lang, {
                          zh: "context 示例：region: hk",
                          en: "Context example: region: hk",
                        })}
                      />
                    </label>
                    <label className="fake-input">
                      <input
                        className="search-inline-input"
                        type="text"
                        value={row.initialMessage}
                        onChange={(event) =>
                          updateBatchDraftRow(row.rowId, "initialMessage", event.target.value)
                        }
                        placeholder={t(lang, {
                          zh: "可选：首条补充消息",
                          en: "Optional: first follow-up message",
                        })}
                      />
                    </label>
                  </div>
                ))}
                <div className="task-row">
                  <button className="route-btn" type="button" onClick={addBatchDraftRow}>
                    {t(lang, { zh: "新增一行", en: "Add row" })}
                  </button>
                  <button
                    className="route-btn active"
                    data-testid="dashboard-batch-create-draft"
                    disabled={!canCreateBatchDraft || createBatchRunMutation.isPending}
                    type="button"
                    onClick={async () => {
                      if (!selectedService || !batchGovernanceValidation.governance) {
                        return;
                      }

                      try {
                        await createBatchRunMutation.mutateAsync({
                          targetServiceId: selectedService.id,
                          title: batchTitleDraft.trim() || undefined,
                          items: batchDraftItems,
                          governance: batchGovernanceValidation.governance,
                        });
                      } catch {
                        return;
                      }
                    }}
                  >
                    {createBatchRunMutation.isPending
                      ? t(lang, { zh: "创建中", en: "Creating" })
                      : t(lang, { zh: "创建批次草稿", en: "Create batch draft" })}
                  </button>
                </div>
                {createBatchRunMutation.error instanceof Error ? (
                  <div className="section-note">{createBatchRunMutation.error.message}</div>
                ) : null}
              </div>
              <div className="detail-item">
                <div className="instance-head">
                  <div className="file-name">{t(lang, { zh: "最近批次", en: "Recent batches" })}</div>
                  <span className="pill">
                    {String(recentBatchRuns.length).padStart(2, "0")}
                  </span>
                </div>
                {recentBatchRuns.length === 0 ? (
                  <div className="section-note">
                    {t(lang, {
                      zh: "当前服务还没有批次记录。",
                      en: "This service does not have any batch jobs yet.",
                    })}
                  </div>
                ) : (
                  recentBatchRuns.slice(0, 3).map((item) => (
                    <div className="detail-item" key={item.job.batchJobId}>
                      <div className="instance-head">
                        <div className="file-name">{item.job.title}</div>
                        <span className="pill active">{item.job.status}</span>
                      </div>
                      <div className="meta">
                        {t(lang, {
                          zh: `成功 ${item.summary.succeededCount} / 失败 ${item.summary.failedCount} / 运行中 ${item.summary.runningCount + item.summary.startingCount + item.summary.queuedCount}`,
                          en: `Succeeded ${item.summary.succeededCount} / Failed ${item.summary.failedCount} / Active ${item.summary.runningCount + item.summary.startingCount + item.summary.queuedCount}`,
                        })}
                      </div>
                      <div className="task-row">
                        <button
                          className="route-btn active"
                          data-testid={`dashboard-batch-open-board-${item.job.batchJobId}`}
                          type="button"
                          onClick={() =>
                            navigate(dashboardRoutes.serviceBatch(selectedService.id, item.job.batchJobId))
                          }
                        >
                          {t(lang, { zh: "打开批次看板", en: "Open batch board" })}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {selectedBatch ? (
                <div className="detail-item" data-testid="dashboard-batch-board">
                  <div className="instance-head">
                    <div className="file-name">{t(lang, { zh: "当前批次看板", en: "Current batch board" })}</div>
                    <span className="pill active" data-testid="dashboard-batch-board-status">
                      {selectedBatch.job.status}
                    </span>
                  </div>
                  <div className="pill-row">
                    <span className="path-chip active">
                      {t(lang, {
                        zh: `总数 ${selectedBatch.summary.totalCount}`,
                        en: `Total ${selectedBatch.summary.totalCount}`,
                      })}
                    </span>
                    <span className="path-chip">
                      {t(lang, {
                        zh: `成功 ${selectedBatch.summary.succeededCount}`,
                        en: `Succeeded ${selectedBatch.summary.succeededCount}`,
                      })}
                    </span>
                    <span className="path-chip">
                      {t(lang, {
                        zh: `失败 ${selectedBatch.summary.failedCount}`,
                        en: `Failed ${selectedBatch.summary.failedCount}`,
                      })}
                    </span>
                    <span className="path-chip">
                      {t(lang, {
                        zh: `待审批 ${selectedBatch.summary.waitingApprovalCount}`,
                        en: `Approval ${selectedBatch.summary.waitingApprovalCount}`,
                      })}
                    </span>
                  </div>
                  <div className="meta">
                    {t(lang, {
                      zh: `并发 ${selectedBatch.job.maxParallelRuns} / 预算 ${selectedBatch.job.budgetLimit ?? "none"} / 重试 ${selectedBatch.job.retryLimit}`,
                      en: `Concurrency ${selectedBatch.job.maxParallelRuns} / Budget ${selectedBatch.job.budgetLimit ?? "none"} / Retry ${selectedBatch.job.retryLimit}`,
                    })}
                  </div>
                  <div className="task-row">
                    <button
                      className="route-btn"
                      data-testid="dashboard-batch-validate"
                      disabled={validateBatchRunMutation.isPending}
                      type="button"
                      onClick={async () => {
                        try {
                          await validateBatchRunMutation.mutateAsync(selectedBatch.job.batchJobId);
                        } catch {
                          return;
                        }
                      }}
                    >
                      {validateBatchRunMutation.isPending
                        ? t(lang, { zh: "校验中", en: "Validating" })
                        : t(lang, { zh: "校验批次", en: "Validate batch" })}
                    </button>
                    <button
                      className="route-btn active"
                      data-testid="dashboard-batch-start"
                      disabled={startBatchRunMutation.isPending}
                      type="button"
                      onClick={async () => {
                        try {
                          await startBatchRunMutation.mutateAsync(selectedBatch.job.batchJobId);
                        } catch {
                          return;
                        }
                      }}
                    >
                      {startBatchRunMutation.isPending
                        ? t(lang, { zh: "启动中", en: "Starting" })
                        : t(lang, { zh: "启动剩余项", en: "Start pending items" })}
                    </button>
                    <button
                      className="route-btn"
                      data-testid="dashboard-batch-retry"
                      disabled={retryBatchRunMutation.isPending}
                      type="button"
                      onClick={async () => {
                        try {
                          await retryBatchRunMutation.mutateAsync(selectedBatch.job.batchJobId);
                        } catch {
                          return;
                        }
                      }}
                    >
                      {retryBatchRunMutation.isPending
                        ? t(lang, { zh: "重跑中", en: "Retrying" })
                        : t(lang, { zh: "重跑失败项", en: "Retry failed items" })}
                    </button>
                    <button
                      className="route-btn"
                      data-testid="dashboard-batch-cancel"
                      disabled={cancelBatchRunMutation.isPending}
                      type="button"
                      onClick={async () => {
                        try {
                          await cancelBatchRunMutation.mutateAsync(selectedBatch.job.batchJobId);
                        } catch {
                          return;
                        }
                      }}
                    >
                      {cancelBatchRunMutation.isPending
                        ? t(lang, { zh: "取消中", en: "Cancelling" })
                        : t(lang, { zh: "取消剩余项", en: "Cancel pending items" })}
                    </button>
                    <button
                      className="route-btn"
                      data-testid="dashboard-batch-back-to-launchpad"
                      type="button"
                      onClick={() => navigate(dashboardRoutes.service(selectedService.id))}
                    >
                      {t(lang, { zh: "返回启动台", en: "Back to launchpad" })}
                    </button>
                  </div>
                  {validateBatchRunMutation.error instanceof Error ? (
                    <div className="section-note">{validateBatchRunMutation.error.message}</div>
                  ) : null}
                  {startBatchRunMutation.error instanceof Error ? (
                    <div className="section-note">{startBatchRunMutation.error.message}</div>
                  ) : null}
                  {retryBatchRunMutation.error instanceof Error ? (
                    <div className="section-note">{retryBatchRunMutation.error.message}</div>
                  ) : null}
                  {cancelBatchRunMutation.error instanceof Error ? (
                    <div className="section-note">{cancelBatchRunMutation.error.message}</div>
                  ) : null}
                  {selectedBatchItems.map((item) => (
                    <div
                      className="detail-item"
                      data-testid={`dashboard-batch-item-${item.batchItemId}`}
                      key={item.batchItemId}
                    >
                      <div className="instance-head">
                        <div className="file-name">{item.title}</div>
                        <span className="pill" data-testid={`dashboard-batch-item-status-${item.batchItemId}`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="route-code">{item.targetPath}</div>
                      <div className="meta">
                        {item.runId
                          ? t(lang, {
                              zh: `关联实例 ${item.runId} / 运行状态 ${item.runStatus ?? "n/a"}`,
                              en: `Linked run ${item.runId} / runtime status ${item.runStatus ?? "n/a"}`,
                            })
                          : t(lang, {
                              zh: `尚未创建实例 / 已尝试 ${item.attemptCount} 次`,
                              en: `Run not created yet / attempted ${item.attemptCount} times`,
                            })}
                      </div>
                      {item.errorMessage ? (
                        <div className="section-note">{item.errorMessage}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : selectedWorkshop && focusService ? (
            <div className="detail-body">
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "用户对象", en: "Audience" })}</div>
                <div className="meta">{t(lang, selectedWorkshop.audience)}</div>
              </div>
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "工坊摘要", en: "Workshop Summary" })}</div>
                <div className="meta">{t(lang, selectedWorkshop.summary)}</div>
              </div>
              <div className="detail-item">
                <div className="file-name">{t(lang, { zh: "默认服务", en: "Default Service" })}</div>
                <div className="meta">{t(lang, focusService.name)}</div>
              </div>
              {favoritesEnabled ? (
                <div className="detail-item">
                  <div className="file-name">
                    {t(lang, { zh: "收藏状态", en: "Favorite status" })}
                  </div>
                  <div className="meta">
                    {selectedWorkshopFavorited
                      ? t(lang, {
                          zh: "当前账户已收藏该工坊，可从账户面板直接返回。",
                          en: "The current account already favorited this workshop and can jump back from the account panel.",
                        })
                      : t(lang, {
                          zh: "你可以先收藏该工坊，后续从账户面板快速返回。",
                          en: "Favorite this workshop now to reopen it quickly from the account panel later.",
                        })}
                  </div>
                </div>
              ) : null}
              <div className="pill-row">
                {selectedWorkshop.tags.map((tag) => (
                  <span className="path-chip" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <div className="task-row">
                <button
                  className="route-btn"
                  type="button"
                  onClick={() => navigate(dashboardRoutes.instances)}
                >
                  {t(lang, { zh: "查看实例列表", en: "Open instances" })}
                </button>
                {favoritesEnabled
                  ? renderFavoriteButton(selectedWorkshop.id, selectedWorkshopFavorited)
                  : null}
                <button
                  className="route-btn active"
                  type="button"
                  onClick={() => navigate(dashboardRoutes.service(focusService.id))}
                >
                  {t(lang, { zh: "进入服务启动台", en: "Open service launchpad" })}
                </button>
              </div>
            </div>
          ) : (
            <div className="detail-body">
              {recentVisibleInstances.map((item) => (
                <div className="detail-item" key={item.id}>
                  <div className="instance-head">
                    <div className="list-title">{t(lang, item.title)}</div>
                    <span className={`pill ${item.statusClass}`}>{t(lang, item.status)}</span>
                  </div>
                  <div className="list-route">{item.route}</div>
                  <div className="meta">{t(lang, item.summary)}</div>
                </div>
              ))}
              <div className="task-row">
                <button
                  className="route-btn active"
                  type="button"
                  onClick={() => navigate(dashboardRoutes.instances)}
                >
                  {t(lang, { zh: "进入实例页", en: "Open instances" })}
                </button>
              </div>
            </div>
          )}
        </article>
      </div>

      <div className="workshop-grid">
        {filteredWorkshops.length === 0 ? (
          <article className="workshop-card">
            <div className="detail-item">
              <div className="file-name">{t(lang, { zh: "没有匹配结果", en: "No matches" })}</div>
              <div className="meta">
                {t(lang, {
                  zh: "请调整搜索词或切换工坊分类。当前工作区不展示跨工作区结果。",
                  en: "Adjust the query or switch the workshop scope. Results never spill across workspaces.",
                })}
              </div>
            </div>
          </article>
        ) : null}
        {filteredWorkshops.map((item) => {
          const service = visibleServices.find((entry) => entry.id === item.linkedService);
          const itemFavorited = favoritedWorkshopIds.has(item.id);

          return (
            <article className="workshop-card" key={item.id}>
              <img className="cover" src={item.cover} alt={t(lang, item.title)} />
              <div className="pill-row">
                <span className="pill active">{t(lang, item.badge)}</span>
                <span className="pill">{t(lang, { zh: "可实例化", en: "Runnable" })}</span>
                {itemFavorited ? (
                  <span className="pill active">
                    <svg className="icon inline-icon">
                      <use href="#i-heart" />
                    </svg>
                    {t(lang, { zh: "已收藏", en: "Favorited" })}
                  </span>
                ) : null}
              </div>
              <h3 className="workshop-title">{t(lang, item.title)}</h3>
              <div className="meta">{t(lang, item.audience)}</div>
              <div className="section-note">{t(lang, item.summary)}</div>
              <div className="pill-row">
                {item.tags.map((tag) => (
                  <span className="path-chip" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <div className="section-note">{t(lang, item.next)}</div>
              <div className="task-row">
                <button
                  className="route-btn"
                  type="button"
                  onClick={() => navigate(dashboardRoutes.workshop(item.id))}
                >
                  {t(lang, { zh: "查看工坊", en: "View workshop" })}
                </button>
                {favoritesEnabled ? renderFavoriteButton(item.id, itemFavorited) : null}
                {service ? (
                  <button
                    className="route-btn active"
                    type="button"
                    onClick={() => navigate(dashboardRoutes.service(service.id))}
                  >
                    {t(lang, { zh: "服务启动台", en: "Launchpad" })}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <details className="tech-details">
        <summary>{t(lang, { zh: "查看技术详情", en: "Show technical details" })}</summary>
        <div className="tech-body">
          <div className="tech-note">
            {t(lang, {
              zh: "技术路径、工作区边界与跨端入口保留在折叠区，方便 creator 和重度用户查看。",
              en: "Technical routes, workspace boundaries, and cross-surface entry points live in this collapsed area for creators and power users.",
            })}
          </div>
          <div className="tech-grid">
            <div className="tech-box">
              <h4>{t(lang, { zh: "当前工作区根路径", en: "Current workspace roots" })}</h4>
              <div className="route-code">{currentWorkspace.root}</div>
              <div className="route-code">{`${currentWorkspace.root}output/`}</div>
              <div className="route-code">{`${currentWorkspace.root}archive/`}</div>
            </div>
            <div className="tech-box">
              <h4>{t(lang, { zh: "跨端入口", en: "Cross-surface entries" })}</h4>
              <div className="route-code">h5://workshop/list</div>
              <div className="route-code">mini://workshop/home</div>
              <div className="route-code">dashboard://instances/&lt;task-id&gt;</div>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}
