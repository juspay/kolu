/**
 * `@kolu/padi/servePadi` — the ONE assembler of the `padiSurface` server deps.
 * Built ENTIRELY from padi's own domain modules (relative imports within `@kolu/padi`);
 * it NEVER imports from `packages/server` — the dependency arrow points OUT (a
 * helper that lives only in the server, `previewRealpathGuard`, is REPRODUCED
 * here in `./preview.ts`).
 *
 * `buildPadiSurfaceDeps` returns every read / procedure / source handler
 * `padiSurface` declares, minus `channel` (which kolu-server's shared
 * `implementSurfaces` second-arg supplies, reusing the one publisher).
 * `walkSurface` throws at boot if ANY member lacks deps, so EVERY member is
 * wired here. The reactive WRITE-path (padi's ctx + write-triggers publishing
 * deltas) is LIVE: the client reads the terminal record, urgency, daemon status,
 * session, activity feed, and the `terminalExit` event off `padiSurface`. The
 * `session` / `activityFeed` cells are backed by padi's OWN state-root Conf, set by
 * padi's `daemonMain` at boot (`openPadiStateStores` → `setPadiSessionStore` /
 * `setPadiActivityFeedStore`, see `./confStores.ts`); the wire members live here.
 */

import { rmSync } from "node:fs";
import { derived, everyMsOr, source } from "@kolu/surface/reactor";
import {
  type ImplementSurfaceDeps,
  inMemoryStore,
  streamFromAbortableSource,
} from "@kolu/surface/server";
import type { DaemonLifetimeInfo } from "@kolu/surface-daemon";
import { isContractSkewError } from "@kolu/surface-daemon-supervisor";
import { DEFAULT_SCROLLBACK } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import {
  currentPtyHostIdentity,
  DEFAULT_MIRROR_SCROLLBACK,
  SNAPSHOT_SCROLLBACK,
} from "kaval";
import { worktreeCreate, worktreeRemove } from "kolu-git";
import type { Logger } from "pino";
import { createFinishQuiet } from "./activity/finishQuiet.ts";
import { createLiveActivitySource } from "./activity/liveActivity.ts";
import { createSettleEvents } from "./attention/settleEvents.ts";
import { createWatchRegistry } from "./attention/watchRegistry.ts";
import type {
  EndpointGrid,
  TerminalAttachFrame,
  TerminalEndpoint,
} from "./endpoint.ts";
import {
  isPadiDeclaredError,
  KavalContractSkew,
  ScratchWriteRejected,
} from "./errors.ts";
import { padiFsGitDeps } from "./fsGitDeps.ts";
import {
  HOST_INVENTORY_SAMPLE_INTERVAL_MS,
  samplePadiHostInventory,
} from "./hostInventory.ts";
import {
  MEMORY_SAMPLE_INTERVAL_MS,
  samplePadiMemory,
} from "./memorySampler.ts";
import {
  newTerminalPolicyStore,
  resolveNewTerminalTheme,
} from "./newTerminalTheme.ts";
import { readPreview } from "./preview.ts";
import {
  onDaemonStatusChange,
  readDaemonStatus,
  readDaemonStatuses,
} from "./ptyHost/daemonStatus.ts";
import { recycleLocalKaval } from "./ptyHost/restartLocal.ts";
import { pulseSource } from "./pulseSource.ts";
import { cancelPendingAutosave } from "./session/autosaveGate.ts";
import {
  requirePadiActivityFeedStore,
  requirePadiSessionStore,
} from "./session/confStores.ts";
import { resumableTerminalIds } from "./session/resumable.ts";
import {
  forfeitSession,
  importSession,
  restoreSession,
} from "./session/sessionRestore.ts";
import {
  listPadiStateBackups,
  restorePadiStateBackup,
} from "./session/stateBackups.ts";
import {
  DEFAULT_PADI_VERSION,
  PADI_SURFACE_VERSION,
  type PadiIdentity,
  type PadiStatus,
  type PadiTerminal,
  type padiSurface,
} from "./surface.ts";
import {
  getActiveTerminal,
  getTerminal,
  registryMap,
  requireActiveTerminal,
  requireMutableTerminal,
  snapshotFor,
  terminalNotFound,
} from "./terminal-registry.ts";
import {
  discardLocalSleeping,
  wakeLocalTerminal,
} from "./terminalEndpoint/local.ts";
import { composePadiTerminal } from "./terminalEndpoint/metadata.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
import { appendTerminalFile, saveTerminalFile } from "./terminalScratch.ts";
import {
  createTerminal,
  killAllTerminals,
  killTerminal,
  setActiveTerminalId,
  setCanvasLayout,
  setRightPanelState,
  setSubPanelState,
  setTerminalIntent,
  setTerminalParent,
  setTerminalTheme,
  sleepTerminal,
} from "./terminals.ts";
import { unwrapGit } from "./terminalWorkspace/endpoint.ts";
import { exportTranscriptHtml } from "./transcript/transcript.ts";
import { base64DecodedLength, rejectionFor } from "./upload.ts";

// Baked scrollback-backfill invariant, asserted at daemon startup (fail fast, no
// degrade): a client's own scrollback must hold the ENTIRE reachable history —
// the full mirror plus the bounded attach snapshot — so `prependScrollback`
// never splices past its `CircularList`'s `maxLength` and silently evicts the
// rows it just inserted (the one demonstrated corruption mode). Headroom is a
// build-time fact across three packages that can't share a constant (kaval owns
// the mirror depth, `@kolu/terminal-vocab` the client depth); padi is the one
// daemon that sees both, so it is where the three numbers meet and a violation
// crashes the boot rather than corrupting a terminal in the field.
if (DEFAULT_SCROLLBACK < DEFAULT_MIRROR_SCROLLBACK + SNAPSHOT_SCROLLBACK) {
  throw new Error(
    `scrollback-backfill headroom violated: client DEFAULT_SCROLLBACK (${DEFAULT_SCROLLBACK}) < mirror (${DEFAULT_MIRROR_SCROLLBACK}) + snapshot (${SNAPSHOT_SCROLLBACK}); the client buffer cannot hold the full reachable history`,
  );
}

type PadiDeps = ImplementSurfaceDeps<typeof padiSurface.spec>;

/**
 * Bridge a plain handler body onto the `Effect` channel S2's `ProcedureImpl`
 * requires, with padi's DECLARED errors (`./errors.ts`) routed to the FAILURE
 * channel and everything else left a DEFECT (PLAN D4).
 *
 * ONE bridge rather than thirty-five hand-written `Effect.succeed` /
 * `Effect.promise` wrappers: "which throw is declared and which is a defect" is
 * exactly the rule that rots when it is respelled per member, and this is the
 * one seam every padi procedure crosses. The body may be sync or async — the
 * same latitude the retired oRPC `ProcedureImpl` gave (`O | Promise<O>`) — and
 * it receives the AbortSignal the call's fiber owns, which is how a superseded
 * read (`fs.filePreviewTag`) still aborts mid-flight now that there is no
 * `signal` on the handler options (D10/#18).
 */
function handle<A, E>(
  body: (signal: AbortSignal) => A | Promise<A>,
): Effect.Effect<A, E> {
  return Effect.catch(
    Effect.tryPromise({
      try: async (signal) => body(signal),
      catch: (err: unknown) => err,
    }),
    (err) =>
      isPadiDeclaredError(err)
        ? Effect.fail(err as E)
        : (Effect.die(err) as Effect.Effect<A, E>),
  );
}

/** {@link handle}'s twin for a body that is ALREADY an `Effect` — same declared-vs-
 *  defect rule, no Promise in the middle. A handler whose work composes (padi's
 *  own supervisory verbs, now that the endpoint kit is Effect-native) routes here
 *  instead of being flattened into a promise and re-lifted. */
function handleEffect<A, E>(
  body: Effect.Effect<A, unknown>,
): Effect.Effect<A, E> {
  return Effect.catch(body, (err) =>
    isPadiDeclaredError(err)
      ? Effect.fail(err as E)
      : (Effect.die(err) as Effect.Effect<A, E>),
  );
}

/**
 * THE reactor-poll Promise edge for padi's poll cells — one function, named, so
 * the crossing is countable.
 *
 * The reactor's poll dep is `read: () => Promise<T>` BY DESIGN: a poll source
 * owns its own cadence and seed and is deliberately not Effect code (locked
 * decision 1). padi's samplers are Effects now — they compose the supervisor's
 * Effect-native control-core reads — so this is where the two meet. Once, here,
 * rather than once per cell.
 */
function pollRead<A>(program: Effect.Effect<A, unknown>): () => Promise<A> {
  return () => Effect.runPromise(program);
}

/** One subscriber's `terminalAttach` frames: open the terminal's endpoint attach,
 *  emit the mandatory snapshot-first frame (carrying the backfill seed `topLine`
 *  and the reflow generation `reflowEpoch`), then relay its deltas — including the
 *  shipped overflow re-attach (#1591), which arrives as a further `snapshot` frame
 *  through `reattachingDeltas`.
 *
 *  Routed by the terminal's OWN location so a remote tile's attach reaches its
 *  host (a remote endpoint arrives with the cross-host work); local today. The
 *  caller's grid rides through to the host verbatim — it arrives as one
 *  composite, so there is nothing to validate or reassemble here. Note that makes
 *  the attach a WRITE: the host resizes the terminal to it before serializing
 *  (see `PadiTerminalAttachInputSchema`). */
async function* attachFrames(
  id: string,
  resizeTo: EndpointGrid | undefined,
  signal: AbortSignal,
): AsyncGenerator<TerminalAttachFrame> {
  const entry = requireActiveTerminal(id);
  const { snapshot, topLine, reflowEpoch, deltas } =
    await resolveTerminalEndpoint(entry.meta.location).attach(
      id,
      signal,
      resizeTo,
    );
  yield { kind: "snapshot", data: snapshot, topLine, reflowEpoch };
  for await (const frame of deltas) yield frame;
}

/** The DAEMON-LIFETIME teardown for everything `buildPadiSurfaceDeps` stands up
 *  and keeps running past its own return: the finish-quiet tracker (its kaval
 *  activity subscription) and the attention flow (the settle-event source, the
 *  standing subscription registry, and the two sinks wired between them).
 *
 *  ONE handle, because it is one lifetime — a `servePadi` rebuild in tests must
 *  dispose the prior set rather than stack a second one on the same daemon, and
 *  two singletons with two dispose functions guarding the same moment is two
 *  chances to forget one. Nothing READS the pieces through here: every consumer
 *  is a closure inside the same function body, holding the value lexically. */
let disposeStanding: (() => void) | undefined;

/** Assemble the FULL `padiSurface` server deps (minus `channel`). Every member
 *  gets a functional read/procedure/source handler AND a live write path (the padi
 *  ctx `surface.ts` registers drives the collection/cell publishes). The
 *  `previewRealpathGuard` is padi's own re-creation of the server's shipped adapter
 *  (`./preview.ts`), never imported from `packages/server`. */
export function buildPadiSurfaceDeps(deps: {
  endpoint: TerminalEndpoint;
  log: Logger;
  /** padi's boot time (ms epoch) — the SAME `PADI_STARTED_AT` constant
   *  `daemonMain.ts` also hands the control-core `hello` (`buildControlCoreDeps`),
   *  reused here (never re-derived via a fresh `Date.now()`) so the `identity` cell
   *  and `hello` can't drift. */
  startedAt: number;
  /** padi's navigable git commit (`currentPadiCommitHash()`) — the SAME value
   *  `daemonMain.ts` hands `hello`. `""` off-nix; mapped to a DECLARED `null` below
   *  (never re-derived). */
  commit: string;
  /** padi's serialized lifetime (`forever` in production; `boundToPid` under a
   *  test/smoke run) — the SAME projection `daemonMain.ts` hands `daemonMain`,
   *  seeded into the `identity` cell so the readout and the actual policy can't
   *  drift. */
  lifetime: DaemonLifetimeInfo;
  /** padi's resolved state-root — the `hostInventory` poll read resolves the
   *  held-kaval fallback address from it (`samplePadiHostInventory`). */
  stateRoot: string;
}): PadiDeps {
  const { endpoint, log, startedAt, commit, lifetime, stateRoot } = deps;
  const fsGit = padiFsGitDeps(endpoint, log);
  // Dispose the PRIOR daemon-lifetime set (finish tracker + attention flow) so a
  // servePadi test rebuild doesn't stack resubscribe loops or two sets of sinks.
  disposeStanding?.();
  disposeStanding = undefined;
  // EF2 — daemon-lifetime finish tracker + standing kaval activity sub. Dual-edge
  // with terminals via `finish.project` (quiet-exit re-folds without an
  // agent-state change).
  const finish = createFinishQuiet({ log });

  // SETTLE EVENTS → the standing subscriptions. One event source — "a terminal
  // just started needing someone", derived from the SAME urgency level the Dock
  // and the browser's alerts read — feeding the named, buffered queues an
  // MCP-only supervisor drains. Disposed alongside the finish tracker (one
  // `disposeStanding`) so a servePadi rebuild in tests cannot stack two sets of
  // listeners on one daemon.
  const settleEvents = createSettleEvents({ log });
  const watchRegistry = createWatchRegistry({
    log,
    // The daemon's CURRENT settle sequence — where a fresh subscription starts
    // acknowledged, and the ceiling an acknowledgement is sanity-checked against
    // (a cursor from a previous padi generation would otherwise set a watermark
    // no future event could climb past).
    daemonSeq: () => settleEvents.lastSeq(),
  });
  const unsubscribeSettle = settleEvents.onFrame((events) =>
    watchRegistry.accept(events),
  );
  disposeStanding = () => {
    unsubscribeSettle();
    watchRegistry.dispose();
    settleEvents.dispose();
    finish.dispose();
  };

  // The padi memory / host-inventory poll cells fire on their fixed cadence AND the
  // moment a daemon's status changes — so a fresh daemon's readout reflects its
  // kaval the INSTANT it connects. A poll cell's connect fires at SERVE time, BEFORE
  // the endpoint boots + spawns the kaval, so the interval alone would leave the
  // first authoritative frame stale-but-valid (kaval `absent` / a host inventory
  // without the just-spawned kaval) standing for a full cadence. Fusing an immediate
  // re-sample onto the daemon-status change (available at serve time — unlike
  // kolu-server's late `padiSession`, which is why that sampler defers to #1831)
  // closes that startup window: the readout re-reads on connect, not one tick later.
  // The fuse itself is the reactor's `everyMsOr(ms, subscribe)` (SR8.c graduated the
  // once-duplicated app-local twins into `@kolu/surface`); here the change signal is
  // `onDaemonStatusChange`.

  // The kaval THIS padi would spawn — its OWN baked identity (a build constant,
  // read from kaval's `currentPtyHostIdentity`). Mirrors the guard the server's
  // retired surface-app buildInfo axis used: off-nix the id is "" (no baked
  // identity), so omit `expectedKaval` then and the client's currency nudge stays
  // silent. Seeded once at boot into a read-only cell — a build constant never
  // changes at runtime, so there is no write-trigger (unlike urgency).
  const identity = currentPtyHostIdentity();
  // SPREAD, never `expectedKaval: … : undefined` (#17): the field is
  // `Schema.optionalKey`, so an ABSENT key is accepted and a present-but-
  // `undefined` one is REJECTED — where zod's `.optional()` took either. The
  // off-nix case (`staleKey === ""`) is the ORDINARY one for any run outside a
  // nix build, and this value is seeded into the `status` cell, whose every
  // subscribe ENCODES it — so spelling the `undefined` broke the cell for every
  // from-source server, not an edge case.
  const status: PadiStatus = {
    ...(identity.staleKey ? { expectedKaval: identity } : {}),
  };
  // padi's OWN identity (distinct from the kaval `identity` above) — the per-host
  // `identity` cell twin of the control-core `hello`. `commit` is a DECLARED value:
  // `""` off-nix maps to `null` ("padi declares: no commit"), never left as an
  // empty string a render site would have to re-interpret. Built once, here, from
  // the SAME `startedAt`/`commit` this function's caller already reads for `hello`
  // — a build/boot constant, so no write-trigger (like `status` above).
  const padiIdentity: PadiIdentity = {
    commit: commit || null,
    surfaceVersion: PADI_SURFACE_VERSION,
    startedAt,
    lifetime,
  };

  return {
    cells: {
      // Read-only version handshake — same shape as terminalWorkspace's version
      // cell.
      version: { store: inMemoryStore(DEFAULT_PADI_VERSION) },
      // Read-only per-host identity — padi's own build commit/surfaceVersion/boot
      // time, the `hello` twin every `padiMap` entry can read directly (see
      // `PadiIdentitySchema`'s doc comment in `surface.ts`).
      identity: { store: inMemoryStore(padiIdentity) },
      // Read-only build-currency axis — the expected-kaval identity, a build
      // constant seeded once at boot (the client's kaval-update nudge — the
      // amber pip + tooltip, via `kavalStale` — reads it against the connected
      // daemon's reported `daemonStatus.identity`).
      status: { store: inMemoryStore(status) },
      // The resolved new-terminal theme policy the binding kolu-server pushes.
      // The SAME module store `resolveNewTerminalTheme` reads — that identity is
      // what makes `lifecycle.create` resolve against the wire-written authority.
      newTerminalPolicy: { store: newTerminalPolicyStore },
      // The running kaval + padi daemons on THIS padi's host — the "Running daemons"
      // leak diagnostic. A DERIVED member fed by a POLL source: `samplePadiHostInventory`
      // scans the host (reading padi's serve socket from the module global set at boot),
      // and the reactor owns the T+0 seed (from the spec default until it lands), the
      // non-overlap guard, and later-read log-skip-continue that the hand-rolled
      // `startPadiHostInventorySampler` used to spell. `install` owns just the coarse
      // 10s unref'd cadence (a live diagnostic never holds the process open).
      hostInventory: derived.cell(
        source({
          label: "hostInventory",
          read: pollRead(samplePadiHostInventory(stateRoot)),
          install: everyMsOr(
            HOST_INVENTORY_SAMPLE_INTERVAL_MS,
            onDaemonStatusChange,
          ),
        }),
      ),
      // Live process-memory readout (padi's OWN RSS + its kaval's) — a DERIVED
      // member fed by a POLL source: `samplePadiMemory` is the read, and the
      // reactor owns the T+0 seed (seeded from the spec default until it lands),
      // the non-overlap guard, and later-read log-skip-continue that the
      // hand-rolled `startPadiMemorySampler` used to spell. `install` owns just the
      // cadence: a 5s `unref`'d interval (a live metric never holds the process
      // open). The graph is the one writer — no ctx `.set`, no store/equals here.
      processMemory: derived.cell(
        source({
          label: "processMemory",
          read: pollRead(samplePadiMemory),
          install: everyMsOr(MEMORY_SAMPLE_INTERVAL_MS, onDaemonStatusChange),
        }),
      ),
      // A DERIVED member — finish.project owns track + enter/leave-waiting sync +
      // pure recomputeUrgency so call sites cannot drift. Dual-edged on terminals
      // and the finish generation (quiet-exit promote re-folds without an
      // agent-state change). Spec `equals` (`urgencyEqual`) is the ONE wire
      // dedup point. No `store`/`equals` here — the graph is the one writer.
      urgency: derived.cell(($) => {
        const terminals = $.terminals();
        const next = finish.project(terminals);
        // The settle EDGE, taken where the LEVEL is computed — one fold, one
        // arrival time, so a supervisor's nudge and the Dock's paint can never
        // describe different worlds. Observing from inside a derivation is the
        // latitude the reactor's DUAL EDGE note already grants this exact cell
        // (`finish.project` writes the episode map and bumps its generation
        // here), and it is safe for a second reason of its own: the transition is
        // computed against the PREVIOUS frame, so a redundant recompute yields no
        // candidates and emits nothing.
        settleEvents.observe(next, terminals);
        return next;
      }),
      // The saved session — backed by padi's OWN state-root Conf, set by padi's
      // daemonMain at boot (`setPadiSessionStore`, see `confStores.ts`), read here
      // via `requirePadiSessionStore`. The
      // `get` reads that store DIRECTLY and normalizes an empty-terminals blob to
      // `null` (the legacy "nothing to restore" invariant) INLINE — it must NOT
      // delegate to `getSavedSession`, which reads THIS cell (via
      // `padiSurfaceCtx.cells.session.get`): a `get: () => getSavedSession()` is
      // mutually recursive and blows the stack at boot (the first `getSavedSession`
      // is padi's boot reconcile / `parkSavedSession`). The `equals` content-dedup
      // and the `onWrite` autosave-cancel travel WITH the writer — the surface cell
      // otherwise publishes a fresh reference on every byte-identical re-save (which
      // detaches the restore button mid-frame), and every write must cancel any
      // pending `saveSession([])` autosave a stale `terminals:dirty` armed
      // (including the e2e `test__set`, which bypasses the named `setSavedSession`).
      session: {
        store: {
          get: () => {
            const s = requirePadiSessionStore().get();
            if (!s || s.terminals.length === 0) return null;
            // Host stamps the resumable set on every serve — the client renders
            // this list and may only subtract (opt-out); it never constructs it.
            return {
              ...s,
              resumableIds: resumableTerminalIds(s.terminals),
            };
          },
          set: (v) => {
            if (v === null) {
              requirePadiSessionStore().set(null);
              return;
            }
            // Stamp on the same object the cell bus will publish (applyAndPublish
            // publishes `next`, not a post-set get) so every wire push carries
            // host-owned membership. Persist only the disk shape — resumableIds
            // is wire-only and recomputed on every get.
            //
            // A DECODED value is `readonly`, and rebuilding is not an option here:
            // the cell bus publishes the very object it was handed, so a copy would
            // carry the stamp while the wire pushed the unstamped original. The
            // write is narrowed to the ONE wire-only field this seam owns.
            (v as { resumableIds?: readonly string[] }).resumableIds =
              resumableTerminalIds(v.terminals);
            requirePadiSessionStore().set({
              terminals: v.terminals,
              activeTerminalId: v.activeTerminalId,
              savedAt: v.savedAt,
            });
          },
        },
        // Compare disk shape only — `get()` always stamps `resumableIds`, while
        // writers often pass the conf blob without it. Equality must not treat
        // stamp presence as a content change (would defeat byte-identical dedup
        // and remount the restore card on every re-save).
        equals: (a, b) => {
          const disk = (s: typeof a) => {
            if (s === null) return null;
            const { resumableIds: _drop, ...rest } = s;
            return rest;
          };
          return JSON.stringify(disk(a)) === JSON.stringify(disk(b));
        },
        onWrite: () => cancelPendingAutosave(),
      },
      // The activity feed — backed by padi's OWN state-root Conf, set by padi's
      // daemonMain at boot (`setPadiActivityFeedStore`, see `confStores.ts`).
      // A thin lazy wrapper (not the bare store) because the store is injected
      // AFTER this deps object is built (padi's boot order), so calling
      // `requirePadiActivityFeedStore()` eagerly here would read before the set.
      activityFeed: {
        store: {
          get: () => requirePadiActivityFeedStore().get(),
          set: (v) => requirePadiActivityFeedStore().set(v),
        },
      },
    },

    collections: {
      // The composed terminal record — `authored ⋈ snapshot` folded SERVER-side
      // into one record (the client reads it directly, no reader-join). The registry
      // IS the store, so `upsert`/`remove` are no-ops here; the metadata seam
      // (`terminalEndpoint/metadata.ts`) drives the live fan-out through the padi
      // ctx, and this collection's keys stream is the client's terminal list.
      terminals: {
        readAll: () => registryMap<PadiTerminal>(composePadiTerminal),
        readOne: (key) => {
          const entry = getTerminal(key);
          return entry ? composePadiTerminal(entry) : undefined;
        },
        upsert: () => {},
        remove: () => {},
        // The derived `urgency` cell folds `$.terminals()` on the ~150 ms agent
        // firehose; a plain `readAll()` sibling read would re-compose ALL M
        // terminals (`registryMap(composePadiTerminal)`) per poke = O(M²)
        // composes/cycle (SR7's regression). Opt into the materialized view so
        // the fold reads a per-key cache updated by these publish seams — O(M).
        // SAFE here because EVERY terminals change flows through this collection's
        // ctx `upsert`/`remove` (metadata.ts's `publishComposedTerminal` and
        // `dropSnapshot` are the sole writers; the registry is the store, so
        // `upsert`/`remove` above are no-ops and the composed value the seams pass
        // is the view's single write path).
        materializeSiblingView: true,
      },

      // Per-host kaval status — backed by padi's own `readDaemonStatuses` /
      // `readDaemonStatus` (`./ptyHost/daemonStatus.ts`, the source of truth); the
      // store is the authority, so upsert/remove are no-ops.
      daemonStatus: {
        readAll: () => readDaemonStatuses(),
        readOne: (key) => readDaemonStatus(key),
        upsert: () => {},
        remove: () => {},
      },
    },

    streams: {
      // LIVE (W2.3) — the set of terminals producing output right now. The source
      // folds kaval's host-global, resize-excluded meaningful-output edge (kaval
      // contract 5.3) through the shared tracker's live-dot window into a live set;
      // a single kaval subscription per watcher (re-subscribed across a daemon
      // recycle), no per-terminal byte taps (see `createLiveActivitySource`). The
      // client's per-tile green dot now MIRRORS this member off
      // `padiSurface.streams.activity` — it no longer derives from its own
      // `terminalAttach` bytes. The fs/git change-pulses are pure reuse of
      // `padiFsGitDeps(...).streams`.
      activity: createLiveActivitySource(log),
      // The standing-subscription doorbell — pulse-then-requery, the same shape
      // as the fs/git change pulses. It carries only a counter: the buffer behind
      // `watch.drain` is the authority, so a pulse lost to a dropped stream costs
      // the caller a wait, never an event.
      watchPulse: {
        source: (input: { name: string }) =>
          pulseSource(
            (onEvent) => watchRegistry.onPulse(input.name, onEvent),
            log,
            `watchPulse[${input.name}]`,
          ),
      },
      ...fsGit.streams,
      // The per-subscriber terminal byte stream — snapshot-first frame, then
      // live output, with the shipped overflow re-attach (#1591) riding on
      // through `reattachingDeltas`. Routed by the terminal's OWN location so a
      // remote tile's attach reaches its host (a remote endpoint arrives with the
      // cross-host work); local today.
      terminalAttach: {
        // A member `source` is Effect-native now (S2): it returns a `Stream`, and
        // interruption of the subscribing fiber is the unsubscribe. The producer
        // underneath is still AbortSignal-shaped (the endpoint's `attach` opens a
        // kaval subscription it must be told to release), so it crosses at the
        // framework's ONE producer-edge bridge rather than by threading a signal
        // back through a handler option that no longer exists (D10/#18).
        source: ({ id, resizeTo }) =>
          streamFromAbortableSource((signal) =>
            attachFrames(id, resizeTo, signal),
          ),
      },
    },

    events: {
      // Terminal process exited — single-yield-then-close, validating existence
      // at subscribe time so a stale-session re-subscribe swallows the typed
      // NOT_FOUND. The SOLE `terminalExit` generator now: koluSurface's duplicate
      // copy was deleted (W1 padi seam), so `local.ts`'s exit publish targets
      // padi's ctx and the client reads `padi.events.terminalExit`.
      //
      // `terminalNotFound` here is an UNDECLARED failure ⇒ a DEFECT: an
      // `EventSpec` carries no error channel to declare it on. Deliberate, and
      // documented in `errors.ts` — do not try to declare it.
      terminalExit: {
        source: (input, { bus }) =>
          streamFromAbortableSource((signal) =>
            (async function* exitFrames(): AsyncGenerator<number> {
              if (!getTerminal(input.id)) throw terminalNotFound(input.id);
              for await (const exitCode of bus.subscribe(signal)) {
                yield exitCode;
                return;
              }
            })(),
          ),
      },
    },

    procedures: {
      // Standing settle-event subscriptions. All three verbs are INSTANT — the
      // waiting happens on the caller's side, parked on `watchPulse`, so no
      // handler is held open for the minutes or hours a supervisor may idle
      // between a worker's turns.
      watch: {
        open: ({ input }) =>
          handle(() => {
            // `open` answers `reattached` itself — the registry is the only thing
            // that can know it without a race, and it seeds a fresh
            // subscription's watermark from the `daemonSeq` it was built with.
            const { sub, reattached } = watchRegistry.open(
              input.name,
              input.ids,
            );
            log.info(
              {
                name: input.name,
                reattached,
                scope: input.ids === undefined ? "all" : input.ids.length,
              },
              reattached
                ? "watch subscription re-attached"
                : "watch subscription opened",
            );
            return {
              name: sub.name,
              acknowledged: sub.acknowledged,
              reattached,
            };
          }),
        drain: ({ input }) =>
          handle(() => watchRegistry.drain(input.name, input.after)),
        close: ({ input }) =>
          handle(() => {
            watchRegistry.close(input.name);
            return {};
          }),
      },
      lifecycle: {
        create: ({ input }) =>
          handle(() => {
            // A sub-terminal must hang off a LIVE parent (F3) — the same
            // live-PTY narrow every per-terminal handler uses. `PadiCreateInput`
            // omits `lastActivityAt`: a fresh terminal seeds `lastActivityAt: 0`
            // (via `createAuthoredActive` → `seedMemory`), and the fold stamps recency
            // later — the client can't supply it. (Only `session.restore` threads a
            // saved `lastActivityAt` through, via `respawnActive`, not this path.)
            if (input.parentId !== undefined)
              requireActiveTerminal(input.parentId);
            const info = createTerminal(input.cwd, input.parentId, {
              // An explicit theme always wins; absent one, the pushed policy
              // decides — HERE, so the MCP and CLI faces obey the user's
              // new-terminal theme setting exactly as the browser does (#2045).
              // A SPLIT gets no policy theme at all: it renders inside its parent
              // tile with the PARENT's theme, so a tint picked for it would be
              // invisible — and would then pollute the shuffle peer set with a
              // colour nobody can see.
              themeName:
                input.themeName ??
                (input.parentId === undefined
                  ? resolveNewTerminalTheme()
                  : undefined),
              canvasLayout: input.canvasLayout,
              subPanel: input.subPanel,
              rightPanel: input.rightPanel,
              intent: input.intent,
            });
            // Creating a fresh terminal DOES NOT forfeit the restore: the parked
            // entries (and the saved session on disk they stand for) survive, so the
            // restore stays offered — a user who reaches for a new terminal has not
            // decided to throw their previous session away. Forfeit is now the
            // EXPLICIT `session.forfeit` act (discard parked + clear the blob together).
            // The old create-time `discardAllLocalParked()` traded a cosmetic parked
            // leak for silent data loss: with parked records invisible to
            // `snapshotSession`, a create then a close shrank the blob to nothing (PATH
            // B). `session.restore` still takes the OTHER path — it CONSUMES each parked
            // entry via the parked→active flip, never reaching here.
            return info;
          }),
        kill: ({ input }) =>
          handle(async () => {
            const info = await killTerminal(input.id);
            if (!info) throw terminalNotFound(input.id);
            return info;
          }),
        killAll: () => handle(() => killAllTerminals()),
        sleep: ({ input }) =>
          handle(() => {
            log.info({ terminal: input.id }, "sleep");
            return sleepTerminal(input.id);
          }),
        wake: ({ input }) =>
          handle(() => {
            log.info({ terminal: input.id }, "wake");
            const info = wakeLocalTerminal(input.id);
            if (!info) throw terminalNotFound(input.id);
            return info;
          }),
        discardSleeping: ({ input }) =>
          handle(() => {
            log.info({ terminal: input.id }, "discard sleeping");
            discardLocalSleeping(input.id);
          }),
        // Fire-and-forget stream ops: a resize/keystroke landing just after a
        // kill is an EXPECTED race, so quiet-drop via `getActiveTerminal`
        // (#1628) rather than throwing NOT_FOUND.
        // AWAITED, unlike `sendInput` below: the quiet-drop on a killed terminal
        // stays (that race is expected), but once a live terminal HAS been
        // found, whether the host accepted the new grid is the caller's business
        // — a client told "resized" while the PTY kept its old size would render
        // against a size nothing has, silently.
        resize: ({ input }) =>
          handle(async () => {
            await getActiveTerminal(input.id)?.handle.resize(
              input.cols,
              input.rows,
            );
          }),
        sendInput: ({ input }) =>
          handle(() => {
            getActiveTerminal(input.id)?.handle.write(input.data);
          }),
        // The "Restart kaval" button — force-recycle THIS host's kaval daemon,
        // preserving the session (B3.2). padi's INTERNAL supervisory op: capture →
        // drain → recycle (kill + spawn fresh) → park, all via `recycleLocalKaval`
        // (the soul) through the endpoint's coalescing emit-guard. PADI STAYS UP —
        // this is the `adopt-or-ensure` recycle arm, never a padi restart (that is
        // the separate `control.drain` upgrade path). Resolves once the fresh kaval
        // is connected; a failure rejects with the captured session safe on disk.
        //
        // `recycleLocalKaval` is THE routine, shared verbatim with the steady-state
        // supervisor (#2101 N1) — the button is now the manual trigger of the same
        // machinery, not a second copy of it. What stays HERE is the only thing that
        // is about this being an RPC: retyping a contract skew as a declared wire
        // error.
        recycleKaval: () =>
          handleEffect(
            Effect.gen(function* () {
              yield* Effect.catch(recycleLocalKaval("Restart kaval"), (err) => {
                // A contract skew is the ONE failure this handler can translate — it
                // is the knowing endpoint (the same precedent as `unwrapGit`'s
                // `FILE_GONE` → `NOT_FOUND` mapping: the layer that knows what an
                // error means must retype it, not leave it to flatten downstream): a
                // plain rethrow would be flattened to INTERNAL_SERVER_ERROR by oRPC
                // and the user would read an opaque toast (the field failure,
                // bug-remote-kaval-contract-skew defect A). Refuse via the DECLARED
                // error constructor (SK6) — versions as typed data, `defined: true`
                // on the wire — one recycle attempt was the diagnosis; padi is not
                // the actor that can fix a skew (only the binder's reprovision is).
                if (isContractSkewError(err)) {
                  return Effect.fail(
                    new KavalContractSkew({
                      daemonVersion: err.daemonVersion,
                      requiredVersion: err.requiredVersion,
                    }),
                  );
                }
                return Effect.fail(err);
              });
            }),
          ),
      },

      chrome: {
        setTheme: ({ input }) =>
          handle(() => {
            requireMutableTerminal(input.id);
            log.info(
              { terminal: input.id, theme: input.themeName },
              "set theme",
            );
            setTerminalTheme(input.id, input.themeName);
          }),
        setIntent: ({ input }) =>
          handle(() => {
            requireMutableTerminal(input.id);
            log.info(
              { terminal: input.id, intentLength: input.intent.length },
              "set intent",
            );
            setTerminalIntent(input.id, input.intent);
          }),
        setParent: ({ input }) =>
          handle(() => {
            requireMutableTerminal(input.id);
            log.info(
              { terminal: input.id, parent: input.parentId },
              "set terminal parent",
            );
            setTerminalParent(input.id, input.parentId);
          }),
        setActive: ({ input }) =>
          handle(() => {
            setActiveTerminalId(input.id);
          }),
        setCanvasLayout: ({ input }) =>
          handle(() => {
            requireMutableTerminal(input.id);
            setCanvasLayout(input.id, input.layout);
          }),
        setSubPanel: ({ input }) =>
          handle(() => {
            requireMutableTerminal(input.id);
            setSubPanelState(input.id, {
              collapsed: input.collapsed,
              panelSize: input.panelSize,
            });
          }),
        setRightPanel: ({ input }) =>
          handle(() => {
            requireMutableTerminal(input.id);
            const { id: _id, ...state } = input;
            setRightPanelState(input.id, state);
          }),
      },

      screen: {
        state: ({ input }) =>
          handle(() => requireActiveTerminal(input.id).handle.getScreenState()),
        text: ({ input }) =>
          handle(() =>
            requireActiveTerminal(input.id).handle.getScreenText(
              input.startLine,
              input.endLine,
            ),
          ),
        history: ({ input }) =>
          handle(() =>
            requireActiveTerminal(input.id).handle.getHistory(
              input.before,
              input.max,
              input.epoch,
            ),
          ),
      },

      // fs reads off the SAME shared endpoint `serveFsGit` wraps (its procedure
      // objects carry terminalWorkspace's ctx type, which padi's ctx can't
      // satisfy, so declare the handlers here against padi's ctx — the endpoint
      // methods are the reused source of truth). `readFile` is TEXT-only (binary
      // goes through `preview.read`).
      fs: {
        listAll: ({ input }) =>
          handle(() => endpoint.fs.listAll(input.repoPath)),
        listIgnored: ({ input }) =>
          handle(() => endpoint.fs.listIgnored(input.repoPath)),
        // Delete-while-viewing — a file deleted under an open preview, a build
        // output `just clean`ed under an open row — must reach the client as a
        // TYPED `NOT_FOUND`, because that is the one status
        // `BrowseFileDispatcher` swallows (matching the old value stream, which
        // simply stopped yielding). None of these three needs a wrapper to get
        // it: each kolu-git read returns the structural `FILE_GONE` member and
        // `unwrapGit` maps it, so the classification is already settled by the
        // time it reaches here. `endpoint.test.ts` pins that for all three.
        listDirectory: ({ input }) =>
          handle(() =>
            endpoint.fs.listDirectory(input.repoPath, input.dirPath),
          ),
        readFile: ({ input }) =>
          handle(() => endpoint.fs.readFile(input.repoPath, input.filePath)),
        // The call's own AbortSignal is threaded so a superseded preview query
        // (input changed, or a fresh file-change pulse re-fired) aborts the
        // whole-file hash mid-read instead of running to completion — the cost is
        // real on a multi-GB video where the read runs for seconds. There is no
        // `signal` handler option any more (D10/#18); the signal `handle` passes
        // is the one the call's FIBER owns, so an interrupted call — the Effect
        // successor of a cancelled request — still aborts the read.
        filePreviewTag: ({ input }) =>
          handle((signal) =>
            endpoint.fs.filePreviewTag(input.repoPath, input.filePath, signal),
          ),
      },

      // git reads off the same shared endpoint; the worktree MUTATIONS are
      // padi's own (not in serveFsGit), composed beside the reads.
      git: {
        getStatus: ({ input }) =>
          handle(() => endpoint.git.getStatus(input.repoPath, input.mode)),
        getDiff: ({ input }) =>
          handle(() =>
            endpoint.git.getDiff(
              input.repoPath,
              input.filePath,
              input.mode,
              input.oldPath,
            ),
          ),
        worktreeCreate: ({ input }) =>
          handle(async () => {
            log.info(
              { repo: input.repoPath, name: input.name },
              "worktree create",
            );
            const result = unwrapGit(
              await worktreeCreate(input.repoPath, input.name, log),
            );
            log.info(
              {
                repo: input.repoPath,
                path: result.path,
                branch: result.branch,
              },
              "worktree created",
            );
            return result;
          }),
        worktreeRemove: ({ input }) =>
          handle(async () => {
            log.info({ worktree: input.worktreePath }, "worktree remove");
            unwrapGit(await worktreeRemove(input.worktreePath, log));
          }),
      },

      scratch: {
        // AUTHORITATIVE server-side upload gate — the write half of paste/upload
        // (the client does `scratch.write` + `lifecycle.sendInput`), so this
        // procedure re-enforces the SAME policy the retired server
        // `uploadFile`/`pasteImage` handlers did before touching disk (upload.ts:
        // "the server is the authoritative gate before writing to disk"). The
        // client prechecks for a fast toast, but a direct/buggy caller must not be
        // able to write disallowed/oversized bytes, nor orphan a scratch file
        // under an absent/sleeping/parked id — hence require an ACTIVE terminal
        // and run `rejectionFor` (extension allowlist + 50 MB cap). "image.png"
        // passes the allowlist, so a clipboard paste is gated on size exactly as
        // the old `sizeRejectionFor` path was.
        write: ({ input }) =>
          handle(() => {
            requireActiveTerminal(input.terminalId);
            const bytes = base64DecodedLength(input.data);
            // FIRST chunk (or a whole small file): the extension allowlist is
            // checked here, once, before anything touches disk.
            if (input.appendTo === undefined) {
              const reason = rejectionFor(input.name, bytes);
              if (reason !== null) throw new ScratchWriteRejected({ reason });
              return {
                path: saveTerminalFile(
                  input.terminalId,
                  input.name,
                  input.data,
                ),
              };
            }
            // CONTINUATION. The size gate has to run on the file's total size
            // AFTER the append, never on the chunk: a per-chunk check would let
            // an unlimited file through as an unlimited number of legal chunks,
            // which is the whole cap defeated by arithmetic. `appendTerminalFile`
            // returns the on-disk total for exactly this reason, and it is the
            // real size — measured from the filesystem, not accumulated from
            // numbers the client supplied.
            let appended: { path: string; totalBytes: number };
            try {
              appended = appendTerminalFile(
                input.terminalId,
                input.appendTo,
                input.data,
              );
            } catch (cause) {
              throw new ScratchWriteRejected({
                reason: `Upload chunk refused: ${cause instanceof Error ? cause.message : String(cause)}`,
              });
            }
            const reason = rejectionFor(input.name, appended.totalBytes);
            if (reason !== null) {
              // Over the cap mid-stream: drop what landed rather than leaving a
              // half file the agent might read as whole.
              rmSync(appended.path, { force: true });
              throw new ScratchWriteRejected({ reason });
            }
            return { path: appended.path };
          }),
      },

      // Range-capable, serve-dir-shaped byte read — the SAME `readPreview`
      // kolu-server's re-backed preview route calls (one impl, two
      // callers), so the surface procedure and the HTTP bypass are
      // byte-identical. The streaming body is buffered whole to base64 so it
      // rides the procedure wire; the `..`/`%2f`/symlink 403 guard is
      // re-enforced inside `readPreview` by padi's own `previewRealpathGuard`.
      preview: {
        // Straight through — `readPreview` is already an Effect whose ONE
        // declared fault (`PreviewTooLarge`) is typed into its failure channel,
        // so it needs none of `handle`'s throw-sniffing to get there.
        read: ({ input }) => readPreview(input),
        // Resolve a terminal's repoRoot off padi's OWN registry (`snapshotFor`, the
        // source of truth) — the re-serving binder's iframe route turns the URL's
        // terminal id into a repo path with this, then STREAMS the file itself via
        // the shared `previewFile` (bounded heap), so kolu-server never holds the
        // terminal→repoRoot map and never forces a large video whole through base64.
        repoRootForTerminal: ({ input }) =>
          handle(() => ({
            repoRoot: snapshotFor(input.terminalId)?.git?.repoRoot ?? null,
          })),
      },

      transcript: {
        exportHtml: ({ input }) => handle(() => exportTranscriptHtml(input)),
      },

      session: {
        restore: ({ input }) => handle(() => restoreSession(input)),
        import: ({ input }) => handle(() => importSession(input)),
        forfeit: () => handle(() => forfeitSession()),
      },

      // The state-backup ring (#1658) — this padi's own ring, under ITS
      // state-root (a remote host's ring lives on that box; the map client is
      // how a browser reaches it). Failures are undeclared throws — defects
      // surfaced as toasts — because none of them is an expected outcome a
      // client branches on.
      backups: {
        list: () => handle(() => listPadiStateBackups(stateRoot)),
        restore: ({ input }) =>
          handle(() => restorePadiStateBackup(stateRoot, input)),
      },
    },
  };
}
