import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchProfiles, type ProfileSummary } from "../api/engine";
import { useEngineHealth } from "../hooks/useEngineHealth";

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
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selectedProfileId, setSelectedProfileIdState] = useState<number | null>(
    readStoredId,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedProfileIdRef = useRef(selectedProfileId);
  selectedProfileIdRef.current = selectedProfileId;

  const setSelectedProfileId = useCallback((id: number | null) => {
    selectedProfileIdRef.current = id;
    setSelectedProfileIdState(id);
    try {
      if (id == null) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      /* ignore */
    }
  }, []);

  const reloadProfiles = useCallback(async () => {
    if (!health) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchProfiles();
      setProfiles(list);
      const current = selectedProfileIdRef.current;
      if (list.length === 0) {
        setSelectedProfileId(null);
      } else if (current == null || !list.some((p) => p.id === current)) {
        setSelectedProfileId(list[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [health, setSelectedProfileId]);

  useEffect(() => {
    void reloadProfiles();
  }, [reloadProfiles]);

  const value = useMemo(
    () => ({
      profiles,
      selectedProfileId,
      setSelectedProfileId,
      reloadProfiles,
      loading,
      error,
    }),
    [
      profiles,
      selectedProfileId,
      setSelectedProfileId,
      reloadProfiles,
      loading,
      error,
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
