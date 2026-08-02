/**
 * `kaval-tui wait` — the hook-free, daemon-sourced done-signal (issue #1629).
 *
 * The data side of the `wait` verb, factored out of `main.ts` so it is testable
 * against a real pty-host over a real socket with no `process.exit` — `cmdWait`
 * is the thin glue that maps the outcome to output + exit code (mirroring
 * `padi-tui`'s `awaitAgentState` / `main.ts:cmdWait` split).
 *
 * The signal source is the SAME raw PTY output the daemon already serves on the
 * `terminalAttach` stream (snapshot-then-`delta` frames — `ptyHostSurface.ts`):
 * each `delta` is a verbatim chunk of bytes the daemon emitted to the client, so
 * "no delta for N ms" is exact output-quiescence and "a delta matches <re>" is a
 * scan of new output — both agent-agnostic, with no shell rc-hooks and no
 * busy-word table. We do NOT add a daemon-side wait or a new contract member: the
 * existing output tap IS the source of truth (see the PR's design-philosophy
 * note), so this is a client-side debounce/scan *leaf* beside `snapshot`/`send`,
 * not a new volatility receptacle in the daemon. It works over `--socket` and
 * `--host` for free because `terminalAttach`/`exit` already do.
 *
 * The race/lifecycle boilerplate (abort-chain, first-writer-wins settle,
 * timeout, the interrupted/closed fallback) is `@kolu/surface/wait`'s `runWait`
 * scaffold — extracted when the kolu MCP face became its third consumer. What
 * stays HERE is the kaval-contract-bound condition watcher: the idle window,
 * the match buffer/scan, and the lost-feed discrimination against
 * `terminal.list` (non-verbatim twins of padi's watchers, per the
 * port-not-extract doctrine).
 *
 * This is explicitly NOT `padi-tui wait`'s hooked agent-state path: that keys on
 * OSC marks a *hooked* shell emits; this keys on raw output bytes from ANY
 * terminal (a plain `kaval-tui create`'d `claude`/`codex`/`grok`/`opencode`).
 */

import { isDeadTransportError } from "@kolu/surface/errors";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  runWait,
  type WaitCtx,
  waitOutcomeJson,
  type WaitOutcome as SharedWaitOutcome,
} from "@kolu/surface/wait";
import type { PtyTuiClient } from "./connect.ts";
import { subscribe } from "./stream.ts";

// The timer-range vocabulary graduated into the shared wait scaffold; re-used
// here for the `--until idle:<ms>` / `--timeout` boundary guards.
export { isValidTimerMs, MAX_TIMER_MS };

/** The condition a `wait` blocks on, parsed from `--until`:
 *   - `idle` — resolve once no output byte has arrived for `ms` (the
 *     agent-agnostic "turn ended / awaiting input" signal — the common case).
 *   - `match` — resolve once new output matches `regex` (a completion marker or
 *     a returned-prompt sentinel). */
export type WaitCondition =
  | { kind: "idle"; ms: number }
  | { kind: "match"; regex: RegExp };

/** The result of parsing `--until <spec>` — a condition, or a loud, actionable
 *  error message the CLI surfaces with `fail()` BEFORE dialing (a bad spec
 *  should never provision a `--host` daemon we'd immediately drop). */
export type ParsedUntil = WaitCondition | { kind: "error"; message: string };

/** A promise that resolves after `ms` — the package's one `setTimeout` wrapper,
 *  reused by `attach`'s reconnect backoff and the send acceptance test's
 *  observed-settle wait. Lives beside the wait vocabulary, the module that
 *  already owns this package's timer idiom, so the sleep isn't re-typed at each
 *  call site. */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Parse the `--until` value into a {@link WaitCondition}. Two forms only —
 *  `idle:<ms>` (a positive whole number of milliseconds) and `match:<regex>` (a
 *  non-empty, valid JS regex). Anything else is a loud error, never a silent
 *  default — there is no third "auto" mode to fall back to. */
export function parseUntil(spec: string): ParsedUntil {
  const idle = "idle:";
  const match = "match:";
  if (spec.startsWith(idle)) {
    const raw = spec.slice(idle.length);
    // Digits only: a count of milliseconds is a whole number, so reject "",
    // "-5", "8.5", "8e2", " 8" at the boundary rather than coercing via Number().
    if (!/^\d+$/.test(raw)) {
      return {
        kind: "error",
        message: `--until idle:<ms> needs a positive whole number of milliseconds, got ${JSON.stringify(raw)} (e.g. idle:800).`,
      };
    }
    const ms = Number(raw);
    // 0 never settles, and a window above the setTimeout ceiling overflows and
    // fires near-instantly (a FALSE "idle") — both fail the shared timer-range
    // rule, so crash loud rather than coerce.
    if (!isValidTimerMs(ms)) {
      return {
        kind: "error",
        message: `--until idle:<ms> must be between 1 and ${MAX_TIMER_MS} (~24.8 days): 0 never settles and a larger window overflows the timer, got ${JSON.stringify(raw)}.`,
      };
    }
    return { kind: "idle", ms };
  }
  if (spec.startsWith(match)) {
    const pattern = spec.slice(match.length);
    if (pattern === "") {
      return {
        kind: "error",
        message:
          "--until match:<regex> needs a non-empty pattern (e.g. match:'DONE').",
      };
    }
    try {
      return { kind: "match", regex: new RegExp(pattern) };
    } catch (err) {
      return {
        kind: "error",
        message: `--until match: invalid regex ${JSON.stringify(pattern)} — ${(err as Error).message}`,
      };
    }
  }
  return {
    kind: "error",
    message: `--until must be idle:<ms> or match:<regex>, got ${JSON.stringify(spec)}.`,
  };
}

/** The met payload a `kaval-tui wait` stamps: which condition form fired and
 *  how long it took — plus the matched line for `match`. Spread flat into the
 *  shared union's `met` arm, so the `--json` wire frame is byte-identical to
 *  the pre-scaffold shape. */
type OutputMet =
  | { fired: "idle"; elapsedMs: number }
  | { fired: "match"; elapsedMs: number; matchedLine: string };

/** The outcome of a `wait` — the shared scaffold union over {@link OutputMet}:
 *  `met` (which form fired + timing), `timeout`, `gone` (the terminal EXITED
 *  before the condition could fire), `interrupted` (a Ctrl+C), or `closed` (a
 *  dropped link; `error` holds the first upstream failure). The
 *  `interrupted`/`closed` split is decided by the scaffold from `opts.signal`,
 *  so the outcome alone carries the full result and `cmdWait` never re-derives
 *  it from a side channel. */
export type WaitOutcome = SharedWaitOutcome<OutputMet>;

/** Serialize a {@link WaitOutcome} to the stable `--json` wire frame via the
 *  shared {@link waitOutcomeJson} (which owns the four terminal arms —
 *  `timeout`/`gone`/`interrupted`/`closed` — and the `result`-from-`kind`
 *  discriminant, so a `--json` driver never falls back to parsing the exit
 *  code). This face SPREADS the met detail flat: the split union guarantees
 *  `matchedLine` exactly when `fired === "match"`, so the projection follows the
 *  discriminant with no presence guard — an idle frame can't carry a line, a
 *  match frame can't omit one. */
export function waitResultJson(
  id: string,
  outcome: WaitOutcome,
): Record<string, unknown> {
  return waitOutcomeJson<OutputMet>(id, outcome, (met) =>
    met.fired === "match"
      ? {
          fired: "match",
          elapsedMs: met.elapsedMs,
          matchedLine: met.matchedLine,
        }
      : { fired: "idle", elapsedMs: met.elapsedMs },
  );
}

/** Cap the accumulated match buffer so a long-running `match` wait against a
 *  chatty terminal can't grow it unbounded. Far larger than any realistic
 *  sentinel/marker, so a match near the tail (the normal case — the marker is the
 *  newest output) is never lost to the trim. */
const MATCH_BUFFER_CAP = 1 << 16;

/** Strip VT control sequences (OSC + CSI) and `\r` so a `matchedLine` reads
 *  cleanly in the human/JSON output. The match itself runs against the raw bytes
 *  (so an escape between two letters can't hide a sentinel from the regex); this
 *  only tidies the REPORTED line. OSC is stripped too because a shell prompt's
 *  title-set (`\x1b]0;…\x07`/ST-terminated) routinely leads a line, and a
 *  CSI-only strip would leave those bytes raw in the JSON output. */
function cleanLine(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC … (BEL- or ST-terminated)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/\r/g, "")
    .trim();
}

/** The (cleaned) line of `buffer` that contains the match at `index` — for the
 *  `matchedLine` field, so the caller sees WHICH output line tripped the regex. */
function matchedLineAt(buffer: string, index: number): string {
  const start = buffer.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const nl = buffer.indexOf("\n", index);
  const end = nl === -1 ? buffer.length : nl;
  return cleanLine(buffer.slice(start, end));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Await `call`, but give up the moment `signal` aborts — resolving `undefined`
 *  for "the race settled elsewhere; this answer is no longer wanted".
 *
 *  A streaming member takes its cancellation from fiber interruption (see
 *  `./stream.ts`), but a UNARY call has no such handle at this Promise edge:
 *  Effect RPC carries no cancellation token (PLAN D10/#18) and the face runs the
 *  call with `Effect.runPromise`. The bound still matters for the same reason it
 *  did when a `{ signal }` call option carried it — a half-open wire makes even
 *  a cheap read park, and `runWait` AWAITS its watchers, so an unbounded read
 *  would let the "bounded" wait outlive its own timeout or Ctrl+C. What we
 *  cannot do is stop the abandoned call; it runs to completion (or to the link's
 *  own keepalive failure) unobserved, which is stated here rather than implied.
 *  Its later rejection is attached, never orphaned. */
function untilAborted<T>(
  call: Promise<T>,
  signal: AbortSignal,
): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise<T | undefined>((resolve, reject) => {
    const onAbort = (): void => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    call.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Block until PTY `id`'s output meets `condition` (idle quiescence or a regex
 * match on new output), then resolve `met`; or resolve `timeout` after
 * `timeoutMs`, `gone` if the terminal exits first, `interrupted` on `signal`
 * abort, or `closed` if the link drops. Pure data layer — no tty, no
 * `process.exit` — so it is testable over a real socket.
 *
 * The race rides `runWait`; the watchers subscribe TWO existing streams
 * concurrently:
 *   - `terminalAttach` — the snapshot-then-`delta` output feed. The snapshot is
 *     the current screen replay (not new output): for `idle` it just starts the
 *     quiet window; for `match` it is NOT scanned (we match NEW bytes since the
 *     call). Each `delta` resets the idle window / is scanned for the regex.
 *   - `exit` — yields once when the child exits. If it fires before the
 *     condition, the condition can never land, so we resolve `gone` (exit 3 at
 *     the CLI) rather than blocking to the timeout.
 * Whichever settles first aborts the other (the scaffold's race).
 */
export async function awaitOutputCondition(
  client: PtyTuiClient,
  opts: {
    id: string;
    condition: WaitCondition;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<WaitOutcome> {
  return runWait(
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
    async (ctx: WaitCtx<OutputMet>) => {
      // The idle window: (re)armed on the snapshot and on every delta; if it
      // elapses with no further output, the terminal has been quiescent for `ms`.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const disarmIdle = (): void => {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
      };
      const armIdle = (ms: number): void => {
        disarmIdle();
        idleTimer = setTimeout(
          () =>
            ctx.settle({
              kind: "met",
              fired: "idle",
              elapsedMs: ctx.elapsedMs(),
            }),
          ms,
        );
      };

      // The first upstream failure this watcher itself observed — preferred over
      // the generic slow-consumer message when the lost feed settles `closed`.
      let feedError: string | undefined;

      // The output feed dropped before any outcome and without an abort WE
      // caused. Two causes, told apart by the inventory — the SAME
      // discrimination `runAttach` uses for an identical stream end: the PTY
      // exited (the channel closed → `gone`), or it's still live and we were
      // dropped as a slow subscriber / the daemon ended our attach (`Channel`'s
      // drop-slow mode → `closed`, a dropped feed we can't honestly keep
      // waiting on). Either way we must DISARM the idle timer first: leaving it
      // armed would let it fire a FALSE `met` off the last delta even though we
      // can no longer observe new output; and a `match` that simply stopped
      // reading would otherwise hang to the timeout. So we settle loud here
      // rather than going quiet. (A genuinely unexpected watcher THROW, by
      // contrast, propagates per the scaffold's contract — this path handles
      // only the EXPECTED feed-end shapes.)
      const settleOnLostFeed = async (): Promise<void> => {
        disarmIdle();
        try {
          // Bound the unary read against ctx.signal by hand — the call option
          // that used to carry it is gone (see `untilAborted`). An abort means
          // the race already settled, so there is no verdict left to reach:
          // return rather than settling `closed` over an outcome that won.
          const listed = await untilAborted(
            client.surface.terminal.list({}),
            ctx.signal,
          );
          if (listed === undefined) return;
          if (!listed.entries.some((e) => e.id === opts.id)) {
            ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
            return;
          }
        } catch (err) {
          // A dead transport poisons a shared connection, so it PROPAGATES (a
          // CLI wait dials its own link and exits, but the discrimination stays
          // in lockstep with padi's watcher, the port-not-extract twin).
          if (isDeadTransportError(err)) throw err;
          const m = errMessage(err);
          feedError ??= m;
          ctx.recordUpstreamError(m);
        }
        ctx.settle({
          kind: "closed",
          error:
            feedError ??
            `the daemon ended ${opts.id}'s output feed while its PTY was still live (a slow-consumer drop) — re-run \`kaval-tui wait\`.`,
        });
      };

      const consumeOutput = async (): Promise<void> => {
        let buffer = "";
        try {
          // The subscription's teardown IS ctx.signal's abort (the wait race's
          // settle, the timeout, a Ctrl+C): `subscribe` wires the abort to the
          // fiber interrupt, so a torn-down feed ends the loop cleanly with
          // `ctx.signal.aborted` true — which is exactly what the two
          // end-of-loop branches below already discriminate on.
          const frames = subscribe(
            client.surface.terminalAttach.get({ id: opts.id }),
            ctx.signal,
          );
          for await (const msg of frames) {
            if (opts.condition.kind === "idle") {
              // The snapshot is the replay of the current screen, not new output —
              // but it's the moment to start the quiet window (an already-idle
              // terminal then fires after `ms`); each delta resets it.
              armIdle(opts.condition.ms);
              continue;
            }
            // match: scan NEW output (deltas) only — the snapshot is the prior
            // screen, not bytes that arrived "since the call".
            if (msg.kind !== "delta") continue;
            buffer += msg.data;
            const m = opts.condition.regex.exec(buffer);
            if (m !== null) {
              ctx.settle({
                kind: "met",
                fired: "match",
                elapsedMs: ctx.elapsedMs(),
                matchedLine: matchedLineAt(buffer, m.index),
              });
              return;
            }
            // Bound the buffer (keep the tail, where a sentinel lands) so a chatty
            // terminal that never matches can't grow it without limit.
            if (buffer.length > MATCH_BUFFER_CAP)
              buffer = buffer.slice(-MATCH_BUFFER_CAP);
          }
          // The stream ENDED with no outcome and without an abort we caused — the
          // feed is gone. (Every settle — met/timeout/Ctrl+C — aborts ctx.signal
          // synchronously, so a settled race can never reach the lost-feed path.)
          if (!ctx.signal.aborted) await settleOnLostFeed();
        } catch (err) {
          // An abort (the condition fired elsewhere, a Ctrl+C, the timeout) is the
          // expected end — don't record it as an upstream failure. A non-abort error
          // is a dropped feed: record it, then settle loud so the idle timer can't
          // fire a false `met` and a `match` can't hang on a stream we stopped
          // reading.
          if (!ctx.signal.aborted) {
            if (isDeadTransportError(err)) throw err;
            const m = errMessage(err);
            feedError ??= m;
            ctx.recordUpstreamError(m);
            await settleOnLostFeed();
          }
        }
      };

      const consumeExit = async (): Promise<void> => {
        try {
          const frames = subscribe(
            client.surface.exit.get({ id: opts.id }),
            ctx.signal,
          );
          // Deliberately NOT `firstFrameOrUndefined` (SR6 non-adoption): this settle
          // is a side effect that must fire the INSTANT the first exit frame arrives,
          // BEFORE the iterator's async close is awaited — because `consumeExit` races
          // `consumeOutput` and the timeout in a `Promise.all`, and `settle` is
          // first-wins. The primitive does `for await … return frame`, which awaits
          // AsyncIteratorClose before it resolves, so it would move `settle` PAST that
          // close and let a competing timer/feed event win the race first (and fold the
          // close latency into `elapsedMs`). The open-coded loop keeps settle-then-close
          // ordering, so it stays. (first-frame-guard:allow — ordering-sensitive.)
          for await (const _msg of frames) {
            ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
            return;
          }
        } catch {
          // The exit stream is the PRECISE "child exited → gone" signal, but losing
          // it is NOT fatal, so — unlike consumeOutput — we deliberately neither
          // settle nor disarm here. A real exit ALSO ends the terminalAttach feed →
          // settleOnLostFeed → gone, so consumeOutput is the backstop; meanwhile a
          // healthy output feed keeps idle/match/timeout working. (An abort — our own
          // settle or Ctrl+C — is likewise the expected end.) We do not record this
          // into the upstream latch: it would only ever surface through the `closed`
          // path, and that path is reached via consumeOutput, which records its OWN
          // error.
        }
      };

      try {
        await Promise.all([consumeOutput(), consumeExit()]);
      } finally {
        // The scaffold clears ITS timeout; the idle timer is this watcher's own.
        disarmIdle();
      }
    },
  );
}
