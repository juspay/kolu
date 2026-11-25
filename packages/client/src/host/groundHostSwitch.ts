import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { Setter } from "solid-js";
import { hostReconcileTarget } from "./hostReconcile.ts";

/** Where a REQUESTED active host may actually be seated, given membership.
 *
 *  `departed` is the host the request NAMED when it could not be seated — the
 *  one the toast is about — and `null` when the request stands as asked. */
export type GroundedHostSwitch = {
  target: HostKey;
  departed: HostKey | null;
};

/** Ground a requested active host against membership — the write-side reading
 *  of the SAME {@link hostReconcileTarget} decision wire.ts's membership effect
 *  enacts, so a write and a membership frame can never disagree about who is a
 *  member.
 *
 *  A surface can name a host that has since left (an attention jump off a
 *  notification, a palette row built before the pool moved). Seating it would
 *  strand the tab on a dead host — `useEntry` does not re-key on its own, so
 *  every `activePadiRpc` call throws `MAP_KEY_UNKNOWN`, the canvas freezes and
 *  no chip is lit — so a non-member request is seated on the local default
 *  instead, and named. Before the first membership snapshot lands there is
 *  nothing to ground against, which that decision already answers as a no-op. */
export function groundHostSwitch(
  keys: readonly HostKey[],
  next: HostKey,
  localHost: HostKey,
): GroundedHostSwitch {
  const action = hostReconcileTarget(keys, next, null, localHost);
  if (action === null) return { target: next, departed: null };
  return { target: action.target, departed: next };
}

/** Say that a host is gone and the canvas has moved — the ONE wording, shared
 *  by the grounded write and the membership effect's departed-bounce. */
export function hostDepartedMessage(departed: HostKey): string {
  return `Host "${encodeHostKey(departed)}" left the pool — switched to the local host`;
}

/** What the grounded setter needs of its surroundings: the pool it grounds
 *  against, the signal it seats into, and the toast it says a departure with.
 *  Injected rather than imported so the setter wire.ts actually installs is the
 *  one a unit test drives (`groundHostSwitch.test.ts`). */
export type GroundedHostSetterDeps = {
  /** Pool membership, read as a FACT: the caller untracks it, so a writer
   *  standing in a reactive scope never subscribes to the pool. */
  members: () => readonly HostKey[];
  /** The current active host, for an updater-shaped write. */
  intent: () => HostKey;
  /** Seat a grounded host — the raw signal setter. */
  seat: (host: HostKey) => HostKey;
  localHost: HostKey;
  warn: (message: string) => void;
};

/** THE active-host setter: every write goes through the grounding above, so an
 *  ungrounded active host is unrepresentable at the one place it could be
 *  written rather than corrected a flush later by the effect that reads it.
 *  That is what lets wire.ts's reconcile effect be driven by MEMBERSHIP alone. */
export function createGroundedHostSetter(
  deps: GroundedHostSetterDeps,
): Setter<HostKey> {
  return ((value: HostKey | ((prev: HostKey) => HostKey)) => {
    const next = typeof value === "function" ? value(deps.intent()) : value;
    const grounded = groundHostSwitch(deps.members(), next, deps.localHost);
    if (grounded.departed !== null) {
      deps.warn(hostDepartedMessage(grounded.departed));
    }
    return deps.seat(grounded.target);
    // `Setter<HostKey>`'s overload set (a value, an updater, and the arms a
    // non-nullable signal cannot take) is not expressible in one implementation
    // signature; the two arms above are its whole surface here.
  }) as Setter<HostKey>;
}
