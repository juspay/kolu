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

import { isContractSkewError } from "@kolu/surface-daemon-supervisor";
import { derived, everyMsOr, source } from "@kolu/surface/reactor";
import { type ImplementSurfaceDeps, inMemoryStore } from "@kolu/surface/server";
import { unwrapGit } from "./terminalWorkspace/endpoint.ts";
import { ORPCError } from "@orpc/server";
import type { DaemonLifetimeInfo } from "@kolu/surface-daemon";
import {
  currentPtyHostIdentity,
  DEFAULT_MIRROR_SCROLLBACK,
  SNAPSHOT_SCROLLBACK,
} from "kaval";
import { DEFAULT_SCROLLBACK } from "@kolu/terminal-vocab/schema";
import { isFileGoneError, worktreeCreate, worktreeRemove } from "kolu-git";
import type { Logger } from "pino";
import { cancelPendingAutosave } from "./session/autosaveGate.ts";
import {
  requirePadiActivityFeedStore,
  requirePadiSessionStore,
} from "./session/confStores.ts";
import type { TerminalEndpoint } from "./endpoint.ts";
import { padiFsGitDeps } from "./fsGitDeps.ts";
import { createFinishQuiet, type FinishQuiet } from "./activity/finishQuiet.ts";
import { createLiveActivitySource } from "./activity/liveActivity.ts";
import { readPreview } from "./preview.ts";
import {
  onDaemonStatusChange,
  readDaemonStatus,
  readDaemonStatuses,
} from "./ptyHost/daemonStatus.ts";
import { restartLocalDaemon } from "./ptyHost/restartLocal.ts";
import { resumableTerminalIds } from "./session/resumable.ts";
import {
  forfeitSession,
  importSession,
  restoreSession,
} from "./session/sessionRestore.ts";
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
import {
  HOST_INVENTORY_SAMPLE_INTERVAL_MS,
  samplePadiHostInventory,
} from "./hostInventory.ts";
import {
  MEMORY_SAMPLE_INTERVAL_MS,
  samplePadiMemory,
} from "./memorySampler.ts";
import { composePadiTerminal } from "./terminalEndpoint/metadata.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
import { saveTerminalFile } from "./terminalScratch.ts";
import {
  createTerminal,
  killAllTerminals,
  killTerminal,
  setActiveTerminalId,
  setCanvasLayout,
  setNewTerminalPolicy,
  setRightPanelState,
  setSubPanelState,
  setTerminalIntent,
  setTerminalParent,
  setTerminalTheme,
  sleepTerminal,
} from "./terminals.ts";
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

/** Prior standing finish-quiet handle — disposed when deps are rebuilt (tests). */
let standingFinishQuiet: FinishQuiet | undefined;
function disposeStandingFinishQuiet(): void {
  standingFinishQuiet?.dispose();
  standingFinishQuiet = undefined;
}

/** Map a "the file is gone" filesystem error (a raw node `ENOENT`, however the
 *  endpoint surfaces it) to a TYPED `NOT_FOUND` the client can recognize across
 *  the wire; re-throw anything else untouched. A missing file genuinely IS a
 *  not-found, and typing it lets a delete-while-viewing be swallowed at the
 *  consumer instead of masking to a generic error panel. */
function fileGoneAsNotFound(e: unknown, filePath: string): unknown {
  return isFileGoneError(e)
    ? new ORPCError("NOT_FOUND", { message: `File not found: ${filePath}` })
    : e;
}

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
  // EF2 — daemon-lifetime finish tracker + standing kaval activity sub. Dual-edge
  // with terminals via `finish.project` (quiet-exit re-folds without an
  // agent-state change). Dispose any prior handle so servePadi test rebuilds
  // don't stack resubscribe loops.
  disposeStandingFinishQuiet();
  const finish = createFinishQuiet({ log });
  standingFinishQuiet = finish;

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
  const status: PadiStatus = {
    expectedKaval: identity.staleKey ? identity : undefined,
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
          read: () => samplePadiHostInventory(stateRoot),
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
          read: samplePadiMemory,
          install: everyMsOr(MEMORY_SAMPLE_INTERVAL_MS, onDaemonStatusChange),
        }),
      ),
      // A DERIVED member — finish.project owns track + enter/leave-waiting sync +
      // pure recomputeUrgency so call sites cannot drift. Dual-edged on terminals
      // and the finish generation (quiet-exit promote re-folds without an
      // agent-state change). Spec `equals` (`urgencyEqual`) is the ONE wire
      // dedup point. No `store`/`equals` here — the graph is the one writer.
      urgency: derived.cell(($) => finish.project($.terminals())),
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
            v.resumableIds = resumableTerminalIds(v.terminals);
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
      ...fsGit.streams,
      // The per-subscriber terminal byte stream — snapshot-first frame, then
      // live output, with the shipped overflow re-attach (#1591) riding on
      // through `reattachingDeltas`. Routed by the terminal's OWN location so a
      // remote tile's attach reaches its host (a remote endpoint arrives with the
      // cross-host work); local today.
      terminalAttach: {
        source: async function* ({ id, resizeTo }, signal) {
          const entry = requireActiveTerminal(id);
          // The caller's grid rides through to the host verbatim — it arrives as
          // one composite, so there is nothing to validate or reassemble here.
          // Note this makes the attach a WRITE: the host resizes the terminal to
          // it before serializing (see `PadiTerminalAttachInputSchema`).
          const { snapshot, topLine, reflowEpoch, deltas } =
            await resolveTerminalEndpoint(entry.meta.location).attach(
              id,
              signal,
              resizeTo,
            );
          // First frame is a `snapshot` carrying the backfill seed (`topLine`)
          // and the reflow generation (`reflowEpoch`) alongside the snapshot
          // bytes; delta frames carry `data` only, except a re-attach frame which
          // is itself a `snapshot` (see `reattachingDeltas`).
          yield { kind: "snapshot", data: snapshot, topLine, reflowEpoch };
          for await (const frame of deltas) yield frame;
        },
      },
    },

    events: {
      // Terminal process exited — single-yield-then-close, validating existence
      // at subscribe time so a stale-session re-subscribe swallows the typed
      // NOT_FOUND. The SOLE `terminalExit` generator now: koluSurface's duplicate
      // copy was deleted (W1 padi seam), so `local.ts`'s exit publish targets
      // padi's ctx and the client reads `padi.events.terminalExit`.
      terminalExit: {
        source: async function* (input, signal, { bus }) {
          if (!getTerminal(input.id)) throw terminalNotFound(input.id);
          for await (const exitCode of bus.subscribe(signal)) {
            yield exitCode;
            return;
          }
        },
      },
    },

    procedures: {
      lifecycle: {
        create: ({ input }) => {
          // A sub-terminal must hang off a LIVE parent (F3) — the same
          // live-PTY narrow every per-terminal handler uses. `PadiCreateInput`
          // omits `lastActivityAt`: a fresh terminal seeds `lastActivityAt: 0`
          // (via `createAuthoredActive` → `seedMemory`), and the fold stamps recency
          // later — the client can't supply it. (Only `session.restore` threads a
          // saved `lastActivityAt` through, via `respawnActive`, not this path.)
          if (input.parentId !== undefined)
            requireActiveTerminal(input.parentId);

          // `themeName` is a caller OVERRIDE only — `createTerminal` applies the
          // new-terminal policy for every caller, wire or in-process (#2045).
          const info = createTerminal(input.cwd, input.parentId, {
            themeName: input.themeName,
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
        },
        kill: async ({ input }) => {
          const info = await killTerminal(input.id);
          if (!info) throw terminalNotFound(input.id);
          return info;
        },
        killAll: async () => {
          await killAllTerminals();
        },
        sleep: async ({ input }) => {
          log.info({ terminal: input.id }, "sleep");
          await sleepTerminal(input.id);
        },
        wake: ({ input }) => {
          log.info({ terminal: input.id }, "wake");
          const info = wakeLocalTerminal(input.id);
          if (!info) throw terminalNotFound(input.id);
          return info;
        },
        discardSleeping: ({ input }) => {
          log.info({ terminal: input.id }, "discard sleeping");
          discardLocalSleeping(input.id);
        },
        // Fire-and-forget stream ops: a resize/keystroke landing just after a
        // kill is an EXPECTED race, so quiet-drop via `getActiveTerminal`
        // (#1628) rather than throwing NOT_FOUND.
        // AWAITED, unlike `sendInput` below: the quiet-drop on a killed terminal
        // stays (that race is expected), but once a live terminal HAS been
        // found, whether the host accepted the new grid is the caller's business
        // — a client told "resized" while the PTY kept its old size would render
        // against a size nothing has, silently.
        resize: async ({ input }) => {
          await getActiveTerminal(input.id)?.handle.resize(
            input.cols,
            input.rows,
          );
        },
        sendInput: ({ input }) => {
          getActiveTerminal(input.id)?.handle.write(input.data);
        },
        // The "Restart kaval" button — force-recycle THIS host's kaval daemon,
        // preserving the session (B3.2). padi's INTERNAL supervisory op: capture →
        // drain → recycle (kill + spawn fresh) → park, all via `restartLocalDaemon`
        // (the soul) through the endpoint's coalescing emit-guard. PADI STAYS UP —
        // this is the `adopt-or-ensure` recycle arm, never a padi restart (that is
        // the separate `control.drain` upgrade path). Resolves once the fresh kaval
        // is connected; a failure rejects with the captured session safe on disk.
        recycleKaval: async ({ errors }) => {
          log.info({}, "recycle kaval (Restart kaval)");
          try {
            await restartLocalDaemon();
          } catch (err) {
            const skew = isContractSkewError(err);
            // A failed restart otherwise surfaces ONLY as a client toast — padi's
            // journal would show the "recycle kaval" start line and then an
            // unexplained silence. Surface it: the endpoint has already reported
            // its terminal state and the captured session is safe on disk (the
            // user can retry or restore), but the failure must be legible in the
            // journal — naming the ACTUAL state (skew → `incompatible`).
            log.error(
              { err },
              skew
                ? "recycle kaval (Restart kaval) failed — endpoint reported incompatible (contract skew); captured session is safe on disk"
                : "recycle kaval (Restart kaval) failed — endpoint reported dead/degraded; captured session is safe on disk",
            );
            // A contract skew is the ONE failure this handler can translate — it
            // is the knowing endpoint (the `fileGoneAsNotFound` precedent): a
            // plain rethrow would be flattened to INTERNAL_SERVER_ERROR by oRPC
            // and the user would read an opaque toast (the field failure,
            // bug-remote-kaval-contract-skew defect A). Refuse via the DECLARED
            // error constructor (SK6) — versions as typed data, `defined: true`
            // on the wire — one recycle attempt was the diagnosis; padi is not
            // the actor that can fix a skew (only the binder's reprovision is).
            if (isContractSkewError(err)) {
              throw errors.KAVAL_CONTRACT_SKEW({
                message: err.message,
                data: {
                  daemonVersion: err.daemonVersion,
                  requiredVersion: err.requiredVersion,
                },
              });
            }
            throw err;
          }
        },
      },

      chrome: {
        setTheme: ({ input }) => {
          requireMutableTerminal(input.id);
          log.info({ terminal: input.id, theme: input.themeName }, "set theme");
          setTerminalTheme(input.id, input.themeName);
        },
        setIntent: ({ input }) => {
          requireMutableTerminal(input.id);
          log.info(
            { terminal: input.id, intentLength: input.intent.length },
            "set intent",
          );
          setTerminalIntent(input.id, input.intent);
        },
        setParent: ({ input }) => {
          requireMutableTerminal(input.id);
          log.info(
            { terminal: input.id, parent: input.parentId },
            "set terminal parent",
          );
          setTerminalParent(input.id, input.parentId);
        },
        setActive: ({ input }) => {
          setActiveTerminalId(input.id);
        },
        setNewTerminalPolicy: ({ input }) => {
          setNewTerminalPolicy(input);
        },
        setCanvasLayout: ({ input }) => {
          requireMutableTerminal(input.id);
          setCanvasLayout(input.id, input.layout);
        },
        setSubPanel: ({ input }) => {
          requireMutableTerminal(input.id);
          setSubPanelState(input.id, {
            collapsed: input.collapsed,
            panelSize: input.panelSize,
          });
        },
        setRightPanel: ({ input }) => {
          requireMutableTerminal(input.id);
          const { id: _id, ...state } = input;
          setRightPanelState(input.id, state);
        },
      },

      screen: {
        state: ({ input }) =>
          requireActiveTerminal(input.id).handle.getScreenState(),
        text: ({ input }) =>
          requireActiveTerminal(input.id).handle.getScreenText(
            input.startLine,
            input.endLine,
          ),
        history: ({ input }) =>
          requireActiveTerminal(input.id).handle.getHistory(
            input.before,
            input.max,
            input.epoch,
          ),
      },

      // fs reads off the SAME shared endpoint `serveFsGit` wraps (its procedure
      // objects carry terminalWorkspace's ctx type, which padi's ctx can't
      // satisfy, so declare the handlers here against padi's ctx — the endpoint
      // methods are the reused source of truth). `readFile` is TEXT-only (binary
      // goes through `preview.read`).
      fs: {
        listAll: ({ input }) => endpoint.fs.listAll(input.repoPath),
        listIgnored: ({ input }) => endpoint.fs.listIgnored(input.repoPath),
        // A file deleted while the Code tab is viewing it must surface as a
        // TYPED `NOT_FOUND`, not a raw ENOENT that masks to a generic error on
        // the wire: `BrowseFileDispatcher` swallows `NOT_FOUND` (delete-while-
        // viewing) to match the old value stream, which simply stopped yielding.
        readFile: async ({ input }) => {
          try {
            return await endpoint.fs.readFile(input.repoPath, input.filePath);
          } catch (e) {
            throw fileGoneAsNotFound(e, input.filePath);
          }
        },
        filePreviewTag: async ({ input, signal }) => {
          try {
            // Thread the request `signal` so a superseded preview query (input
            // changed, or a fresh file-change pulse re-fired) aborts the whole-
            // file hash mid-read instead of running to completion — the cost is
            // real on a multi-GB video where the read runs for seconds.
            return await endpoint.fs.filePreviewTag(
              input.repoPath,
              input.filePath,
              signal,
            );
          } catch (e) {
            throw fileGoneAsNotFound(e, input.filePath);
          }
        },
      },

      // git reads off the same shared endpoint; the worktree MUTATIONS are
      // padi's own (not in serveFsGit), composed beside the reads.
      git: {
        getStatus: ({ input }) =>
          endpoint.git.getStatus(input.repoPath, input.mode),
        getDiff: ({ input }) =>
          endpoint.git.getDiff(
            input.repoPath,
            input.filePath,
            input.mode,
            input.oldPath,
          ),
        worktreeCreate: async ({ input }) => {
          log.info(
            { repo: input.repoPath, name: input.name },
            "worktree create",
          );
          const result = unwrapGit(
            await worktreeCreate(input.repoPath, input.name, log),
          );
          log.info(
            { repo: input.repoPath, path: result.path, branch: result.branch },
            "worktree created",
          );
          return result;
        },
        worktreeRemove: async ({ input }) => {
          log.info({ worktree: input.worktreePath }, "worktree remove");
          unwrapGit(await worktreeRemove(input.worktreePath, log));
        },
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
        write: ({ input }) => {
          requireActiveTerminal(input.terminalId);
          const bytes = base64DecodedLength(input.data);
          const reason = rejectionFor(input.name, bytes);
          if (reason !== null) {
            throw new ORPCError("BAD_REQUEST", { message: reason });
          }
          return {
            path: saveTerminalFile(input.terminalId, input.name, input.data),
          };
        },
      },

      // Range-capable, serve-dir-shaped byte read — the SAME `readPreview`
      // kolu-server's re-backed Hono preview route calls (one impl, two
      // callers), so the surface procedure and the HTTP bypass are
      // byte-identical. The streaming body is buffered whole to base64 so it
      // rides the procedure wire; the `..`/`%2f`/symlink 403 guard is
      // re-enforced inside `readPreview` by padi's own `previewRealpathGuard`.
      preview: {
        read: ({ input }) => readPreview(input),
        // Resolve a terminal's repoRoot off padi's OWN registry (`snapshotFor`, the
        // source of truth) — the re-serving binder's iframe route turns the URL's
        // terminal id into a repo path with this, then STREAMS the file itself via
        // the shared `previewFile` (bounded heap), so kolu-server never holds the
        // terminal→repoRoot map and never forces a large video whole through base64.
        repoRootForTerminal: ({ input }) => ({
          repoRoot: snapshotFor(input.terminalId)?.git?.repoRoot ?? null,
        }),
      },

      transcript: {
        exportHtml: ({ input }) => exportTranscriptHtml(input),
      },

      session: {
        restore: ({ input }) => restoreSession(input),
        import: ({ input }) => importSession(input),
        forfeit: () => forfeitSession(),
      },
    },
  };
}
