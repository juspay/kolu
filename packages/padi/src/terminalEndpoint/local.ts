/**
 * `LocalTerminalEndpoint` — this kolu process. It does **not** own `kaval`:
 * `kolu-server` is a client of a separately spawned kaval daemon, and reaches
 * it through the typed `ptyHostSurface` contract via the stable `ptyHostClient`
 * forwarding facade (`../ptyHost/index.ts`) over that daemon's own socket. This
 * endpoint forwards spawn/kill/write/resize/attach through that client AND
 * **runs the per-terminal sensor set** (`@kolu/terminal-vocab`) against the
 * pty-host's raw tap streams (cwd · title · command-run · foreground).
 *
 * Why route through the contract rather than call `PtyHost` directly: the
 * consumer here is then written against `PtyHostClient` — the exact shape the
 * daemon (over a unix socket) or a remote ssh pty-host serves. The sensor set
 * has zero synchronous dependency on the host (it reads taps, not a
 * `PtyHandle`), so it runs identically across the wire. The kaval daemon serves
 * its own socket, which `kaval-tui` reaches directly — a second consumer of the
 * one host, and nothing in this file changes for it. See
 * `docs/atlas/src/content/atlas/pty-daemon.mdx` (Fresh approach).
 *
 * `TerminalEndpoint.fs/git` bind to the host-side wrapper lifted into
 * `@kolu/terminal-vocab` (R6) — `createTerminalWorkspaceEndpoint` shells out
 * to `kolu-git` for this machine; a remote endpoint (R8) mirrors the same
 * `terminal-workspace` surface over the link, so there is one fs/git impl.
 */

import type { WireSchema } from "@kolu/surface/define";
import { type Channel, inMemoryChannel } from "@kolu/surface/server";
import type {
  AgentIdentity,
  TerminalEvent,
  TerminalId,
  TerminalPorts,
  TerminalSnapshot,
  TerminalState,
} from "@kolu/terminal-vocab/schema";
import { seedSnapshot, TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { resumeFormFor } from "anyagent/cli";
import { Effect, Result, Schema, Stream } from "effect";
import type { ForegroundSample, PtyHostClient, PtyHostListEntry } from "kaval";
import { abortableDelay } from "../abortableDelay.ts";
import { trackRecentAgent, trackRecentRepo } from "../activity/activity.ts";
import type {
  EndpointGrid,
  PtySpawnOpts,
  TerminalAttachment,
  TerminalEndpoint,
  TerminalHandle,
  TerminalHistoryChunk,
} from "../endpoint.ts";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import {
  createPortSampler,
  type PortSampler,
  type PortScanTarget,
} from "../ports/index.ts";
import { buildTerminalSpawnInput, ptyHostClient } from "../ptyHost/index.ts";
import { notifyDirty } from "../publisher.ts";
import {
  type ActiveTerminalProcess,
  drainTerminals,
  getActiveTerminal,
  getTerminal,
  listTerminals,
  parkedTerminalIds,
  registerTerminal,
  type SleepingTerminalProcess,
  type TerminalProcess,
  terminalNotFound,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { cleanupTerminalScratch } from "../terminalScratch.ts";
import { createTerminalWorkspaceEndpoint } from "../terminalWorkspace/endpoint.ts";
import {
  type FoldCtx,
  fold,
  restoreTargetEqual,
  restoreTargetOf,
  seedRecencyBaseline,
  stepRecencyBaseline,
} from "../terminalWorkspace/fold.ts";
import {
  type CommandRunSample,
  type SensorSignals,
  startSensors,
} from "../terminalWorkspace/sensors.ts";
import type {
  AuthoredActiveTerminal,
  SavedActiveTerminal,
  SavedSleepingTerminal,
  TerminalInfo,
} from "../vocab.ts";
import {
  AuthoredActiveSchema,
  AuthoredParkedSchema,
  AuthoredSleepingSchema,
  createAuthoredActive,
  LOCAL_LOCATION,
  PersistedSnapshotSchema,
  SavedActiveTerminalSchema,
  SavedSleepingTerminalSchema,
} from "../vocab.ts";
import {
  commitSnapshot,
  dropSnapshot,
  installSnapshot,
  publishTerminalState,
  updateMemory,
} from "./metadata.ts";
import {
  type OpenedAttach,
  reattachingDeltas,
  releaseOnAbort,
} from "./reattachingDeltas.ts";

// ── Decoders ────────────────────────────────────────────────────────────
// `Schema.decodeUnknownSync` is the successor of zod's `.parse` — same fail-fast
// semantic, same call sites. Bound ONCE per schema at module scope rather than
// per call: `decodeUnknownSync` compiles the schema on each application, and
// three of these run on the per-terminal sleep/wake/seed paths.
const decodePersistedSnapshot = Schema.decodeUnknownSync(
  PersistedSnapshotSchema,
);
const decodeAuthoredActive = Schema.decodeUnknownSync(AuthoredActiveSchema);
const decodeAuthoredSleeping = Schema.decodeUnknownSync(AuthoredSleepingSchema);
const decodeAuthoredParked = Schema.decodeUnknownSync(AuthoredParkedSchema);
const decodeTerminalId = Schema.decodeUnknownResult(TerminalIdSchema);
// The TOLERANT read boundary for an adopted survivor's saved record (#2122) —
// `decodeUnknownResult` is a BRANCH, never a throw. `SavedActiveTerminalSchema`
// is the whole record (persisted snapshot + authored fields + id), so a success
// here makes the two projections below (`adoptedAuthored` /`adoptedSnapshot`,
// both `decodeUnknownSync` over strict subsets of these same fields) total by
// construction — exactly how `seedHandlelessTerminal` gates its own sub-decodes.
const decodeSavedActive = Schema.decodeUnknownResult(SavedActiveTerminalSchema);

/** Birth a terminal's two halves together — register the entry (whose required
 *  `snapshot` field carries the value) and fan that snapshot out to the
 *  `snapshots` collection. The SEED counterpart to `finalizeRemoval`'s teardown:
 *  "the entry exists" and "its snapshot is published" become one step, so an R9
 *  install/publish change touches one place. Each caller keeps its own POSTAMBLE
 *  (publishTerminalState, markReady + sensors, the list-changed emit) at the call
 *  site, exactly as `finalizeRemoval`'s callers keep their preamble. */
function registerAndInstall(id: TerminalId, entry: TerminalProcess): void {
  registerTerminal(id, entry);
  installSnapshot(id);
}

// ── Local fs/git surfaces (local fs is on this machine) ─────────────────
// The thin wrapper over `kolu-git` was lifted to `@kolu/terminal-vocab`
// (R6) so padi drives ONE impl whether it serves the local host (here,
// in-process) or a remote host. This
// endpoint binds that impl to its `TerminalEndpoint`; the surface streams in
// `surface.ts` read it off `localEndpoint.fs/git` byte-identically.
const { fs: localFs, git: localGit } = createTerminalWorkspaceEndpoint(log);

// ── The contract-backed terminal handle ─────────────────────────────────

/** A `TerminalHandle` whose control verbs forward through the pty-host client.
 *  Every verb waits on `ready` first — `spawn` is an async RPC (even
 *  in-process the contract call resolves on a later microtask), so a tile that
 *  renders on the sync shadow can issue attach/write/resize *before* the PTY
 *  exists. Without the gate, attach hits "no PTY with id …" and early
 *  keystrokes are silently dropped. `write`/`resize` queue behind `ready`
 *  (fire-and-forget once released — the call is cheap and the PTY is the
 *  authority); `getScreenState`/`getScreenText`/`attach` await it (so the
 *  contract widened those to allow a Promise). Holds only the terminal id +
 *  pid — the live reads (cwd / process / foregroundPid) the sensors need
 *  arrive over the tap streams, not this handle. */
/** The rejection reason when a fresh `terminal.spawn` SUCCEEDED on the daemon but
 *  the registry entry it belonged to was REPLACED or removed BEFORE it reached
 *  `ready` — a second client killed or slept the terminal mid-spawn (the identity
 *  check in {@link LocalTerminalEndpoint.spawnViaClient} fails). This is a typed,
 *  padi-LOCAL discriminant (no kaval/handle-contract change): it distinguishes an
 *  explicit newer user action from a genuine infrastructure spawn failure (a
 *  dead/wedged kaval, or a bad cwd), which rejects with the raw RPC error instead.
 *  Restore keys on THIS type to HONOR the kill/slept intent — it must NOT re-park a
 *  terminal the user just killed as a restore offer (F3). */
export class TerminalSpawnRacedError extends Error {
  constructor() {
    super("terminal raced during spawn (killed/slept)");
    this.name = "TerminalSpawnRacedError";
  }
}

/** Exported so a seam test can drive the REAL producer against a REAL
 *  `ptyHostClientOver` face — the face is where kaval's input schemas are
 *  decoded, so a paraphrased fake would not exercise the gate this proxy has to
 *  satisfy (#17: an `optionalKey` field rejects a present-`undefined`). */
export class PtyHostTerminalProxy implements TerminalHandle {
  pid = 0;
  /** Resolves once `terminal.spawn` has created the PTY. Rejects if spawn
   *  failed, so a queued write / awaited attach surfaces the failure instead
   *  of hanging or hitting a missing PTY. */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: unknown) => void;

  /** The pty-host client is injected so the proxy is decoupled from how it's
   *  built — but it's a stable reference, not a thunk: this is the forwarding
   *  facade from `../ptyHost/index.ts` (`makeForwardingClient`), which resolves
   *  the endpoint's live connection on every call. So a daemon recycle (B3) is
   *  invisible here without re-pointing anything, and the proxy never needs to
   *  re-resolve per verb. */
  constructor(
    private readonly id: TerminalId,
    private readonly client: PtyHostClient,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // A spawn failure with nothing yet awaiting `ready` must not reach the
    // process-wide unhandledRejection handler (which would exit the server).
    this.ready.catch(() => {});
  }

  /** PTY exists — release queued/awaiting verbs. */
  markReady(pid: number): void {
    this.pid = pid;
    this.resolveReady();
  }

  /** Spawn failed (or raced a kill) — fail queued/awaiting verbs. */
  markFailed(err: unknown): void {
    this.rejectReady(err);
  }

  write(data: string): void {
    void this.ready
      .then(() =>
        runEndpointEdge(
          this.client.surface.terminal.write({ id: this.id, data }),
        ),
      )
      .catch((err) => log.error({ terminal: this.id, err }, "pty-host write"));
  }

  /** AWAITED, unlike `write`: a resize is a CLAIM about the consumer's grid, and
   *  a claim that silently failed to land leaves that consumer rendering against
   *  a size the PTY does not have — the exact wrong-grid screen this subsystem
   *  exists to prevent, with no way for the caller to know. So the rejection
   *  propagates to the caller instead of collapsing into a server-side log.
   *
   *  `ok: false` is the ONE quiet outcome: kaval had no such PTY, i.e. the
   *  process exited on its side before padi observed the exit and tore this
   *  proxy down. That is the same expected killed-terminal race the surrounding
   *  design deliberately quiet-drops (see `servePadi`'s `getActiveTerminal`
   *  drop), not a failure — there is no consumer left to render at the wrong
   *  size. Returning here keeps it out of the caller's error path; anything that
   *  REJECTS (transport, handler throw) still propagates, which is the failure
   *  the client's toast exists for. */
  async resize(cols: number, rows: number): Promise<void> {
    await this.ready;
    const { ok } = await runEndpointEdge(
      this.client.surface.terminal.resize({
        id: this.id,
        cols,
        rows,
      }),
    );
    if (!ok)
      log.debug(
        { terminal: this.id, cols, rows },
        "resize dropped: pty already exited on kaval's side",
      );
  }

  async getScreenState(): Promise<string> {
    await this.ready;
    const { data } = await runEndpointEdge(
      this.client.surface.terminal.getScreenState({
        id: this.id,
      }),
    );
    return data;
  }

  async getScreenText(
    startLine?: number,
    endLine?: number,
    tailLines?: number,
  ): Promise<string> {
    await this.ready;
    // Translate the positional `TerminalHandle` contract into the wire's single
    // bound axis: a tail pins the read to the screen bottom; an explicit
    // start/end is a line range; nothing set is the full scrollback. The three
    // never combine, so there's no precedence to encode — each maps to its own
    // `ScreenExtent` variant rather than an open range standing in for "full".
    //
    // The `range` arm SPREADS each bound, never spells it (#17): both are
    // `Schema.optionalKey` on kaval's wire and the client face DECODES this
    // input, so an ABSENT key is accepted and a present-but-`undefined` one is
    // REJECTED — where zod's `.optional()` took either. A HALF-open range (only
    // a start, or only an end) is exactly the shape `screen.text` forwards when
    // the caller sent one bound, so spelling the missing half out would throw
    // before the call ever left padi.
    const extent =
      tailLines !== undefined
        ? ({ kind: "tail", lines: tailLines } as const)
        : startLine === undefined && endLine === undefined
          ? ({ kind: "full" } as const)
          : ({
              kind: "range",
              ...(startLine !== undefined && { startLine }),
              ...(endLine !== undefined && { endLine }),
            } as const);
    const { text } = await runEndpointEdge(
      this.client.surface.terminal.getScreenText({
        id: this.id,
        extent,
      }),
    );
    return text;
  }

  async getHistory(
    before: number | undefined,
    max: number,
    epoch?: number,
  ): Promise<TerminalHistoryChunk> {
    await this.ready;
    return runEndpointEdge(
      this.client.surface.terminal.getHistory({
        id: this.id,
        // SPREAD both cursors, never spell them (#17): each is
        // `Schema.optionalKey` on kaval's wire and the client face DECODES this
        // input, so an ABSENT key is accepted and a present-but-`undefined` one is
        // REJECTED — where zod's `.optional()` took either. Both absences are
        // ORDINARY, not edge cases: an omitted `before` is the documented
        // self-seeding first page (what the `screen_history` MCP tool sends), and
        // an omitted `epoch` is every caller whose attach snapshot carried no
        // `reflowEpoch`. Spelling either out throws before the call leaves padi.
        ...(before !== undefined && { before }),
        max,
        ...(epoch !== undefined && { epoch }),
      }),
    );
  }
}

// ── Per-terminal sensor bridge ───────────────────────────────────────

/** Pump a pty-host tap stream into a callback until it ends or `signal` aborts
 *  (kill / exit). The contract stream call resolves to the async iterable (a
 *  `ClientPromiseResult`), so the source is awaited first. An aborted stream
 *  surfaces as a thrown error, so an aborted signal is treated as expected
 *  teardown, not a failure.
 *
 *  Returns a Promise that resolves when the stream ends or aborts (it never
 *  rejects — failures are logged / routed to `onError`). The per-terminal taps
 *  ignore it (fire-and-forget); the inventory reconciler awaits it to know when
 *  to re-subscribe across a daemon recycle. */
/** The FOREGROUND tap's `onError` — a NON-abort failure means the pty-host connection
 *  dropped (an unclean kaval death). It ONLY logs and performs NO
 *  `foreground.publish`: the W12 STAYS-DEFINED-UNDER-BLINDNESS invariant. The agent
 *  sensor's shell-idle discriminant reads `foregroundPid === undefined` as a genuine
 *  end (clears `restoreTarget`), so a blind observer must leave the LAST known sample
 *  (the stale DEFINED agent pid) in place — never fabricate a `null`/undefined. The
 *  only writer of the sensor's foreground is a real `onEvent` sample; `bridgeStream`
 *  (pinned in `bridgeStream.test.ts`) guarantees the failure path can't fabricate an
 *  `onEvent` either.
 *
 *  `foreground` is passed in — the handler HAS the capability to publish — precisely so
 *  the invariant is TESTABLE: a regression that "clears stale foreground on disconnect"
 *  would light up the pin in `bridgeStream.test.ts`. It is deliberately unused here. */
export function onForegroundTapError(
  id: string,
  foreground: Pick<SensorSignals["foreground"], "publish">,
  err: unknown,
): void {
  void foreground; // capability present, deliberately NOT exercised (blindness invariant)
  log.error(
    { err, terminal: id },
    "pty-host foreground tap failed — keeping last foreground sample (blind)",
  );
}

/**
 * THE Effect run edge of padi's terminal-endpoint layer — one function, so the
 * crossing is countable rather than scattered.
 *
 * Two shapes cross here and they are the same crossing. A TAP hands a `signal`,
 * which becomes fiber interruption at exactly this seam (D10/#18) — the
 * surrounding domain (`TerminalLifecycle.abort`, the port-nudge controller, the
 * reconciler) stays AbortController-shaped because it is not Effect code, and
 * interruption is what actually closes the kaval subscription. The SPAWN TAIL
 * hands none: `spawnPty` is synchronous by contract (the sync-shadow invariant —
 * the tile must render before the PTY exists), so the tail it fires cannot be
 * `yield*`ed by anybody; there is no Effect above it to compose into, because its
 * caller returns a value rather than a description.
 *
 * Everything else in this file composes.
 */
function runEndpointEdge<A>(
  program: Effect.Effect<A, unknown>,
  signal?: AbortSignal,
): Promise<A> {
  return Effect.runPromise(program, signal ? { signal } : undefined);
}

export function bridgeStream<T>(
  source: Stream.Stream<T, unknown>,
  signal: AbortSignal,
  onEvent: (value: T) => void,
  // Called when the stream itself fails for a NON-abort reason (an abort is
  // expected teardown and is always swallowed). The pure-enrichment taps (cwd /
  // title / command-run) omit it — a dropped enrichment stream just stops updating
  // that field, logged generically. The FOREGROUND and EXIT taps supply one for
  // distinct reasons: the foreground handler exists to make the blindness event
  // LOUD while performing NO reset of the last foreground sample (the W12 invariant
  // the sensor's shell-idle discriminant leans on — a dead observer must keep showing
  // the stale DEFINED agent pid, never a false shell-idle), and a dropped exit stream
  // is a lifecycle problem ("we no longer know when this PTY dies"), not a missing field.
  onError?: (err: unknown) => void,
): Promise<void> {
  return runEndpointEdge(
    Stream.runForEach(source, (value) =>
      Effect.sync(() => {
        try {
          onEvent(value);
        } catch (err) {
          // Per-event fence: a single bad event (a failed metadata publish, a
          // scratch-cleanup fs error on exit, …) must NOT escape and end the
          // consumption — that would silence this tap (cwd / title /
          // foreground / exit) for the terminal for good. Log and keep
          // consuming. (This is the fence the dissolved agent metadata loop
          // carried in `applyAgentEvent`; it moved here with the taps.)
          log.error(
            { err },
            "pty-host tap onEvent threw (subscription kept alive)",
          );
        }
      }),
    ),
    signal,
  ).then(
    () => {},
    (err) => {
      if (signal.aborted) return;
      if (onError) {
        onError(err);
        return;
      }
      log.error({ err }, "pty-host tap subscription failed");
    },
  );
}

/** Delay before re-subscribing to a kaval stream after it ends — one cadence for
 *  every consumer of {@link resubscribeStream} (the finish fold, the live dots, the
 *  port scan's output nudge), so recycle recovery feels consistent and the number
 *  cannot drift between them. Lives beside the loop it parameterizes rather than in
 *  one of the three consumers: the third consumer is in this file, and importing it
 *  back from `finishQuiet.ts` (which imports the loop from here) would make a cycle
 *  out of what is really just a knob on the loop. */
export const ACTIVITY_RESUBSCRIBE_DELAY_MS = 2_000;

/** Subscribe to a `ptyHostClient` stream and RE-SUBSCRIBE across daemon recycles
 *  (a B3.2 restart, a supervisor reconnect, the 5.2->5.3 force-recycle) until
 *  `signal` aborts. Fire-and-forget — callers `void` it; the loop owns its own
 *  failures, so nothing here rejects.
 *
 *  Owns the one subtlety BOTH live consumers (`inventoryReconcile`, `liveActivity`)
 *  need: the forwarding facade calls `liveClient()` EAGERLY, so `getStream()`
 *  THROWS SYNCHRONOUSLY when the daemon isn't connected (dead-on-boot or
 *  mid-recycle) — BEFORE `bridgeStream` runs, so bridgeStream's internal fence
 *  can't catch it. Without this guard that throw escapes to `unhandledRejection`
 *  and exits the server on the honest dead-daemon path. Caught here as a drop:
 *  `onDrop` logs, then delay + re-subscribe. A stream that DRAINS (bridgeStream
 *  resolves, never rejects) is a separate case, routed to `onStreamError` (or
 *  bridgeStream's default when omitted). Extracting this loop is what keeps the
 *  eager-throw guard from diverging between the two call sites.
 *
 *  A kaval stream member is now a LAZY `Stream` (kaval-report §5): building one
 *  registers nothing. That is why `getStream` is still a THUNK and why the
 *  subscription only exists once `bridgeStream` runs it — the same shape the
 *  loop already had, so the laziness trap is closed here by construction rather
 *  than at each call site. */
export async function resubscribeStream<T>(opts: {
  signal: AbortSignal;
  delayMs: number;
  getStream: () => Stream.Stream<T, unknown>;
  onEvent: (value: T) => void;
  onStreamError?: (err: unknown) => void;
  onDrop: (err: unknown) => void;
}): Promise<void> {
  const { signal, delayMs, getStream, onEvent, onStreamError, onDrop } = opts;
  while (!signal.aborted) {
    try {
      await bridgeStream(getStream(), signal, onEvent, onStreamError);
    } catch (err) {
      if (signal.aborted) return;
      onDrop(err);
    }
    if (signal.aborted) return;
    await abortableDelay(delayMs, signal);
  }
}

/** The producer's optional screen reader (Claude's AskUserQuestion / ExitPlanMode
 *  screen-scrape promotion, #905) — reads the rendered screen tail through the
 *  pty-host handle. `getScreenText` waits on `ready`, so it's safe even if a poll
 *  tick races spawn. The handle is read off the live active entry (the producer
 *  runs only while active). Looks the entry up explicitly rather than asserting:
 *  a poll tick can race teardown/sleep, and a bare TypeError would be misread by
 *  the producer's `isNotFoundError` gate as an UNEXPECTED scrape failure — so throw
 *  the structured `terminalNotFound` to keep the race classified as benign. */
function readScreenTextFor(id: TerminalId, tailLines: number): Promise<string> {
  const entry = getActiveTerminal(id);
  if (!entry) throw terminalNotFound(id);
  return entry.handle.getScreenText(undefined, undefined, tailLines);
}

/** Did any AUTHORED fact the fold writes change — the two memory fields the
 *  authored record stores (`lastActivityAt`, `lastAgentCommand`) plus the
 *  fold-derived `restoreTarget`? Compares the restore target BY VALUE
 *  (`restoreTargetEqual` over `restoreTargetOf`) rather than re-deriving the move
 *  from the target's raw inputs, so this fence can never desync from the projection
 *  it gates on — fold another input into `restoreTargetOf` and this stays correct.
 *  The AUTHORED-publish fence: a pure agent-detail / foreground tick leaves all of
 *  these equal, so the `kolu.authored` collection is NOT re-published on the ~150 ms
 *  observation firehose — only `commitSnapshot` (the snapshots collection) sees
 *  that churn. */
function authoredFactsEqual(a: TerminalState, b: TerminalState): boolean {
  return (
    a.memory.lastActivityAt === b.memory.lastActivityAt &&
    a.memory.lastAgentCommand === b.memory.lastAgentCommand &&
    restoreTargetEqual(restoreTargetOf(a), restoreTargetOf(b))
  );
}

/** The restore-relevant OBSERVED field set — exactly what `PersistedSnapshotSchema`
 *  persists to disk (cwd · git · pr). Read its keys ONCE (module scope) and drive the
 *  autosave fence off them, so the fence and the persisted projection can't drift: add
 *  a fourth persisted field to `PersistedSnapshotSchema` and the fence covers it
 *  with no second edit here. */
const PERSISTED_SNAPSHOT_KEYS = Object.keys(
  PersistedSnapshotSchema.fields,
) as (keyof TerminalSnapshot)[];

/** Are two folds' RESTORE-RELEVANT projections equal — the autosave (disk) fence?
 *  A STRICT SUPERSET of `authoredFactsEqual`, so "every authored-fact change is also a
 *  restore-relevant change" is a FACT OF THE CODE, not two independently-maintained
 *  field lists. On top of the authored facts it adds the persisted snapshot fields
 *  (`PERSISTED_SNAPSHOT_KEYS`); agent DETAIL and foreground are excluded, so the
 *  ~150 ms firehose folds to an equal projection and never arms autosave. Those
 *  fields compare by reference (the fold preserves the reference for an unchanged
 *  field — a non-git fold spreads the same object — pinned in `fold.test.ts`), which
 *  is exact for "did this restore-relevant value change". The caller passes the
 *  already-computed authored-fact delta (`authoredEqual`) so the firehose path doesn't
 *  recompute it; it defaults to the standalone computation for any other caller. */
function restoreRelevantEqual(
  a: TerminalState,
  b: TerminalState,
  authoredEqual: boolean = authoredFactsEqual(a, b),
): boolean {
  return (
    authoredEqual &&
    PERSISTED_SNAPSHOT_KEYS.every((k) => a.snapshot[k] === b.snapshot[k])
  );
}

/** Everything needed to stop one terminal's producer + tap bridges: abort the
 *  tap-stream subscriptions and stop the producer — plus the two things the
 *  HOST-WIDE port sampler needs to reach this terminal (its root pid to walk
 *  from, its `ports` channel to publish into). Those live here rather than in a
 *  second map because the sampler's target list must be exactly "the terminals
 *  with a live sensor layer", and this map already IS that set — a separate map
 *  would be a second definition of the same membership, free to drift. */
interface TerminalLifecycle {
  abort: AbortController;
  stopAwareness: () => void;
  /** OS pid of the PTY's root process — the port scan's walk origin. */
  rootPid: number;
  ports: Channel<TerminalPorts>;
}

/** Best-effort `foreground` seed from a live `list` entry's `foregroundProcess`
 *  (contract 2.1). The sensor set re-derives the authoritative value from the
 *  surviving foreground tap (which replays a snapshot on subscribe), so this is
 *  only the pre-tap value the tile renders for the boot frame — null when the
 *  daemon reports no foreground name. `title` is unknown to the foreground field,
 *  so it stays null until the title tap fires. */
function liveForeground(
  liveEntry: PtyHostListEntry,
): TerminalSnapshot["foreground"] {
  return liveEntry.foregroundProcess
    ? { name: liveEntry.foregroundProcess, title: liveEntry.title ?? null }
    : null;
}

/** The OBSERVATION half of an adopted survivor (B3.3): the saved record's
 *  restore-relevant snapshot fields (`cwd`/`git`/`pr`, parsed WHOLE through
 *  `PersistedSnapshotSchema`), with the live agent re-seeded to `null` and the
 *  foreground to the live daemon snapshot — the producer re-derives the live agent
 *  against the surviving taps. The agent the survivor will resume rides the AUTHORED
 *  half's `restoreTarget` (`adoptedAuthored`), not here.
 *
 *  The LIVE daemon snapshot (`liveEntry`) is the authority for `cwd` and
 *  `foreground` (F2): kaval's `cwd`/`title` taps do NOT replay a snapshot on
 *  subscribe, so a `cd` that happened while kolu-server was down — or after the
 *  last 500ms-debounced autosave — would otherwise leave the adopted tile pinned
 *  to the stale SAVED cwd. The survivor's listed `cwd` wins; the git sensor
 *  re-resolves against it on start. */
export function adoptedSnapshot(
  record: SavedActiveTerminal,
  liveEntry: PtyHostListEntry,
): TerminalSnapshot {
  return {
    // Everything not saved starts at ITS SEED, from the one home for that set
    // (`seedSnapshot`) rather than hand-spelled here: the live agent resets, the
    // foreground resets before the live read below overrides it, and so do the
    // ports — nothing about a port survived the restart in the saved record, and
    // the host-wide scan re-derives the real set within a tick of the sensor layer
    // starting. A SEVENTH snapshot field then lands in `seedSnapshot` alone.
    ...seedSnapshot(liveEntry.cwd),
    ...decodePersistedSnapshot(record),
    // The two DELIBERATE overrides: the live daemon snapshot is the authority for
    // both (see above), so they win over the saved projection.
    cwd: liveEntry.cwd,
    foreground: liveForeground(liveEntry),
  };
}

/** The AUTHORED half of an adopted survivor — its `location` + memory + the
 *  `restoreTarget` + client chrome + active discriminant, parsed off the saved
 *  record WHOLE (so a new authored field rides the parse too). The observation half
 *  rides `adoptedSnapshot`. */
export function adoptedAuthored(
  record: SavedActiveTerminal,
): AuthoredActiveTerminal {
  return decodeAuthoredActive(record);
}

/** The OBSERVATION half of an ORPHAN survivor (B3.3): a live PTY the daemon still
 *  owns with NO saved record (F1). A create that never reached the 500ms-debounced
 *  autosave before the restart is the common case — so the PTY is ADOPTED (never
 *  reaped), seeded entirely from the live daemon snapshot. Its authored half is a
 *  bare `createAuthoredActive(LOCAL_LOCATION)` (client chrome that never made it to
 *  disk is gone, but the live shell + scrollback survive — the headline guarantee). */
export function orphanSnapshot(liveEntry: PtyHostListEntry): TerminalSnapshot {
  return {
    ...seedSnapshot(liveEntry.cwd),
    foreground: liveForeground(liveEntry),
  };
}

// ── Endpoint implementation ────────────────────────────────────────────

class LocalTerminalEndpoint implements TerminalEndpoint {
  readonly fs = localFs;
  readonly git = localGit;

  /** id → its sensor-set + tap-bridge teardown. Its keys ARE the terminals
   *  with a live sensor layer in this process. */
  private readonly lifecycles = new Map<TerminalId, TerminalLifecycle>();

  /** The ONE host-wide port sampler for this process, armed on the first terminal
   *  that gets a sensor layer and then daemon-lifetime (its timer is `unref`'d, so
   *  it holds nothing open). One scan serves every terminal — a per-terminal
   *  sampler would re-read the whole `/proc` once per tile. */
  private portSampler: PortSampler | undefined;

  /** Lifetime of the port sampler's kaval nudge subscription — a field, so it
   *  scopes to THIS endpoint rather than the process. Never aborted today: the
   *  sampler lives as long as the endpoint does, like the finish-quiet feed that
   *  reads the same stream. */
  private readonly portNudgeAbort = new AbortController();

  /** Arm the port sampler + its output nudge, once. Lazy rather than built with
   *  the endpoint so a padi with no terminals runs no clock and opens no kaval
   *  subscription at all. */
  private ensurePortSampler(): PortSampler {
    if (this.portSampler !== undefined) return this.portSampler;
    const sampler = createPortSampler({
      // Re-read at the top of every pass: the port scan repartitions from the
      // CURRENT root pids, so a terminal that closed between two passes is
      // simply absent and can leave no stale subtree behind.
      targets: (): PortScanTarget[] =>
        [...this.lifecycles].map(([id, lc]) => ({ id, rootPid: lc.rootPid })),
      // Straight into the terminal's own `ports` channel — its port sensor owns
      // the structural dedup, so an unchanged scan stops here.
      // The sampler hands over a ready `TerminalPorts` it built from a SUCCESSFUL
      // read, and republishes the same object while the host is unchanged — so this
      // seam forwards a reference rather than minting a wrapper per terminal per
      // pass. A terminal the sampler has never read stays at `seedSnapshot`'s
      // `unknown`, which is a different fact from `known: []`.
      publish: (id, ports) => this.lifecycles.get(id)?.ports.publish(ports),
      rootPidOf: (id) => this.lifecycles.get(id)?.rootPid,
      log,
    });
    this.portSampler = sampler;
    // The output nudge. kaval's host-global `activity` edge is the SAME
    // resize-excluded meaningful-output fact the finish fold and the live dots
    // read — one subscription for the whole host, not a per-terminal byte tap —
    // so a dev server's "ready" banner pulls its scan forward instead of waiting
    // out the baseline. The stream is a hint about WHEN to look and nothing more:
    // its payload is never read, only its arrival.
    void resubscribeStream({
      signal: this.portNudgeAbort.signal,
      delayMs: ACTIVITY_RESUBSCRIBE_DELAY_MS,
      getStream: () => ptyHostClient.surface.activity.get({}),
      onEvent: () => sampler.nudge(),
      onDrop: (err) => {
        // A dropped feed costs promptness, not correctness — the 5 s baseline
        // still catches every bind. Debug, like the other consumers of this same
        // stream, because a kaval recycle drops it as a matter of course.
        log.debug(
          { err },
          "port-scan output nudge feed dropped; will resubscribe",
        );
      },
    });
    return sampler;
  }

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    // Sync shadow: register a connecting entry (proxy handle + default
    // metadata) so the tile renders immediately — the `TerminalEndpoint.
    // spawnPty` sync-shadow contract. The pty-host resolves the authoritative
    // cwd / pid on the async tail below; the sensor set starts there too.
    //
    // The shadow only needs a placeholder cwd until the spawn echoes back the
    // resolved value (`res.cwd` at the `spawnAndWire` tail). We deliberately do
    // NOT re-derive a home-dir fallback here: that would be a second rule for
    // the same value that can disagree with the spawn's own fallback chain
    // (`buildTerminalSpawnInput`, which can consult the host's `info.home` that
    // this synchronous path cannot see). Seed with the caller's cwd or empty,
    // and let the `res.cwd` correction below install the single authority.
    const cwd = opts.cwd ?? "";
    // Seed the OBSERVATION half (cwd + snapshot defaults). It rides the registry
    // entry built in `registerActiveAndSpawn`, born WITH the authored half.
    const aw = seedSnapshot(cwd);

    // The AUTHORED half — location + memory + the client-owned chrome seeded before
    // providers run (#642). `lastActivityAt` is the one memory field a caller seeds:
    // session restore threads the saved recency through so it survives restart (it
    // lives on the authored record now, the fold's `updateMemory` rewrites it live).
    const meta: AuthoredActiveTerminal = {
      ...createAuthoredActive(LOCAL_LOCATION),
    };
    if (opts.initialMetadata?.lastActivityAt !== undefined)
      meta.lastActivityAt = opts.initialMetadata.lastActivityAt;
    // Session restore threads the saved agent-resume facts through so the restore-time
    // re-persist can't write `none` over a resuming agent before the fold re-derives
    // them (the fold's `updateMemory` rewrites both live once the agent is re-observed).
    if (opts.initialMetadata?.lastAgentCommand !== undefined)
      meta.lastAgentCommand = opts.initialMetadata.lastAgentCommand;
    if (opts.initialMetadata?.restoreTarget !== undefined)
      meta.restoreTarget = opts.initialMetadata.restoreTarget;
    if (opts.parentId) meta.parentId = opts.parentId;
    const initial = opts.initialMetadata;
    if (initial?.themeName) meta.themeName = initial.themeName;
    if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
    if (initial?.subPanel) meta.subPanel = initial.subPanel;
    if (initial?.rightPanel) meta.rightPanel = initial.rightPanel;
    if (initial?.intent) meta.intent = initial.intent;

    return this.registerActiveAndSpawn(id, meta, aw, opts);
  }

  /** Register a fresh ACTIVE sync-shadow entry under `id` (proxy handle + the
   *  given `meta`) and kick off its async spawn + sensor wiring. The shared core
   *  of `spawnPty` (snapshot-seeded) and `wake` (sleeping-base-preserved):
   *  both register a live entry then spawn, differing only in the `meta` +
   *  `snapshot` carried in and whether `opts.resumeCommand` replays an agent on
   *  the freshly-spawned PTY.
   *
   *  Captures the entry this active shadow OVERWRITES (`prior`) and threads it
   *  into the spawn tail so a wake whose spawn/wiring fails can RESTORE the
   *  sleeping record rather than drop it (F2): `wake` overwrites a sleeping
   *  entry, and unconditionally unregistering on failure would erase the dormant
   *  record the user can still wake (and the next autosave would persist that
   *  loss). A fresh `spawnPty` overwrites nothing, so `prior` is undefined and
   *  the unwind is a plain unregister as before. */
  private registerActiveAndSpawn(
    id: TerminalId,
    meta: AuthoredActiveTerminal,
    snapshot: TerminalSnapshot,
    opts: PtySpawnOpts,
  ): TerminalInfo {
    const tlog = log.child({ terminal: id });
    const prior = getTerminal(id);
    const proxy = new PtyHostTerminalProxy(id, ptyHostClient);
    // Both halves are born in ONE entry — snapshot is a required field, so the
    // entry IS its snapshot; `registerAndInstall` registers it and fans the
    // snapshot snapshot out in one step (the seed counterpart to
    // `finalizeRemoval`).
    const entry: ActiveTerminalProcess = {
      info: { id, pid: 0 },
      meta,
      snapshot,
      handle: proxy,
    };
    registerAndInstall(id, entry);
    // A lifecycle flip must PUBLISH, mirroring the sleep path — see
    // `publishTerminalState` for why `terminals:dirty` alone can't reach the
    // client. A WAKE flips `entry.meta` to active on the SAME id the sleep last
    // pushed as sleeping; fresh spawns push their birth record through here too.
    // The `terminals` collection upsert this fans out is ALSO the client's
    // terminal-list source (its keys stream), so no separate list emit is needed.
    publishTerminalState(id);

    void this.spawnAndWire(id, opts, proxy, entry, prior, tlog);
    return entry.info;
  }

  /** Re-install the sensor set of a terminal padi ALREADY HOLDS, against the
   *  taps of the daemon it has just re-connected to (juspay/kolu#2182).
   *
   *  This is the HEAL's verb, and the whole reason it is not `adoptTerminal`:
   *  adoption is a BOOT verb, written for an empty registry and a saved session
   *  that is the only record of what was running. Mid-session neither premise
   *  holds — the registry never emptied, and it, not the saved session, is the
   *  truth. Running adoption over it re-registers the saved record (rewinding any
   *  chrome newer than the last autosave, which `saveSession` then persists),
   *  wipes a terminal born inside the autosave debounce entirely, re-stamps
   *  `adoptedAt` so the client announces a boot adoption that never happened, and
   *  treats a wiring failure as an orphaned PTY to kill. All four are damage to
   *  a session that was never lost, done in the name of repairing it.
   *
   *  What actually died with the link is the taps: they are bridged ONCE, per
   *  terminal, and have no re-subscribe loop of their own (see
   *  {@link installSnapshotSensors}). Re-installing them is therefore the entire
   *  job, and installation is idempotent — it replaces any set the terminal
   *  already has rather than stranding it.
   *
   *  Returns false for an id padi does not hold, which is not this verb's case to
   *  handle: a PTY that appeared while the link was down is the inventory
   *  reconciler's to discover, and inventing a registry entry from a live PTY is
   *  adoption again by another name.
   *
   *  A wiring failure here does NOT kill the PTY. The boot's reap exists because
   *  a half-wired survivor at boot is an orphan nothing else will ever claim; a
   *  half-wired terminal mid-session is a terminal the user is looking at, whose
   *  entry is intact and whose next heal will try again. Killing it would be the
   *  destruction this whole arm exists to prevent. */
  rewireSurvivingSensors(
    id: TerminalId,
    liveEntry: PtyHostListEntry,
  ): RewireOutcome {
    const entry = getTerminal(id);
    if (!entry) return "unknown";
    const tlog = log.child({ terminal: id });
    try {
      this.installSnapshotSensors(
        id,
        liveEntry.pid,
        liveEntry.cwd,
        liveEntry.commandRooted ?? false,
      );
    } catch (err) {
      // Distinct from `unknown` because the CALLER must distinguish them: an id
      // we do not hold is somebody else's job, while a terminal we hold and
      // could not wire is one kolu has gone blind to — and the heal has to
      // report that rather than announce a restored link over it.
      tlog.error(
        { err, pid: liveEntry.pid },
        "sensor re-wiring failed after a link heal — the terminal is LIVE and keeps running; the heal reports incomplete and retries",
      );
      return "failed";
    }
    tlog.info({ pid: liveEntry.pid }, "re-wired a surviving PTY's sensors");
    return "rewired";
  }

  /** The daemon no longer lists a terminal we hold: it exited while the link was
   *  down. Its own exit tap died with that link, so this is the last chance to
   *  observe the exit at all — see {@link dropVanishedTerminal}. Runs the ordinary
   *  exit teardown, with a code that says the truth: we never saw one. */
  noteVanishedWhileBlind(id: TerminalId): void {
    if (!getTerminal(id)) return;
    log
      .child({ terminal: id })
      .info(
        {},
        "terminal exited while the link was down — dropping it now that the daemon no longer lists it",
      );
    this.handleExit(id, EXIT_CODE_UNOBSERVED);
  }

  /** Adopt a SURVIVING PTY (B3.3): the kaval daemon outlived a kolu-server
   *  restart, so its PTY for `id` is already alive at `liveEntry.pid`.
   *  Re-establish kolu's side WITHOUT spawning — install the caller-built
   *  `snapshot` (a whole saved record via `adoptedSnapshot`, or an orphan's
   *  live-snapshot defaults via `orphanSnapshot`; either way the live fields
   *  pr/agent/foreground are re-derived by the sensors, the freshness guarantee),
   *  register the terminal under the `authored` half, release the handle at the
   *  live pid, and re-run the sensor set against the surviving taps. The sibling
   *  of `spawnPty`/`spawnAndWire` minus the spawn RPC: both converge on
   *  `installSnapshotSensors`, and a wiring failure reaps the orphaned PTY through
   *  the shared `killHalfWiredPty`.
   *
   *  A BOOT verb. It writes the registry from the caller's `authored` record, so
   *  running it over a registry that is already populated rewinds whatever the
   *  saved record does not know — see {@link rewireSurvivingSensors}, which is
   *  what a mid-session heal runs instead. */
  adoptTerminal(
    id: TerminalId,
    authored: AuthoredActiveTerminal,
    snapshot: TerminalSnapshot,
    liveEntry: PtyHostListEntry,
  ): void {
    const tlog = log.child({ terminal: id });
    const proxy = new PtyHostTerminalProxy(id, ptyHostClient);
    // Both halves ride ONE entry — snapshot is a required field
    // (`installSnapshotSensors` reads `getTerminal(id)!.snapshot` as `record.meta`).
    const entry: ActiveTerminalProcess = {
      info: { id, pid: liveEntry.pid },
      meta: authored,
      snapshot,
      handle: proxy,
    };
    registerAndInstall(id, entry);
    // The PTY already exists on the survivor — release the handle's queued /
    // awaited verbs at the live pid with no spawn RPC (the sole structural
    // difference from `spawnAndWire`).
    proxy.markReady(liveEntry.pid);
    try {
      // Adoption RE-OBSERVES a survivor: the producer re-resolves the live agent
      // from the surviving (replayed) taps. That re-observation must NOT bump recency
      // (the saved value is the truth) — the recency baseline is seeded from the saved
      // restore target, so a re-resolve of the SAME session matches it and is silent.
      this.installSnapshotSensors(
        id,
        liveEntry.pid,
        liveEntry.cwd,
        liveEntry.commandRooted ?? false,
      );
    } catch (err) {
      // Sensor wiring failed against the survivor — the same reap policy as a
      // failed fresh spawn (the F2 receptacle): tear down partials, kill the
      // now-orphaned PTY, unwind the entry. `prior` is undefined because THIS
      // verb only ever runs at boot, over an empty registry, where a half-wired
      // survivor is an orphan nothing else will claim. That is a precondition of
      // the reap, not an incidental fact: a mid-session caller would be killing a
      // terminal the user is looking at. The heal deliberately does not come here
      // — it re-wires through `rewireSurvivingSensors`, which never kills.
      this.killHalfWiredPty(
        id,
        entry,
        undefined,
        tlog,
        err,
        "sensor wiring failed while adopting a surviving PTY; killing the orphan",
      );
      return;
    }
    // `registerAndInstall` above fanned the adopted record onto padi's
    // `terminals` collection, so the client renders the adopted tile from its
    // keys stream. Deliberately NO `notifyDirty()`: the saved session already holds
    // this terminal, and the boot converges the session explicitly once all
    // survivors are adopted — arming an autosave here could persist a half-adopted
    // set (or a not-yet-restored active marker).
    tlog.info({ pid: liveEntry.pid }, "adopted surviving PTY");
  }

  /** The pty-host spawn RPC + the raced-during-spawn check. Returns the resolved
   *  `{pid, cwd}`, or null if the registry's active entry for `id` is no longer
   *  the one this spawn is wiring — killed, slept, or re-spawned while the RPC was
   *  in flight (the pty-host-side PTY is then cleaned up here). Throws on an RPC
   *  failure — the caller (`spawnAndWire`) unwinds the shadow.
   *
   *  The check is by IDENTITY (`getActiveTerminal(id) === expected`), not mere
   *  presence (F1): a `beginSleep` that flipped the entry to sleeping mid-spawn
   *  leaves a DIFFERENT entry under the same id, so a bare presence check would
   *  pass and the tail would wire sensors + republish active metadata over the
   *  sleeping flip — leaking a hidden live PTY the registry believes is dormant.
   *  A mismatch leaves the registry ALONE (it now holds someone else's entry —
   *  the sleeping flip, or a fresh re-spawn) and only kills the orphaned PTY. */
  private async spawnViaClient(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: PtyHostTerminalProxy,
    expected: ActiveTerminalProcess,
  ): Promise<{ pid: number; cwd: string } | null> {
    const res = await runEndpointEdge(
      Effect.flatMap(buildTerminalSpawnInput({ id, cwd: opts.cwd }), (input) =>
        ptyHostClient.surface.terminal.spawn(input),
      ),
    );
    if (getActiveTerminal(id) !== expected) {
      proxy.markFailed(new TerminalSpawnRacedError());
      try {
        await runEndpointEdge(ptyHostClient.surface.terminal.kill({ id }));
      } catch (err) {
        log
          .child({ terminal: id })
          .error({ err }, "pty-host kill of spawn-raced terminal failed");
      }
      return null;
    }
    return { pid: res.pid, cwd: res.cwd };
  }

  /** Async tail of `spawnPty`/`wake`: confirm the PTY spawned, then start the
   *  sensor set against its taps. On failure unwinds the shadow, restoring a
   *  `prior` sleeping entry on a wake (F2). */
  private async spawnAndWire(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: PtyHostTerminalProxy,
    entry: ActiveTerminalProcess,
    prior: TerminalProcess | undefined,
    tlog: typeof log,
  ): Promise<void> {
    // Phase 1 — the spawn RPC. A failure here means no PTY was created
    // (`host.spawn` either returns a live child or throws), so there's nothing
    // to kill: just unwind the sync shadow.
    let res: { pid: number; cwd: string } | null;
    try {
      res = await this.spawnViaClient(id, opts, proxy, entry);
    } catch (err) {
      tlog.error({ err }, "pty-host terminal.spawn failed");
      proxy.markFailed(err);
      this.unwindSpawnShadow(id, entry, prior);
      return;
    }
    if (!res) return; // raced during spawn — spawnViaClient already cleaned up

    proxy.markReady(res.pid);
    // A decoded wire value is `readonly` — rebuild rather than assign into it.
    entry.info = { ...entry.info, pid: res.pid };
    // Seed the authoritative resolved cwd onto the entry's observation before
    // starting the producer (the git sensor reads the spawn cwd at start, and the
    // fold seeds `current` off `entry.snapshot`).
    commitSnapshot(id, { ...entry.snapshot, cwd: res.cwd });

    // Phase 2 — post-spawn wiring. The PTY now exists and the host owns it, so
    // a failure here must KILL the child (not just unregister the entry), or
    // we leak an orphaned PTY with no server-side record.
    try {
      // The recency baseline is seeded from the durable restore target inside
      // `installSnapshotSensors`: a fresh spawn has no target (null baseline) so its
      // first agent bumps; a RESUMING wake's `exact` target makes the re-resolved
      // session match the baseline and stay silent — no `initialLive` flag needed.
      // A padi spawn is always a shell terminal (the kolu face has no command
      // param — #1872's protection), so the sensors read it shell-rooted.
      this.installSnapshotSensors(id, res.pid, res.cwd, false);
    } catch (err) {
      this.killHalfWiredPty(
        id,
        entry,
        prior,
        tlog,
        err,
        "pty-host sensor wiring failed after spawn; killing the orphaned PTY",
      );
      return;
    }
    // WAKE: replay the agent as type-ahead now that the sensor set is wired, so
    // the command-run tap catches the resumed invocation and the agent indicator
    // re-lights. The PTY buffers the bytes until the shell reaches its prompt
    // (the same type-ahead a fast typist relies on), so there's no readiness
    // race — only set on wake (`resumeAgentCommand` output), never an ordinary spawn.
    if (opts.resumeCommand) proxy.write(`${opts.resumeCommand}\r`);
    tlog.info({ pid: res.pid, total: listTerminals().length }, "created");
  }

  /** Unwind the active sync-shadow `entry` whose async spawn/wiring failed.
   *
   *  Identity-gated: acts ONLY while the registry still holds OUR `entry`. A
   *  `beginSleep` / re-spawn that raced in mid-spawn replaced it with a different
   *  entry under the same id, and that newer entry is authoritative — clobbering
   *  it here would re-introduce the F1/F2 loss (drop the sleeping flip, or evict
   *  a fresh re-spawn). When we DO still own the slot, RESTORE a `prior` sleeping
   *  record (F2: a failed WAKE must leave the dormant terminal the user can still
   *  wake, not erase it); otherwise (a fresh `spawnPty`, `prior` undefined or
   *  active) drop the shadow. Idempotent. */
  private unwindSpawnShadow(
    id: TerminalId,
    entry: ActiveTerminalProcess,
    prior: TerminalProcess | undefined,
  ): void {
    if (getTerminal(id) !== entry) return;
    if (prior?.meta.state === "sleeping") {
      // Restoring a sleeping record: re-register `prior` WHOLE via
      // `registerAndInstall` — its snapshot rides as a field on the entry, so the
      // dormant value comes back with it (the tile recomposes cwd/branch off the
      // persisted half; the live half is dead data while sleeping) and is re-fanned
      // to the collection so subscribers see the restored dormant value (the wake
      // had fanned out the active one). Do NOT drop it.
      registerAndInstall(id, prior);
      publishTerminalState(id);
      return;
    }
    // A fresh spawn that failed: the registry entry goes, so the store entry must
    // too (store↔registry lockstep).
    this.finalizeRemoval(id);
  }

  /** Recover from "the PTY exists on the daemon but sensor wiring failed":
   *  log the wiring error under `reason`, tear down any partial sensors, kill
   *  the orphaned PTY (a kill failure is logged, not thrown — there's nothing
   *  left to do), and unwind the sync shadow (restoring a `prior` sleeping
   *  record on a failed wake — F2). Extracted as the one reap policy so B3.3's
   *  survivor-adoption path can share it — one place to change how a half-wired
   *  PTY is reaped; `reason` distinguishes the call site. */
  private killHalfWiredPty(
    id: TerminalId,
    entry: ActiveTerminalProcess,
    prior: TerminalProcess | undefined,
    tlog: typeof log,
    err: unknown,
    reason: string,
  ): void {
    tlog.error({ err }, reason);
    this.teardownSensors(id);
    void runEndpointEdge(ptyHostClient.surface.terminal.kill({ id })).catch(
      (killErr) =>
        tlog.error({ err: killErr }, "kill of half-wired PTY failed"),
    );
    this.unwindSpawnShadow(id, entry, prior);
  }

  /** INSTALL a terminal's snapshot sensor set, REPLACING any set it already has —
   *  idempotent by requirement, because a mid-session heal re-runs the boot's
   *  adopt (#2182). Start the per-terminal snapshot PRODUCER against the pty-host's
   *  tap streams and FOLD its observation stream into the registry entry — the
   *  local R9.0 seam.
   *  The producer runs HERE, in kolu-server, so it's always the current build's code
   *  (the freshness guarantee). kolu seeds `current` from the entry's durable
   *  observation + memory and folds each emitted observation: the five snapshot
   *  fields are last-write-wins; `lastActivityAt` is stamped from a LIVE agent
   *  observation with kolu's clock — an identity change always, a same-identity
   *  output tick throttled; `lastAgentCommand` + the derived `restoreTarget`
   *  are kolu's to remember. It commits the snapshot half to the `snapshot`
   *  collection, the memory half + the `restoreTarget` to `kolu.authored`, and arms
   *  the session autosave — each effect arm gated by ITS OWN delta so the ~150 ms
   *  agent-detail / foreground firehose reaches NONE of disk, the authored
   *  collection, or (beyond a single snapshot publish) the wire. */
  private installSnapshotSensors(
    id: TerminalId,
    pid: number,
    cwd: string,
    commandRooted: boolean,
  ): void {
    // Installing a sensor set REPLACES any set this terminal already has, rather
    // than overwriting the `lifecycles` entry and stranding the old one (#2182).
    // The tail of this function is a bare `lifecycles.set`, and the only thing
    // that ever aborts a set is `teardownSensors` reading that same map — so
    // before mid-session re-adoption existed, a second install would have left
    // the first set's `abort` and `stopAwareness` permanently unreachable: two
    // awareness loops folding into two accumulators, both writing one terminal's
    // snapshot, neither stoppable by a later kill or exit. Adoption used to be
    // once-per-process by construction; a link that heals mid-session (the
    // healer's re-converge re-runs the boot's adopt) makes it repeatable, so the
    // install has to be idempotent rather than merely unrepeated. Idempotent by
    // the same call the kill path uses — a no-op when there is no prior set, and
    // an abort that ends the old taps WITHOUT tripping `handleExit`.
    this.teardownSensors(id);
    const abort = new AbortController();
    const { signal } = abort;
    const signals: SensorSignals = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<CommandRunSample>(),
      foreground: inMemoryChannel<ForegroundSample>(),
      // Fed by the host-wide port sampler (below), not by a pty-host tap.
      ports: inMemoryChannel<TerminalPorts>(),
    };
    // Arm the host-wide port sampler (once per process) up front, so the nudge is
    // in hand for the command-mark bridge below. Its first pass can only run after
    // this synchronous function returns — by then the lifecycle registration at the
    // tail has published this terminal's root pid and channel.
    const portSampler = this.ensurePortSampler();

    // Seed the fold accumulator from the entry's durable state (the caller —
    // spawnPty/wake/adopt — registered it before we get here). A fact the producer
    // can't re-observe (the two memory facts, the resume target) survives because
    // it is simply never in an observation.
    const seedEntry = getTerminal(id)!;
    let current: TerminalState = {
      snapshot: seedEntry.snapshot,
      memory: {
        lastActivityAt: seedEntry.meta.lastActivityAt,
        lastAgentCommand: seedEntry.meta.lastAgentCommand,
      },
    };

    // Recency frame phase, decided BY VALUE against the agent identity the producer
    // last knew, seeded from the durable restore target: an adopt / resuming-wake
    // re-resolves the SAME survivor (`exact` target) → matches the baseline → not live
    // → the saved recency stands across the restart, however many same-identity settle
    // emits land while its detail resolves; a fresh spawn seeds `null`, so its first
    // agent is genuinely new and bumps. The fold then decides the stamp — an identity
    // change always, a same-identity OUTPUT tick throttled — so a stable session's
    // recency tracks its output instead of freezing. `runStartedAt` floors that
    // throttle so the survivor-settle burst can't false-bump the saved recency. This
    // replaces the old 1.5 s timer whose race could restamp saved recency.
    let recencyBaseline: AgentIdentity | null = seedRecencyBaseline(
      seedEntry.meta.restoreTarget,
    );
    const runStartedAt = Date.now();

    const emit = (o: TerminalEvent): void => {
      const before = current;
      // The frame phase is a VALUE comparison on the agent identity: a re-resolved
      // identity equal to the baseline is a re-observation (not live); a different one
      // is new activity, and the baseline advances to it. Only an authoritative agent
      // value carries recency — `stepRecencyBaseline` owns that step (incl. the
      // non-agent / `unknown` guard) so the producer and its conformance test share it.
      const step = stepRecencyBaseline(recencyBaseline, o);
      recencyBaseline = step.baseline;
      const ctx: FoldCtx = { live: step.live, at: Date.now(), runStartedAt };
      current = fold(current, o, ctx);
      // Cross-terminal MRUs (kolu's, fold-side) track the OBSERVATION itself — a git
      // context seen, a (non-replayed) agent command run — NOT the fold delta, so they
      // run BEFORE the no-op early-return below. Re-launching the SAME agent command
      // dedups in the fold (`lastAgentCommand` is unchanged → `current === before`) but
      // is still a fresh launch that must refresh the recent-agents MRU `lastSeen`;
      // gating it on the fold delta would drop that bump — the old command sensor fired
      // `trackRecentAgent` on every non-replayed mark, independent of the memory write.
      if (o.kind === "git" && o.git)
        trackRecentRepo(o.git.mainRepoRoot, o.git.repoName);
      if (o.kind === "commandRun" && !o.replayed) trackRecentAgent(o.command);
      if (current === before) return; // `unknown`/dedup no-op — nothing else to commit
      // Three effect arms, each gated by ITS OWN delta — no firehose on any:
      //  - the OBSERVED half → the `snapshots` collection, on a snapshot change;
      //  - the MEMORY half + the derived `restoreTarget` → `kolu.authored`, on an
      //    authored-fact change (so pure agent-detail churn never re-publishes it);
      //  - the session AUTOSAVE, on a restore-relevant VALUE change (off disk for the
      //    firehose). None of the three fires `terminals:dirty` from its own commit
      //    seam — that fence lives here.
      if (current.snapshot !== before.snapshot)
        commitSnapshot(id, current.snapshot);
      // Evaluate the authored-fact delta ONCE and feed it to the disk fence (a strict
      // superset), so the firehose path doesn't recompute `authoredFactsEqual` —
      // and its `restoreTargetOf` allocations — a second time inside it.
      const authoredEqual = authoredFactsEqual(before, current);
      if (!authoredEqual)
        updateMemory(id, current.memory, restoreTargetOf(current));
      if (!restoreRelevantEqual(before, current, authoredEqual)) notifyDirty();
    };

    // Bridge the raw VT taps onto the producer's signals (fire-and-forget — the
    // abort signal owns teardown). The producer emits a `cwd` observation off the
    // `cwd` channel; the git sensor reads the same channel to re-resolve git.
    void bridgeStream(ptyHostClient.surface.cwd.get({ id }), signal, (msg) =>
      signals.cwd.publish(msg.cwd),
    );
    void bridgeStream(ptyHostClient.surface.title.get({ id }), signal, (msg) =>
      signals.title.publish(msg.title),
    );
    void bridgeStream(
      ptyHostClient.surface.commandRun.get({ id }),
      signal,
      (msg) => {
        // An OSC 633 command mark is the other "look sooner" signal (the note's
        // pair with output bursts): the command that just started is the one most
        // likely to bind a port, and waiting out the baseline is exactly the delay
        // the nudge exists to remove. A REPLAYED mark nudges too — it means this
        // sensor layer just started (a restart / adopt), so the host's ports are
        // unknown to us and worth reading now rather than in five seconds.
        portSampler.nudge();
        signals.commandRun.publish({
          command: msg.command,
          replayed: msg.replayed,
          // The wire field is OPTIONAL for forward-compat (an additive frame field,
          // no contract bump). A survivor kaval predating it emits no `shellJoin`
          // AND no command-rooted seed (lock 1 ships with the field), so its
          // commands are all raw — `false` is correct, never a revived defect. The
          // skew default lives ONLY here at the wire boundary; the internal sample
          // carries a definite dialect from this point on.
          shellJoin: msg.shellJoin ?? false,
        });
      },
    );
    void bridgeStream(
      ptyHostClient.surface.foreground.get({ id }),
      signal,
      (msg) =>
        signals.foreground.publish({
          process: msg.process,
          foregroundPid: msg.foregroundPid,
        }),
      (err) => onForegroundTapError(id, signals.foreground, err),
    );
    const stopAwareness = startSensors(
      id,
      {
        pid,
        cwd,
        commandRooted,
        signals,
        readScreenText: (tailLines) => readScreenTextFor(id, tailLines),
        log,
      },
      emit,
    );

    // Natural exit: the `exit` tap yields the code once. An intentional kill
    // aborts this signal first (see `teardownSensors`), so `handleExit` only
    // ever fires for a genuine exit.
    void bridgeStream(
      ptyHostClient.surface.exit.get({ id }),
      signal,
      (msg) => this.handleExit(id, msg.exitCode),
      (err) => {
        // The exit tap is the terminal's lifecycle signal — losing it is not
        // a missing field, it's "we no longer know when this PTY dies." In
        // process the stream only ends via the exit code or an abort
        // (teardown), so a non-abort failure is unreachable today; this fires
        // only once pty-host is socket-served. The correct recovery there is
        // to RE-SUBSCRIBE (the surviving daemon may still own a live PTY) —
        // tearing the terminal down here would be the #1034 premature-loss
        // bug, and leaving it silent is the stale-terminal mode. That
        // reconnect is mid-session resilience (R-3); until it lands, surface
        // the lost signal loudly rather than swallow it as a generic tap drop.
        log.error(
          { err, terminal: id },
          "pty-host exit tap failed (non-abort) — exit signal lost; terminal may be stale until R-3 wires re-subscribe",
        );
      },
    );

    // The port sampler's target list IS this map, so registering here is also what
    // enrols the terminal in the scan; its `ports` channel is the route back.
    this.lifecycles.set(id, {
      abort,
      stopAwareness,
      rootPid: pid,
      ports: signals.ports,
    });
    // Brand new to the scan — read now rather than up to a baseline later. An
    // ADOPTED survivor is the case that needs it: its server has been serving for
    // however long padi was down, and its first output burst may be minutes away.
    portSampler.nudge();
  }

  /** Stop a terminal's sensor set + tap bridges (idempotent). Aborting the
   *  signal ends every tap subscription — including the `exit` tap, so a kill
   *  that calls this BEFORE the pty-host kill can't trip `handleExit`. */
  private teardownSensors(id: TerminalId): void {
    const lc = this.lifecycles.get(id);
    if (!lc) return;
    this.lifecycles.delete(id);
    lc.abort.abort();
    lc.stopAwareness();
  }

  /** Fully remove a terminal from existence — the two-store teardown tail as one
   *  receptacle: drop the registry entry AND its snapshot store value (the IFF
   *  lockstep), then arm the autosave. `dropSnapshot` fans the removal onto padi's
   *  `terminals` collection (its keys stream IS the client's terminal list), so no
   *  separate list emit is needed. handleExit / killTerminal / discardSleeping / a
   *  failed fresh `spawnPty` all converge here, so an R9 snapshot-backing change (or
   *  any change to the notification set) touches ONE place instead of four call
   *  sites. Each site's differing PREAMBLE (`terminalExit` publish,
   *  `cleanupTerminalScratch`, the kill RPC, the identity gate) stays at the call
   *  site; only this identical tail is encapsulated.
   *
   *  The SEED counterpart is `registerAndInstall` (register the entry + fan its
   *  snapshot out), so birth and removal read as symmetric receptacles. */
  private finalizeRemoval(id: TerminalId): void {
    unregisterTerminal(id);
    dropSnapshot(id);
    notifyDirty();
  }

  /** A terminal's PTY exited naturally. Stop its sensor layer, publish the
   *  exit, drop the entry, save the session. */
  private handleExit(id: TerminalId, exitCode: number): void {
    const entry = getTerminal(id);
    if (!entry) return;
    log.child({ terminal: id }).info({ exitCode }, "exited");
    this.teardownSensors(id);
    cleanupTerminalScratch(id);
    padiSurfaceCtx.events.terminalExit.publish({ id }, exitCode);
    this.finalizeRemoval(id);
  }

  async killTerminal(id: TerminalId): Promise<TerminalInfo | undefined> {
    // Kill requires an ACTIVE terminal — the symmetric mirror of `discardSleeping`
    // (which requires sleeping). A sleeping id is "not found" here so a raw `kill`
    // RPC or a multi-client race can't run a dead-PTY kill against a record sleep
    // already released; sleeping terminals exit via `discardSleeping`. The clients
    // already route sleeping → discard, so this only fences off misuse.
    const entry = getActiveTerminal(id);
    if (!entry) return undefined;
    const tlog = log.child({ terminal: id });
    tlog.info({ pid: entry.info.pid }, "killing");
    // Stop the sensor layer FIRST — this aborts the `exit` tap, so the
    // pty-host's exit (which fires on an intentional kill too, since pty-host
    // makes no kill/exit distinction) can't reach `handleExit` and
    // double-publish `terminalExit`. The kill RPC's response drives client
    // cleanup instead.
    this.teardownSensors(id);
    try {
      await runEndpointEdge(ptyHostClient.surface.terminal.kill({ id }));
    } catch (err) {
      tlog.error({ err }, "pty-host kill failed; unregistering anyway");
    }
    cleanupTerminalScratch(id);
    this.finalizeRemoval(id);
    return entry.info;
  }

  /** Begin sleeping an ACTIVE terminal: stop its sensor set and flip its registry
   *  entry to the sleeping arm IN PLACE (same id, same map slot, persisted base
   *  preserved, live overlay dropped + `sleptAt` stamped), publishing the new
   *  state — but leave the PTY ALIVE. The caller persists the session durably,
   *  THEN calls `releaseSleptPty` to kill the PTY (persist-before-kill). Sensors
   *  go down FIRST so no in-flight tap can re-publish the active meta over the
   *  flip (the sink closes over the active entry) and the later kill can't reach
   *  `handleExit` (which would unregister our sleeping entry). Returns false — a
   *  no-op — when `id` is not an active terminal (already sleeping / absent). */
  beginSleep(id: TerminalId): boolean {
    const entry = getActiveTerminal(id);
    if (!entry) return false;
    this.teardownSensors(id);
    // Flip the AUTHORED entry to the sleeping arm IN PLACE. `entry.meta` (location +
    // memory + the `restoreTarget` + client chrome) rides the `...entry.meta` spread
    // — the fold already set `restoreTarget` during the active session (a live agent
    // → `exact`, a quit-to-shell → `none`), so the freeze needs no special capture:
    // wake reads the target straight off `meta`. The frozen-`pr` special case is GONE
    // — `pr` is restore-relevant now and rides the entry's observation, which
    // `beginSleep` carries over so the dormant tile recomposes its cwd / branch / pr
    // off it. Sensors went down FIRST so no in-flight observation re-publishes the
    // active meta over the flip.
    //
    // DEFERRED (R9.0): `beginSleep` does NOT drain a final settle before freezing.
    // The freeze takes whatever `restoreTarget` the fold last wrote; it does NOT hold
    // "the last AUTHORITATIVE agent" by construction. So a launch-then-sleep INSIDE
    // the agent settle window (commandRun seen, agent not yet resolved → target still
    // `none`) freezes `none` and wakes to a FALSE bare shell. Narrow + self-correcting
    // (re-launch fixes it); the active drain is an async-`beginSleep` follow-up.
    const sleeping: SleepingTerminalProcess = {
      info: { id, pid: 0 },
      meta: decodeAuthoredSleeping({
        ...entry.meta,
        state: "sleeping",
        sleptAt: Date.now(),
      }),
      snapshot: entry.snapshot,
    };
    registerTerminal(id, sleeping);
    publishTerminalState(id);
    log
      .child({ terminal: id })
      .info("flipped to sleeping (PTY pending release)");
    return true;
  }

  /** Release the PTY of a terminal `beginSleep` already flipped to sleeping: kill
   *  the now-detached PTY and scrub its scratch. The registry entry STAYS (as
   *  sleeping). A kill failure is logged, not thrown — the record is sleeping
   *  regardless, and boot reconcile reaps any survivor (adopt-or-reap). */
  async releaseSleptPty(id: TerminalId): Promise<void> {
    try {
      await runEndpointEdge(ptyHostClient.surface.terminal.kill({ id }));
    } catch (err) {
      log
        .child({ terminal: id })
        .error(
          { err },
          "pty-host kill failed while sleeping; record is sleeping regardless",
        );
    }
    cleanupTerminalScratch(id);
  }

  /** Wake a SLEEPING terminal: flip it back to the active arm and re-spawn its
   *  PTY on the SAME id in its saved cwd, replaying the resume form derived from the
   *  authored `restoreTarget` (via `resumeFormFor`) so the conversation comes back —
   *  session-restore-of-one. The authored record rides through WHOLE
   *  (theme/layout/intent/memory/restoreTarget); the observation is reset and
   *  re-derived by the producer. Returns the active info, or undefined when `id` is
   *  not a sleeping terminal. */
  wake(id: TerminalId): TerminalInfo | undefined {
    const entry = getTerminal(id);
    if (!entry || entry.meta.state !== "sleeping") return undefined;
    // The resume FORM switches on the authored `restoreTarget`: `exact` resumes the
    // EXACT conversation that was live at sleep by id (juspay/kolu#1495);
    // `legacyMostRecent` (migrated pre-1.29 records) the most-recent marker (claude
    // `-c`, codex `resume --last`, opencode `--continue`); `none` / absent / a
    // non-resumable agent → null, a bare shell (juspay/kolu#1492).
    const resumeCommand = resumeFormFor(entry.meta.restoreTarget);
    // Reset the OBSERVATION (pr/agent/foreground re-derived by the re-spawned PTY's
    // producer), keeping the saved cwd. The authored memory + resume target ride the
    // active entry built in `registerActiveAndSpawn`.
    const wokenAwareness: TerminalSnapshot = seedSnapshot(entry.snapshot.cwd);
    // Flip the AUTHORED record to active — drops `sleptAt`.
    const meta = decodeAuthoredActive({ ...entry.meta, state: "active" });
    log
      .child({ terminal: id })
      .info({ resuming: resumeCommand !== null }, "waking");
    return this.registerActiveAndSpawn(id, meta, wokenAwareness, {
      cwd: wokenAwareness.cwd,
      parentId: meta.parentId,
      resumeCommand: resumeCommand ?? undefined,
    });
  }

  /** Discard a HANDLE-LESS terminal — the shared core behind {@link discardSleeping}
   *  and {@link discardParked}. Neither arm has a PTY to kill (sleep already released
   *  it; a parked record's PTY died with the host at reboot), so this just scrubs any
   *  leftover scratch, unregisters, and arms the autosave. Returns false when `id` is
   *  not in the `expectedState` arm. */
  private discardHandleless(
    id: TerminalId,
    expectedState: "sleeping" | "parked",
  ): boolean {
    const entry = getTerminal(id);
    if (!entry || entry.meta.state !== expectedState) return false;
    cleanupTerminalScratch(id);
    this.finalizeRemoval(id);
    log.child({ terminal: id }).info(`discarded ${expectedState} terminal`);
    return true;
  }

  /** Discard a SLEEPING terminal: remove its record. There is no PTY to kill —
   *  sleep already released it. Returns false when `id` is not sleeping. */
  discardSleeping(id: TerminalId): boolean {
    return this.discardHandleless(id, "sleeping");
  }

  /** Discard a PARKED terminal: drop the parked record + its snapshot. The PTY
   *  died with the host at reboot, so there is nothing to kill. The consume half of
   *  the parked→active flip: `restoreSession` re-spawns a FRESH active terminal
   *  (new id) and drops the old parked record here, so a concurrent restore finds
   *  no parked entry and no-ops (the idempotency token). Returns false when `id`
   *  is not parked. */
  discardParked(id: TerminalId): boolean {
    return this.discardHandleless(id, "parked");
  }

  /** FORFEIT every remaining parked record — the "create instead of restore" path.
   *  padi's boot reconcile parks each reboot-killed active terminal so the restore
   *  card can bring it back; if the user creates a FRESH terminal instead, the
   *  restore is forfeited, so those parked entries must be dropped rather than left
   *  lingering invisibly forever (they never render as tiles, so nothing else would
   *  ever reap them). Distinct from `session.restore`, which CONSUMES each parked
   *  entry via the parked→active flip (`discardParked` per record) — this is the
   *  all-at-once forfeit a plain `lifecycle.create` triggers. */
  discardAllParked(): void {
    for (const id of parkedTerminalIds()) this.discardParked(id);
  }

  async killAllTerminals(): Promise<void> {
    const ids = listTerminals().map((info) => info.id);
    log.info({ count: ids.length }, "killing all terminals");
    for (const id of ids) this.teardownSensors(id);
    try {
      await runEndpointEdge(ptyHostClient.surface.terminal.killAll({}));
    } catch (err) {
      log.error({ err }, "pty-host killAll failed; draining anyway");
    }
    const entries = drainTerminals();
    for (const entry of entries) {
      cleanupTerminalScratch(entry.info.id);
      // `dropSnapshot` fans each removal onto padi's `terminals` collection, so
      // the client's terminal list (its keys stream) empties as the drain runs.
      dropSnapshot(entry.info.id);
    }
  }

  async attach(
    id: TerminalId,
    signal: AbortSignal | undefined,
    resizeTo?: EndpointGrid,
  ): Promise<TerminalAttachment> {
    // Wait for the PTY to actually exist before opening the attach stream —
    // otherwise a tile attaching off the sync shadow races the in-flight
    // `terminal.spawn` and the pty-host throws "no PTY with id". `ready` is the
    // `TerminalHandle` invariant (undefined ⟹ already live); awaiting it
    // surfaces a spawn failure rather than hitting a missing PTY.
    await getActiveTerminal(id)?.handle.ready;
    // Open a kaval attach and consume its mandatory snapshot-first frame. Shared
    // by the initial attach and each overflow-driven re-attach below. The
    // pty-host contract guarantees the first frame is the screen-state snapshot,
    // then deltas; a first frame that isn't a snapshot is a contract violation —
    // throw rather than silently paint a blank terminal (the same fail-loud
    // stance as `getScreenState`'s NOT_FOUND).
    // The resize is a PARAMETER of the open, not state: only the initial attach
    // below passes one, and the overflow-driven re-attaches call `open()` bare.
    //
    // `resizeTo` is a VALUE captured when this attach was requested, but the
    // consumer's real grid is a live fact: after any resize it travels on
    // `lifecycle.resize`, which this closure never hears about. Replaying the
    // captured value on a re-attach would therefore drag the PTY BACK to a size
    // the consumer no longer has — and because `attach` performs a real resize,
    // that lands a SIGWINCH and a snapshot laid out for the stale grid,
    // recreating the exact defect this change closes. Re-attaching WITHOUT it is
    // correct precisely because the initial attach already sized the terminal
    // and `lifecycle.resize` has owned every change since, so the PTY is already
    // at the consumer's current size and the fresh snapshot serializes there.
    const open = async (openAt?: EndpointGrid): Promise<OpenedAttach> => {
      // A kaval stream member is a lazy `Stream`; `toAsyncIterable`'s iterator
      // is what runs it, and its `return()` interrupts the running fiber —
      // which IS the unsubscribe (D10/#18). The caller's `signal` is bridged
      // onto that one teardown so an aborted attach still releases kaval's
      // subscriber slot, exactly as the retired `{ signal }` call option did.
      const iter = Stream.toAsyncIterable(
        // OMIT `resizeTo` on a bare re-attach rather than spelling `undefined`:
        // it is a `Schema.optionalKey` field, which accepts an ABSENT key and
        // REJECTS a present `undefined` one (#17) — and the face DECODES the
        // input at this edge, so an explicit `undefined` fails the call.
        ptyHostClient.surface.terminalAttach.get(
          openAt === undefined ? { id } : { id, resizeTo: openAt },
        ),
      )[Symbol.asyncIterator]();
      // The bridge lives with the loop that re-opens (and so re-registers it):
      // it has to answer an ALREADY-aborted signal by releasing NOW, because a
      // re-open after an abort would otherwise hold an undetachable subscription.
      releaseOnAbort(iter, signal);
      const first = await iter.next();
      if (first.done) {
        // The stream ended before its MANDATORY snapshot frame. If the caller
        // aborted, that is a normal teardown — hand back an empty attachment the
        // consumer discards. Otherwise the kaval contract was violated (kaval
        // always yields a snapshot first, even an empty one), so FAIL LOUD rather
        // than fabricate a valid `{ snapshot: "", topLine: 0 }` that paints a
        // blank, frozen pane indistinguishable from a real empty terminal.
        // OMIT `reflowEpoch` rather than spelling `undefined`: "this attachment
        // reports no reflow generation" is an ABSENT key, and an explicit
        // `undefined` is the one spelling nothing downstream can honestly carry.
        if (signal?.aborted) return { snapshot: "", topLine: 0, iter };
        throw new Error(
          `attach(${id}): stream ended before its mandatory snapshot frame`,
        );
      }
      if (first.value.kind !== "snapshot") {
        throw new Error(
          `attach(${id}): expected a snapshot first frame, got "${first.value.kind}"`,
        );
      }
      return {
        snapshot: first.value.data,
        topLine: first.value.topLine,
        reflowEpoch: first.value.reflowEpoch,
        iter,
      };
    };

    const initial = await open(resizeTo);
    // The deltas survive a slow-subscriber drop: on kaval's `overflow` frame the
    // loop re-attaches for a fresh snapshot instead of ending (which would freeze
    // the client's scrollback as if the PTY had exited). Since kolu#2101 it also
    // survives a PLAIN end for a still-live PTY, re-opening to ask kaval whether
    // the PTY is actually gone. See `reattachingDeltas`.
    return {
      snapshot: initial.snapshot,
      topLine: initial.topLine,
      reflowEpoch: initial.reflowEpoch,
      // Re-attaches carry NO resize (see above) — `open()` with no argument.
      // `signal` rides along so the loop can tell OUR teardown (the abort that
      // ends the kaval iterator through the `iter.return()` bridge above) from an
      // end the chain manufactured: the first is graceful, the second is a
      // question to re-open on.
      deltas: reattachingDeltas(() => open(), initial.iter, { id, signal }),
    };
  }
}

const localEndpointImpl = new LocalTerminalEndpoint();
export const localTerminalEndpoint: TerminalEndpoint = localEndpointImpl;

// ── Sleep / wake / discard (local-only today, like adoption) ────────────
//
// Exposed as standalone entries rather than on the shared `TerminalEndpoint`
// interface — sleep/wake is local-only for now (manual, single-host). P3's
// remote-host sleep is an additive sibling, not a retrofit of the interface.

/** Flip an active terminal to the sleeping arm IN PLACE (PTY left alive). The
 *  facade persists the session durably, THEN calls `releaseSleptLocalPty` to kill
 *  the PTY (persist-before-kill). Returns false if `id` is not active. */
export function beginSleepLocal(id: TerminalId): boolean {
  return localEndpointImpl.beginSleep(id);
}

/** Kill the PTY of an already-flipped sleeping terminal. */
export function releaseSleptLocalPty(id: TerminalId): Promise<void> {
  return localEndpointImpl.releaseSleptPty(id);
}

/** Wake a sleeping terminal: flip to active + re-spawn on the same id, deriving the
 *  resume form from the persisted `restoreTarget` (the fold-decided resume value). */
export function wakeLocalTerminal(id: TerminalId): TerminalInfo | undefined {
  return localEndpointImpl.wake(id);
}

/** Discard a sleeping terminal's record (no PTY to kill). */
export function discardLocalSleeping(id: TerminalId): boolean {
  return localEndpointImpl.discardSleeping(id);
}

/** Discard a parked terminal's record — the consume half of the parked→active
 *  flip (`restoreSession`). No PTY to kill (it died at reboot). */
export function discardLocalParked(id: TerminalId): boolean {
  return localEndpointImpl.discardParked(id);
}

/** Forfeit EVERY remaining parked record — the "create a fresh terminal instead
 *  of restoring" path (`lifecycle.create`). Drops the lingering restore-card rows
 *  padi's boot reconcile parked; a no-op when none are parked. */
export function discardAllLocalParked(): void {
  localEndpointImpl.discardAllParked();
}

/** Seed a HANDLE-LESS terminal into the registry from a saved record — the shared
 *  core behind {@link seedSleepingTerminal} and {@link seedParkedTerminal}. Both
 *  restore a terminal whose PTY is gone (there is no PTY to re-wire) as a handle-less
 *  registry entry: validate the id + record at the read boundary, reset the live
 *  observation off the saved restore-relevant projection, register the entry (fanning
 *  its snapshot out), and fire the wire.
 *
 *  Tolerates a malformed record by DROPPING it (returns false, never throws) so one
 *  corrupt entry — a base truncated by a crash mid-write, hand-edited, or left by an
 *  older build — can't break the load for every other terminal (the
 *  `persisted-schema-stays-tolerant` policy). Idempotent: re-seeding a present id is
 *  a no-op.
 *
 *  Publishes ONLY the wire (via `registerAndInstall` → padi's `terminals`
 *  collection, whose keys stream is the client's list), NEVER the autosave dirty:
 *  neither arm may persist here — on cold boot the active records are not yet
 *  restored, so a snapshot-and-save would persist a set missing them and wipe the
 *  saved session; parked records are never persisted at all (`snapshotSession` skips
 *  them). Persistence is the caller's job.
 *
 *  The arms differ only in the schema they validate against and the authored entry
 *  they build (passed as `recordSchema` / `toEntry`); `label` names the arm in the
 *  drop warning. */
function seedHandlelessTerminal<Saved extends { id: string }>(
  record: Saved,
  {
    recordSchema,
    toEntry,
    label,
  }: {
    recordSchema: WireSchema<Saved>;
    toEntry: (
      parsed: Saved,
      base: { info: TerminalInfo; snapshot: TerminalSnapshot },
    ) => TerminalProcess;
    label: string;
  },
): boolean {
  // The tolerant read boundary: `decodeUnknownResult` is the Effect successor of
  // zod's `.safeParse` — a BRANCH, never a throw — so one corrupt record is
  // dropped and every other terminal still loads
  // (`persisted-schema-stays-tolerant`). Both decodes must succeed.
  const idParsed = decodeTerminalId(record.id);
  const recordParsed = Schema.decodeUnknownResult(recordSchema)(record);
  if (Result.isFailure(idParsed) || Result.isFailure(recordParsed)) {
    log.warn(
      { id: record.id },
      `dropping malformed record while seeding ${label} terminal`,
    );
    return false;
  }
  const id = idParsed.success;
  if (getTerminal(id)) return false;
  const parsed = recordParsed.success;
  // Seed the OBSERVATION from the saved restore-relevant projection (cwd / git / pr),
  // live agent + foreground reset — the client's join recomposes the dormant tile's
  // cwd / branch / pr off it. The agent the terminal will resume rides the authored
  // record built by `toEntry`. The observation rides the entry's `snapshot` field (no
  // separate store), then fans out.
  const persisted = decodePersistedSnapshot(parsed);
  const snapshot: TerminalSnapshot = {
    // The live fields (agent, foreground, ports) come from the ONE home for the
    // snapshot-default set rather than being re-spelled here: a cold-restored
    // terminal has no process yet, so it can be serving nothing by construction.
    ...seedSnapshot(persisted.cwd),
    ...persisted,
  };
  registerAndInstall(id, toEntry(parsed, { info: { id, pid: 0 }, snapshot }));
  return true;
}

/** Seed a SLEEPING terminal into the registry from its saved record — the dormant
 *  analogue of adoption (there is no PTY to re-wire). Used by BOTH boot paths: the
 *  surviving-daemon reconcile (`adoptSurvivingSession`) and the host-side cold-boot
 *  restore (`restoreSession` in `sessionRestore.ts`), so a slept terminal reappears
 *  as ☾ on any restart.
 *  The agent the terminal will resume rides the AUTHORED sleeping record's
 *  `restoreTarget` (its `exact` arm keeps only the identity — no full-agent
 *  reconstruction needed across a cold restart). */
export function seedSleepingTerminal(record: SavedSleepingTerminal): boolean {
  return seedHandlelessTerminal(record, {
    recordSchema: SavedSleepingTerminalSchema,
    toEntry: (parsed, base) => ({
      ...base,
      meta: decodeAuthoredSleeping(parsed),
    }),
    label: "sleeping",
  });
}

/** Seed a PARKED terminal into the registry from a saved ACTIVE record — the
 *  reboot no-survivor analogue of adoption for a terminal whose PTY died with the
 *  host. Mirrors {@link seedSleepingTerminal}, differing only in the arm: state
 *  `parked` (+ `parkedAt`) rather than `sleeping` (+ `sleptAt`).
 *
 *  COPIES `lastActivityAt` (and the whole authored base — location, restore
 *  target, client chrome) off the saved record onto the parked meta, so the
 *  restore card's recency ranking survives the reboot and the parked→active flip
 *  can forward it to the fresh spawn — without it the fold would reseed the
 *  restored terminal to `lastActivityAt: 0` and the dock's recency would collapse
 *  after a reboot. The saved `state: "active"` is overridden to `parked`; zod strips
 *  the snapshot fields (cwd/git/pr/id). */
export function seedParkedTerminal(record: SavedActiveTerminal): boolean {
  return seedHandlelessTerminal(record, {
    recordSchema: SavedActiveTerminalSchema,
    toEntry: (parsed, base) => ({
      ...base,
      meta: decodeAuthoredParked({
        ...parsed,
        state: "parked",
        parkedAt: Date.now(),
      }),
    }),
    label: "parked",
  });
}

/** Adopt a surviving local PTY at boot (B3.3) that HAS a saved record — its
 *  persisted chrome rides through whole (`adoptedAuthored`/`adoptedSnapshot`), with the live daemon
 *  snapshot the authority for `cwd`/`foreground`. Exposed as a standalone entry
 *  rather than on the shared `TerminalEndpoint` interface because adoption
 *  is local-only today — P3's remote-host adoption is an additive sibling, not
 *  a retrofit of the shared interface.
 *
 *  TOLERANT of a record this build cannot decode (#2122): returns `false` instead
 *  of throwing, leaving the caller to adopt the still-live PTY as an ORPHAN. The
 *  record is what a build with a WIDER vocabulary wrote — the reported case was a
 *  rollback under a session holding an `AgentKind` the running build's enum does
 *  not carry — and the old throwing decode made that one record fatal to the whole
 *  boot: `adoptSurvivingSession` propagated it, and the fail-closed arm in
 *  `ensureLocalEndpoint` answered by RECYCLING the adopted daemon, killing every
 *  live terminal on the host (including the ones that decoded perfectly). One
 *  unreadable record may cost THAT terminal its saved chrome and nothing more —
 *  the same `persisted-schema-stays-tolerant` rule `seedHandlelessTerminal`
 *  already applies to the sleeping / parked seeds.
 *
 *  The id is validated here too rather than cast: `reconcile` joins saved records
 *  to live PTYs on a raw string, so a saved id that is not a `TerminalId` reached
 *  the registry as a cast — the one hole the orphan path had already closed. */
/** What re-wiring one terminal settled on. Three-valued because the caller owes
 *  each a different answer: `unknown` is not ours to touch, `failed` is one kolu
 *  has gone blind to (so the heal must report incomplete and retry), and only
 *  `rewired` is done. */
export type RewireOutcome = "rewired" | "unknown" | "failed";

/** The exit code recorded for a terminal that exited while padi could not see it
 *  — outside the 0-255 an OS can report, so it cannot be mistaken for one the
 *  process actually returned. */
const EXIT_CODE_UNOBSERVED = -1;

/** Re-wire ONE already-held terminal's sensors after a link heal — the heal's
 *  counterpart to {@link adoptLocalTerminal}, and deliberately not a variant of
 *  it: no saved record is read, so nothing the user has changed since the last
 *  autosave can be rewound. Takes the live PTY only, because the registry entry
 *  it re-wires is already the truth. False when padi does not hold the id. */
export function rewireLocalSurvivor(
  liveEntry: PtyHostListEntry,
): RewireOutcome {
  const idParsed = decodeTerminalId(liveEntry.id);
  if (Result.isFailure(idParsed)) return "unknown";
  return localEndpointImpl.rewireSurvivingSensors(idParsed.success, liveEntry);
}

/** Treat a terminal padi holds as EXITED because the daemon no longer lists it
 *  (juspay/kolu#2182). The one caller is the link heal, and it is the only place
 *  the fact is still observable: the terminal's own exit tap died with the link,
 *  and the inventory reconciler's exited arm is a deliberate no-op precisely
 *  because it trusts that tap. Routes through the SAME teardown every other exit
 *  takes rather than a second removal path. */
export function dropVanishedTerminal(id: TerminalId): void {
  localEndpointImpl.noteVanishedWhileBlind(id);
}

export function adoptLocalTerminal(
  record: SavedActiveTerminal,
  liveEntry: PtyHostListEntry,
): boolean {
  const idParsed = decodeTerminalId(record.id);
  const recordParsed = decodeSavedActive(record);
  if (Result.isFailure(idParsed) || Result.isFailure(recordParsed)) {
    log.warn(
      { id: record.id },
      "saved record did not decode — adopting the surviving PTY as an orphan instead (it keeps its shell, not its saved chrome)",
    );
    return false;
  }
  const parsed = recordParsed.success;
  localEndpointImpl.adoptTerminal(
    idParsed.success,
    adoptedAuthored(parsed),
    adoptedSnapshot(parsed, liveEntry),
    liveEntry,
  );
  return true;
}

/** Adopt a surviving local PTY at boot (B3.3) that has NO saved record (F1) — a
 *  create that never reached the debounced autosave before the restart. The live
 *  shell is adopted (never reaped), seeded entirely from the daemon snapshot
 *  (`orphanSnapshot`). The sibling of `adoptLocalTerminal` for the unmatched-survivor
 *  case the reconcile partition surfaces separately. `id` is an ALREADY-VALIDATED
 *  `TerminalId` — the caller (the boot reconcile or the inventory boundary) parsed
 *  it against `TerminalIdSchema`, so this no longer re-casts a raw wire string. */
export function adoptLocalOrphan(
  id: TerminalId,
  liveEntry: PtyHostListEntry,
): void {
  localEndpointImpl.adoptTerminal(
    id,
    createAuthoredActive(LOCAL_LOCATION),
    orphanSnapshot(liveEntry),
    liveEntry,
  );
}

/** Adopt a PTY discovered LIVE on the inventory feed (B3.5) — a `kaval-tui create`
 *  against the daemon kolu is already a client of. Same orphan adoption as
 *  `adoptLocalOrphan`, but it ALSO arms the session autosave (F2): the boot path
 *  converges + persists the session EXPLICITLY after adopting all survivors, so
 *  `adoptTerminal` is deliberately silent there — but a single tile appearing
 *  mid-session has no such explicit save, so without arming the autosave the
 *  out-of-band terminal would render yet never enter the saved session until some
 *  LATER dirtying event (a metadata change, an exit) happened to fire. A
 *  kolu-server restart in that window would lose it. Emitting `terminalsDirty`
 *  here schedules the same debounced `saveSession(snapshot())` a fresh spawn does,
 *  so the adopted tile is persisted on the next 500ms tick. */
export function adoptLocalInventoryOrphan(
  id: TerminalId,
  liveEntry: PtyHostListEntry,
): void {
  // Identical orphan adoption to the boot path, plus the autosave arming — so it
  // composes `adoptLocalOrphan` rather than repeating `adoptTerminal(orphanSnapshot…)`.
  adoptLocalOrphan(id, liveEntry);
  notifyDirty();
}

/** Fail CLOSED on a live PTY whose wire id kolu cannot represent (F1) — a
 *  non-UUID id (kolu's registry is keyed on `TerminalId` = `z.string().uuid()`).
 *  Every real client mints a UUID (`crypto.randomUUID()`: kolu-server, kaval-tui),
 *  so this is an anomaly outside kolu's domain rather than valid state to keep:
 *  it cannot be registered (no tile, no exit tap, no way to surface or kill it
 *  through kolu), and leaving it alive is a hidden live process — the same
 *  fail-open the boot recycle guards against. So KILL it rather than log-and-drop;
 *  the contract's `kill` RPC takes the opaque wire string. A kill failure is
 *  logged, not thrown — there is nothing else kolu can do, and a throw here would
 *  end the inventory subscription / abort the boot adoption for every later PTY.
 *  Shared by the boot reconcile (`reattach.ts`) and the live inventory boundary
 *  (`inventoryReconcile.ts`) so the "unrepresentable id" policy lives in one
 *  place. */
export function reapUnrepresentablePty(rawId: string): void {
  log.warn(
    { rawId },
    "live PTY id failed TerminalIdSchema — killing the unrepresentable PTY (fail-closed)",
  );
  void runEndpointEdge(
    ptyHostClient.surface.terminal.kill({ id: rawId }),
  ).catch((err) =>
    log.error(
      { err, rawId },
      "kill of unrepresentable PTY failed; it remains live on the daemon",
    ),
  );
}
