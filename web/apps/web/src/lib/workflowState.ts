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
  if (_input.health?.ok) return "ready";
  if (_input.health || _input.error || !_input.loading) return "offline";
  return "loading";
}

export function resolveResourceState(_input: ResourceStateInput): ResourceState {
  if (_input.hasData) return "ready";
  if (_input.error) return "error";
  return _input.loading ? "loading" : "ready";
}

export function getBackgroundError(_error: string | null, _hasData: boolean): string | null {
  return _hasData ? _error : null;
}

export function canUseSettingsResource(
  _engineState: EngineState,
  _resource: ResourceStateInput,
): boolean {
  return _engineState === "ready" && resolveResourceState(_resource) === "ready";
}

export function canUseRecoveryTools(_engineState: EngineState): boolean {
  return _engineState === "ready";
}

export function shouldMountPlanTools(
  _engineState: EngineState,
  _selectedProfileId: number | null,
): boolean {
  return _engineState === "ready" && _selectedProfileId != null;
}
