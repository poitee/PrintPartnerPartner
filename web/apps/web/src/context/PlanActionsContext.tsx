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
  openRenamePlan: () => void;
  openDuplicatePlan: () => void;
  openDeletePlan: () => void;
  openArchivePlan: () => void;
  registerOpenCreate: (fn: (() => void) | null) => void;
  registerOpenRename: (fn: (() => void) | null) => void;
  registerOpenDuplicate: (fn: (() => void) | null) => void;
  registerOpenDelete: (fn: (() => void) | null) => void;
  registerOpenArchive: (fn: (() => void) | null) => void;
};

const PlanActionsContext = createContext<PlanActionsContextValue | null>(null);

export function PlanActionsProvider({ children }: { children: ReactNode }) {
  const openCreateRef = useRef<(() => void) | null>(null);
  const openRenameRef = useRef<(() => void) | null>(null);
  const openDuplicateRef = useRef<(() => void) | null>(null);
  const openDeleteRef = useRef<(() => void) | null>(null);
  const openArchiveRef = useRef<(() => void) | null>(null);

  const registerOpenCreate = useCallback((fn: (() => void) | null) => {
    openCreateRef.current = fn;
  }, []);

  const registerOpenRename = useCallback((fn: (() => void) | null) => {
    openRenameRef.current = fn;
  }, []);

  const registerOpenDuplicate = useCallback((fn: (() => void) | null) => {
    openDuplicateRef.current = fn;
  }, []);

  const registerOpenDelete = useCallback((fn: (() => void) | null) => {
    openDeleteRef.current = fn;
  }, []);

  const registerOpenArchive = useCallback((fn: (() => void) | null) => {
    openArchiveRef.current = fn;
  }, []);

  const openCreatePlan = useCallback(() => {
    openCreateRef.current?.();
  }, []);

  const openRenamePlan = useCallback(() => {
    openRenameRef.current?.();
  }, []);

  const openDuplicatePlan = useCallback(() => {
    openDuplicateRef.current?.();
  }, []);

  const openDeletePlan = useCallback(() => {
    openDeleteRef.current?.();
  }, []);

  const openArchivePlan = useCallback(() => {
    openArchiveRef.current?.();
  }, []);

  const value = useMemo(
    () => ({
      openCreatePlan,
      openRenamePlan,
      openDuplicatePlan,
      openDeletePlan,
      openArchivePlan,
      registerOpenCreate,
      registerOpenRename,
      registerOpenDuplicate,
      registerOpenDelete,
      registerOpenArchive,
    }),
    [
      openCreatePlan,
      openRenamePlan,
      openDuplicatePlan,
      openDeletePlan,
      openArchivePlan,
      registerOpenCreate,
      registerOpenRename,
      registerOpenDuplicate,
      registerOpenDelete,
      registerOpenArchive,
    ],
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
