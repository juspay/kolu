import { type HostKey, hostKeysInclude } from "kolu-common/hostKey";

export type HostReconcileAction =
  | { kind: "activate-joined"; target: HostKey }
  | { kind: "bounce-departed"; target: HostKey };

const isPreSnapshotWindow = (keys: readonly HostKey[]): boolean =>
  keys.length === 0;

const isUnremovableDefault = (active: HostKey): boolean =>
  active.kind === "local";

const isStillMember = (keys: readonly HostKey[], active: HostKey): boolean =>
  hostKeysInclude(keys, active);

export function hostReconcileTarget(
  keys: readonly HostKey[],
  active: HostKey,
  pendingJoin: HostKey | null,
  localHost: HostKey,
): HostReconcileAction | null {
  if (pendingJoin !== null && hostKeysInclude(keys, pendingJoin)) {
    return { kind: "activate-joined", target: pendingJoin };
  }
  if (isPreSnapshotWindow(keys)) return null;
  if (isUnremovableDefault(active)) return null;
  if (isStillMember(keys, active)) return null;
  return { kind: "bounce-departed", target: localHost };
}
