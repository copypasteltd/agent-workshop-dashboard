import { createRunsRealtimeClient, type RunRealtimeConnection } from "@lingban/api-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { serverRealtimeMessageSchema, type RunSnapshot } from "@lingban/contracts";
import { applyBridgeEventToRunSnapshot } from "@lingban/domain-models";
import { dashboardApiBaseUrl } from "./api";

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
});

type DashboardRunStreamState = {
  connected: boolean;
  transport: "idle" | "ws" | "sse";
  sendMessage(text: string): boolean;
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

    const handleRealtimePayload = (raw: MessageEvent<string>) => {
      const parsed = serverRealtimeMessageSchema.parse(JSON.parse(raw.data) as unknown);

      if (parsed.type === "runs.snapshot") {
        syncSnapshot(parsed.payload);
        return;
      }

      if (parsed.type !== "runs.event") {
        return;
      }

      const current = queryClient.getQueryData<RunSnapshot>(["dashboard", "runs", runId]);
      if (!current) {
        return;
      }

      const next = applyBridgeEventToRunSnapshot(current, parsed.payload);
      syncSnapshot(next);
    };

    if (typeof WebSocket !== "undefined") {
      const connection = dashboardRunsRealtime.connect(runId, {
        onOpen: () => {
          setConnected(true);
          setTransport("ws");
        },
        onClose: () => {
          setConnected(false);
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
    }

    if (typeof EventSource === "undefined") {
      return;
    }

    setConnected(true);
    setTransport("sse");

    const source = new EventSource(`${dashboardApiBaseUrl}/v1/runs/${runId}/stream`);

    source.addEventListener("runs.snapshot", handleRealtimePayload as EventListener);
    source.addEventListener("runs.event", handleRealtimePayload as EventListener);

    return () => {
      source.close();
      setConnected(false);
      setTransport("idle");
    };
  }, [enabled, queryClient, runId]);

  return {
    connected,
    transport,
    sendMessage(text: string) {
      if (!connectionRef.current?.isOpen()) {
        return false;
      }

      connectionRef.current.sendMessage({
        text,
        attachments: [],
      });
      return true;
    },
  } satisfies DashboardRunStreamState;
}
