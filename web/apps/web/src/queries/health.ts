import { useQuery } from "@tanstack/react-query";
import { ensureEngineRunning, fetchHealth, type HealthResponse } from "../api/engine";
import { queryKeys } from "./keys";

const HEALTH_POLL_MS = 8000;

async function loadHealth(): Promise<HealthResponse> {
  await ensureEngineRunning();
  return fetchHealth();
}

export function useHealthQuery() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: loadHealth,
    refetchInterval: HEALTH_POLL_MS,
    retry: 2,
  });
}
