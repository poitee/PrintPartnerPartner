import { useCallback, useEffect, useState } from "react";
import {
  ensureEngineRunning,
  fetchHealth,
  type HealthResponse,
} from "../api/engine";

export function useEngineHealth(pollMs = 8000) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await ensureEngineRunning();
      const h = await fetchHealth();
      setHealth(h);
    } catch (e) {
      setHealth(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs]);

  return { health, error, loading, refresh };
}
