import { activeScope } from "../hostScope/hostScopes";

/** Whether the ACTIVE host's dock shows sleeping (☾) rows. Defaults to `true`
 *  while no scope is active. */
export function showSleeping(): boolean {
  return activeScope()?.prefs.showSleeping() ?? true;
}

/** Toggle/set the ACTIVE host's ☾ filter (a no-op with no active scope). */
export function setShowSleeping(
  next: boolean | ((prev: boolean) => boolean),
): void {
  activeScope()?.prefs.setShowSleeping(next);
}
