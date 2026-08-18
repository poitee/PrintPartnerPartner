export type EngineState = "loading" | "offline" | "ready";
export type ResourceState = "loading" | "error" | "ready";

type EngineStateInput = {
  health: { ok: boolean } | null;
  loading: boolean;
  error: string | null;
};

type ResourceStateInput = {
  loading: boolean;
  error: string | null;
  hasData: boolean;
};

export function resolveEngineState(_input: EngineStateInput): EngineState {
  return "loading";
}

export function resolveResourceState(_input: ResourceStateInput): ResourceState {
  return "loading";
}

export function getBackgroundError(_error: string | null, _hasData: boolean): string | null {
  return null;
}

export function canUseSettingsResource(
  _engineState: EngineState,
  _resource: ResourceStateInput,
): boolean {
  return false;
}

export function canUseRecoveryTools(_engineState: EngineState): boolean {
  return false;
}

export function shouldMountPlanTools(
  _engineState: EngineState,
  _selectedProfileId: number | null,
): boolean {
  return false;
}
