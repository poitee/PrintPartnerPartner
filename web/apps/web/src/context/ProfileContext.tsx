import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProfileSummary } from "../api/engine";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { queryKeys } from "../queries/keys";
import { useProfilesQuery } from "../queries/profiles";

const STORAGE_KEY = "pp-selected-profile-id";

type ProfileContextValue = {
  profiles: ProfileSummary[];
  selectedProfileId: number | null;
  setSelectedProfileId: (id: number | null) => void;
  reloadProfiles: () => Promise<void>;
  loading: boolean;
  error: string | null;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

function readStoredId(): number | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { health } = useEngineHealth();
  const qc = useQueryClient();
  const {
    data: profiles = [],
    isLoading,
    error: queryError,
    refetch,
  } = useProfilesQuery(Boolean(health?.ok));

  const [selectedProfileId, setSelectedProfileIdState] = useState<number | null>(readStoredId);

  const setSelectedProfileId = useCallback((id: number | null) => {
    setSelectedProfileIdState(id);
    try {
      if (id == null) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (profiles.length === 0) {
      if (selectedProfileId != null) setSelectedProfileId(null);
    } else if (
      selectedProfileId == null ||
      !profiles.some((p) => p.id === selectedProfileId)
    ) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId, setSelectedProfileId]);

  const reloadProfiles = useCallback(async () => {
    if (!health?.ok) return;
    await qc.invalidateQueries({ queryKey: queryKeys.profiles });
    await refetch();
  }, [health?.ok, qc, refetch]);

  const value = useMemo(
    (): ProfileContextValue => ({
      profiles,
      selectedProfileId,
      setSelectedProfileId,
      reloadProfiles,
      loading: isLoading,
      error:
        queryError instanceof Error
          ? queryError.message
          : queryError
            ? String(queryError)
            : null,
    }),
    [
      profiles,
      selectedProfileId,
      setSelectedProfileId,
      reloadProfiles,
      isLoading,
      queryError,
    ],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfileSelection() {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfileSelection must be used within ProfileProvider");
  }
  return ctx;
}
