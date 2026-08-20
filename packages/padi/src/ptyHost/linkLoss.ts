/**
 * The self-healing arm of padi's kaval endpoint (juspay/kolu#2182): re-converge
 * when the held connection dies MID-SESSION.
 *
 * ## The defect this closes
 *
 * The endpoint reports `degraded` when the connection it holds closes, and until
 * this module nothing ever re-dialled. In the field padi sat degraded for 52
 * minutes with a perfectly healthy kaval still serving behind the dead socket
 * (the link died on an RPC ping timeout — most likely a padi event-loop stall),
 * `ptyHostClient` threw on every call, and the only recovery the UI offered
 * destroyed every running terminal. Restarting padi BY HAND fixed it in one
 * step, and that is the whole design: padi's boot re-runs `converge`, which
 * ADOPTS the same-build resident kaval (9 PTYs and 8 agents survived the manual
 * restart). This module is that boot step, re-armed as an invariant — the same
 * move `kavalSupervision` made for the probe ("convergence was an event; this
 * makes it an invariant"), one failure mode over.
 *
 * ## Why `degraded`, and only after a `connected`
 *
 * `degraded` is the one state that means "we HELD a connection and lost it",
 * which is exactly what makes re-converging a treatment rather than a hot loop
 * against a daemon that never came up. A dead-on-boot daemon reports `dead` and
 * keeps today's behaviour (the card and its button); the `everConnected` latch
 * says so in one bit.
 *
 * ## What it cannot race
 *
 *   - **Itself.** The heal claim is the in-flight token — presence IS the flag,
 *     the idiom `serializeRestart` uses for the same job one layer down. An
 *     attempt is never started while one is running.
 *   - **A restart.** A user "Restart kaval" and the steady-state supervision
 *     auto-recycle both reach the endpoint through ONE trigger, and that trigger
 *     is claimed where it is built: the claim is taken SYNCHRONOUSLY, so no heal
 *     can start behind it, and it then waits out an attempt already mid-converge.
 *     Both sides check, so the exclusion is total rather than one-directional —
 *     which matters because two spawns at one rendezvous is the "the new daemon
 *     yields to the live gate holder" no-op recycle the spine fails loudly on.
 *     Both sides are `endpointClaim.ts`'s, not this module's: an arbiter of two
 *     arms cannot live inside one of them.
 *   - **A stale trigger.** The status is re-read at FIRE time, never at arm
 *     time. A link healed by any other path has already reported `connected`,
 *     which cancels the loop and resets the backoff.
 *
 *   The endpoint's own emit-guard (`underRestartHold`) is what makes the second
 *   point cheap: it already repaints a restart's transient `degraded` as
 *   `restarting`, so a restart's own teardown can never look like a link loss.
 *   The claim closes the one instant that guard cannot cover — the trigger
 *   invoked, its `holdRestarting` not yet emitted.
 *
 * ## What a heal announces — the verdict is the message
 *
 * A heal that ADOPTS and a heal that lands on a fresh daemon are two different
 * facts about the user's session, so {@link ConvergeVerdict} is handed to
 * `onRecovered` rather than swallowed into the journal line. `adopted` means the
 * LINK was re-made and nothing was lost — the same pid, the same PTYs, the same
 * agents. `no-survivors` / `recycled` mean the daemon is new and the saved
 * session is parked, which is what `startKavalSupervision`'s recycle proves and
 * why only those two share its stamp. Collapsing them (as #2182 first shipped)
 * makes the client tell an adopted session it was restarted and is "ready to
 * restore" while it is still running.
 *
 * ## Timer choice — node timers, not Effect's Clock
 *
 * The ruling `kavalSupervision` wrote down (see its "Timer choice" section), for
 * the same two reasons: (1) the timer must be `unref`'d — a pending heal must
 * never be the thing holding a draining padi open — and Effect 4's default
 * `Clock` sleeps on a plain, REF'd `setTimeout`, so `Effect.sleep` /
 * `Schedule` cannot express this timer without a bespoke Clock service; and (2)
 * it is a CHAINED `setTimeout`, never `setInterval`, so a converge that outlasts
 * its backoff can never overlap the next attempt.
 *
 * ## Why unbounded retries are not the unbounded retry the doctrine forbids
 *
 * Each attempt is bounded — by the endpoint's own dial, handshake and
 * socket-ready deadlines — and the interval is bounded below by the backoff and
 * above by its 30 s ceiling. What is unbounded is only how long padi keeps
 * trying, and the alternative (give up after N) is precisely the permanent
 * `degraded` this exists to end.
 */

import type { EndpointState } from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { log } from "../log.ts";
import type { KavalObservation } from "../kavalObservation.ts";
import { healClaimed, restartClaimed, withHealClaim } from "./endpointClaim.ts";
import type { ConvergeVerdict } from "./reconcileConverged.ts";

/** The first wait before a re-converge, and the ceiling the doubling stops at.
 *  Not knobs — there is no override path and no env read: a link that died with
 *  a healthy daemon still behind it is re-dialled within a second, and a link
 *  that stays down is re-dialled twice a minute forever, with one WARN per
 *  attempt either way. */
const BACKOFF_MS = 1_000;
const BACKOFF_CEILING_MS = 30_000;

/** The healer's one seam onto the endpoint: every status it publishes. */
export interface LinkLossHealer {
  /** Fold one published status into the loop. TOTAL and cheap by contract: the
   *  endpoint's `onStatus` is SYNCHRONOUS (it is called from the transport's own
   *  `onClose`), so this may only arm a timer — the converge happens on that
   *  timer, off the emit's stack. */
  observe(state: EndpointState): void;
}

export function startLinkLossHealer(deps: {
  /** Re-converge the endpoint and run the SAME post-converge hooks the boot runs
   *  (adopt-reconcile, its fail-closed recycle, or the no-survivor park). A
   *  VALUE, not a thunk — an Effect is already the description of work not yet
   *  done — and re-run per attempt. */
  readonly reconverge: Effect.Effect<ConvergeVerdict, unknown>;
  /** Stamp the PROVEN recovery so the client toasts it once, told WHICH recovery
   *  this was. The verdict is not a detail of the log line: an `adopted` heal
   *  re-made the LINK to a daemon that never stopped serving (every terminal and
   *  agent kept running), while `no-survivors` / `recycled` mean the daemon
   *  itself is new and the saved session is parked for restore. Only the second
   *  is what `startKavalSupervision`'s `onRecovered` proves, so only the second
   *  may share its stamp and its sentence. Injected, so this module never reaches
   *  into the status store.
   *
   *  REQUIRED, like `stillServing` and for the same reason: a heal nobody is told
   *  about is a silent recovery, and the user is left reading a page that said
   *  the connection was lost. An optional announcement is a graceful-degradation
   *  path, which is a defect here rather than a convenience. */
  readonly onRecovered: (verdict: ConvergeVerdict) => void;
  /** Is the daemon we lost the link to STILL SERVING at the rendezvous? The
   *  healer's precondition, and the reason it cannot become a respawn LOOP.
   *
   *  `converge` spawns when it finds nobody home (`convergence/converge.ts` —
   *  "probe-origin absence → decide(null) → spawn/bind"), so a healer that
   *  converged unconditionally would RESTART a daemon that had died rather than
   *  re-attach to one that had not — at this loop's cadence, with this loop's
   *  backoff reset on every connect, and past the give-up the steady-state probe
   *  arm spends its ledger to reach. That is the hot restart loop
   *  `KAVAL_SUPERVISION_SPEC.unrepaired` exists to bound and `/padi` publishes as
   *  a promise ("padi stops restarting … a hot restart loop is not a repair").
   *  A lost LINK and a dead DAEMON are two faults with two owners; this predicate
   *  is where the healer declines the one that is not its own.
   *
   *  What it rules out is the LOOP, not every spawn: the reading and the converge
   *  are two dials, so a daemon that exits between them is still converged into
   *  existence once — and a dying daemon (OOM, shutdown) is exactly one that drops
   *  its links first and exits seconds later. That single spawn is self-limiting
   *  (the next round reads `unreachable` and stands down) but it is unledgered,
   *  and it is honest to say so rather than to claim the guard is airtight. The
   *  airtight version is not spellable here: it needs an adopt-only mode on
   *  `converge` — one dial that refuses to create — which lives in
   *  `@kolu/surface-daemon-supervisor` and is a shared-package change.
   *
   *  The sensor's OWN word for what it saw, not a second vocabulary for it — one
   *  condition with two names is one a field log cannot correlate. What each
   *  answer means to THIS loop:
   *
   *  - `healthy` — a daemon answered. Our link is the only thing that broke, so
   *    re-converging re-attaches to it and nothing is spawned or killed.
   *  - `wedged` — something holds the socket but could not answer. Waiting is
   *    right: a converge here would meet the silence deadline and TAKE OVER a
   *    daemon whose repair the probe arm already owns (and budgets), and a daemon
   *    merely busy for one 5 s window is one we must not give up on either. So:
   *    no converge, and no stand-down — probe again after the next backoff.
   *  - `unreachable` — nothing is listening. Not our fault to fix: re-converging
   *    would SPAWN, which is a restart, which is the probe arm's ledgered job. */
  readonly stillServing: Effect.Effect<KavalObservation["kind"]>;
  /** First-wait override, in ms — a TEST seam (like `startKavalSupervision`'s
   *  `pollMs`); production omits it. */
  readonly backoffMs?: number;
}): LinkLossHealer {
  const firstMs = deps.backoffMs ?? BACKOFF_MS;
  /** The last state the endpoint published. Read it through {@link published},
   *  never off a narrowed local: it moves under every `await` below, and
   *  re-reading it at fire time is exactly why a stale trigger cannot act. */
  let state: EndpointState | undefined;
  const published = (): EndpointState | undefined => state;
  /** Have we ever held a connection? Latched for the process: a link lost once
   *  is a link that can be lost again, and the next loss is this same incident
   *  class. */
  let everConnected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** How many re-converges this incident has actually RUN — a running total, not
   *  the number of ticks: a tick that stands down or reschedules never becomes an
   *  attempt. */
  let attempts = 0;
  let waitMs = firstMs;

  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    attempts = 0;
    waitMs = firstMs;
  };

  const arm = (): void => {
    // One pending attempt at a time, and none while one runs — a running attempt
    // re-arms itself if it fails.
    if (timer !== undefined || healClaimed()) return;
    const backoffMs = waitMs;
    timer = setTimeout(() => {
      timer = undefined;
      void tick(backoffMs);
    }, backoffMs);
    timer.unref?.();
  };

  /** Escalate the wait — only after an attempt that did NOT restore the link.
   *  The backoff encapsulates how hard we are FAILING, so a tick that never
   *  converged (a restart owns the endpoint, the daemon is wedged) must not spend
   *  it: a kaval merely busy for a minute would otherwise reach the 30 s ceiling
   *  without one converge having been tried, and the link would then stay down
   *  for up to another 30 s after the daemon answered again. */
  const backOff = (): void => {
    waitMs = Math.min(waitMs * 2, BACKOFF_CEILING_MS);
  };

  /** May this tick converge RIGHT NOW? Asked again after every await, because
   *  each one can invalidate the answer: our own attempt owns the chain (it
   *  re-arms itself), a restart owns the ENDPOINT — the one case that reschedules
   *  behind it — and a status that is no longer `degraded` means the link healed,
   *  or died terminally, by some other path. */
  const cleared = (): boolean => {
    if (healClaimed()) return false;
    if (restartClaimed()) {
      arm();
      return false;
    }
    return published() === "degraded";
  };

  /** ONE re-converge. Never rejects: the loop owns the retry, so a failed
   *  attempt is a logged fact it folds in — never an escaping rejection, and
   *  never one a waiting restart could inherit.
   *
   *  It is told WHICH attempt it is rather than reading the counter: a converge
   *  that succeeds publishes `connected` from inside itself, which resets the
   *  counter before the line below is written.
   *
   *  Returns the verdict a converge settled on, or `undefined` when the attempt
   *  failed. It does NOT announce: whether the link actually came back is one
   *  decision, and the caller is where both readings of it meet. */
  const runAttempt = async (
    attemptNo: number,
  ): Promise<ConvergeVerdict | undefined> => {
    try {
      const verdict = await Effect.runPromise(deps.reconverge);
      // "settled", not "restored": the caller owns the one reading of whether
      // the link actually came back, and a converge can settle on a verdict and
      // then lose the link again during its own reconcile. Journalling the
      // stronger word here would make a field grep count attempts that restored
      // nothing.
      log.info(
        { attempt: attemptNo, verdict },
        `kaval re-converge settled — ${verdict}`,
      );
      return verdict;
    } catch (err) {
      log.error(
        { err, attempt: attemptNo },
        "kaval re-converge attempt failed — the link is still down; retrying after the next backoff",
      );
      return undefined;
    }
  };

  const tick = async (backoffMs: number): Promise<void> => {
    if (!cleared()) return;
    // The precondition, re-asked at every fire because it is a fact about NOW:
    // only a daemon that is still serving is a link this loop may re-make.
    //
    // A rejection here is NOT folded into an observation. `observeHeldKaval`
    // already absorbs both the failure and the defect channel into a
    // `KavalObservation`, so nothing that reaches this `catch` is a probe that
    // answered badly — it is a bug in the injected Effect. Fail loudly and treat
    // the tick as undecided: declining to converge is what makes a spawn
    // impossible, and it costs one backoff to ask again.
    const observed = await Effect.runPromise(deps.stillServing).catch(
      (err: unknown) => {
        log.error(
          { err, nextAttempt: attempts + 1 },
          "kaval residency probe THREW — the reading is a bug in the sensor, not a verdict about the daemon; re-checking after the next backoff",
        );
        return undefined;
      },
    );
    // The probe took up to its own deadline, so the clearance read before it is
    // now stale — a restart can have claimed the endpoint, or the link can have
    // healed, while we were asking. Ask again rather than act on what was true
    // 5 s ago.
    if (!cleared()) return;
    if (observed !== "healthy") {
      // One line per DECISION, not per tick: a silent decline is how a degraded
      // padi looks identical to a padi nobody is watching.
      // `nextAttempt`, not `attempt`: no attempt ran here, and one key for both
      // facts would make a field-log grep for `attempt: 3` match a decline that
      // did nothing as well as the converge that later ran as attempt 3.
      if (observed !== undefined) {
        log.warn(
          { observed, nextAttempt: attempts + 1 },
          observed === "unreachable"
            ? "kaval link lost and nothing is serving the socket — a converge here would SPAWN, which is the steady-state probe arm's ledgered job; re-checking after the next backoff"
            : "kaval link lost and the daemon is not answering — a wedged daemon is the steady-state probe arm's to repair; re-checking after the next backoff",
        );
      }
      // ALWAYS re-arm. What makes a respawn impossible is declining to CONVERGE,
      // which every branch here already does — so stopping the loop buys nothing
      // and costs the bug it was meant to prevent. A single `unreachable` is not
      // proof the daemon is gone for good (the bind gap of an out-of-band
      // restart reads exactly like it), and a healer that stood down on one
      // would sit out the daemon's return: the probe arm does not re-dial a
      // HEALTHY daemon — it clears its ledger and recycles nothing — so nobody
      // would re-make the link and padi would stay degraded with the destructive
      // button as its only exit. That is #2182 again, through the door this
      // guard opened. Re-arming costs one probe per backoff and nothing else.
      arm();
      return;
    }
    attempts += 1;
    const attemptNo = attempts;
    log.warn(
      { attempt: attemptNo, backoffMs },
      `kaval link lost mid-session — re-converging (attempt ${attemptNo}, backoff ${backoffMs}ms)`,
    );
    // Under the heal claim for the whole attempt — the arbiter publishes the
    // token before the attempt starts, so the converge and everything its
    // reconciliation reaches already sees the heal that is running it.
    const verdict = await withHealClaim(() => runAttempt(attemptNo));
    // ONE reading of "did the link come back": a verdict AND an endpoint that is
    // actually connected. A converge that succeeded emits `connected` from
    // inside itself, so `observe` has already cancelled this loop and reset the
    // backoff; anything else — a failed attempt, or a "success" that left the
    // endpoint down — is still a link to heal, and is not a recovery to
    // announce. Decided HERE rather than leaning on the status store to drop a
    // stamp this module never sees.
    if (verdict !== undefined && published() === "connected") {
      deps.onRecovered(verdict);
      return;
    }
    // This attempt did not restore the link, which is the one thing the backoff
    // measures — so escalate, then re-arm.
    backOff();
    arm();
  };

  return {
    observe: (next: EndpointState): void => {
      state = next;
      if (next === "connected") {
        everConnected = true;
        cancel();
        return;
      }
      // `dead` / `incompatible` are boot-time or terminal verdicts this loop does
      // not treat, and `restarting` / `connecting` are somebody else's in-flight
      // transition. Only a LOST connection is ours.
      if (next !== "degraded") return;
      if (!everConnected) return;
      arm();
    },
  };
}
