/**
 * The data side of the CLI — reading the `terminalWorkspaceSurface` from a
 * connected client, factored out of `main.ts` so it is testable against a real
 * pulam over a real socket with no tty (see the integration test). Two reads: a
 * one-shot `snapshotAwareness` for `status`, and a live `watchAwareness` for
 * `watch` (the `awareness` collection + the `activity` live-dot stream, driven
 * by `mirrorRemoteSurface`).
 */

import { isContractVersionCompatible } from "@kolu/surface/define";
import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import {
  type AwarenessValue,
  TERMINAL_WORKSPACE_CONTRACT_VERSION,
  type TerminalId,
  terminalWorkspaceSurface,
} from "@kolu/terminal-workspace/surface";
import type { PulamClient } from "./connect.ts";

/** Confirm the running pulam speaks a wire-compatible workspace contract before
 *  we read it — a newer pulam-tui against an older/different daemon would
 *  otherwise fail deep inside oRPC with an opaque schema error instead of an
 *  honest "restart it" line. The `version` cell ALWAYS opens with a snapshot
 *  frame, so an empty stream is a protocol/link failure, not a benign "no value
 *  yet" — `firstFrameOrUndefined` returning undefined is surfaced as such. */
export async function assertCompatible(client: PulamClient): Promise<string> {
  const version = await firstFrameOrUndefined(
    await client.surface.version.get({}),
  );
  if (version === undefined) {
    throw new Error(
      "pulam version cell yielded no snapshot frame — the surface stream ended empty (link or protocol failure).",
    );
  }
  if (
    !isContractVersionCompatible(
      version.contractVersion,
      TERMINAL_WORKSPACE_CONTRACT_VERSION,
    )
  ) {
    throw new Error(
      `workspace contract mismatch: the daemon speaks ${version.contractVersion}, pulam-tui needs ${TERMINAL_WORKSPACE_CONTRACT_VERSION}. Restart it (and pulam-tui) to the same build.`,
    );
  }
  return version.contractVersion;
}

/** A one-shot snapshot of the whole awareness collection: the current key set
 *  (the first frame of the `keys` snapshot-then-delta stream), then each key's
 *  current value (the first frame of its per-key stream). Per-key reads run
 *  concurrently; their streams are aborted once read. */
export async function snapshotAwareness(
  client: PulamClient,
): Promise<Array<[TerminalId, AwarenessValue]>> {
  const abort = new AbortController();
  try {
    const keys =
      (await firstFrameOrUndefined(await client.surface.awareness.keys({}))) ??
      [];
    const pairs = await Promise.all(
      keys.map(async (key): Promise<[TerminalId, AwarenessValue] | null> => {
        const value = await firstFrameOrUndefined(
          await client.surface.awareness.get({ key }, { signal: abort.signal }),
        );
        return value === undefined ? null : [key, value];
      }),
    );
    return pairs.filter((p): p is [TerminalId, AwarenessValue] => p !== null);
  } finally {
    abort.abort();
  }
}

/** A still-unresolved awareness value — the daemon's `seedAwarenessValue`: no
 *  git, no agent, no foreground, PR not yet resolved, recency at 0. A freshly
 *  (re)started pulam — exactly what `--host` provisions — publishes this seed for
 *  each terminal the instant it discovers it, THEN fills it in asynchronously as
 *  the git / PR / agent / foreground sensors resolve. So a value is "resolved
 *  enough to show" once ANY of those fields has landed. */
function isResolved(v: AwarenessValue): boolean {
  return (
    v.git !== null ||
    v.agent !== null ||
    v.foreground !== null ||
    v.pr.kind !== "pending" ||
    v.lastActivityAt > 0
  );
}

/** A snapshot that WAITS for the daemon's sensors to resolve, for `status`.
 *  `snapshotAwareness` takes each key's first frame — which for a just-dialed
 *  ephemeral pulam (`--host` provisions a fresh one) is the unresolved *seed*,
 *  so every row renders blank. Instead, mirror the `awareness` collection (the
 *  same delta-delivering path `watch` rides) and settle once **every** terminal
 *  the daemon first reported has a resolved value (`isResolved`), then linger
 *  `graceMs` so sibling fields landing in the same burst are caught — capping the
 *  whole wait at `maxMs`. Against a warm daemon every value arrives resolved, so
 *  this settles at once (sub-`graceMs`); against a fresh one it waits just long
 *  enough for the sensors. A terminal the sensors legitimately resolve to
 *  "nothing" (no repo, no agent) never flips `isResolved`, so it falls through at
 *  `maxMs` — bounded, never a hang. */
export async function settledSnapshot(
  client: PulamClient,
  opts: { maxMs?: number; graceMs?: number } = {},
): Promise<Array<[TerminalId, AwarenessValue]>> {
  // Once the fast sensors (git/PR) have resolved every terminal, `graceMs` is how
  // long we keep collecting before printing — wide enough to catch the slower
  // agent / foreground sensors, which land a beat later (~1s after git) in the
  // same burst. `maxMs` caps the whole wait so a terminal that resolves to
  // nothing — or an agent churning continuous deltas — can't stall the snapshot.
  const maxMs = opts.maxMs ?? 3000;
  const graceMs = opts.graceMs ?? 1500;
  // The key set the daemon first reports — the terminals we wait to resolve.
  // (A terminal appearing later still lands in `acc` and renders; one that
  // leaves just stops blocking the gate.)
  const expected =
    (await firstFrameOrUndefined(await client.surface.awareness.keys({}))) ??
    [];

  const acc = new Map<TerminalId, AwarenessValue>();
  const abort = new AbortController();
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const stop = (): void => {
    abort.abort();
    settle();
  };
  const hardCap = setTimeout(stop, maxMs);

  // Settle once every still-present expected terminal has a resolved value —
  // then a short grace for siblings in the same burst (re-armed so a value that
  // un-resolves can't settle early). Empty expectation → nothing to wait for.
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
    terminalWorkspaceSurface,
    client,
    {
      collections: {
        awareness: {
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
    { signal: abort.signal },
  ).done.then(settle, settle); // a closed link settles us too (nothing more coming)

  try {
    await done;
  } finally {
    clearTimeout(hardCap);
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    abort.abort();
  }
  return [...acc.entries()];
}

/** Handlers a live `watch` reacts to. `live` is whether the terminal is moving
 *  bytes RIGHT NOW (the `activity` stream's current membership) at the instant
 *  of the awareness change — annotation only; an activity-only flip emits no
 *  line of its own (it pulses ~1s while bytes move, which would drown the feed),
 *  it just colours the next awareness line. */
export interface WatchHandlers {
  onUpsert: (id: TerminalId, value: AwarenessValue, live: boolean) => void;
  onRemove: (id: TerminalId) => void;
}

/** Follow the awareness collection live until the link closes (the caller
 *  disposes on Ctrl+C) or `signal` aborts. One `mirrorRemoteSurface` drives both
 *  the `awareness` collection (the rows) and the `activity` stream (the live
 *  dot): the activity frame updates a local live-set the upsert handler reads,
 *  so a printed line reflects whether that terminal was moving bytes at the time.
 *  Resolves when the mirror settles (every subscription ended = link closed).
 *
 *  `log` is the diagnostic sink for NON-abort upstream failures (a dropped link,
 *  a protocol error). Without it `mirrorRemoteSurface` would default to a no-op
 *  and a real connection loss would look like a clean stop — so `watch` passes a
 *  stderr sink and treats an un-aborted settle as a failure (see `cmdWatch`). */
export async function watchAwareness(
  client: PulamClient,
  handlers: WatchHandlers,
  signal?: AbortSignal,
  log?: (line: string) => void,
): Promise<void> {
  // The `activity` stream's current membership — the set of terminals moving
  // bytes right now. Updated on each frame; read (not re-emitted) by upserts.
  //
  // Seed it from the activity stream's CURRENT snapshot before the mirror opens,
  // so the initial awareness rows already know which terminals are live. The
  // mirror starts the awareness collection and the activity stream concurrently
  // with no ordering guarantee, so the keys-snapshot upserts can otherwise race
  // ahead of the activity stream's first frame and paint an already-active
  // terminal as idle until some later awareness change happens to re-emit it.
  // The mirror re-applies the same snapshot on its first activity frame (and
  // every delta after), so this only fills the startup gap.
  const live = new Set<TerminalId>();
  const seedAbort = new AbortController();
  try {
    const seed = await firstFrameOrUndefined(
      await client.surface.activity.get({}, { signal: seedAbort.signal }),
    );
    for (const id of seed ?? []) live.add(id);
  } finally {
    seedAbort.abort();
  }
  await mirrorRemoteSurface(
    terminalWorkspaceSurface,
    client,
    {
      collections: {
        awareness: {
          // Guard the consumer callbacks at this funnel: a throwing handler must
          // not escape into mirrorRemoteSurface's internal loop and wedge the
          // whole watch — contain it to the one frame and surface it via `log`.
          upsert: (id, value) => {
            try {
              handlers.onUpsert(id, value, live.has(id));
            } catch (err) {
              log?.(
                `awareness upsert handler failed: ${(err as Error).message}`,
              );
            }
          },
          remove: (id) => {
            try {
              handlers.onRemove(id);
            } catch (err) {
              log?.(
                `awareness remove handler failed: ${(err as Error).message}`,
              );
            }
          },
        },
      },
      streams: {
        activity: {
          input: {},
          onFrame: (ids) => {
            live.clear();
            for (const id of ids) live.add(id);
          },
        },
      },
    },
    { signal, log },
  ).done;
}

/** The outcome of a `wait`: the agent reached a target bucket (`met`, carrying
 *  the matched agent), the wait elapsed its cap (`timeout`), or the mirror
 *  settled without either (`closed` — a dropped link, or the caller's signal
 *  aborting; `error` holds the first upstream failure if there was one). */
export type WaitOutcome =
  | { kind: "met"; agent: NonNullable<AwarenessValue["agent"]> }
  | { kind: "timeout" }
  | { kind: "closed"; error?: string };

/** Block until one terminal's agent enters a target bucket (`matches` true),
 *  then resolve `met`; or resolve `timeout` after `timeoutMs`, or `closed` if
 *  the link settles first. Pure data layer (no tty, no `process.exit`) so it is
 *  testable over a real socket — `cmdWait` is the thin glue that maps the
 *  outcome to output + exit code.
 *
 *  It rides `watchAwareness`, so the mirror REPLAYS each terminal's current
 *  value on connect: an agent already in a target bucket matches immediately
 *  (no hang waiting for a transition that already happened). An external
 *  `signal` (the CLI's Ctrl+C) is chained into the internal abort, so a caller
 *  interrupt unwinds the same way the timeout does — but leaves `outcome`
 *  unset, surfacing as `closed` (which `cmdWait` distinguishes from a real link
 *  drop via its own signal). */
export async function awaitAgentState(
  client: PulamClient,
  opts: {
    id: TerminalId;
    matches: (agent: AwarenessValue["agent"]) => boolean;
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
    await watchAwareness(
      client,
      {
        onUpsert: (id, value) => {
          if (id !== opts.id) return;
          // Guard non-null first so `agent` narrows — `matches` only returns
          // true for an agent in a target bucket, but the guard keeps the type
          // honest without a cast.
          if (value.agent !== null && opts.matches(value.agent)) {
            outcome ??= { kind: "met", agent: value.agent };
            abort.abort();
          }
        },
        onRemove: () => {},
      },
      abort.signal,
      (line) => {
        upstreamError ??= line;
      },
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return outcome ?? { kind: "closed", error: upstreamError };
}
