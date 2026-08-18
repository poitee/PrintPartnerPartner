export type AuxiliaryErrors = Record<string, string>;

export function setAuxiliaryError(
  errors: AuxiliaryErrors,
  _key: string,
  _message: string,
): AuxiliaryErrors {
  return errors;
}

export function clearAuxiliaryError(
  errors: AuxiliaryErrors,
  _key: string,
): AuxiliaryErrors {
  return errors;
}

export function currentAuxiliaryError(_errors: AuxiliaryErrors): string | null {
  return null;
}
