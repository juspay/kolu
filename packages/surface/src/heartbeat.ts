/**
 * The half-open-link watchdog, framework-free — one interval that races a cheap
 * `probe` against a `timeoutMs`, settles exactly once per tick (answer-or-timeout
 * wins, the other a no-op), skips a tick while a probe is still in flight, `unref`s
 * its timers, and a `dispose()` that clears an outstanding probe so it can't fire
 * late.
 *
 * A SILENTLY half-open link — TCP dead with no FIN/RST after a laptop sleep,
 * Wi-Fi roam, or a NAT/proxy evicting an idle connection — fires neither `close`
 * nor `error`, so without a watchdog the link sits "open" forever and every stream
 * hangs. This is the one algorithm that detects that and hands recovery back to
 * the transport, and it lives HERE once: both legs that need it consume it instead
 * of re-deriving it.
 *
 *   - the BROWSER leg (`@kolu/surface-app`'s partysocket `createHeartbeat`) passes
 *     `isLive: () => ws.readyState === ws.OPEN` and `onStale: () => ws.reconnect()`;
 *   - the SSH leg (`@kolu/surface-nix-host`'s HostSession) passes
 *     `isLive: () => this.connection === 'connected'` and `onStale: () => this.recheck()`.
 *
 * The two variation points the legs differ on — the "is the link live enough to
 * probe?" GATE and the "the link is lying, recover it" ACTION — are the two
 * injected callbacks (`isLive`, `onStale`); everything else (the race, the
 * single-settle, the skip-overlap, the late-fire-safe dispose, the
 * synchronous-throw branch) is shared.
 *
 * Framework-free: timers only, no SolidJS, no partysocket — so the ssh leg can
 * consume it without pulling in a browser transport. Lives in `@kolu/surface`
 * (which both legs already depend on) so the dependency arrow points OUT of both.
 */

/** How often the watchdog probes a live link, and how long it waits for an answer
 *  before declaring the link half-open. A healthy peer answers in milliseconds, so
 *  the 10s timeout is a confident dead-signal; the 15s interval keeps the keep-
 *  alive cheap. Worst-case auto-recovery after a link goes silently dead is one
 *  interval + one timeout (~25s). Single-sourced here so the browser leg and the
 *  ssh leg pin the SAME cadence by structure, not a convention comment. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;

/** Upper bounds on the tunable timing — a watchdog this is the whole point of must
 *  fire on a useful cadence, so a value past these (`intervalMs: 2_000_000_000` — a
 *  ~23-day interval under `setTimeout`'s 2³¹−1 cap — or a multi-minute `timeoutMs`)
 *  is a watchdog that effectively never fires: a branded-but-blind signal. Per the
 *  repo's fail-fast rule, an absurd value CRASHES rather than silently degrades. The
 *  bounds are generous (default 15s/10s; tuning to a slower minute-scale cadence is
 *  fine) — they only reject the pathological. */
export const MAX_HEARTBEAT_INTERVAL_MS = 300_000; // 5 min
export const MAX_HEARTBEAT_TIMEOUT_MS = 120_000; // 2 min

/** How far the wall clock may run ahead of the monotonic clock across a single
 *  probe before the watchdog reads the gap as a runtime SUSPENSION — a laptop
 *  sleep, a tab freeze, an app-switch occlusion — rather than a genuine missed
 *  answer. While the runtime is actually RUNNING the two clocks track within timer
 *  jitter (both advance in real time, even under CPU starvation or background
 *  throttling); they only DIVERGE when the process is frozen (the monotonic clock
 *  pauses while the wall clock keeps going) or the wall clock is stepped. A full
 *  second is comfortably above jitter / NTP slew yet far below any freeze long
 *  enough to drop a connection, so a gap past it means the probe's `timeoutMs`
 *  window was NOT a fair, continuously-running one — the timer slept through part
 *  of it and fired overdue on resume. The mis-fire direction is benign: a gap
 *  that is a false positive only ever VOIDS-and-re-probes (one extra cheap probe),
 *  it can never force a spurious `onStale`. */
export const SUSPENSION_SLACK_MS = 1_000;

/** Cumulative FOREGROUND (monotonic) running-time budget for voiding suspected-
 *  suspension probes before the watchdog stops deferring and fires `onStale`
 *  anyway — a multiple of one full probe cycle (`intervalMs + timeoutMs`).
 *  Voiding may DEFER a stale verdict across a real suspension, but a pathological
 *  freeze/resume flap (or a clock that reports a gap every tick) must never
 *  SILENCE it: once this much *running* time elapses with every probe voided and
 *  none settling, the next void converts to a stale verdict. Measured on the
 *  monotonic clock, so genuinely-suspended time never spends the budget — this is
 *  the watchdog-of-the-watchdog that keeps "voided forever ⇒ silent" unspellable. */
export const VOID_BUDGET_FACTOR = 3;

/** The monotonic clock the suspension check reads — `performance.now()` where
 *  present (every browser, Node ≥ 16), else `Date.now()`. The fallback collapses
 *  the wall/mono gap to ~0, which only DISABLES suspension-voiding (degrading to
 *  the pre-fix behaviour where a frozen-then-resumed probe forces a reconnect) —
 *  it never blinds the watchdog, the fail-safe direction. */
const monotonicNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/** The app-facing knob to TUNE (never disable) the watchdog the connect seams /
 *  `createLiveSignal` wire. Framework-free (no solid) so the framework-free
 *  `@kolu/surface-app/connect` can build its `HeartbeatConfig` on it too. `onStale`
 *  here is the REPORTER (run after the recovery), not the action. There is no
 *  disable variant: a brand-minting seam that disabled its watchdog would mint a
 *  branded-but-blind signal. */
export interface HeartbeatTuning {
  /** How often to probe while the link is live. Default {@link DEFAULT_HEARTBEAT_INTERVAL_MS}. */
  intervalMs?: number;
  /** How long to wait for a probe before declaring half-open. Default {@link DEFAULT_HEARTBEAT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Report a forced reconnect (a missed probe). Defaults to a `console.warn`. */
  onStale?: () => void;
}

/** Options for {@link createHeartbeat}. */
export interface HeartbeatOptions {
  /** Gate: probe only when the link is live enough to answer. The browser leg
   *  passes `() => ws.readyState === ws.OPEN`; the ssh leg passes
   *  `() => this.connection === "connected"`. A tick where this is false is a
   *  no-op, so the (possibly minutes-long) connecting/backoff windows are never
   *  probed. */
  isLive: () => boolean;
  /** The recovery ACTION run when a probe TIMES OUT (the link is lying — "open"
   *  but not answering). The browser leg passes `() => ws.reconnect()`; the ssh
   *  leg passes `() => this.recheck()`. Run FIRST and guarded, so a throwing
   *  reporter (below) can never defeat the recovery this watchdog exists to
   *  provide. */
  onStale: () => void;
  /** A cheap round-trip whose RESOLUTION is the liveness signal (its value is
   *  ignored). A REJECTION still counts as alive — the round-trip completed (the
   *  peer answered, even with an error) — so only a TIMEOUT (no answer at all)
   *  means half-open. A SYNCHRONOUS throw is treated DIFFERENTLY: it means no
   *  round-trip happened (the probe is miswired), so it is reported via
   *  `onProbeError` and does NOT trigger the on-stale action. */
  probe: () => Promise<unknown>;
  /** How often to probe while `isLive()`. Default {@link DEFAULT_HEARTBEAT_INTERVAL_MS}. */
  intervalMs?: number;
  /** How long to wait for a probe before declaring the link half-open and running
   *  `onStale`. Default {@link DEFAULT_HEARTBEAT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Report a forced recovery (a missed probe). Optional — run guarded AFTER
   *  `onStale`, so it can never defeat the recovery. */
  onStaleReport?: () => void;
  /** Report a probe that threw SYNCHRONOUSLY (a miswired/broken probe, distinct
   *  from an async rejection). Optional. */
  onProbeError?: (error: unknown) => void;
  /** The wall + monotonic clock pair the suspension check reads, gathered into ONE
   *  both-or-neither container (matching the repo's `deps` test-seam convention —
   *  renderRecovery / scrollLock) so the illegal half-injected state (a fake wall
   *  clock + the real `performance.now`, whose gap always reads as suspended) is
   *  unspellable. Injectable ONLY so a test can model "the wall clock advanced
   *  while the event loop was frozen" — which fake timers alone cannot express,
   *  since advancing a fake timer also advances both clocks together, so their gap
   *  stays 0. Production passes nothing and gets the real `Date.now` /
   *  `performance.now` globals. */
  deps?: { now: () => number; mono: () => number };
}

/** Crash unless `value` is a positive, finite millisecond count within `max` — the
 *  fail-fast guard against a watchdog tuned so slow it effectively never fires (a
 *  branded-but-blind signal). */
function assertSaneMs(label: string, value: number, max: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    throw new Error(
      `createHeartbeat: ${label} must be a positive number ≤ ${max}ms — got ${value}. ` +
        "A watchdog whose timing effectively never fires is a branded-but-blind " +
        "liveness signal; the value is rejected rather than silently degraded.",
    );
  }
}

/** Build the half-open-link watchdog. Each tick — only while `isLive()` — races
 *  `probe` against `timeoutMs`. A probe that doesn't answer in time normally means
 *  the link is half-open, so `onStale()` runs (abandon-and-recover). One miss
 *  forces the action (no multi-miss debounce that would only lengthen the freeze),
 *  and ticks never overlap: a tick is skipped while the previous probe is still
 *  outstanding.
 *
 *  A probe is only a FAIR test of the link if the runtime ran continuously for the
 *  whole `timeoutMs` window. A laptop sleep / tab freeze / app-switch occlusion
 *  PAUSES the event loop — the probe timer sleeps through the gap and fires overdue
 *  on resume, when the link is often perfectly healthy. So before declaring stale,
 *  the watchdog compares elapsed WALL time to elapsed MONOTONIC time across the
 *  probe: if the wall clock ran far ahead (the gap a frozen monotonic clock leaves
 *  behind), the window was NOT continuous — the verdict is VOID, and the watchdog
 *  abandons the probe WITHOUT `onStale` and re-probes immediately over a fresh,
 *  fully-running window. The void is the watchdog's OWN arithmetic over its clocks,
 *  not a caller-supplied "suspended?" boolean — so there is no knob to pin true and
 *  silence `onStale`. A void-budget ceiling (`VOID_BUDGET_FACTOR`) keeps repeated
 *  voiding from deferring a real stale verdict forever.
 *
 *  `wake()` is the browser leg's fast path: a wake event (window focus / page
 *  resume) means the runtime may have just resumed, so the in-flight probe's window
 *  can't be trusted — abandon it (without `onStale`) and re-probe NOW, rather than
 *  waiting for its overdue timeout to fire and void. A wake with no real suspension
 *  only re-probes a healthy link — including the FIRST wake after a long OS-awake
 *  tab freeze (where the monotonic clock advanced through the freeze): it re-probes
 *  a fresh window rather than reconnecting. But a sustained STORM of wakes faster
 *  than `timeoutMs` IS a void in disguise, so it honours a `VOID_BUDGET_FACTOR`
 *  ceiling of running time anchored at the first wake-abandon: once that budget is
 *  spent on a never-settling probe, the next wake fires stale — bounding the
 *  deferral without letting freeze time alone force a spurious reconnect.
 *
 *  Returns `dispose()` to stop the interval AND any in-flight probe timeout (so a
 *  probe outstanding at teardown can't fire a late `onStale`), plus `wake()`. */
export function createHeartbeat(opts: HeartbeatOptions): {
  dispose: () => void;
  wake: () => void;
} {
  const intervalMs = opts.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  // FAIL FAST on absurd timing — a watchdog whose interval/timeout effectively
  // never fires is a branded-but-blind signal, so crash loudly rather than wire a
  // dead watchdog (the repo's "no silent degradation" rule). Catches a positive
  // value past the sane max AND a non-positive / non-finite one.
  assertSaneMs("intervalMs", intervalMs, MAX_HEARTBEAT_INTERVAL_MS);
  assertSaneMs("timeoutMs", timeoutMs, MAX_HEARTBEAT_TIMEOUT_MS);
  const now = opts.deps?.now ?? Date.now;
  const mono = opts.deps?.mono ?? monotonicNow;
  // The void-budget ceiling in monotonic (running-time) ms — see VOID_BUDGET_FACTOR.
  const voidBudgetMs = (intervalMs + timeoutMs) * VOID_BUDGET_FACTOR;
  let inFlight = false;
  let disposed = false;
  // Each probe gets a generation. A probe's outcomes (its timeout firing, its
  // promise settling) only act while they belong to the CURRENT generation — so a
  // probe abandoned by a suspension-void or a `wake()` re-probe can never settle
  // the FRESH probe that replaced it. Without this, the immediate re-tick would let
  // an abandoned probe's late answer (or overdue timeout) drive the new one.
  let generation = 0;
  // The wall + monotonic readings at the CURRENT probe's launch. The timeout
  // compares elapsed wall vs elapsed monotonic against these to tell a genuine
  // no-answer (both advanced together) from a runtime SUSPENSION (wall jumped while
  // monotonic was frozen) the timer slept through and fired overdue on resume.
  let launchWall = 0;
  let launchMono = 0;
  // Monotonic time of the last DEFINITIVE settle (an alive answer OR a fired stale).
  // The suspension-void ceiling reads it; a void is NOT a settlement, so it is left
  // untouched while voiding, and the running time since it climbs until the budget
  // is spent and a void converts to a stale verdict.
  let lastSettledMono = mono();
  // Monotonic time of the FIRST wake-driven abandon since the last definitive settle
  // — the start of a possible wake STORM. `wake()` budgets running time from HERE,
  // not from `lastSettledMono`. Why the distinct anchor: the suspension-void path
  // only spends the budget while the monotonic clock is FROZEN (a genuine
  // suspension), so `lastSettledMono` there counts only running-time flapping. But a
  // wake fires for an OS-AWAKE tab freeze (Page-Lifecycle `resume`), where the
  // monotonic clock ADVANCED through the freeze (the wall/mono gap is ~0, so the
  // void never sees it — see `onWake`). Measured from `lastSettledMono`, that freeze
  // time would read as spent budget and force a spurious stale on the FIRST resume
  // wake. Anchored at the first wake-abandon instead, a lone resume always re-probes
  // a fresh window, and only a SUSTAINED storm (later wakes past the budget of
  // running time) converts to stale. `undefined` ⇒ no wake-abandon outstanding;
  // reset there by every definitive settle.
  let wakeStormStartMono: number | undefined;
  // The CURRENT probe's timeout, at function scope so `dispose()` can clear it —
  // otherwise a probe in flight at teardown would still run `onStale()` later.
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  // Resolve the current probe exactly once (the answer or the timeout wins, the
  // other becomes a no-op). On a timeout we run `onStale` FIRST and report SECOND,
  // each in a guarded block, so a throwing `onStale`/reporter can never defeat the
  // recovery this helper exists to provide. A guarded throw is surfaced via
  // `console.error` (not swallowed) — a recovery action that throws leaves the
  // link half-open with no recovery applied, which must never go silent. No-op once
  // disposed or once the probe has been superseded (a stale generation).
  const settled = (stale: boolean, gen: number) => {
    if (disposed || gen !== generation || !inFlight) return;
    inFlight = false;
    if (probeTimer !== undefined) {
      clearTimeout(probeTimer);
      probeTimer = undefined;
    }
    // A definitive verdict (alive OR stale) resets both budget clocks: the
    // suspension-void ceiling, and the wake-storm anchor (the storm is over — the
    // next wake-abandon starts a fresh window).
    lastSettledMono = mono();
    wakeStormStartMono = undefined;
    if (stale) {
      try {
        opts.onStale();
      } catch (error) {
        // A throwing recovery action must never unwind the watchdog timer — but
        // it must not vanish either: a recovery that throws means the link is
        // still half-open with NO recovery attempted, the exact "silent
        // half-open" this watchdog exists to prevent. Surface it loudly (the
        // package's fail-loud posture — `caught-error-must-not-collapse-to-empty`)
        // instead of swallowing, then keep the interval alive.
        console.error(
          "heartbeat: onStale recovery action threw — link may still be half-open, recovery NOT applied",
          error,
        );
      }
      try {
        opts.onStaleReport?.();
      } catch (error) {
        // A throwing status reporter must never unwind anything either — but
        // surface it rather than swallow (same fail-loud posture as above).
        console.error("heartbeat: onStaleReport reporter threw", error);
      }
    }
  };
  // Abandon the current probe WITHOUT a verdict — used by a suspension-void and by
  // `wake()`. Clears the timer and the in-flight flag, and bumps the generation so
  // the abandoned probe's still-pending promise settles into a no-op. Does NOT touch
  // `lastSettledMono`: a void is not a settlement, so the budget keeps climbing.
  const abandon = () => {
    inFlight = false;
    if (probeTimer !== undefined) {
      clearTimeout(probeTimer);
      probeTimer = undefined;
    }
    generation++;
  };
  function tick(): void {
    if (inFlight || disposed) return;
    if (!opts.isLive()) return;
    inFlight = true;
    const gen = ++generation;
    launchWall = now();
    launchMono = mono();
    probeTimer = setTimeout(() => {
      if (disposed || gen !== generation || !inFlight) return;
      // Was the probe's window a fair, continuously-running one? If the wall clock
      // ran far ahead of the monotonic clock, the runtime was SUSPENDED across it
      // (the timer slept through the gap and fired overdue on resume) — VOID the
      // verdict and re-probe over a fresh window, rather than declaring a healthy
      // link half-open. UNLESS the void budget is spent (a flap that has deferred a
      // verdict for too long of ACTUAL running time): then fall through and fire
      // stale, so voiding can never silence the watchdog.
      const currentMono = mono();
      const suspended =
        now() - launchWall - (currentMono - launchMono) > SUSPENSION_SLACK_MS;
      if (suspended && currentMono - lastSettledMono <= voidBudgetMs) {
        abandon();
        tick(); // fresh, full-timeoutMs probe over a continuously-running window
        return;
      }
      settled(true, gen);
    }, timeoutMs);
    probeTimer.unref?.();
    // A SYNCHRONOUS throw from `probe` means NO round-trip was made at all — the
    // probe is miswired (a bad client cast, a missing method), not a liveness
    // signal — so it must NOT be silently classified as alive the way a genuine
    // async REJECTION (the peer answered with an error) is. We surface it and
    // settle WITHOUT running `onStale`: a broken probe is a local fault the link
    // can't fix, so a recovery would only churn. The watchdog goes inert until the
    // probe is fixed, but the report makes that visible instead of silent.
    let probing: Promise<unknown>;
    try {
      probing = opts.probe();
    } catch (error) {
      // Report in a guarded block, then ALWAYS `settled(false)` — a throwing
      // reporter must not leave `inFlight`/`probeTimer` armed, or this local probe
      // fault would later be misclassified as a stale transport and force a
      // spurious `onStale()` (and an uncaught error in the timer).
      try {
        opts.onProbeError?.(error);
      } catch (reportError) {
        // A throwing status reporter must never defeat the settle below — but
        // surface it rather than swallow (the package's fail-loud posture).
        console.error("heartbeat: onProbeError reporter threw", reportError);
      }
      settled(false, gen);
      return;
    }
    Promise.resolve(probing).then(
      () => settled(false, gen),
      () => settled(false, gen),
    );
  }
  // "I just woke up" — a wake event (window focus / page resume, wired by the
  // browser leg) signals the runtime may have just resumed. The in-flight probe's
  // window can't be trusted (it may straddle the gap), so abandon it WITHOUT
  // `onStale` and probe fresh immediately — recovery in ~ms instead of waiting for
  // the overdue timeout to fire and void, or for the next interval.
  //
  // A wake re-probe IS a void in disguise — it abandons the in-flight probe's
  // window without a verdict, exactly like the suspension-void in the timeout. So a
  // flood of wake events faster than `timeoutMs` must not keep clearing the probe
  // deadline and defer `onStale` forever — the "voided forever ⇒ silent" the budget
  // exists to make unspellable. (`onWake` wires focus / visibility / resume here; a
  // half-open socket must not be kept off `onStale` by a storm of them.) So the wake
  // path carries its OWN running-time budget, anchored at the FIRST wake-abandon
  // since the last settle (`wakeStormStartMono`).
  //
  // Why a distinct anchor instead of `lastSettledMono` (the suspension-void's): a
  // wake fires for an OS-AWAKE tab freeze, where the monotonic clock ADVANCED
  // through the freeze, so `mono() - lastSettledMono` would include freeze time and
  // force a spurious stale on the FIRST resume wake — the exact reconnect this fast
  // path exists to avoid. Anchored at the first wake-abandon, a lone resume (even a
  // single resume that trips focus + visibility + resume at once — those land at the
  // same mono, well inside the budget) always abandons and re-probes a FRESH window;
  // the new probe then gets its full `timeoutMs` to settle (healthy ⇒ no reconnect)
  // or time out (dead ⇒ `onStale` via the normal path). Only a SUSTAINED storm —
  // later wakes that keep re-arming a never-settling probe past the budget of
  // RUNNING time since the storm began — converts to a stale verdict here.
  function wake(): void {
    if (disposed) return;
    if (inFlight) {
      if (wakeStormStartMono === undefined) {
        // First wake-abandon since the last settle: always re-probe a fresh window.
        wakeStormStartMono = mono();
      } else if (mono() - wakeStormStartMono > voidBudgetMs) {
        // A storm has re-armed a never-settling probe past the budget — fire stale.
        settled(true, generation);
        return;
      }
      abandon();
    }
    tick();
  }
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return {
    dispose: () => {
      disposed = true;
      clearInterval(handle);
      if (probeTimer !== undefined) {
        clearTimeout(probeTimer);
        probeTimer = undefined;
      }
    },
    wake,
  };
}
