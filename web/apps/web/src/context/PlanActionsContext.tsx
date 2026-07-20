import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

type PlanActionsContextValue = {
  openCreatePlan: () => void;
  registerOpenCreate: (fn: (() => void) | null) => void;
};

const PlanActionsContext = createContext<PlanActionsContextValue | null>(null);

export function PlanActionsProvider({ children }: { children: ReactNode }) {
  const openCreateRef = useRef<(() => void) | null>(null);

  const registerOpenCreate = useCallback((fn: (() => void) | null) => {
    openCreateRef.current = fn;
  }, []);

  const openCreatePlan = useCallback(() => {
    openCreateRef.current?.();
  }, []);

  const value = useMemo(
    () => ({ openCreatePlan, registerOpenCreate }),
    [openCreatePlan, registerOpenCreate],
  );

  return (
    <PlanActionsContext.Provider value={value}>{children}</PlanActionsContext.Provider>
  );
}

export function usePlanActions() {
  const ctx = useContext(PlanActionsContext);
  if (!ctx) {
    throw new Error("usePlanActions must be used within PlanActionsProvider");
  }
  return ctx;
}
