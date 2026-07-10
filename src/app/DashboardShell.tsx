import type {
  CreatorPackageSummary,
  NotificationRecord,
  SearchResultRecord,
  ServiceCatalogEntry,
  WorkshopCatalogEntry,
} from "@lingban/contracts";
import { matchesSearchQuery } from "@lingban/domain-models";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { DashboardAuthScreen } from "../components/DashboardAuthScreen";
import { IconSprite } from "../components/IconSprite";
import {
  creatorPackages,
  dashboardAssets,
  dashboardServices,
  instances,
  workshops,
} from "../data/dashboardData";
import {
  dashboardAuthApi,
  dashboardCatalogApi,
  dashboardCreatorApi,
  dashboardMeApi,
  dashboardNotificationsApi,
  dashboardRunsApi,
  dashboardSearchApi,
} from "../lib/api";
import { dashboardI18n, setDashboardLanguage, t } from "../lib/i18n";
import { mapRunSnapshotToInstanceRecord } from "../lib/liveRunAdapters";
import { dashboardRoutes } from "../lib/routes";
import { applyDashboardTheme } from "../lib/theme";
import {
  listDashboardWorkspaceViews,
  resolveDashboardWorkspaceView,
} from "../lib/workspaceContext";
import { resolveCreatorAccessState } from "../lib/accessControl";
import { useDashboardAuthStore } from "../stores/dashboardAuthStore";
import { useDashboardUiStore } from "../stores/dashboardUiStore";

type ShellWorkshopRecord = {
  id: string;
  title: WorkshopCatalogEntry["displayName"];
  summary: WorkshopCatalogEntry["summary"];
  route: string;
};

type ShellServiceRecord = {
  id: string;
  name: ServiceCatalogEntry["displayName"];
  auth: ServiceCatalogEntry["authRequirementText"];
  route: string;
};

type ShellPackageRecord = {
  id: string;
  title: CreatorPackageSummary["title"];
  source: CreatorPackageSummary["source"];
  status: CreatorPackageSummary["statusLabel"];
  statusClass: CreatorPackageSummary["tone"];
  route: string;
};

type ShellNotificationItem = {
  id: string;
  notificationId?: string;
  tone: "active" | "warn" | "success" | "danger";
  title: string;
  note: string;
  route: string;
  unread?: boolean;
};

type ShellSearchItem = {
  id: string;
  type: string;
  title: string;
  note: string;
  route: string;
};

function normalizePackageTone(
  value: string
): CreatorPackageSummary["tone"] {
  if (value === "success" || value === "warn" || value === "active") {
    return value;
  }

  return "active";
}

function mapStaticWorkshopRecord(item: (typeof workshops)[number]): ShellWorkshopRecord {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    route: dashboardRoutes.workshop(item.id),
  };
}

function mapCatalogWorkshopRecord(item: WorkshopCatalogEntry): ShellWorkshopRecord {
  return {
    id: item.workshopId,
    title: item.displayName,
    summary: item.summary,
    route: dashboardRoutes.workshop(item.workshopId),
  };
}

function mapStaticServiceRecord(item: (typeof dashboardServices)[number]): ShellServiceRecord {
  return {
    id: item.id,
    name: item.name,
    auth: item.auth,
    route: dashboardRoutes.service(item.id),
  };
}

function mapCatalogServiceRecord(item: ServiceCatalogEntry): ShellServiceRecord {
  return {
    id: item.serviceId,
    name: item.displayName,
    auth: item.authRequirementText,
    route: dashboardRoutes.service(item.serviceId),
  };
}

function mapStaticPackageRecord(item: (typeof creatorPackages)[string]): ShellPackageRecord {
  return {
    id: item.id,
    title: item.title,
    source: item.source,
    status: item.status,
    statusClass: normalizePackageTone(item.statusClass),
    route: dashboardRoutes.creatorPackage(item.id),
  };
}

function mapCreatorPackageRecord(item: CreatorPackageSummary): ShellPackageRecord {
  return {
    id: item.packageId,
    title: item.title,
    source: item.source,
    status: item.statusLabel,
    statusClass: item.tone,
    route: dashboardRoutes.creatorPackage(item.packageId),
  };
}

function buildDashboardNoticeRoute(notice: NotificationRecord) {
  if (notice.target.resource !== "run") {
    return dashboardRoutes.workshops;
  }

  switch (notice.target.view) {
    case "audit":
      return dashboardRoutes.instance(notice.target.runId, "audit");
    case "files":
      return dashboardRoutes.instance(notice.target.runId, "files");
    default:
      return dashboardRoutes.instance(notice.target.runId);
  }
}

function buildDashboardFavoriteRoute(workshopId: string) {
  return dashboardRoutes.workshop(workshopId);
}

function buildDashboardSearchRoute(target: SearchResultRecord["target"]) {
  switch (target.resource) {
    case "workshop":
      return dashboardRoutes.workshop(target.workshopId);
    case "service":
      return dashboardRoutes.service(target.serviceId);
    case "run":
      return dashboardRoutes.instance(
        target.runId,
        target.view === "files" ? "files" : undefined
      );
    case "package":
      return dashboardRoutes.creatorPackage(target.packageId);
  }
}

function buildDashboardSearchTypeLabel(
  resourceType: SearchResultRecord["resourceType"],
  lang: "zh" | "en"
) {
  switch (resourceType) {
    case "workshop":
      return t(lang, { zh: "宸ュ潑", en: "Workshop" });
    case "service":
      return t(lang, { zh: "鏈嶅姟", en: "Service" });
    case "run":
      return t(lang, { zh: "瀹炰緥", en: "Instance" });
    case "package":
      return t(lang, { zh: "Package", en: "Package" });
  }
}

function mapSearchResultToShellItem(
  item: SearchResultRecord,
  lang: "zh" | "en"
): ShellSearchItem {
  return {
    id: item.documentId,
    type: buildDashboardSearchTypeLabel(item.resourceType, lang),
    title: t(lang, item.title),
    note: t(lang, item.summary),
    route: buildDashboardSearchRoute(item.target),
  };
}

function mapNotificationToDashboardItem(
  notice: NotificationRecord,
  lang: "zh" | "en"
): ShellNotificationItem {
  return {
    id: notice.notificationId,
    notificationId: notice.notificationId,
    tone: notice.tone,
    title: t(lang, notice.title),
    note: t(lang, notice.summary),
    route: buildDashboardNoticeRoute(notice),
    unread: !notice.isRead,
  };
}

export function DashboardShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useDashboardUiStore((state) => state.theme);
  const lang = useDashboardUiStore((state) => state.lang);
  const currentWorkspaceId = useDashboardUiStore((state) => state.currentWorkspaceId);
  const sidebarOpen = useDashboardUiStore((state) => state.sidebarOpen);
  const activeInstanceId = useDashboardUiStore((state) => state.activeInstanceId);
  const activePackageId = useDashboardUiStore((state) => state.activePackageId);
  const setLang = useDashboardUiStore((state) => state.setLang);
  const setCurrentWorkspaceId = useDashboardUiStore((state) => state.setCurrentWorkspaceId);
  const toggleTheme = useDashboardUiStore((state) => state.toggleTheme);
  const toggleSidebar = useDashboardUiStore((state) => state.toggleSidebar);
  const setSidebarOpen = useDashboardUiStore((state) => state.setSidebarOpen);
  const authMode = useDashboardAuthStore((state) => state.authMode);
  const authenticated = useDashboardAuthStore((state) => state.authenticated);
  const bootstrapping = useDashboardAuthStore((state) => state.bootstrapping);
  const user = useDashboardAuthStore((state) => state.user);
  const authCurrentWorkspace = useDashboardAuthStore((state) => state.currentWorkspace);
  const authWorkspaces = useDashboardAuthStore((state) => state.workspaces);
  const tokens = useDashboardAuthStore((state) => state.tokens);
  const applySessionResponse = useDashboardAuthStore(
    (state) => state.applySessionResponse
  );
  const clearAuth = useDashboardAuthStore((state) => state.clearAuth);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const deferredGlobalSearchQuery = useDeferredValue(globalSearchQuery);

  const workspaceOptions = useMemo(
    () =>
      listDashboardWorkspaceViews(
        authMode === "required" ? authWorkspaces : undefined
      ),
    [authMode, authWorkspaces]
  );
  const currentWorkspace = useMemo(
    () =>
      resolveDashboardWorkspaceView({
        selectionId: currentWorkspaceId,
        workspaces: authMode === "required" ? authWorkspaces : undefined,
        fallbackWorkspaceId: authCurrentWorkspace?.workspaceId,
      }),
    [authCurrentWorkspace?.workspaceId, authMode, authWorkspaces, currentWorkspaceId]
  );
  const creatorAccess = useMemo(
    () =>
      resolveCreatorAccessState({
        authMode,
        authenticated,
        workspace: currentWorkspace,
      }),
    [authMode, authenticated, currentWorkspace]
  );
  const dataQueriesEnabled = authMode !== "required" || authenticated;
  const previewMode = authMode !== "required";
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
    enabled: dataQueriesEnabled,
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
    enabled: dataQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const runsQuery = useQuery({
    queryKey: [
      "dashboard",
      "runs",
      "shell",
      currentWorkspace.selectionId,
      currentWorkspace.id,
    ],
    queryFn: async () => dashboardRunsApi.listRuns(),
    enabled: dataQueriesEnabled,
    retry: false,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
  const packagesQuery = useQuery({
    queryKey: [
      "dashboard",
      "creator",
      "packages",
      currentWorkspace.selectionId,
      currentWorkspace.id,
    ],
    queryFn: async () =>
      dashboardCreatorApi.listPackages({
        workspaceContextKey: currentWorkspace.id,
      }),
    enabled: dataQueriesEnabled && creatorAccess.canAccessCreator,
    retry: false,
    staleTime: 30_000,
  });
  const workspaceSummaryQuery = useQuery({
    queryKey: [
      "dashboard",
      "workspaces",
      "summary",
      currentWorkspace.selectionId,
      currentWorkspace.runtimeWorkspaceId,
    ],
    queryFn: async () =>
      dashboardAuthApi.getWorkspaceSummary(currentWorkspace.runtimeWorkspaceId),
    enabled: authMode === "required" && authenticated,
    retry: false,
    staleTime: 30_000,
  });
  const meSummaryQuery = useQuery({
    queryKey: [
      "dashboard",
      "me",
      "summary",
      currentWorkspace.selectionId,
      currentWorkspace.id,
    ],
    queryFn: async () => dashboardMeApi.getSummary(),
    enabled: authMode === "required" && authenticated,
    retry: false,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const favoriteWorkshopsQuery = useQuery({
    queryKey: [
      "dashboard",
      "me",
      "favorites",
      currentWorkspace.selectionId,
      currentWorkspace.id,
    ],
    queryFn: async () =>
      dashboardMeApi.listFavoriteWorkshops({
        limit: 4,
      }),
    enabled: authMode === "required" && authenticated,
    retry: false,
    staleTime: 15_000,
  });
  const notificationsQuery = useQuery({
    queryKey: [
      "dashboard",
      "notifications",
      currentWorkspace.selectionId,
      currentWorkspace.id,
    ],
    queryFn: async () =>
      dashboardNotificationsApi.listNotifications({
        limit: 6,
      }),
    enabled: authMode === "required" && authenticated,
    retry: false,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const trimmedGlobalSearchQuery = globalSearchQuery.trim();
  const deferredTrimmedGlobalSearchQuery = deferredGlobalSearchQuery.trim();
  const searchResultsQuery = useQuery({
    queryKey: [
      "dashboard",
      "search",
      currentWorkspace.selectionId,
      currentWorkspace.id,
      deferredTrimmedGlobalSearchQuery,
    ],
    queryFn: async () =>
      dashboardSearchApi.listSearchResults({
        q: deferredTrimmedGlobalSearchQuery,
        limit: 8,
        entrySurface: "dashboard",
      }),
    enabled:
      authMode === "required" &&
      authenticated &&
      deferredTrimmedGlobalSearchQuery.length > 0,
    retry: false,
    staleTime: 10_000,
  });
  const searchHistoryQuery = useQuery({
    queryKey: [
      "dashboard",
      "search",
      "history",
      currentWorkspace.selectionId,
      currentWorkspace.id,
    ],
    queryFn: async () =>
      dashboardSearchApi.listSearchHistory({
        limit: 6,
      }),
    enabled: authMode === "required" && authenticated,
    retry: false,
    staleTime: 15_000,
  });
  const recordSearchClickMutation = useMutation({
    mutationFn: async (input: { query: string; documentId: string }) =>
      dashboardSearchApi.recordSearchClick({
        query: input.query,
        documentId: input.documentId,
        entrySurface: "dashboard",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "search"],
      });
    },
  });
  const notificationSummaryQuery = useQuery({
    queryKey: [
      "dashboard",
      "notifications",
      "summary",
      currentWorkspace.selectionId,
      currentWorkspace.id,
    ],
    queryFn: async () => dashboardNotificationsApi.getNotificationSummary(),
    enabled: authMode === "required" && authenticated,
    retry: false,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const markNotificationReadMutation = useMutation({
    mutationFn: async (notificationId: string) =>
      dashboardNotificationsApi.markNotificationRead(notificationId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "notifications"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "notifications", "summary"],
        }),
      ]);
    },
  });
  const markAllNotificationsReadMutation = useMutation({
    mutationFn: async () => dashboardNotificationsApi.markAllNotificationsRead(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "notifications"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "notifications", "summary"],
        }),
      ]);
    },
  });

  const switchWorkspaceMutation = useMutation({
    mutationFn: async (workspaceId: string) => {
      if (authMode !== "required" || !authenticated) {
        setCurrentWorkspaceId(workspaceId);
        return null;
      }

      return dashboardAuthApi.switchWorkspace({
        workspaceId,
      });
    },
    onSuccess: async (response, workspaceId) => {
      if (response) {
        applySessionResponse(response);
        setCurrentWorkspaceId(response.currentWorkspace.workspaceId);
      } else {
        setCurrentWorkspaceId(workspaceId);
      }

      await queryClient.removeQueries({
        queryKey: ["dashboard"],
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      if (authMode !== "required") {
        return;
      }

      await dashboardAuthApi.logout({
        refreshToken: tokens?.refreshToken,
      });
    },
    onSettled: async () => {
      clearAuth();
      await queryClient.removeQueries({
        queryKey: ["dashboard"],
      });
      navigate(dashboardRoutes.workshops, { replace: true });
    },
  });

  const visibleWorkshops = useMemo(
    () =>
      workshopsQuery.isSuccess
        ? workshopsQuery.data.map(mapCatalogWorkshopRecord)
        : currentWorkspace.source === "auth"
          ? []
          : workshops
              .filter((item) => currentWorkspace.workshopIds.includes(item.id))
              .map(mapStaticWorkshopRecord),
    [currentWorkspace, workshopsQuery.data, workshopsQuery.isSuccess]
  );

  const visibleServices = useMemo(
    () =>
      servicesQuery.isSuccess
        ? servicesQuery.data.map(mapCatalogServiceRecord)
        : currentWorkspace.source === "auth"
          ? []
          : dashboardServices
              .filter((item) => currentWorkspace.workshopIds.includes(item.workshopId))
              .map(mapStaticServiceRecord),
    [currentWorkspace, servicesQuery.data, servicesQuery.isSuccess]
  );

  const visibleInstances = useMemo(
    () =>
      runsQuery.isSuccess
        ? runsQuery.data
            .map((snapshot) => mapRunSnapshotToInstanceRecord(snapshot, undefined, currentWorkspace))
            .filter((item) => item.workspaceId === currentWorkspace.id)
        : currentWorkspace.source === "auth"
          ? []
          : Object.values(instances).filter((item) => item.workspaceId === currentWorkspace.id),
    [currentWorkspace, runsQuery.data, runsQuery.isSuccess]
  );

  const visiblePackages = useMemo(
    () =>
      !creatorAccess.canAccessCreator
        ? []
        : previewMode
          ? Object.values(creatorPackages)
              .filter((item) => currentWorkspace.packageIds.includes(item.id))
              .map(mapStaticPackageRecord)
          : (packagesQuery.data ?? []).map(mapCreatorPackageRecord),
    [creatorAccess.canAccessCreator, currentWorkspace, packagesQuery.data, previewMode]
  );

  const view = useMemo<"workshops" | "instances" | "creator">(() => {
    if (location.pathname.includes("/instances")) {
      return "instances";
    }
    if (location.pathname.includes("/creator")) {
      return "creator";
    }
    return "workshops";
  }, [location.pathname]);

  const workspaceStats = useMemo(() => {
    const metrics = workspaceSummaryQuery.data?.metrics;

    return {
      workshops: metrics?.visibleWorkshopsCount ?? visibleWorkshops.length,
      instances: metrics?.visibleRunsCount ?? visibleInstances.length,
      packages: creatorAccess.canAccessCreator
        ? metrics?.visiblePackagesCount ?? visiblePackages.length
        : 0,
    };
  }, [
    creatorAccess.canAccessCreator,
    visibleInstances.length,
    visiblePackages.length,
    visibleWorkshops.length,
    workspaceSummaryQuery.data?.metrics,
  ]);

  const viewMeta = {
    workshops: {
      label: "dashboard://workshops",
      title: t(lang, { zh: "工坊", en: "Workshops" }),
      desc: t(lang, {
        zh: "用于选择工作流、筛选工坊、快速实例化任务。首页只保留浏览和启动所需信息，技术路由与结构说明进入折叠详情。",
        en: "Used to choose workflows, filter workshops, and instantiate tasks quickly. The landing page keeps only browsing and launch-critical information while technical routes move into collapsed detail.",
      }),
    },
    instances: {
      label: `dashboard://instances/${activeInstanceId}`,
      title: t(lang, { zh: "实例", en: "Instances" }),
      desc: t(lang, {
        zh: "多任务列表在左，当前实例的完整对话在中，文件、运行、审计等深层信息进入右侧子页签。",
        en: "The task list stays on the left, the full conversation for the active instance stays in the center, and files, runtime, and audit move into right-side subtabs.",
      }),
    },
    creator: {
      label: `dashboard://creator/${activePackageId}`,
      title: t(lang, { zh: "Creator", en: "Creator" }),
      desc: t(lang, {
        zh: "Creator 页聚焦 package、runtime、connectors 与发布审核。重型工程信息进入子页签，首屏只保留选择和判断所需内容。",
        en: "The Creator page focuses on packages, runtime, connectors, and release reviews. Heavy engineering detail lives inside subtabs while the first screen keeps only selection and decision-critical content.",
      }),
    },
  }[view];

  const creatorAccessHint = creatorAccess.canAccessCreator
    ? null
    : creatorAccess.reason === "membership-suspended"
      ? t(lang, {
          zh: "当前工作区成员资格已暂停，Creator 包与治理入口已锁定。",
          en: "Workspace membership is suspended, so Creator packages and governance are locked.",
        })
      : t(lang, {
          zh: "当前工作区角色没有 Creator 访问权限。",
          en: "The current workspace role does not include Creator access.",
        });

  const fallbackSearchResults = useMemo<ShellSearchItem[]>(() => {
    if (!trimmedGlobalSearchQuery) {
      return [];
    }

    return [
      ...visibleWorkshops.map((item) => ({
        id: `workshop:${item.id}`,
        type: t(lang, { zh: "工坊", en: "Workshop" }),
        title: t(lang, item.title),
        note: t(lang, item.summary),
        route: item.route,
      })),
      ...visibleServices.map((item) => ({
        id: `service:${item.id}`,
        type: t(lang, { zh: "服务", en: "Service" }),
        title: t(lang, item.name),
        note: t(lang, item.auth),
        route: item.route,
      })),
      ...visibleInstances.map((item) => ({
        id: `instance:${item.id}`,
        type: t(lang, { zh: "实例", en: "Instance" }),
        title: t(lang, item.title),
        note: t(lang, item.nextAction),
        route: dashboardRoutes.instance(item.id),
      })),
      ...(creatorAccess.canAccessCreator
        ? visiblePackages.map((item) => ({
            id: `package:${item.id}`,
            type: t(lang, { zh: "Package", en: "Package" }),
            title: t(lang, item.title),
            note: t(lang, item.source),
            route: item.route,
          }))
        : []),
    ]
      .filter((item) =>
        matchesSearchQuery(trimmedGlobalSearchQuery, [
          item.id,
          item.type,
          item.title,
          item.note,
          item.route,
        ])
      )
      .slice(0, 8);
  }, [
    creatorAccess.canAccessCreator,
    lang,
    trimmedGlobalSearchQuery,
    visibleInstances,
    visiblePackages,
    visibleServices,
    visibleWorkshops,
  ]);
  const remoteSearchResults = useMemo(
    () => (searchResultsQuery.data?.items ?? []).map((item) => mapSearchResultToShellItem(item, lang)),
    [lang, searchResultsQuery.data?.items]
  );
  const shouldUseRemoteSearchResults =
    authMode === "required" &&
    authenticated &&
    !previewMode &&
    trimmedGlobalSearchQuery.length > 0 &&
    trimmedGlobalSearchQuery === deferredTrimmedGlobalSearchQuery &&
    searchResultsQuery.isSuccess;
  const searchResults = shouldUseRemoteSearchResults
    ? remoteSearchResults
    : fallbackSearchResults;
  const searchHistoryItems = searchHistoryQuery.data?.items ?? [];
  const searchResultsPending =
    authMode === "required" &&
    authenticated &&
    !previewMode &&
    trimmedGlobalSearchQuery.length > 0 &&
    (trimmedGlobalSearchQuery !== deferredTrimmedGlobalSearchQuery ||
      searchResultsQuery.isLoading ||
      searchResultsQuery.isFetching);

  const fallbackNotificationItems = useMemo<ShellNotificationItem[]>(() => {
    const next = [
      ...visibleInstances
        .filter((item) => item.statusClass === "warn")
        .map((item) => ({
          id: `approval:${item.id}`,
          tone: "warn" as const,
          title: t(lang, { zh: "待审批实例", en: "Approval pending" }),
          note: `${t(lang, item.title)} / ${t(lang, item.nextAction)}`,
          route: dashboardRoutes.instance(item.id, "audit"),
        })),
      ...visibleInstances
        .filter((item) => item.statusClass === "active")
        .slice(0, 2)
        .map((item) => ({
          id: `instance:${item.id}`,
          tone: "active" as const,
          title: t(lang, { zh: "运行中实例", en: "Active instance" }),
          note: `${t(lang, item.title)} / ${t(lang, item.summary)}`,
          route: dashboardRoutes.instance(item.id),
        })),
      ...visiblePackages
        .filter((item) => item.statusClass !== "success")
        .map((item) => ({
          id: `package:${item.id}`,
          tone: item.statusClass,
          title:
            item.statusClass === "warn"
              ? t(lang, { zh: "待发布 package", en: "Pending package" })
              : t(lang, { zh: "可发布 package", en: "Release-ready package" }),
          note: `${t(lang, item.title)} / ${t(lang, item.status)}`,
          route: dashboardRoutes.creatorPackage(item.id),
        })),
    ];

    return next.slice(0, 6);
  }, [lang, visibleInstances, visiblePackages]);

  const packageNotificationItems = useMemo<ShellNotificationItem[]>(
    () =>
      visiblePackages
        .filter((item) => item.statusClass !== "success")
        .map((item) => ({
          id: `package:${item.id}`,
          tone: item.statusClass,
          title:
            item.statusClass === "warn"
              ? t(lang, { zh: "待发布 package", en: "Pending package" })
              : t(lang, { zh: "可发布 package", en: "Release-ready package" }),
          note: `${t(lang, item.title)} / ${t(lang, item.status)}`,
          route: dashboardRoutes.creatorPackage(item.id),
          unread: true,
        })),
    [lang, visiblePackages]
  );

  const notificationItems = useMemo(() => {
    if (notificationsQuery.isSuccess) {
      return [
        ...notificationsQuery.data.map((notice) => mapNotificationToDashboardItem(notice, lang)),
        ...packageNotificationItems,
      ].slice(0, 6);
    }

    return fallbackNotificationItems;
  }, [
    fallbackNotificationItems,
    lang,
    notificationsQuery.data,
    notificationsQuery.isSuccess,
    packageNotificationItems,
  ]);

  const notificationCount = notificationsQuery.isSuccess
    ? (notificationSummaryQuery.data?.unreadCount ??
        notificationsQuery.data.filter((item) => !item.isRead).length) +
      packageNotificationItems.length
    : notificationItems.length;

  const accountSummaryCards = useMemo(() => {
    if (!meSummaryQuery.data) {
      return [];
    }

    const metrics = meSummaryQuery.data.profileMetrics;
    return [
      {
        id: "favorite-workshops",
        label: t(lang, { zh: "收藏工坊", en: "Favorite workshops" }),
        value: String(metrics.favoriteWorkshopsCount),
      },
      {
        id: "total-assets",
        label: t(lang, { zh: "资产总数", en: "Total assets" }),
        value: String(metrics.totalAssetsCount),
      },
      {
        id: "receipt-assets",
        label: t(lang, { zh: "回执资产", en: "Receipt assets" }),
        value: String(metrics.receiptAssetsCount),
      },
      {
        id: "pending-actions",
        label: t(lang, { zh: "待处理", en: "Pending actions" }),
        value: String(metrics.pendingActionsCount),
      },
    ];
  }, [lang, meSummaryQuery.data]);

  const accountFavoriteItems = favoriteWorkshopsQuery.data?.items ?? [];

  function handleSearchItemOpen(item: ShellSearchItem) {
    if (shouldUseRemoteSearchResults && trimmedGlobalSearchQuery.length > 0) {
      recordSearchClickMutation
        .mutateAsync({
          query: trimmedGlobalSearchQuery,
          documentId: item.id,
        })
        .catch(() => undefined);
    }

    navigate(item.route);
    setSearchPanelOpen(false);
  }

  const accountActions = [
    ...(user
      ? [
          {
            id: "account-user",
            label: t(lang, { zh: "当前账户", en: "Current user" }),
            value: `${user.displayName} / ${user.email}`,
          },
        ]
      : []),
    {
      id: "workspace-root",
      label: t(lang, { zh: "工作区根路径", en: "Workspace root" }),
      value: currentWorkspace.root,
    },
    {
      id: "workspace-scope",
      label: t(lang, { zh: "当前空间身份", en: "Current workspace role" }),
      value: t(lang, currentWorkspace.meta),
    },
  ];

  useEffect(() => {
    setDashboardLanguage(lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = dashboardI18n.t("dashboard.title");
    document.body.dataset.theme = theme;
    document.body.dataset.sidebar = sidebarOpen ? "open" : "closed";
    applyDashboardTheme(theme);
  }, [lang, theme, sidebarOpen]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 960) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarOpen]);

  useEffect(() => {
    setSearchPanelOpen(false);
    setNoticeOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  if (bootstrapping || authMode === "unknown") {
    return (
      <>
        <IconSprite />
        <div className="auth-shell">
          <div className="auth-panel auth-panel-compact">
            <div className="auth-brand">
              <div className="logo auth-logo">
                <img src={dashboardAssets.logo} alt="灵办词元 logo" />
              </div>
              <div>
                <div className="eyebrow">
                  {t(lang, { zh: "正在恢复会话", en: "Restoring session" })}
                </div>
                <h1 className="auth-title">
                  {t(lang, {
                    zh: "正在检查当前工作区与令牌状态",
                    en: "Checking workspace and token state",
                  })}
                </h1>
                <p className="auth-copy">
                  {t(lang, {
                    zh: "如果存在有效会话，控制台会直接恢复到上次工作区。",
                    en: "If a valid session exists, the dashboard restores the previous workspace automatically.",
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (authMode !== "disabled" && !authenticated) {
    return (
      <>
        <IconSprite />
        <DashboardAuthScreen />
      </>
    );
  }

  return (
    <>
      <IconSprite />
      <div className="shell">
        <aside className="rail">
          <button
            className={`rail-btn drawer-toggle ${sidebarOpen ? "active" : ""}`}
            type="button"
            onClick={toggleSidebar}
          >
            <svg className="icon">
              <use href="#i-panel-left" />
            </svg>
          </button>
          <div className="rail-nav">
            <button
              className={`rail-btn ${view === "workshops" ? "active" : ""}`}
              type="button"
              onClick={() => navigate(dashboardRoutes.workshops)}
            >
              <svg className="icon">
                <use href="#i-home" />
              </svg>
            </button>
            <button
              className={`rail-btn ${view === "instances" ? "active" : ""}`}
              type="button"
              onClick={() => navigate(dashboardRoutes.instances)}
            >
              <svg className="icon">
                <use href="#i-terminal" />
              </svg>
            </button>
            <button
              className={`rail-btn ${view === "creator" ? "active" : ""}`}
              type="button"
              onClick={() => navigate(dashboardRoutes.creator)}
            >
              <svg className="icon">
                <use href="#i-spark" />
              </svg>
            </button>
          </div>
        </aside>

        <aside className="sidebar">
          <div className="sidebar-header">
            <button
              className={`sidebar-close ${sidebarOpen ? "active" : ""}`}
              type="button"
              onClick={toggleSidebar}
            >
              <svg className="icon">
                <use href="#i-panel-left" />
              </svg>
            </button>
          </div>
          <div className="brand">
            <div className="brand-row">
              <div className="logo">
                <img src={dashboardAssets.logo} alt="灵办词元 logo" />
              </div>
              <div>
                <div className="brand-sub">
                  {t(lang, { zh: "多语言控制台", en: "Multilingual Console" })}
                </div>
                <div className="brand-title">
                  {t(lang, {
                    zh: "灵办词元 / Operator Dashboard",
                    en: "Lingban Ciyuan / Operator Dashboard",
                  })}
                </div>
              </div>
            </div>
            <div className="muted">
              {t(lang, { zh: "当前工作区根路径：", en: "Current workspace root: " })}
              {currentWorkspace.root}
            </div>
          </div>

          <nav className="nav">
            <NavLink
              className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`}
              to={dashboardRoutes.workshops}
            >
              <svg className="icon">
                <use href="#i-home" />
              </svg>
              <span className="nav-text">{t(lang, { zh: "工坊", en: "Workshops" })}</span>
            </NavLink>
            <NavLink
              className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`}
              to={dashboardRoutes.instances}
            >
              <svg className="icon">
                <use href="#i-terminal" />
              </svg>
              <span className="nav-text">{t(lang, { zh: "实例", en: "Instances" })}</span>
            </NavLink>
            {creatorAccess.canAccessCreator ? (
              <NavLink
                className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`}
                to={dashboardRoutes.creator}
              >
                <svg className="icon">
                  <use href="#i-spark" />
                </svg>
                <span className="nav-text">{t(lang, { zh: "Creator", en: "Creator" })}</span>
              </NavLink>
            ) : (
              <button
                className="nav-btn"
                type="button"
                disabled
                title={creatorAccessHint ?? undefined}
              >
                <svg className="icon">
                  <use href="#i-spark" />
                </svg>
                <span className="nav-text">{t(lang, { zh: "Creator", en: "Creator" })}</span>
              </button>
            )}
          </nav>

          <div className="sidebar-foot">
            <div className="mini-card">
              <div className="eyebrow">
                {t(lang, { zh: "工作区切换", en: "Workspace Switch" })}
              </div>
              <div className="pill-row">
                {workspaceOptions.map((item) => (
                  <button
                    className={`path-chip ${
                      item.selectionId === currentWorkspace.selectionId ? "active" : ""
                    }`}
                    key={item.selectionId}
                    type="button"
                    disabled={switchWorkspaceMutation.isPending}
                    onClick={() => switchWorkspaceMutation.mutate(item.selectionId)}
                  >
                    {t(lang, item.name)}
                  </button>
                ))}
              </div>
              <div className="muted">
                {t(lang, currentWorkspace.meta)}
                {t(lang, {
                  zh: "。工作区用于切换根路径、成员权限和可见工坊。",
                  en: ". The workspace controls the root path, member scope, and visible workshops.",
                })}
              </div>
            </div>
            <div className="mini-card">
              <div className="eyebrow">{t(lang, { zh: "当前重点", en: "Current Focus" })}</div>
              <div className="mono" style={{ fontWeight: 700 }}>
                {view === "workshops"
                  ? t(lang, { zh: "先选工坊", en: "Pick a workshop" })
                  : view === "instances"
                    ? t(lang, { zh: "当前实例对话", en: "Active instance conversation" })
                    : t(lang, { zh: "当前 package", en: "Selected package" })}
              </div>
              <div className="muted">
                {view === "workshops"
                  ? t(lang, {
                      zh: "首页强调选择和启动。",
                      en: "The landing page emphasizes choosing and launching.",
                    })
                  : view === "instances"
                    ? t(lang, {
                        zh: "对话在中央，文件与审计转入右侧。",
                        en: "Conversation stays central while files and audit move right.",
                      })
                    : t(lang, {
                        zh: "镜像、凭证与发布拆到子页签。",
                        en: "Runtime, secrets, and release are split into subtabs.",
                      })}
              </div>
            </div>
            <button className="theme-btn" type="button" onClick={toggleTheme}>
              <span
                className="card-row"
                style={{ justifyContent: "space-between", width: "100%" }}
              >
                <span className="mono">{t(lang, { zh: "主题", en: "Theme" })}</span>
                <span>
                  <svg className="icon moon">
                    <use href="#i-moon" />
                  </svg>
                  <svg className="icon sun">
                    <use href="#i-sun" />
                  </svg>
                </span>
              </span>
            </button>
          </div>
        </aside>

        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />

        <main className="main">
          <header className="topbar">
            <div className="title-row">
              <button
                className={`drawer-inline-toggle ${sidebarOpen ? "active" : ""}`}
                type="button"
                onClick={toggleSidebar}
              >
                <svg className="icon">
                  <use href="#i-panel-left" />
                </svg>
              </button>
              <div className="title-wrap">
                <div className="eyebrow">{viewMeta.label}</div>
                <h1>{viewMeta.title}</h1>
                <p>{viewMeta.desc}</p>
              </div>
            </div>
            <div className="toolbar">
              <div className="toolbar-group topbar-search-group">
                <div className="toolbar-pop-wrap">
                  <label className={`global-search ${searchPanelOpen ? "active" : ""}`}>
                    <svg className="icon">
                      <use href="#i-search" />
                    </svg>
                    <input
                      className="global-search-input"
                      type="text"
                      value={globalSearchQuery}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setGlobalSearchQuery(nextValue);
                        setSearchPanelOpen(nextValue.length > 0);
                      }}
                      onFocus={() => setSearchPanelOpen(true)}
                      placeholder={t(lang, {
                        zh: "搜索工坊、服务、实例、Package",
                        en: "Search workshops, services, instances, packages",
                      })}
                    />
                    {globalSearchQuery ? (
                      <button
                        className="icon-chip"
                        type="button"
                        onClick={() => {
                          setGlobalSearchQuery("");
                          setSearchPanelOpen(false);
                        }}
                      >
                        <svg className="icon">
                          <use href="#i-x" />
                        </svg>
                      </button>
                    ) : null}
                  </label>
                  {searchPanelOpen ? (
                    <div className="topbar-panel search-panel">
                      <div className="panel-head">
                        <div>
                          <div className="eyebrow">
                            {t(lang, { zh: "全局搜索", en: "Global Search" })}
                          </div>
                          <div className="panel-title">
                            {globalSearchQuery
                              ? t(lang, { zh: "搜索结果", en: "Search results" })
                              : t(lang, { zh: "可搜索对象", en: "Searchable surfaces" })}
                          </div>
                        </div>
                        <span className="pill active">{t(lang, currentWorkspace.name)}</span>
                      </div>
                      <div className="panel-list">
                        {globalSearchQuery ? (
                          searchResultsPending ? (
                            <div className="panel-empty">
                              {t(lang, {
                                zh: "姝ｅ湪鎼滅储褰撳墠宸ヤ綔鍖虹殑宸ュ潑銆佹湇鍔°€佸疄渚嬪拰 package銆?",
                                en: "Searching workshops, services, instances, and packages in the current workspace.",
                              })}
                            </div>
                          ) : searchResults.length > 0 ? (
                            searchResults.map((item) => (
                              <button
                                className="panel-item"
                                key={item.id}
                                type="button"
                                onClick={() => handleSearchItemOpen(item)}
                              >
                                <div className="panel-item-top">
                                  <span className="pill">{item.type}</span>
                                  <span className="panel-item-route">{item.route}</span>
                                </div>
                                <div className="panel-item-title">{item.title}</div>
                                <div className="panel-item-note">{item.note}</div>
                              </button>
                            ))
                          ) : (
                            <div className="panel-empty">
                              {t(lang, {
                                zh: "当前工作区没有匹配结果。你可以改搜服务名、实例标题或 package ID。",
                                en: "No match in the current workspace. Try a service name, instance title, or package ID.",
                              })}
                            </div>
                          )
                        ) : (
                          <>
                            {searchHistoryItems.length > 0 ? (
                              <>
                                {searchHistoryItems.map((item) => (
                                  <button
                                    className="panel-item"
                                    key={item.historyId}
                                    type="button"
                                    onClick={() => {
                                      setGlobalSearchQuery(item.query);
                                      setSearchPanelOpen(true);
                                    }}
                                  >
                                    <div className="panel-item-top">
                                      <span className="pill active">
                                        {t(lang, { zh: "最近搜索", en: "Recent search" })}
                                      </span>
                                      <span className="panel-item-route">
                                        {item.resourceTypes.join(" / ")}
                                      </span>
                                    </div>
                                    <div className="panel-item-title">{item.query}</div>
                                    <div className="panel-item-note">
                                      {t(lang, {
                                        zh: "再次执行该搜索，并继续复用当前工作区的搜索历史。",
                                        en: "Run this search again and reuse the current workspace history.",
                                      })}
                                    </div>
                                  </button>
                                ))}
                              </>
                            ) : null}
                            {[
                              t(lang, {
                                zh: "工坊和服务的用户侧名称",
                                en: "User-facing workshop and service names",
                              }),
                              t(lang, {
                                zh: "实例标题、状态与目标路径",
                                en: "Instance titles, states, and target paths",
                              }),
                              t(lang, {
                                zh: "Creator package、发布通道和版本线",
                                en: "Creator packages, release channels, and version lines",
                              }),
                            ].map((item) => (
                              <div className="panel-item static" key={item}>
                                <div className="panel-item-note">{item}</div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="toolbar-group">
                <div className="lang-switch">
                  <button
                    className={`lang-btn ${lang === "zh" ? "active" : ""}`}
                    type="button"
                    onClick={() => setLang("zh")}
                  >
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
                      <use href="#i-globe" />
                    </svg>
                    中文
                  </button>
                  <button
                    className={`lang-btn ${lang === "en" ? "active" : ""}`}
                    type="button"
                    onClick={() => setLang("en")}
                  >
                    EN
                  </button>
                </div>
              </div>
              <div className="toolbar-group">
                <div className="toolbar-chip active">
                  {t(lang, { zh: "工作区：", en: "Workspace: " })}
                  {t(lang, currentWorkspace.name)}
                </div>
                <div className="toolbar-chip">
                  {view === "workshops"
                    ? t(lang, {
                        zh: `可见工坊 ${String(workspaceStats.workshops).padStart(2, "0")}`,
                        en: `Visible workshops ${String(workspaceStats.workshops).padStart(2, "0")}`,
                      })
                    : view === "instances"
                      ? t(lang, {
                          zh: `可见实例 ${String(workspaceStats.instances).padStart(2, "0")}`,
                          en: `Visible instances ${String(workspaceStats.instances).padStart(2, "0")}`,
                        })
                      : t(lang, {
                          zh: `可见包 ${String(workspaceStats.packages).padStart(2, "0")}`,
                          en: `Visible packages ${String(workspaceStats.packages).padStart(2, "0")}`,
                        })}
                </div>
                <div className="toolbar-chip">
                  {view === "instances"
                    ? t(lang, {
                        zh: "中央对话 + 右侧详情",
                        en: "Center conversation + right detail",
                      })
                    : view === "creator"
                      ? t(lang, {
                          zh: "包详情 / 调试 / 治理",
                          en: "Package / Debug / Governance",
                        })
                      : t(lang, {
                          zh: "启动后自动追问信息",
                          en: "Prompts for missing info after launch",
                        })}
                </div>
              </div>
              <div className="toolbar-group topbar-actions">
                <button className="icon-btn" type="button" onClick={toggleTheme}>
                  <svg className="icon">
                    <use href={theme === "dark" ? "#i-moon" : "#i-sun"} />
                  </svg>
                  <span>{t(lang, { zh: "主题", en: "Theme" })}</span>
                </button>

                <div className="toolbar-pop-wrap">
                  <button
                    className={`icon-btn ${noticeOpen ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setNoticeOpen((value) => !value);
                      setAccountOpen(false);
                    }}
                  >
                    <svg className="icon">
                      <use href="#i-bell" />
                    </svg>
                    <span>{t(lang, { zh: "通知", en: "Alerts" })}</span>
                    {notificationCount > 0 ? (
                      <span className="topbar-badge">{notificationCount}</span>
                    ) : null}
                  </button>
                  {noticeOpen ? (
                    <div className="topbar-panel pop-panel">
                      <div className="panel-head">
                        <div>
                          <div className="eyebrow">
                            {t(lang, {
                              zh: "通知中心",
                              en: "Notification Center",
                            })}
                          </div>
                          <div className="panel-title">
                            {t(lang, {
                              zh: "需要你处理的项",
                              en: "Actionable items",
                            })}
                          </div>
                        </div>
                        <div className="pill-row">
                          {notificationsQuery.isSuccess ? (
                            <button
                              className="route-btn"
                              type="button"
                              disabled={markAllNotificationsReadMutation.isPending}
                              onClick={() => markAllNotificationsReadMutation.mutate()}
                            >
                              {markAllNotificationsReadMutation.isPending
                                ? t(lang, { zh: "处理中", en: "Processing" })
                                : t(lang, { zh: "全部已读", en: "Mark all read" })}
                            </button>
                          ) : null}
                          <span className="pill warn">{notificationCount}</span>
                        </div>
                      </div>
                      <div className="panel-list">
                        {notificationItems.length > 0 ? (
                          notificationItems.map((item) => (
                            <button
                              className="panel-item"
                              key={item.id}
                              type="button"
                              onClick={() => {
                                if (item.notificationId) {
                                  markNotificationReadMutation.mutate(item.notificationId);
                                }
                                navigate(item.route);
                                setNoticeOpen(false);
                              }}
                            >
                              <div className="panel-item-top">
                                <span className={`pill ${item.tone}`}>{item.title}</span>
                                {item.unread ? (
                                  <span className="pill warn">
                                    {t(lang, { zh: "未读", en: "Unread" })}
                                  </span>
                                ) : null}
                              </div>
                              <div className="panel-item-note">{item.note}</div>
                            </button>
                          ))
                        ) : (
                          <div className="panel-empty">
                            {t(lang, {
                              zh: "当前没有待处理通知。",
                              en: "There are no pending notifications right now.",
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="toolbar-pop-wrap">
                  <button
                    className={`icon-btn ${accountOpen ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setAccountOpen((value) => !value);
                      setNoticeOpen(false);
                    }}
                  >
                    <svg className="icon">
                      <use href="#i-user" />
                    </svg>
                    <span>{t(lang, { zh: "账户", en: "Account" })}</span>
                    <svg className="icon chevron">
                      <use href="#i-chevron-down" />
                    </svg>
                  </button>
                  {accountOpen ? (
                    <div className="topbar-panel pop-panel">
                      <div className="panel-head">
                        <div>
                          <div className="eyebrow">
                            {t(lang, {
                              zh: "当前空间账户",
                              en: "Active Workspace Account",
                            })}
                          </div>
                          <div className="panel-title">{t(lang, currentWorkspace.name)}</div>
                        </div>
                        <span className="pill active">{t(lang, currentWorkspace.type)}</span>
                      </div>
                      <div className="panel-list">
                        {accountActions.map((item) => (
                          <div className="panel-item static" key={item.id}>
                            <div className="panel-item-top">
                              <span className="pill">{item.label}</span>
                            </div>
                            <div className="panel-item-route">{item.value}</div>
                          </div>
                        ))}
                        {authMode === "required" ? (
                          meSummaryQuery.isPending ? (
                            <div className="panel-empty">
                              {t(lang, {
                                zh: "正在加载当前账户摘要。",
                                en: "Loading the current account summary.",
                              })}
                            </div>
                          ) : meSummaryQuery.data ? (
                            <div className="panel-section">
                              <div className="panel-item-top">
                                <div className="panel-section-title">
                                  {t(lang, {
                                    zh: "账户摘要",
                                    en: "Account summary",
                                  })}
                                </div>
                                <span className="pill active">
                                  {t(lang, {
                                    zh: "正式读模型",
                                    en: "Formal read model",
                                  })}
                                </span>
                              </div>
                              <div className="panel-metric-grid">
                                {accountSummaryCards.map((item) => (
                                  <div className="panel-metric-card" key={item.id}>
                                    <div className="panel-metric-label">{item.label}</div>
                                    <div className="panel-metric-value">{item.value}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : meSummaryQuery.error instanceof Error ? (
                            <div className="panel-empty">
                              {t(lang, {
                                zh: `账户摘要暂时不可用：${meSummaryQuery.error.message}`,
                                en: `Account summary is temporarily unavailable: ${meSummaryQuery.error.message}`,
                              })}
                            </div>
                          ) : null
                        ) : null}
                        {authMode === "required" ? (
                          favoriteWorkshopsQuery.isPending ? (
                            <div className="panel-empty">
                              {t(lang, {
                                zh: "正在加载收藏工坊。",
                                en: "Loading favorite workshops.",
                              })}
                            </div>
                          ) : accountFavoriteItems.length > 0 ? (
                            <div className="panel-section">
                              <div className="panel-item-top">
                                <div className="panel-section-title">
                                  {t(lang, {
                                    zh: "收藏工坊",
                                    en: "Favorite workshops",
                                  })}
                                </div>
                                <span className="pill active">
                                  {favoriteWorkshopsQuery.data?.totalCount ?? 0}
                                </span>
                              </div>
                              <div className="panel-sublist">
                                {accountFavoriteItems.map((item) => (
                                  <button
                                    className="panel-item"
                                    key={item.favoriteId}
                                    type="button"
                                    onClick={() => {
                                      navigate(buildDashboardFavoriteRoute(item.workshopId));
                                      setAccountOpen(false);
                                    }}
                                  >
                                    <img
                                      className="panel-cover"
                                      src={item.coverAssetUrl}
                                      alt={t(lang, item.title)}
                                    />
                                    <div className="panel-item-top">
                                      <span className="pill active">
                                        <svg className="icon inline-icon">
                                          <use href="#i-heart" />
                                        </svg>
                                        {t(lang, { zh: "已收藏", en: "Favorited" })}
                                      </span>
                                      <span className="pill">{t(lang, item.badge)}</span>
                                    </div>
                                    <div className="panel-item-title">{t(lang, item.title)}</div>
                                    <div className="panel-item-note">
                                      {t(lang, item.ownerLabel)}
                                    </div>
                                    <div className="panel-item-note">{t(lang, item.summary)}</div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : favoriteWorkshopsQuery.isSuccess ? (
                            <div className="panel-empty">
                              {t(lang, {
                                zh: "当前空间还没有收藏工坊。可以先在工坊页收藏常用入口。",
                                en: "No favorite workshop is saved in this workspace yet. Favorite a workshop from the browse surface first.",
                              })}
                            </div>
                          ) : favoriteWorkshopsQuery.error instanceof Error ? (
                            <div className="panel-empty">
                              {t(lang, {
                                zh: `收藏工坊暂时不可用：${favoriteWorkshopsQuery.error.message}`,
                                en: `Favorite workshops are temporarily unavailable: ${favoriteWorkshopsQuery.error.message}`,
                              })}
                            </div>
                          ) : null
                        ) : null}
                        <div className="panel-inline-actions">
                          <button
                            className="route-btn"
                            type="button"
                            onClick={() => navigate(dashboardRoutes.workshops)}
                          >
                            {t(lang, { zh: "回到工坊", en: "Go to workshops" })}
                          </button>
                          <button
                            className="route-btn active"
                            type="button"
                            onClick={() => navigate(dashboardRoutes.instances)}
                          >
                            {t(lang, { zh: "继续实例", en: "Open instances" })}
                          </button>
                          {authMode === "required" ? (
                            <button
                              className="route-btn"
                              type="button"
                              disabled={logoutMutation.isPending}
                              onClick={() => logoutMutation.mutate()}
                            >
                              {logoutMutation.isPending
                                ? t(lang, { zh: "退出中", en: "Signing out" })
                                : t(lang, { zh: "退出登录", en: "Sign out" })}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          <div className="views">
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}
