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

import { type ImplementSurfaceDeps, inMemoryStore } from "@kolu/surface/server";
import { unwrapGit } from "./terminalWorkspace/endpoint.ts";
import { ORPCError } from "@orpc/server";
import { currentPtyHostIdentity } from "kaval";
import { isFileGoneError, worktreeCreate, worktreeRemove } from "kolu-git";
import type { Logger } from "pino";
import { cancelPendingAutosave } from "./autosaveGate.ts";
import {
  requirePadiActivityFeedStore,
  requirePadiSessionStore,
} from "./confStores.ts";
import type { TerminalEndpoint } from "./endpoint.ts";
import { padiFsGitDeps } from "./fsGitDeps.ts";
import { createLiveActivitySource } from "./liveActivity.ts";
import { readPreview } from "./preview.ts";
import {
  readDaemonStatus,
  readDaemonStatuses,
} from "./ptyHost/daemonStatus.ts";
import { restartLocalDaemon } from "./ptyHost/restartLocal.ts";
import {
  forfeitSession,
  importSession,
  restoreSession,
} from "./sessionRestore.ts";
import {
  DEFAULT_PADI_HOST_INVENTORY,
  DEFAULT_PADI_PROCESS_MEMORY,
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
  seedSleepingTerminal,
  wakeLocalTerminal,
} from "./terminalEndpoint/local.ts";
import { composePadiTerminal } from "./terminalEndpoint/metadata.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
import { saveTerminalFile } from "./terminalScratch.ts";
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
import { exportTranscriptHtml } from "./transcript.ts";
import { base64DecodedLength, rejectionFor } from "./upload.ts";
import { recomputeUrgency, urgencyEqual } from "./urgency.ts";

type PadiDeps = ImplementSurfaceDeps<typeof padiSurface.spec>;

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
}): Omit<PadiDeps, "channel"> {
  const { endpoint, log, startedAt, commit } = deps;
  const fsGit = padiFsGitDeps(endpoint, log);

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
      // leak diagnostic. In-memory (a live diagnostic has no on-disk slot); the
      // periodic host-inventory sampler (`hostInventory.ts`, wired into daemon boot)
      // is the sole writer via `padiSurfaceCtx.cells.hostInventory.set`; a fresh
      // subscription reads the latest via `get`. No `equals` dedup: the coarse 10s
      // cadence + small payload is cheap.
      hostInventory: { store: inMemoryStore(DEFAULT_PADI_HOST_INVENTORY) },
      // Live process-memory readout (padi's OWN RSS + its kaval's). In-memory —
      // a live metric has no on-disk slot. The periodic sampler
      // (`memorySampler.ts`, wired into daemon boot) is the sole writer via
      // `padiSurfaceCtx.cells.processMemory.set`; a fresh subscription reads the
      // latest via `get`. No `equals` dedup: the 5s cadence + small payload is
      // cheap, and padi can't reuse kolu-common's whole-MB helper across the seal.
      processMemory: { store: inMemoryStore(DEFAULT_PADI_PROCESS_MEMORY) },
      // In-memory urgency store, seeded from the registry fold. The metadata seam
      // (`terminalEndpoint/metadata.ts`) re-folds `.set(recomputeUrgency())` on the
      // agent firehose through the padi ctx; `equals` dedups the redundant fires.
      urgency: {
        store: inMemoryStore(recomputeUrgency()),
        equals: urgencyEqual,
      },
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
            return s && s.terminals.length > 0 ? s : null;
          },
          set: (v) => requirePadiSessionStore().set(v),
        },
        equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
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
      // LIVE (W2.3) — the set of terminals producing output right now, tapped from
      // kaval's per-terminal byte deltas. Deferred out of W2.2 as a producer with
      // no consumer; lit here with its FIRST consumer, `padi-tui watch`/`status`,
      // per the self-sufficiency rule. LAZY: byte taps open only while this stream
      // has a subscriber (see `createLiveActivitySource`), so an unwatched padi
      // pays nothing. The client's per-tile green dot is unchanged — it derives
      // from its OWN `terminalAttach` bytes, never this member. The fs/git
      // change-pulses are pure reuse of `padiFsGitDeps(...).streams`.
      activity: createLiveActivitySource(log),
      ...fsGit.streams,
      // The per-subscriber terminal byte stream — snapshot-first frame, then
      // live output, with the shipped overflow re-attach (#1591) riding on
      // through `reattachingDeltas`. Routed by the terminal's OWN location so a
      // remote tile's attach reaches its host (a remote endpoint arrives with the
      // cross-host work); local today.
      terminalAttach: {
        source: async function* ({ id }, signal) {
          const entry = requireActiveTerminal(id);
          const { snapshot, deltas } = await resolveTerminalEndpoint(
            entry.meta.location,
          ).attach(id, signal);
          yield snapshot;
          for await (const data of deltas) yield data;
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
        restoreSleeping: ({ input }) => {
          seedSleepingTerminal(input);
        },
        // Fire-and-forget stream ops: a resize/keystroke landing just after a
        // kill is an EXPECTED race, so quiet-drop via `getActiveTerminal`
        // (#1628) rather than throwing NOT_FOUND.
        resize: ({ input }) => {
          getActiveTerminal(input.id)?.handle.resize(input.cols, input.rows);
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
        recycleKaval: async () => {
          log.info({}, "recycle kaval (Restart kaval)");
          try {
            await restartLocalDaemon();
          } catch (err) {
            // A failed restart otherwise surfaces ONLY as a client toast — padi's
            // journal would show the "recycle kaval" start line and then an
            // unexplained silence. Surface it: the endpoint has already reported
            // dead/degraded and the captured session is safe on disk (the user can
            // retry or restore), but the failure must be legible in the journal.
            log.error(
              { err },
              "recycle kaval (Restart kaval) failed — endpoint reported dead/degraded; captured session is safe on disk",
            );
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
      },

      // fs reads off the SAME shared endpoint `serveFsGit` wraps (its procedure
      // objects carry terminalWorkspace's ctx type, which padi's ctx can't
      // satisfy, so declare the handlers here against padi's ctx — the endpoint
      // methods are the reused source of truth). `readFile` is TEXT-only (binary
      // goes through `preview.read`).
      fs: {
        listAll: ({ input }) => endpoint.fs.listAll(input.repoPath),
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
        // and run `rejectionFor` (extension allowlist + 10 MB cap). "image.png"
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
