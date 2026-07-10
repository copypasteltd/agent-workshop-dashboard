import type { RecordMeRecentActivityInput } from "@lingban/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { dashboardMeApi } from "./api";

function buildRecentRecordKey(input: RecordMeRecentActivityInput | null) {
  if (!input) {
    return null;
  }

  switch (input.resourceType) {
    case "workshop":
      return `${input.resourceType}:${input.workshopId}:${input.interaction}:${input.sourceSurface}`;
    case "service":
      return `${input.resourceType}:${input.serviceId}:${input.interaction}:${input.sourceSurface}`;
    case "run":
      return `${input.resourceType}:${input.runId}:${input.interaction}:${input.sourceSurface}`;
    default:
      return null;
  }
}

export function useDashboardRecentRecorder(
  input: RecordMeRecentActivityInput | null,
  enabled = true
) {
  const queryClient = useQueryClient();
  const lastRecordedKeyRef = useRef<string | null>(null);
  const recordKey = useMemo(() => buildRecentRecordKey(input), [input]);
  const mutation = useMutation({
    mutationFn: async (value: RecordMeRecentActivityInput) =>
      dashboardMeApi.recordRecentActivity(value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "me", "recent"],
      });
    },
  });

  useEffect(() => {
    if (!enabled || !input || !recordKey) {
      return;
    }

    if (lastRecordedKeyRef.current === recordKey) {
      return;
    }

    lastRecordedKeyRef.current = recordKey;
    mutation.mutate(input);
  }, [enabled, input, mutation, recordKey]);

  return mutation;
}
