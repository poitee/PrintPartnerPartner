export type DebouncedAutosave = {
  schedule: () => void;
  flush: () => Promise<void>;
  dispose: () => void;
  clearTimer: () => void;
};

type Options = {
  delayMs: number;
  onSave: () => Promise<void>;
  isDirty: () => boolean;
};

export function createDebouncedAutosave({ delayMs, onSave, isDirty }: Options): DebouncedAutosave {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = async () => {
    clearTimer();
    if (isDirty()) {
      await onSave();
    }
  };

  const schedule = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void onSave();
    }, delayMs);
  };

  const dispose = () => {
    void flush();
  };

  return { schedule, flush, dispose, clearTimer };
}
