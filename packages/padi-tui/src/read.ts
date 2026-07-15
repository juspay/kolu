/**
 * The data side of the CLI — reading padi's `terminals` collection from a
 * connected client, factored out of `main.ts` so it is testable against a real
 * padi over a real socket with no tty. Two reads: a one-shot key set
 * (`readTerminalKeys`, prefix resolution) / `settledSnapshot` (`status`), and a live `watchTerminals`
 * for `watch`/`wait` — the composed `terminals` collection joined with the
 * `activity` live-byte stream, driven by `mirrorRemoteSurface`.
 *
 * padi's compatibility is gated at DIAL (`connectPadi` refuses a contract skew
 * loudly), so — unlike the retired pulam-tui — there is no separate `assertCompatible` read.
 */

import { padiSurface, type PadiTerminal } from "@kolu/padi/surface";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiTuiClient } from "./connect.ts";
import { activeAgent, agentMatchesUntil } from "./render.ts";

/** The current terminal key set — the FIRST frame of the `keys` snapshot-then-delta
 *  stream. The `keys` collection ALWAYS opens with a snapshot frame (zero terminals
 *  is a defined empty array, not an empty stream), so an empty stream means the
 *  link/protocol failed — this surfaces it loudly rather than collapsing to "no
 *  terminals" (which `resolveOne` would then misreport as `no terminal matching
 *  <id>`, and `status` would render as a blank table —
 *  caught-error-must-not-collapse-to-empty). The ONE home for the snapshot-frame
 *  contract and its failure string, shared by {@link settledSnapshot} and the
 *  CLI's id-prefix resolution (`wait` / `create --parent`, which need only the ids,
 *  never each terminal's value — so they read the key set, not the whole snapshot). */
export async function readTerminalKeys(
  client: PadiTuiClient,
): Promise<TerminalId[]> {
  return firstFrameOrThrow(
    await client.surface.terminals.keys({}),
    "padi terminals keys yielded no snapshot frame — link or protocol failure.",
  );
}

/** A composed record is "resolved enough to show" once its live sensors have
 *  landed. A dormant record (`sleeping`/`parked`) is a persisted projection, not
 *  mid-sensing, so it is always resolved. An `active` one is resolved once ANY of
 *  git / agent / foreground has landed, or its PR has left `pending` — a
 *  just-spawned terminal seeds all-null and fills in a beat later. */
function isResolved(v: PadiTerminal): boolean {
  if (v.state !== "active") return true;
  return (
    v.git !== null ||
    v.agent !== null ||
    v.foreground !== null ||
    v.pr.kind !== "pending"
  );
}

/** A snapshot that WAITS for padi's sensors to resolve, for `status`. Against a
 *  warm local padi every value arrives resolved, so this settles at once
 *  (sub-`graceMs`); against a padi that just spawned a terminal it waits just long
 *  enough for the sensors, then lingers `graceMs` to catch siblings landing in the
 *  same burst — capping the whole wait at `maxMs`. A terminal the sensors
 *  legitimately resolve to "nothing" never flips `isResolved`, so it falls through
 *  at `maxMs` — bounded, never a hang. Mirrors the retired pulam-tui's `settledSnapshot`. */
export async function settledSnapshot(
  client: PadiTuiClient,
  opts: { maxMs?: number; graceMs?: number } = {},
): Promise<Array<[TerminalId, PadiTerminal]>> {
  const maxMs = opts.maxMs ?? 3000;
  const graceMs = opts.graceMs ?? 1500;
  // The key set padi first reports — the terminals we wait to resolve.
  const expected = await readTerminalKeys(client);

  const acc = new Map<TerminalId, PadiTerminal>();
  const abort = new AbortController();
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  // Did WE end the read (sensors settled / grace / hard cap / empty fleet)? The
  // mirror's `.done` settling while this is still false means the LINK dropped
  // mid-read — a failure to surface, not a partial snapshot to return silently
  // (caught-error-must-not-collapse-to-empty). Latched at the instant `.done`
  // fires, so a grace timer racing just behind it can't retroactively mask it.
  let stopped = false;
  let linkFailed = false;
  let upstreamError: string | undefined;
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const stop = (): void => {
    stopped = true;
    abort.abort();
    settle();
  };
  const hardCap = setTimeout(stop, maxMs);

  const considerSettling = (): void => {
    if (expected.length === 0) {
      stop();
      return;
    }
    const allResolved = expected.every((k) => {
      const v = acc.get(k);
      return v === undefined ? false : isResolved(v);
    });
    if (allResolved && graceTimer === undefined) {
      graceTimer = setTimeout(stop, graceMs);
    }
  };

  void mirrorRemoteSurface(
    padiSurface,
    client,
    {
      collections: {
        terminals: {
          upsert: (id, value) => {
            acc.set(id, value);
            considerSettling();
          },
          remove: (id) => {
            acc.delete(id);
            considerSettling();
          },
        },
      },
      // Subscribe to `activity` too — not for its data (ignored here) but because
      // a collection-only mirror has nothing holding it open: it would settle its
      // `.done` right after the initial snapshot and stop delivering the very
      // resolution deltas we're waiting for. The (snapshot-then-delta) activity
      // stream keeps the mirror live until we abort it, exactly as `watch` does.
      streams: { activity: { input: {}, onFrame: () => {} } },
    },
    // Capture non-abort upstream blips so a failure carries a diagnostic rather
    // than surfacing as a bare "link closed".
    {
      signal: abort.signal,
      log: (line) => {
        upstreamError ??= line;
      },
    },
  ).done.then(
    // The mirror ended. If WE didn't stop it, the link dropped mid-read — flag it
    // (latched now, before any trailing grace timer can flip `stopped`) so the
    // caller fails loud instead of returning a partial/empty snapshot.
    () => {
      if (!stopped) linkFailed = true;
      settle();
    },
    (err) => {
      if (!stopped) {
        linkFailed = true;
        upstreamError ??= (err as Error).message;
      }
      settle();
    },
  );

  try {
    await done;
  } finally {
    clearTimeout(hardCap);
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    abort.abort();
  }
  if (linkFailed) {
    throw new Error(
      upstreamError ??
        "the padi link closed before the terminal snapshot settled — the daemon stopped or the connection dropped. Is `padi` still running?",
    );
  }
  return [...acc.entries()];
}

/** Handlers a live `watch` reacts to. `live` is whether the terminal is moving
 *  bytes RIGHT NOW (the `activity` stream's current membership) at the instant of
 *  the record change — annotation only; an activity-only flip emits no line of its
 *  own (it pulses ~1s while bytes move, which would drown the feed), it just
 *  colours the next record line. */
export interface WatchHandlers {
  onUpsert: (id: TerminalId, value: PadiTerminal, live: boolean) => void;
  onRemove: (id: TerminalId) => void;
  /** A terminal STARTED (`live` true) or STOPPED (`live` false) moving bytes — the
   *  `activity` stream's live-set transitions, so byte-activity is visible on its
   *  own, not only as a `●` annotation on a coincident awareness line. A
   *  continuously-busy terminal fires ONE `true` (its idle timer keeps re-arming),
   *  then one `false` when output stops — no ~1s pulse spam. Optional; `wait`
   *  ignores it. */
  onActivity?: (id: TerminalId, live: boolean) => void;
}

/** Follow the `terminals` collection live until the link closes (the caller
 *  disposes on Ctrl+C) or `signal` aborts. One `mirrorRemoteSurface` drives both
 *  the `terminals` collection (the rows) and the `activity` stream (the live dot):
 *  the activity frame updates a local live-set the upsert handler reads, so a
 *  printed line reflects whether that terminal was moving bytes at the time.
 *
 *  `log` is the diagnostic sink for NON-abort upstream failures (a dropped link, a
 *  protocol error). Without it a real connection loss would look like a clean stop
 *  — so `watch` passes a stderr sink and treats an un-aborted settle as a failure.
 *
 *  `initialKeys` seeds the mirror's cross-connect reconciliation: any key it lists
 *  that is ABSENT from the collection's first snapshot fires `onRemove` at once
 *  (the mirror's own departed-while-away sweep). `wait` passes the id it is
 *  watching, so a terminal that exited in the gap between id-resolution and this
 *  subscription is reported `gone` on the first frame rather than hanging forever. */
export async function watchTerminals(
  client: PadiTuiClient,
  handlers: WatchHandlers,
  signal?: AbortSignal,
  log?: (line: string) => void,
  initialKeys?: () => Iterable<TerminalId>,
): Promise<void> {
  // The `activity` stream's current membership — the set of terminals moving bytes
  // right now — built up from the mirror's own `activity` frames below. It starts
  // EMPTY and stays that way until the first frame: padi builds a FRESH
  // per-subscription activity tracker whose first frame is always the empty set (a
  // new subscriber can't learn which terminals were ALREADY busy — bytes are only
  // counted from the deltas that arrive AFTER it subscribes), so there is nothing a
  // pre-seed subscription could recover. An already-busy terminal simply lights on
  // its next output chunk.
  const live = new Set<TerminalId>();
  await mirrorRemoteSurface(
    padiSurface,
    client,
    {
      collections: {
        terminals: {
          // Guard the consumer callbacks at this funnel: a throwing handler must
          // not escape into the mirror's internal loop and wedge the whole watch —
          // contain it to the one frame and surface it via `log`.
          upsert: (id, value) => {
            try {
              handlers.onUpsert(id, value, live.has(id));
            } catch (err) {
              log?.(
                `terminals upsert handler failed: ${(err as Error).message}`,
              );
            }
          },
          remove: (id) => {
            try {
              handlers.onRemove(id);
            } catch (err) {
              log?.(
                `terminals remove handler failed: ${(err as Error).message}`,
              );
            }
          },
          // A key here that the first snapshot doesn't re-assert departed before we
          // subscribed — the mirror fires `onRemove` for it once (see `wait`).
          ...(initialKeys !== undefined ? { initialKeys } : {}),
        },
      },
      streams: {
        activity: {
          input: {},
          onFrame: (ids) => {
            const next = new Set(ids);
            // Emit a transition for each terminal that STARTED or STOPPED moving
            // bytes since the last frame, so byte-activity shows on its own line.
            // `live` starts empty and fills from these frames. Guard the callback so
            // a throwing consumer can't wedge the mirror loop.
            const fire = (id: TerminalId, isLive: boolean): void => {
              try {
                handlers.onActivity?.(id, isLive);
              } catch (err) {
                log?.(`activity handler failed: ${(err as Error).message}`);
              }
            };
            for (const id of next) if (!live.has(id)) fire(id, true);
            for (const id of live) if (!next.has(id)) fire(id, false);
            live.clear();
            for (const id of next) live.add(id);
          },
        },
      },
    },
    { signal, log },
  ).done;
}

/** The outcome of a `wait`: the agent reached a target bucket (`met`, carrying the
 *  matched agent), the terminal we were waiting on was removed before it got there
 *  (`gone` — its PTY exited, so the bucket can never land), the wait elapsed its
 *  cap (`timeout`), the caller's signal aborted the wait (`interrupted` — a
 *  Ctrl+C), or the mirror settled without any of those (`closed` — a genuinely
 *  dropped link; `error` holds the first upstream failure if there was one). The
 *  `interrupted`/`closed` split is decided here from `opts.signal`, so the outcome
 *  alone carries the full result. */
export type WaitOutcome =
  | { kind: "met"; agent: AgentInfo }
  | { kind: "gone" }
  | { kind: "timeout" }
  | { kind: "interrupted" }
  | { kind: "closed"; error?: string };

/** Block until one terminal's agent enters a target bucket, then resolve `met`;
 *  or `timeout` after `timeoutMs`, or `closed` if the link settles first. Pure
 *  data layer (no tty, no `process.exit`) so it is testable over a real socket —
 *  `cmdWait` is the thin glue that maps the outcome to output + exit code.
 *
 *  It rides `watchTerminals`, so the mirror REPLAYS each terminal's current value
 *  on connect: an agent ALREADY in a target bucket matches immediately (no hang
 *  waiting for a transition that already happened) — this is what makes the
 *  two-phase `--until working` THEN `--until awaiting,waiting` loop robust against
 *  the stale-state race. If the watched terminal is REMOVED before it reaches a
 *  target bucket (its PTY exited), the bucket can never land, so we resolve `gone`
 *  at once rather than blocking until `timeoutMs` (or, with none, forever). This
 *  covers the exit that happens in the gap between the caller resolving the id and
 *  this subscription too: we SEED the mirror with `opts.id`, so if the first
 *  snapshot no longer carries it, the mirror fires `onRemove` and we resolve `gone`
 *  rather than hanging (the mirror never opens — hence never removes — a key it
 *  didn't see arrive). An external `signal` (the CLI's Ctrl+C) is chained into the
 *  internal abort. */
export async function awaitAgentState(
  client: PadiTuiClient,
  opts: {
    id: TerminalId;
    targets: ReadonlySet<string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<WaitOutcome> {
  const abort = new AbortController();
  if (opts.signal !== undefined) {
    if (opts.signal.aborted) abort.abort();
    else
      opts.signal.addEventListener("abort", () => abort.abort(), {
        once: true,
      });
  }
  let outcome: WaitOutcome | undefined;
  let upstreamError: string | undefined;
  const timer =
    opts.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          outcome ??= { kind: "timeout" };
          abort.abort();
        }, opts.timeoutMs);
  try {
    await watchTerminals(
      client,
      {
        onUpsert: (id, value) => {
          if (id !== opts.id || !agentMatchesUntil(value, opts.targets)) return;
          // The match guarantees a live agent; re-read it for the `met` outcome.
          const agent = activeAgent(value);
          if (agent !== null) {
            outcome ??= { kind: "met", agent };
            abort.abort();
          }
        },
        // The terminal we're waiting on left the collection — its PTY exited, so no
        // future frame can carry the target bucket. Resolve `gone` and unwind
        // rather than hanging until the timeout. Removals of OTHERS are noise here.
        onRemove: (id) => {
          if (id !== opts.id) return;
          outcome ??= { kind: "gone" };
          abort.abort();
        },
      },
      abort.signal,
      (line) => {
        upstreamError ??= line;
      },
      // Seed the watched id so a terminal that exited BEFORE this subscription
      // (in the gap after the caller resolved the id) is reconciled to `gone` on
      // the first snapshot instead of hanging.
      () => [opts.id],
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return (
    outcome ??
    (opts.signal?.aborted
      ? { kind: "interrupted" }
      : { kind: "closed", error: upstreamError })
  );
}
