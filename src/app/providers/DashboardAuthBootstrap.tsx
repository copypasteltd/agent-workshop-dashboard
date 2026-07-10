import type { PropsWithChildren } from "react";
import type { AuthSessionEnvelope } from "@lingban/contracts";
import { useEffect, useRef } from "react";
import { dashboardApiBaseUrl, dashboardAuthFetch } from "../../lib/api";
import { inferWorkspaceContextKey } from "../../lib/workspaceContext";
import { useDashboardUiStore } from "../../stores/dashboardUiStore";
import { useDashboardAuthStore } from "../../stores/dashboardAuthStore";

const dashboardE2eAuthMode = (import.meta.env.VITE_E2E_AUTH_MODE as string | undefined)?.trim();

function isAuthDisabledPayload(value: unknown): value is { authMode: "disabled" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "authMode" in value &&
    (value as { authMode?: unknown }).authMode === "disabled"
  );
}

function isAuthSessionEnvelope(value: unknown): value is AuthSessionEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "user" in value &&
    "session" in value &&
    "currentWorkspace" in value &&
    "workspaces" in value
  );
}

function syncWorkspaceSelection(envelope: AuthSessionEnvelope) {
  const uiStore = useDashboardUiStore.getState();
  const storedSelectionId = uiStore.currentWorkspaceId;

  const matchedWorkspace =
    envelope.workspaces.find(
      (workspace) =>
        workspace.workspaceId === storedSelectionId ||
        workspace.contextKey === storedSelectionId ||
        inferWorkspaceContextKey({
          workspaceId: workspace.workspaceId,
          slug: workspace.slug,
          name: workspace.name,
          type: workspace.type,
        }) === storedSelectionId
    ) ?? envelope.currentWorkspace;

  if (matchedWorkspace.workspaceId !== storedSelectionId) {
    uiStore.setCurrentWorkspaceId(matchedWorkspace.workspaceId);
  }
}

export function DashboardAuthBootstrap({ children }: PropsWithChildren) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    let cancelled = false;

    const bootstrap = async () => {
      const authStore = useDashboardAuthStore.getState();

      authStore.setBootstrapping(true);

      if (dashboardE2eAuthMode === "disabled") {
        authStore.clearAuth();
        authStore.setAuthMode("disabled");
        authStore.setBootstrapping(false);
        return;
      }

      try {
        const response = await dashboardAuthFetch(`${dashboardApiBaseUrl}/v1/auth/session`);

        const payload = (await response.json().catch(() => null)) as unknown;

        if (cancelled) {
          return;
        }

        if (response.ok && isAuthDisabledPayload(payload)) {
          authStore.clearAuth();
          authStore.setAuthMode("disabled");
          authStore.setBootstrapping(false);
          return;
        }

        if (response.ok && isAuthSessionEnvelope(payload)) {
          authStore.applySessionEnvelope(payload);
          syncWorkspaceSelection(payload);
          return;
        }

        authStore.setAuthMode("required");
        authStore.clearAuth();
      } catch (error) {
        if (cancelled) {
          return;
        }

        authStore.setAuthMode("required");
        authStore.clearAuth(
          error instanceof Error ? error.message : "Failed to bootstrap dashboard auth."
        );
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
