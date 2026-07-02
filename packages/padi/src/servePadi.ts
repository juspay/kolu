/**
 * `@kolu/padi/servePadi` — the ONE assembler of the `padiSurface` server deps,
 * the padi twin of `@kolu/terminal-workspace/serveTerminalWorkspace`. Built
 * ENTIRELY from padi's own domain modules (relative imports within `@kolu/padi`);
 * it NEVER imports from `packages/server` — the dependency arrow points OUT (a
 * helper that lives only in the server, `previewRealpathGuard`, is REPRODUCED
 * here in `./preview.ts`).
 *
 * `buildPadiSurfaceDeps` returns every read / procedure / source handler
 * `padiSurface` declares, minus `channel` (which kolu-server's shared
 * `implementSurfaces` second-arg supplies, reusing the one publisher).
 * `walkSurface` throws at boot if ANY member lacks deps, so EVERY member is
 * wired here even though W1.R0 has ZERO client consumers of padi — the read
 * (`readAll`/`readOne`/`source`) and procedure handlers are fully FUNCTIONAL at
 * R0; only the reactive WRITE-path (a padi ctx + write-triggers publishing
 * deltas) is deferred to R1+ (dual-serve, single-publish: every live delta the
 * client renders still flows through `koluSurface` + `terminalWorkspace` +
 * `surfaceApp`).
 */

import { unwrapGit } from "@kolu/terminal-workspace/endpoint";
import { fsGitSurfaceDeps } from "@kolu/terminal-workspace/serveFsGit";
import { quietActivity } from "@kolu/terminal-workspace/serveTerminalWorkspace";
import { type ImplementSurfaceDeps, inMemoryStore } from "@kolu/surface/server";
import { composeTerminalMetadata } from "kolu-common/surface";
import type { TerminalEndpoint } from "kolu-common/terminalEndpoint";
import { worktreeCreate, worktreeRemove } from "kolu-git";
import type { Logger } from "pino";
import { readPreview } from "./preview.ts";
import { importSession, restoreSession } from "./sessionRestore.ts";
import {
  DEFAULT_PADI_VERSION,
  type PadiTerminal,
  type padiSurface,
} from "./surface.ts";
import { saveTerminalFile } from "./terminalScratch.ts";
import {
  discardLocalSleeping,
  seedSleepingTerminal,
  wakeLocalTerminal,
} from "./terminalEndpoint/local.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
import {
  getActiveTerminal,
  getTerminal,
  registryMap,
  requireActiveTerminal,
  type TerminalProcess,
  terminalNotFound,
} from "./terminal-registry.ts";
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
import {
  readDaemonStatus,
  readDaemonStatuses,
} from "./ptyHost/daemonStatus.ts";
import { exportTranscriptHtml } from "./transcript.ts";
import { recomputeUrgency, urgencyEqual } from "./urgency.ts";

type PadiDeps = ImplementSurfaceDeps<typeof padiSurface.spec>;

/** Get a terminal (active OR sleeping) or throw the typed not-found fault —
 *  the chrome setters' shared guard, the padi twin of `router.ts`'s
 *  `requireTerminal`. */
function requireTerminal(id: string): TerminalProcess {
  const entry = getTerminal(id);
  if (!entry) throw terminalNotFound(id);
  return entry;
}

/** Assemble the FULL `padiSurface` server deps (minus `channel`). Every member
 *  gets a functional handler; the write-path (ctx + publish) is deferred to
 *  R1+. The `previewRealpathGuard` is padi's own re-creation of the server's
 *  shipped adapter (`./preview.ts`), never imported from `packages/server`. */
export function buildPadiSurfaceDeps(deps: {
  endpoint: TerminalEndpoint;
  log: Logger;
}): Omit<PadiDeps, "channel"> {
  const { endpoint, log } = deps;
  const fsGit = fsGitSurfaceDeps(endpoint, log);

  // In-memory urgency store, seeded from the registry fold. The write-triggers
  // that call `set(recomputeUrgency())` on the agent firehose land in R1 with
  // the padi ctx; `equals` dedups then. Zero consumers at R0.
  let currentUrgency = recomputeUrgency();

  return {
    cells: {
      // Read-only version handshake — same shape as terminalWorkspace's version
      // cell.
      version: { store: inMemoryStore(DEFAULT_PADI_VERSION) },
      urgency: {
        store: {
          get: () => currentUrgency,
          set: (value) => {
            currentUrgency = value;
          },
        },
        equals: urgencyEqual,
      },
    },

    collections: {
      // The composed terminal record — `authored ⋈ snapshot` folded SERVER-side
      // into one record (the client's reader-join collapses to a single read in
      // R1). The registry is the authority, so `upsert`/`remove` are no-ops that
      // fan out to subscribers once R1 wires the publish seam.
      terminals: {
        readAll: () =>
          registryMap<PadiTerminal>((entry) =>
            composeTerminalMetadata(entry.meta, entry.snapshot),
          ),
        readOne: (key) => {
          const entry = getTerminal(key);
          return entry
            ? composeTerminalMetadata(entry.meta, entry.snapshot)
            : undefined;
        },
        upsert: () => {},
        remove: () => {},
      },

      // Per-host kaval status — identical backing to `koluDeps.collections
      // .daemonStatus`; the store is the authority, so upsert/remove are no-ops.
      daemonStatus: {
        readAll: () => readDaemonStatuses(),
        readOne: (key) => readDaemonStatus(key),
        upsert: () => {},
        remove: () => {},
      },
    },

    streams: {
      // QUIET for now — no raw byte tap yet (R9 injects the live source); the
      // fs/git change-pulses are pure reuse of `fsGitSurfaceDeps(...).streams`.
      activity: quietActivity,
      ...fsGit.streams,
      // The per-subscriber terminal byte stream — snapshot-first frame, then
      // live output, with the shipped overflow re-attach (#1591) riding on
      // through `reattachingDeltas`. Routed by the terminal's OWN location so a
      // remote tile's attach reaches its host (R9.2), local today.
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
      // Single-yield-then-close, validating existence at subscribe time — the
      // typed NOT_FOUND lets a stale-session re-subscribe swallow itself.
      // Identical to `koluDeps.events.terminalExit`.
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
          // omits `lastActivityAt` (padi stamps recency with its own clock).
          if (input.parentId !== undefined)
            requireActiveTerminal(input.parentId);
          return createTerminal(input.cwd, input.parentId, {
            themeName: input.themeName,
            canvasLayout: input.canvasLayout,
            subPanel: input.subPanel,
            rightPanel: input.rightPanel,
            intent: input.intent,
          });
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
      },

      chrome: {
        setTheme: ({ input }) => {
          requireTerminal(input.id);
          log.info({ terminal: input.id, theme: input.themeName }, "set theme");
          setTerminalTheme(input.id, input.themeName);
        },
        setIntent: ({ input }) => {
          requireTerminal(input.id);
          log.info(
            { terminal: input.id, intentLength: input.intent.length },
            "set intent",
          );
          setTerminalIntent(input.id, input.intent);
        },
        setParent: ({ input }) => {
          requireTerminal(input.id);
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
          requireTerminal(input.id);
          setCanvasLayout(input.id, input.layout);
        },
        setSubPanel: ({ input }) => {
          requireTerminal(input.id);
          setSubPanelState(input.id, {
            collapsed: input.collapsed,
            panelSize: input.panelSize,
          });
        },
        setRightPanel: ({ input }) => {
          requireTerminal(input.id);
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
        readFile: ({ input }) =>
          endpoint.fs.readFile(input.repoPath, input.filePath),
        statFileMtimeMs: ({ input }) =>
          endpoint.fs.statFileMtimeMs(input.repoPath, input.filePath),
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
        write: ({ input }) => ({
          path: saveTerminalFile(input.terminalId, input.name, input.data),
        }),
      },

      // Range-capable, serve-dir-shaped byte read — the SAME `readPreview`
      // kolu-server's re-backed Hono preview route calls (one impl, two
      // callers), so the surface procedure and the HTTP bypass are
      // byte-identical. The streaming body is buffered whole to base64 so it
      // rides the procedure wire; the `..`/`%2f`/symlink 403 guard is
      // re-enforced inside `readPreview` by padi's own `previewRealpathGuard`.
      preview: {
        read: ({ input }) => readPreview(input),
      },

      transcript: {
        exportHtml: ({ input }) => exportTranscriptHtml(input),
      },

      session: {
        restore: ({ input }) => restoreSession(input),
        import: ({ input }) => importSession(input),
      },
    },
  };
}
