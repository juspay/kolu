/**
 * The client-side terminal WATCH kit — follow padi's `terminals` collection
 * live, and block until one terminal's agent enters a target bucket. Part of
 * the dial kit (re-exported through `@kolu/padi/dial`): a daemon's package
 * owns the client helpers its consumers share.
 *
 * Graduated here from padi-tui (`read.ts`/`render.ts`) the day the kolu MCP
 * face's `wait_agentState` became the VERBATIM second consumer — both drive
 * the same `padiSurface`, so a copy in each would be two lockstep owners of
 * the wait predicate (the unification gate the padi note records). padi-tui
 * imports these back; the CLI-flag grammar (`--until`'s comma parse and its
 * error strings) stays in padi-tui — only the surface-shaped vocabulary and
 * the watch/wait machinery live here.
 *
 * The race/lifecycle boilerplate rides `@kolu/surface/wait`'s `runWait`
 * scaffold; this module owns only the padi-shaped watchers and predicates.
 */

import { runWait, type WaitOutcome } from "@kolu/surface/wait";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiSurfaceClient } from "./dial.ts";
import { padiSurface, type PadiTerminal } from "./surface.ts";

/** The LIVE agent of a composed record, or `null` — only the `active` arm
 *  carries a running agent (`sleeping`/`parked` are dormant, their PTY
 *  released), so the union is narrowed here rather than at every read site. */
export function activeAgent(v: PadiTerminal): AgentInfo | null {
  return v.state === "active" ? v.agent : null;
}

/** The coarse agent buckets a wait accepts as targets — the `agentBucket`
 *  fold's vocabulary minus `other` (an `other` bucket never matches a real
 *  agent, so accepting it would only ever time out). A wait compares against
 *  the *bucket*, never the raw `AgentInfo['state']` literals, so the one fold
 *  in `@kolu/terminal-vocab/agentProjection` stays the single source of truth
 *  (see `.claude/rules/dock-fleet-mirror.md`). */
export const WAIT_STATES = [
  "working",
  "awaiting",
  "waiting",
] as const satisfies readonly Exclude<
  ReturnType<typeof agentBucket>,
  "other"
>[];

export type WaitState = (typeof WAIT_STATES)[number];

/** Whether a terminal's agent is in one of the target buckets — the wait
 *  predicate. A record with no live agent (a bare shell, a sleeping/parked
 *  terminal, or an agent that exited) is never a match; otherwise its `state`
 *  folds through the shared `agentBucket` and is tested for membership. */
export function agentMatchesUntil(
  v: PadiTerminal,
  targets: ReadonlySet<string>,
): boolean {
  const agent = activeAgent(v);
  return agent !== null && targets.has(agentBucket(agent.state));
}

/** Handlers a live watch reacts to. `live` is whether the terminal is moving
 *  bytes RIGHT NOW (the `activity` stream's current membership) at the instant
 *  of the record change — annotation only; an activity-only flip emits no line
 *  of its own (it pulses ~1s while bytes move, which would drown the feed), it
 *  just colours the next record line. */
export interface WatchHandlers {
  onUpsert: (id: TerminalId, value: PadiTerminal, live: boolean) => void;
  onRemove: (id: TerminalId) => void;
  /** A terminal STARTED (`live` true) or STOPPED (`live` false) moving bytes —
   *  the `activity` stream's live-set transitions, so byte-activity is visible
   *  on its own, not only as a `●` annotation on a coincident awareness line.
   *  A continuously-busy terminal fires ONE `true` (its idle timer keeps
   *  re-arming), then one `false` when output stops — no ~1s pulse spam.
   *  Optional; a wait ignores it. */
  onActivity?: (id: TerminalId, live: boolean) => void;
}

/** Follow the `terminals` collection live until the link closes (the caller
 *  disposes on Ctrl+C) or `signal` aborts. One `mirrorRemoteSurface` drives
 *  both the `terminals` collection (the rows) and the `activity` stream (the
 *  live dot): the activity frame updates a local live-set the upsert handler
 *  reads, so a printed line reflects whether that terminal was moving bytes at
 *  the time.
 *
 *  `log` is the diagnostic sink for NON-abort upstream failures (a dropped
 *  link, a protocol error). Without it a real connection loss would look like
 *  a clean stop — so a watch passes a stderr sink and treats an un-aborted
 *  settle as a failure.
 *
 *  `initialKeys` seeds the mirror's cross-connect reconciliation: any key it
 *  lists that is ABSENT from the collection's first snapshot fires `onRemove`
 *  at once (the mirror's own departed-while-away sweep). A wait passes the id
 *  it is watching, so a terminal that exited in the gap between id-resolution
 *  and this subscription is reported gone on the first frame rather than
 *  hanging forever. */
export async function watchTerminals(
  client: PadiSurfaceClient,
  handlers: WatchHandlers,
  signal?: AbortSignal,
  log?: (line: string) => void,
  initialKeys?: () => Iterable<TerminalId>,
): Promise<void> {
  // The `activity` stream's current membership — the set of terminals moving
  // bytes right now — built up from the mirror's own `activity` frames below.
  // It starts EMPTY and stays that way until the first frame: padi builds a
  // FRESH per-subscription activity tracker whose first frame is always the
  // empty set (a new subscriber can't learn which terminals were ALREADY busy —
  // bytes are only counted from the deltas that arrive AFTER it subscribes), so
  // there is nothing a pre-seed subscription could recover. An already-busy
  // terminal simply lights on its next output chunk.
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
          // A key here that the first snapshot doesn't re-assert departed before
          // we subscribed — the mirror fires `onRemove` for it once (see
          // `awaitAgentState`).
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
            // `live` starts empty and fills from these frames. Guard the callback
            // so a throwing consumer can't wedge the mirror loop.
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

/** The outcome of an agent-state wait — the shared {@link WaitOutcome} union
 *  with the met payload this wait stamps: the matched agent, plus how long the
 *  wait took. */
export type AgentStateOutcome = WaitOutcome<{
  agent: AgentInfo;
  elapsedMs: number;
}>;

/** Block until one terminal's agent enters a target bucket, then resolve
 *  `met`; or `timeout` after `timeoutMs`, `gone` if the terminal is removed
 *  first (its PTY exited, so the bucket can never land), `interrupted` on
 *  `signal` abort, or `closed` if the link settles without any of those. Pure
 *  data layer (no tty, no `process.exit`) so it is testable over a real
 *  socket — padi-tui's `cmdWait` and the MCP face's `wait_agentState` are the
 *  thin glue mapping the outcome to their own output frames.
 *
 *  It rides {@link watchTerminals}, so the mirror REPLAYS each terminal's
 *  current value on connect: an agent ALREADY in a target bucket matches
 *  immediately (no hang waiting for a transition that already happened) — this
 *  is what makes the two-phase `--until working` THEN `--until
 *  awaiting,waiting` loop robust against the stale-state race. The watched id
 *  is SEEDED into the mirror, so a terminal that exited before the
 *  subscription reconciles to `gone` on the first snapshot instead of hanging.
 *  A watcher failure (the mirror rejecting) PROPAGATES per `runWait`'s
 *  contract — a bug is never folded into `closed`. */
export async function awaitAgentState(
  client: PadiSurfaceClient,
  opts: {
    id: TerminalId;
    targets: ReadonlySet<string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<AgentStateOutcome> {
  return runWait<{ agent: AgentInfo; elapsedMs: number }>(
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
    (ctx) =>
      watchTerminals(
        client,
        {
          onUpsert: (id, value) => {
            if (id !== opts.id || !agentMatchesUntil(value, opts.targets))
              return;
            // The match guarantees a live agent; re-read it for the met outcome.
            const agent = activeAgent(value);
            if (agent !== null) {
              ctx.settle({ kind: "met", agent, elapsedMs: ctx.elapsedMs() });
            }
          },
          // The terminal we're waiting on left the collection — its PTY exited, so
          // no future frame can carry the target bucket. Resolve gone and unwind
          // rather than hanging until the timeout. Removals of OTHERS are noise.
          onRemove: (id) => {
            if (id !== opts.id) return;
            ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
          },
        },
        ctx.signal,
        (line) => ctx.recordUpstreamError(line),
        // Seed the watched id so a terminal that exited BEFORE this subscription
        // (in the gap after the caller resolved the id) is reconciled to gone on
        // the first snapshot instead of hanging.
        () => [opts.id],
      ),
  );
}
