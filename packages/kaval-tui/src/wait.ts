/**
 * `kaval-tui wait` — the hook-free, daemon-sourced done-signal (issue #1629).
 *
 * The data side of the `wait` verb, factored out of `main.ts` so it is testable
 * against a real pty-host over a real socket with no `process.exit` — `cmdWait`
 * is the thin glue that maps the outcome to output + exit code (mirroring
 * `pulam-tui`'s `read.ts:awaitAgentState` / `main.ts:cmdWait` split).
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
 * This is explicitly NOT `pulam-tui wait`'s hooked agent-state path: that keys on
 * OSC marks a *hooked* shell emits; this keys on raw output bytes from ANY
 * terminal (a plain `kaval-tui create`'d `claude`/`codex`/`grok`/`opencode`).
 */

import type { PtyTuiClient } from "./connect.ts";

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

/** Node's `setTimeout` caps its delay at the signed 32-bit max (~24.8 days); a
 *  larger delay does NOT wait longer — it silently CLAMPS to 1ms and fires
 *  almost immediately. So an idle window (or `--timeout`) above this is rejected
 *  loud at the boundary rather than "succeeding" in a millisecond: a fail-fast
 *  guard, not a silent coercion. */
export const MAX_TIMER_MS = 2_147_483_647;

/** Parse the `--until` value into a {@link WaitCondition}. Two forms only —
 *  `idle:<ms>` (a positive whole number of milliseconds) and `match:<regex>` (a
 *  non-empty, valid JS regex). Anything else is a loud error, never a silent
 *  default — there is no third "auto" mode to fall back to. */
export function parseUntil(spec: string): ParsedUntil {
  const idle = "idle:";
  const match = "match:";
  if (spec.startsWith(idle)) {
    const raw = spec.slice(idle.length);
    // Digits only + > 0: rejects "", "0", "-5", "8.5", "8e2", " 8" — a count of
    // milliseconds is a positive integer, so anything else fails loud at the
    // boundary rather than being coerced by Number() into a surprising window.
    if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
      return {
        kind: "error",
        message: `--until idle:<ms> needs a positive whole number of milliseconds, got ${JSON.stringify(raw)} (e.g. idle:800).`,
      };
    }
    const ms = Number(raw);
    // Reject above the setTimeout ceiling: a larger window would overflow and
    // fire near-instantly (a FALSE "idle"), so crash loud rather than coerce.
    if (ms > MAX_TIMER_MS) {
      return {
        kind: "error",
        message: `--until idle:<ms> must be ≤ ${MAX_TIMER_MS} (~24.8 days): a larger window overflows the timer and would fire almost immediately, got ${JSON.stringify(raw)}.`,
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

/** The outcome of a `wait`: the condition fired (`met`, carrying which form and
 *  how long it took — plus the matched line for `match`), the wait elapsed its
 *  `--timeout` cap (`timeout`), the terminal EXITED before the condition could
 *  fire (`gone` — the driven agent died, so the condition can never land), the
 *  caller's signal aborted the wait (`interrupted` — a Ctrl+C), or the link
 *  settled without any of those (`closed` — a dropped link; `error` holds the
 *  first upstream failure). The `interrupted`/`closed` split is decided here
 *  from `opts.signal`, so the outcome alone carries the full result and `cmdWait`
 *  never re-derives it from a side channel. */
export type WaitOutcome =
  | { kind: "met"; fired: "idle"; elapsedMs: number }
  | { kind: "met"; fired: "match"; elapsedMs: number; matchedLine: string }
  | { kind: "timeout"; elapsedMs: number }
  | { kind: "gone"; elapsedMs: number }
  | { kind: "interrupted" }
  | { kind: "closed"; error?: string };

/** Serialize a {@link WaitOutcome} to the stable `--json` wire frame — the ONE
 *  home for the driver-facing contract, so the shape lives beside the type it
 *  mirrors instead of being reassembled per branch in `cmdWait`. The `result`
 *  discriminant is derived from `outcome.kind` (NOT from `fired`, which is a
 *  success *detail* of the `met` case), so EVERY outcome — `gone` /
 *  `interrupted` / `closed` included — emits a uniform frame and a `--json`
 *  driver never has to fall back to parsing the exit code alone. */
export function waitResultJson(
  id: string,
  outcome: WaitOutcome,
): Record<string, unknown> {
  switch (outcome.kind) {
    case "met":
      // The split union guarantees `matchedLine` exactly when `fired ===
      // "match"`, so the projection follows the discriminant with no presence
      // guard — an idle frame can't carry a line, a match frame can't omit one.
      return outcome.fired === "match"
        ? {
            id,
            result: "met",
            fired: "match",
            elapsedMs: outcome.elapsedMs,
            matchedLine: outcome.matchedLine,
          }
        : { id, result: "met", fired: "idle", elapsedMs: outcome.elapsedMs };
    case "timeout":
      return { id, result: "timeout", elapsedMs: outcome.elapsedMs };
    case "gone":
      return { id, result: "gone", elapsedMs: outcome.elapsedMs };
    case "interrupted":
      return { id, result: "interrupted" };
    case "closed":
      return {
        id,
        result: "closed",
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      };
  }
}

/** Cap the accumulated match buffer so a long-running `match` wait against a
 *  chatty terminal can't grow it unbounded. Far larger than any realistic
 *  sentinel/marker, so a match near the tail (the normal case — the marker is the
 *  newest output) is never lost to the trim. */
const MATCH_BUFFER_CAP = 1 << 16;

/** A control sequence (CSI, the common form) and `\r`, stripped so a `matchedLine`
 *  reads cleanly in the human/JSON output. The match itself runs against the raw
 *  bytes (so an escape between two letters can't hide a sentinel from the regex);
 *  this only tidies the REPORTED line. */
function cleanLine(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
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

/**
 * Block until PTY `id`'s output meets `condition` (idle quiescence or a regex
 * match on new output), then resolve `met`; or resolve `timeout` after
 * `timeoutMs`, `gone` if the terminal exits first, `interrupted` on `signal`
 * abort, or `closed` if the link drops. Pure data layer — no tty, no
 * `process.exit` — so it is testable over a real socket.
 *
 * It subscribes to TWO existing streams concurrently and races them:
 *   - `terminalAttach` — the snapshot-then-`delta` output feed. The snapshot is
 *     the current screen replay (not new output): for `idle` it just starts the
 *     quiet window; for `match` it is NOT scanned (we match NEW bytes since the
 *     call). Each `delta` resets the idle window / is scanned for the regex.
 *   - `exit` — yields once when the child exits. If it fires before the
 *     condition, the condition can never land, so we resolve `gone` (exit 3 at
 *     the CLI) rather than blocking to the timeout.
 * Whichever resolves first aborts the other.
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
  const start = Date.now();
  const elapsed = (): number => Date.now() - start;

  const abort = new AbortController();
  // Chain the caller's signal (Ctrl+C) into our internal abort so an interrupt
  // unwinds both stream subscriptions the same way the timeout does.
  if (opts.signal !== undefined) {
    if (opts.signal.aborted) abort.abort();
    else
      opts.signal.addEventListener("abort", () => abort.abort(), {
        once: true,
      });
  }

  let outcome: WaitOutcome | undefined;
  let upstreamError: string | undefined;
  // First-writer-wins: timer, idle-timer, attach, and exit all race to set the
  // outcome; `??=` keeps the first and the abort below stops the rest.
  const settle = (o: WaitOutcome): void => {
    outcome ??= o;
    abort.abort();
  };

  const timer =
    opts.timeoutMs === undefined
      ? undefined
      : setTimeout(
          () => settle({ kind: "timeout", elapsedMs: elapsed() }),
          opts.timeoutMs,
        );

  // The idle window: (re)armed on the snapshot and on every delta; if it elapses
  // with no further output, the terminal has been quiescent for `ms`.
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
      () => settle({ kind: "met", fired: "idle", elapsedMs: elapsed() }),
      ms,
    );
  };

  // The output feed dropped before any outcome and without an abort WE caused.
  // Two causes, told apart by the inventory — the SAME discrimination
  // `runAttach` uses for an identical stream end: the PTY exited (the channel
  // closed → `gone`), or it's still live and we were dropped as a slow
  // subscriber / the daemon ended our attach (`Channel`'s drop-slow mode →
  // `closed`, a dropped feed we can't honestly keep waiting on). Either way we
  // must DISARM the idle timer first: leaving it armed would let it fire a FALSE
  // `met` off the last delta even though we can no longer observe new output;
  // and a `match` that simply stopped reading would otherwise hang to the
  // timeout. So we settle loud here rather than going quiet.
  const settleOnLostFeed = async (): Promise<void> => {
    disarmIdle();
    try {
      const { entries } = await client.surface.terminal.list({});
      if (!entries.some((e) => e.id === opts.id)) {
        settle({ kind: "gone", elapsedMs: elapsed() });
        return;
      }
    } catch (err) {
      upstreamError ??= errMessage(err);
    }
    settle({
      kind: "closed",
      error:
        upstreamError ??
        `the daemon ended ${opts.id}'s output feed while its PTY was still live (a slow-consumer drop) — re-run \`kaval-tui wait\`.`,
    });
  };

  const consumeOutput = async (): Promise<void> => {
    let buffer = "";
    try {
      const stream = await client.surface.terminalAttach.get(
        { id: opts.id },
        { signal: abort.signal },
      );
      for await (const msg of stream) {
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
          settle({
            kind: "met",
            fired: "match",
            elapsedMs: elapsed(),
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
      // feed is gone. (Our own met/timeout/Ctrl+C settle aborts the stream, so
      // that end lands in the catch with `abort.signal.aborted` true, NOT here.)
      if (outcome === undefined && !abort.signal.aborted)
        await settleOnLostFeed();
    } catch (err) {
      // An abort (the condition fired elsewhere, a Ctrl+C, the timeout) is the
      // expected end — don't record it as an upstream failure. A non-abort error
      // is a dropped feed: record it, then settle loud so the idle timer can't
      // fire a false `met` and a `match` can't hang on a stream we stopped reading.
      if (!abort.signal.aborted) {
        upstreamError ??= errMessage(err);
        await settleOnLostFeed();
      }
    }
  };

  const consumeExit = async (): Promise<void> => {
    try {
      const stream = await client.surface.exit.get(
        { id: opts.id },
        { signal: abort.signal },
      );
      for await (const _msg of stream) {
        settle({ kind: "gone", elapsedMs: elapsed() });
        return;
      }
    } catch (err) {
      if (!abort.signal.aborted) upstreamError ??= errMessage(err);
    }
  };

  try {
    await Promise.all([consumeOutput(), consumeExit()]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
  }

  return (
    outcome ??
    (opts.signal?.aborted
      ? { kind: "interrupted" }
      : { kind: "closed", error: upstreamError })
  );
}
