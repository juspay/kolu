/**
 * The once-per-supervisor-boot fence for the BUILD-mismatch drain arm.
 *
 * A supervisor drains a same-contract, DIFFERENT-BUILD survivor at most ONCE across its
 * whole process lifetime — a reconnect within the same supervisor process NEVER
 * re-drains. This is the anti-livelock guarantee for the build axis: store hashes DON'T
 * order (there is no "newer build"), so a repeated mismatch-drain between two persistent
 * supervisors at different builds would livelock; the fence makes each supervisor drain
 * at most once at ITS boot, so sequential deploys converge to last-deployed and can never
 * flap. It lives with the SUPERVISOR PROCESS (created once at boot), NOT the connection —
 * so every reconnect shares the one fence.
 *
 * Deliberately distinct from the CONTRACT axis, which needs NO fence: its monotone
 * version ordering IS the anti-livelock guarantee (only the strictly-newer supervisor
 * ever supersedes, so an older one never drains the newer's daemon back).
 */
export interface BuildDrainFence {
  /** Has this supervisor already performed (or committed to) its ONE build-mismatch drain? */
  hasFired: () => boolean;
  /** Mark the one build-mismatch drain as done — no reconnect re-drains after this. */
  markFired: () => void;
}

/** A fresh, un-fired {@link BuildDrainFence}. Exactly one per supervisor boot. */
export function createBuildDrainFence(): BuildDrainFence {
  let fired = false;
  return {
    hasFired: () => fired,
    markFired: () => {
      fired = true;
    },
  };
}
