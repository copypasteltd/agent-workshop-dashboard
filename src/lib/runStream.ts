import { createRunsRealtimeClient, type RunRealtimeConnection } from "@lingban/api-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type RunSnapshot, type SendRunMessageInput } from "@lingban/contracts";
import { applyBridgeEventToRunSnapshot } from "@lingban/domain-models";
import { dashboardApiBaseUrl } from "./api";
import { useDashboardAuthStore } from "../stores/dashboardAuthStore";

function upsertRunSnapshot(list: RunSnapshot[] | undefined, snapshot: RunSnapshot) {
  const current = list ?? [];
  const index = current.findIndex((item) => item.run.runId === snapshot.run.runId);

  if (index === -1) {
    return [snapshot, ...current];
  }

  return current.map((item, itemIndex) => (itemIndex === index ? snapshot : item));
}

const dashboardRunsRealtime = createRunsRealtimeClient({
  baseUrl: dashboardApiBaseUrl,
  getAccessToken: () => useDashboardAuthStore.getState().tokens?.accessToken,
});

type DashboardRunStreamState = {
  connected: boolean;
  transport: "idle" | "ws" | "sse";
  sendMessage(input: SendRunMessageInput): boolean;
};

export function useDashboardRunStream(runId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const connectionRef = useRef<RunRealtimeConnection | null>(null);
  const [connected, setConnected] = useState(false);
  const [transport, setTransport] = useState<DashboardRunStreamState["transport"]>("idle");

  useEffect(() => {
    connectionRef.current?.close();
    connectionRef.current = null;
    setConnected(false);
    setTransport("idle");

    if (!enabled || !runId) {
      return;
    }

    const syncSnapshot = (snapshot: RunSnapshot) => {
      queryClient.setQueryData(["dashboard", "runs", runId], snapshot);
      queryClient.setQueryData(["dashboard", "runs"], (current: RunSnapshot[] | undefined) =>
        upsertRunSnapshot(current, snapshot)
      );
      queryClient.setQueryData(["dashboard", "runs", runId, "files"], snapshot.files);
    };

    const connection = dashboardRunsRealtime.connect(runId, {
      onOpen: () => {
        setConnected(true);
      },
      onClose: () => {
        setConnected(false);
        setTransport("idle");
      },
      onTransport: (nextTransport) => {
        setTransport(nextTransport);
      },
      onSnapshot: syncSnapshot,
      onEvent: (event) => {
        const current = queryClient.getQueryData<RunSnapshot>(["dashboard", "runs", runId]);
        if (!current) {
          return;
        }

        const next = applyBridgeEventToRunSnapshot(current, event);
        syncSnapshot(next);
      },
    });

    connectionRef.current = connection;

    return () => {
      connection.close();
      if (connectionRef.current === connection) {
        connectionRef.current = null;
      }
      setConnected(false);
      setTransport("idle");
    };
  }, [enabled, queryClient, runId]);

  return {
    connected,
    transport,
    sendMessage(input: SendRunMessageInput) {
      if (!connectionRef.current?.isOpen()) {
        return false;
      }

      connectionRef.current.sendMessage(input);
      return true;
    },
  } satisfies DashboardRunStreamState;
}
