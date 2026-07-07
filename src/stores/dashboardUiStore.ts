import { create } from "zustand";
import type { CreatorTab, InstanceTab } from "../data/dashboardData";
import { setDashboardLanguage, type Lang } from "../lib/i18n";

type Theme = "dark" | "light";

type DashboardUiState = {
  theme: Theme;
  lang: Lang;
  currentWorkspaceId: string;
  sidebarOpen: boolean;
  activeInstanceId: string;
  activePackageId: string;
  instanceTab: InstanceTab;
  creatorTab: CreatorTab;
  instanceDrafts: Record<string, string>;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLang: (lang: Lang) => void;
  setCurrentWorkspaceId: (id: string) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveInstanceId: (id: string) => void;
  setActivePackageId: (id: string) => void;
  setInstanceTab: (tab: InstanceTab) => void;
  setCreatorTab: (tab: CreatorTab) => void;
  setInstanceDraft: (instanceId: string, draft: string) => void;
  clearInstanceDraft: (instanceId: string) => void;
};

const THEME_STORAGE_KEY = "lingban.dashboard.theme";
const LANG_STORAGE_KEY = "lingban.dashboard.lang";
const WORKSPACE_STORAGE_KEY = "lingban.dashboard.workspace";
const INSTANCE_DRAFTS_STORAGE_KEY = "lingban.dashboard.instanceDrafts";

function readStorage(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function readJsonStorage<T>(key: string, fallback: T): T {
  const raw = readStorage(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, value);
}

const getInitialTheme = (): Theme =>
  readStorage(THEME_STORAGE_KEY) === "light" ? "light" : "dark";

const getInitialLang = (): Lang =>
  readStorage(LANG_STORAGE_KEY) === "en" ? "en" : "zh";

const getInitialWorkspaceId = () => readStorage(WORKSPACE_STORAGE_KEY) ?? "harbor-finance";
const getInitialInstanceDrafts = () =>
  readJsonStorage<Record<string, string>>(INSTANCE_DRAFTS_STORAGE_KEY, {});

export const useDashboardUiStore = create<DashboardUiState>((set) => ({
  theme: getInitialTheme(),
  lang: getInitialLang(),
  currentWorkspaceId: getInitialWorkspaceId(),
  sidebarOpen: typeof window !== "undefined" ? window.innerWidth > 1240 : true,
  activeInstanceId: "tax-q2",
  activePackageId: "chrome-tax-runner",
  instanceTab: "overview",
  creatorTab: "session",
  instanceDrafts: getInitialInstanceDrafts(),
  setTheme: (theme) => {
    writeStorage(THEME_STORAGE_KEY, theme);
    set({ theme });
  },
  toggleTheme: () =>
    set((state) => {
      const nextTheme = state.theme === "dark" ? "light" : "dark";
      writeStorage(THEME_STORAGE_KEY, nextTheme);
      return { theme: nextTheme };
    }),
  setLang: (lang) => {
    writeStorage(LANG_STORAGE_KEY, lang);
    setDashboardLanguage(lang);
    set({ lang });
  },
  setCurrentWorkspaceId: (currentWorkspaceId) => {
    writeStorage(WORKSPACE_STORAGE_KEY, currentWorkspaceId);
    set({ currentWorkspaceId });
  },
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setActiveInstanceId: (activeInstanceId) => set({ activeInstanceId }),
  setActivePackageId: (activePackageId) => set({ activePackageId }),
  setInstanceTab: (instanceTab) => set({ instanceTab }),
  setCreatorTab: (creatorTab) => set({ creatorTab }),
  setInstanceDraft: (instanceId, draft) =>
    set((state) => {
      const nextDrafts = {
        ...state.instanceDrafts,
        [instanceId]: draft,
      };
      writeStorage(INSTANCE_DRAFTS_STORAGE_KEY, JSON.stringify(nextDrafts));
      return { instanceDrafts: nextDrafts };
    }),
  clearInstanceDraft: (instanceId) =>
    set((state) => {
      const nextDrafts = { ...state.instanceDrafts };
      delete nextDrafts[instanceId];
      writeStorage(INSTANCE_DRAFTS_STORAGE_KEY, JSON.stringify(nextDrafts));
      return { instanceDrafts: nextDrafts };
    }),
}));
