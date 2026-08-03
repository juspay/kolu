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
 * ## The race is the shape
 *
 * Five things can end a wait, and every one of them is an arm of ONE
 * `raceAllFirst`:
 *
 *   - the CONDITION lands (idle quiescence, or a regex match on new output);
 *   - the terminal EXITS (`exit` yields) — the condition can never land now;
 *   - the output feed ENDS under us, which is `gone` or `closed` depending on
 *     whether the PTY is still listed;
 *   - the `--timeout` elapses;
 *   - the caller asks to STOP (a Ctrl+C).
 *
 * This used to ride `@kolu/surface/wait`'s `runWait` scaffold, which is an
 * AbortSignal-and-Promise expression of the same race, plus — because a unary
 * call at a Promise edge has no cancellation handle — a hand-rolled
 * `untilAborted` whose own docstring conceded *"we cannot stop the abandoned
 * call; it runs to completion … unobserved"*. Fiber interruption does stop the
 * WAIT on it, and the losing arms are torn down by the runtime rather than by an
 * abort chain, so `untilAborted`, the arm-on-every-delta `setTimeout` pair, and
 * the `Promise.all([…])` of two hand-driven consumers all go. The scaffold stays
 * for its Promise-shaped consumers (padi's watchers, kolu-mcp); its VOCABULARY —
 * the outcome union and the byte-frozen `--json` frame — is what kaval-tui keeps
 * importing, because that is the part drivers depend on.
 *
 * `interrupted` is an arm rather than fiber interruption ON PURPOSE: it is a
 * REPORTED outcome (`--json` emits a frame for it, and the CLI prints a trailer
 * naming the terminal left running), and an interrupted fiber cannot report
 * anything.
 *
 * This is explicitly NOT `padi-tui wait`'s hooked agent-state path: that keys on
 * OSC marks a *hooked* shell emits; this keys on raw output bytes from ANY
 * terminal (a plain `kaval-tui create`'d `claude`/`codex`/`grok`/`opencode`).
 */

import { isDeadTransportError } from "@kolu/surface/errors";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  waitOutcomeJson,
  type WaitOutcome as SharedWaitOutcome,
} from "@kolu/surface/wait";
import { Effect, Option, Queue, Stream } from "effect";
import type { PtyTuiClient } from "./connect.ts";

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
 *  error message the CLI surfaces BEFORE dialing (a bad spec should never
 *  provision a `--host` daemon we'd immediately drop). */
export type ParsedUntil = WaitCondition | { kind: "error"; message: string };

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
 *  dropped link; `error` holds the first upstream failure). */
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

/** One thing that happened on the output feed, as a value.
 *
 *  The feed ENDING is a `Tick` like any other rather than the queue's own end,
 *  and that is what keeps the condition loop free of end-of-stream plumbing: a
 *  `take` can only ever be answered by a tick or by the idle window, so the two
 *  outcomes the loop cares about are the only two it has to spell. */
type Tick =
  | { readonly kind: "frame"; readonly msg: { kind: string; data?: string } }
  | { readonly kind: "feed-ended" };

/** The idle window elapsed with no tick — a sentinel value rather than a
 *  `TimeoutError`, because "the terminal went quiet" is the SUCCESS this wait
 *  exists to detect, not a failure to recover from. */
const IDLE_WINDOW_ELAPSED = { kind: "idle-window" } as const;

/**
 * Block until PTY `id`'s output meets `condition`, then succeed with `met`; or
 * `timeout` after `timeoutMs`, `gone` if the terminal exits first, `interrupted`
 * if `stop` completes, or `closed` if the link drops. Pure data layer — no tty,
 * no `process.exit` — so it is testable over a real socket.
 *
 * The watchers ride TWO existing streams concurrently:
 *   - `terminalAttach` — the snapshot-then-`delta` output feed. The snapshot is
 *     the current screen replay (not new output): for `idle` it just starts the
 *     quiet window; for `match` it is NOT scanned (we match NEW bytes since the
 *     call). Each `delta` restarts the idle window / is scanned for the regex.
 *   - `exit` — yields once when the child exits. If it fires before the
 *     condition, the condition can never land, so this resolves `gone` (exit 3 at
 *     the CLI) rather than blocking to the timeout.
 *
 * FAILS (rather than resolving an outcome) only for a DEAD TRANSPORT, which
 * poisons a shared connection and must not be reported as a benign `closed`.
 * `raceAllFirst` — first to SETTLE, not first to succeed — is what lets that
 * failure win the race instead of being ignored while the wait runs to its
 * timeout.
 */
export function awaitOutputCondition(
  client: PtyTuiClient,
  opts: {
    id: string;
    condition: WaitCondition;
    timeoutMs?: number;
    /** Completes when the caller asks to stop (a Ctrl+C). An ARM, not fiber
     *  interruption, because `interrupted` is an outcome this wait REPORTS. */
    stop?: Effect.Effect<void>;
  },
): Effect.Effect<WaitOutcome, unknown> {
  const { id, condition } = opts;
  return Effect.scoped(
    Effect.gen(function* () {
      const started = Date.now();
      const elapsed = (): number => Date.now() - started;
      /** The first upstream failure a watcher itself observed — preferred over
       *  the generic slow-consumer message when a lost feed settles `closed`. */
      let feedError: string | undefined;

      // The feed, drained into a queue by its own fiber. The queue is what lets
      // the condition loop express "wait for the next byte, but no longer than
      // the idle window" as one `timeoutOrElse` instead of an arm/disarm timer
      // pair whose every exit path had to remember to disarm it.
      const ticks = yield* Queue.unbounded<Tick>();
      yield* Effect.forkChild(
        Stream.runForEach(
          client.surface.terminalAttach.get({ id }),
          (msg: { kind: string; data?: string }) =>
            Effect.sync(() => {
              Queue.offerUnsafe(ticks, { kind: "frame", msg });
            }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              feedError ??= errMessage(cause);
            }),
          ),
          Effect.andThen(
            Effect.sync(() => {
              Queue.offerUnsafe(ticks, { kind: "feed-ended" });
            }),
          ),
        ),
      );

      /** The output feed dropped before any outcome. Two causes, told apart by
       *  the inventory — the SAME discrimination `runAttach` uses for an
       *  identical stream end: the PTY exited (the channel closed → `gone`), or
       *  it is still live and we were dropped as a slow subscriber / the daemon
       *  ended our attach (the drop-slow mode → `closed`, a dropped feed we
       *  cannot honestly keep waiting on). Either way this SETTLES rather than
       *  going quiet: a `match` that simply stopped reading would otherwise hang
       *  to the timeout. */
      const classifyLostFeed: Effect.Effect<WaitOutcome, unknown> =
        Effect.flatMap(
          Effect.catch(
            Effect.map(client.surface.terminal.list({}), (listed) =>
              listed.entries.some((e) => e.id === id),
            ),
            (err) => {
              // A dead transport poisons a shared connection, so it PROPAGATES
              // (a CLI wait dials its own link and exits, but the discrimination
              // stays in lockstep with padi's watcher, the port-not-extract twin).
              if (isDeadTransportError(err)) return Effect.fail(err);
              feedError ??= errMessage(err);
              // Unknown liveness: fall through to `closed`, which is the honest
              // report — never a fabricated `gone`.
              return Effect.succeed(true);
            },
          ),
          (stillListed): Effect.Effect<WaitOutcome> =>
            stillListed
              ? Effect.succeed({
                  kind: "closed",
                  error:
                    feedError ??
                    `the daemon ended ${id}'s output feed while its PTY was still live (a slow-consumer drop) — re-run \`kaval-tui wait\`.`,
                })
              : Effect.succeed({ kind: "gone", elapsedMs: elapsed() }),
        );

      /** The condition itself: pull ticks until one satisfies it, the idle
       *  window elapses, or the feed ends. */
      const conditionArm: Effect.Effect<WaitOutcome, unknown> = Effect.gen(
        function* () {
          let buffer = "";
          let sawFrame = false;
          for (;;) {
            // The idle window measures silence SINCE A FRAME — so the first take
            // is unbounded. A daemon slow to send its opening snapshot must not
            // read as "this terminal has been quiet all along".
            const tick =
              condition.kind === "idle" && sawFrame
                ? yield* Effect.timeoutOrElse(Queue.take(ticks), {
                    duration: condition.ms,
                    orElse: () => Effect.succeed(IDLE_WINDOW_ELAPSED),
                  })
                : yield* Queue.take(ticks);

            if (tick.kind === "idle-window") {
              return { kind: "met", fired: "idle", elapsedMs: elapsed() };
            }
            if (tick.kind === "feed-ended") return yield* classifyLostFeed;
            sawFrame = true;
            // idle needs nothing from the frame's CONTENT — arriving at all is
            // what restarts the window, which the next iteration's timeout is.
            if (condition.kind === "idle") continue;
            // match: scan NEW output (deltas) only — the snapshot is the prior
            // screen, not bytes that arrived "since the call".
            if (tick.msg.kind !== "delta") continue;
            buffer += tick.msg.data ?? "";
            const m = condition.regex.exec(buffer);
            if (m !== null) {
              return {
                kind: "met",
                fired: "match",
                elapsedMs: elapsed(),
                matchedLine: matchedLineAt(buffer, m.index),
              };
            }
            // Bound the buffer (keep the tail, where a sentinel lands) so a
            // chatty terminal that never matches can't grow it without limit.
            if (buffer.length > MATCH_BUFFER_CAP) {
              buffer = buffer.slice(-MATCH_BUFFER_CAP);
            }
          }
        },
      );

      /** The `exit` stream is the PRECISE "child exited → gone" signal, but
       *  losing it is NOT fatal: a real exit also ends the `terminalAttach` feed,
       *  so `conditionArm`'s lost-feed classification is the backstop, and
       *  meanwhile a healthy output feed keeps idle/match/timeout working. So a
       *  failure here parks this arm forever rather than settling the race —
       *  and it is deliberately NOT recorded into `feedError`, which only ever
       *  surfaces through the `closed` path the other arm owns. */
      const exitArm: Effect.Effect<WaitOutcome, never> = Effect.catchCause(
        Effect.flatMap(
          Stream.runHead(client.surface.exit.get({ id })),
          (head): Effect.Effect<WaitOutcome> =>
            Option.isSome(head)
              ? Effect.succeed({ kind: "gone", elapsedMs: elapsed() })
              : // The stream ended without yielding: not evidence of an exit, so
                // leave the verdict to the feed arm rather than inventing one.
                Effect.never,
        ),
        () => Effect.never,
      );

      const arms: Effect.Effect<WaitOutcome, unknown>[] = [
        conditionArm,
        exitArm,
      ];
      if (opts.timeoutMs !== undefined) {
        arms.push(
          // `elapsed()` READ at the settle, not at the build: the reported number
          // is how long the wait actually took, which is what a driver logging a
          // timeout wants (and what `cmdWait` prints instead of the flag, so a
          // future non-timer timeout route can't print `undefinedms`).
          Effect.map(
            Effect.sleep(opts.timeoutMs),
            (): WaitOutcome => ({ kind: "timeout", elapsedMs: elapsed() }),
          ),
        );
      }
      if (opts.stop !== undefined) {
        arms.push(Effect.as(opts.stop, { kind: "interrupted" } as WaitOutcome));
      }

      // First to SETTLE, not first to succeed: a dead transport is a failure
      // that must win, and `raceAll` would ignore it and keep waiting.
      return yield* Effect.raceAllFirst(arms);
    }),
  );
}
