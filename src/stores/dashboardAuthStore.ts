import type {
  AuthDisabledSessionBootstrap,
  AuthSessionEnvelope,
  AuthSessionResponse,
  AuthTokenPair,
  WorkspaceContextSummary,
} from "@lingban/contracts";
import { create } from "zustand";

type DashboardAuthMode = "unknown" | "disabled" | "required";
type DashboardBootstrapWorkspace =
  | AuthSessionEnvelope["currentWorkspace"]
  | WorkspaceContextSummary;

type PersistedDashboardAuthState = {
  tokens: AuthTokenPair | null;
  user: AuthSessionEnvelope["user"] | null;
  session: AuthSessionEnvelope["session"] | null;
  currentWorkspace: DashboardBootstrapWorkspace | null;
  workspaces: DashboardBootstrapWorkspace[];
  platformAccess: AuthSessionEnvelope["platformAccess"] | null;
};

type DashboardAuthState = PersistedDashboardAuthState & {
  authMode: DashboardAuthMode;
  authenticated: boolean;
  bootstrapping: boolean;
  lastError: string | null;
  setAuthMode: (authMode: DashboardAuthMode) => void;
  setBootstrapping: (bootstrapping: boolean) => void;
  setLastError: (lastError: string | null) => void;
  applySessionResponse: (response: AuthSessionResponse) => void;
  applySessionEnvelope: (envelope: AuthSessionEnvelope) => void;
  applyPublicWorkspaceBootstrap: (bootstrap: AuthDisabledSessionBootstrap) => void;
  clearAuth: (lastError?: string | null) => void;
};

const AUTH_STORAGE_KEY = "lingban.dashboard.auth";

const EMPTY_AUTH_STATE: PersistedDashboardAuthState = {
  tokens: null,
  user: null,
  session: null,
  currentWorkspace: null,
  workspaces: [],
  platformAccess: null,
};

function readStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(AUTH_STORAGE_KEY);
}

function writeStorage(value: PersistedDashboardAuthState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(value));
}

function clearStorage() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

function readPersistedState(): PersistedDashboardAuthState {
  const raw = readStorage();
  if (!raw) {
    return EMPTY_AUTH_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedDashboardAuthState>;
    return {
      tokens: parsed.tokens ?? null,
      user: parsed.user ?? null,
      session: parsed.session ?? null,
      currentWorkspace: parsed.currentWorkspace ?? null,
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
      platformAccess: parsed.platformAccess ?? null,
    };
  } catch {
    return EMPTY_AUTH_STATE;
  }
}

function toPersistedState(input: {
  tokens: AuthTokenPair | null;
  envelope: AuthSessionEnvelope;
}): PersistedDashboardAuthState {
  return {
    tokens: input.tokens,
    user: input.envelope.user,
    session: input.envelope.session,
    currentWorkspace: input.envelope.currentWorkspace,
    workspaces: input.envelope.workspaces,
    platformAccess: input.envelope.platformAccess,
  };
}

const initialState = readPersistedState();

export const useDashboardAuthStore = create<DashboardAuthState>((set, get) => ({
  ...initialState,
  authMode: "unknown",
  authenticated: Boolean(initialState.tokens?.accessToken && initialState.session && initialState.user),
  bootstrapping: true,
  lastError: null,
  setAuthMode: (authMode) => set({ authMode }),
  setBootstrapping: (bootstrapping) => set({ bootstrapping }),
  setLastError: (lastError) => set({ lastError }),
  applySessionResponse: (response) => {
    const persisted = toPersistedState({
      tokens: response.tokens,
      envelope: response,
    });
    writeStorage(persisted);
    set({
      ...persisted,
      authMode: "required",
      authenticated: true,
      bootstrapping: false,
      lastError: null,
    });
  },
  applySessionEnvelope: (envelope) => {
    const persisted = toPersistedState({
      tokens: get().tokens,
      envelope,
    });
    writeStorage(persisted);
    set({
      ...persisted,
      authMode: "required",
      authenticated: Boolean(persisted.tokens?.accessToken),
      bootstrapping: false,
      lastError: null,
    });
  },
  applyPublicWorkspaceBootstrap: (bootstrap) => {
    clearStorage();
    set({
      ...EMPTY_AUTH_STATE,
      currentWorkspace: bootstrap.currentWorkspace,
      workspaces: bootstrap.workspaces,
      authMode: "disabled",
      authenticated: false,
      bootstrapping: false,
      lastError: null,
    });
  },
  clearAuth: (lastError = null) => {
    clearStorage();
    set({
      ...EMPTY_AUTH_STATE,
      authenticated: false,
      bootstrapping: false,
      lastError,
    });
  },
}));

export type { DashboardAuthMode };
