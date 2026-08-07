export const WORKFLOW_ONBOARDING_STORAGE_KEY = "print-partner.workflow.onboarding.v1";

/** True after the user completes Sources → Build → Review once. */
export function isWorkflowOnboardingComplete(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(WORKFLOW_ONBOARDING_STORAGE_KEY) === "1";
}

export function markWorkflowOnboardingComplete(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(WORKFLOW_ONBOARDING_STORAGE_KEY, "1");
}
