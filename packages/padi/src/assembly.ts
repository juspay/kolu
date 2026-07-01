/**
 * `@kolu/padi/assembly` — the NODE-ONLY in-process assembly of `padiSurface`.
 * kolu-server imports {@link padiInProcessDeps} and plugs the result into its
 * `implementSurfaces(...)` call so `padiSurface` serves BESIDE `koluSurface`,
 * COMPLETE and fail-fast (every member backed, none stubbed).
 *
 * W1.1 keeps the member BACKINGS in `packages/server` and injects them as
 * {@link PadiBackings} — the seam W1.2–W1.8 progressively internalize by moving
 * each backing's code into this package. The padi-DOMAIN logic already lives
 * here: the `authored ⋈ snapshot` compose for `terminals`, the recency-free
 * `urgency` fold, the byte-preview read (with the `..`/`%2f`/symlink guards),
 * and the host-side `session.restore`/`import` composition. The fs/git watcher
 * streams reuse `@kolu/terminal-workspace`'s `fsGitSurfaceDeps`; `activity`
 * reuses its honest `quietActivity` (no raw byte tap in-process yet).
 *
 * The read backings are real (registry projections, the urgency fold); the
 * collection/cell WRITES are no-ops — the registry is the authority, exactly as
 * `koluSurface`'s `authored`/`daemonStatus` collections already are. Live deltas
 * to a warm client wire in a later W1.x PR when a consumer first exists; W1.1
 * has ZERO consumers, so a correct snapshot on subscribe is the whole contract.
 */

import { contentTypeForPath, resolvePathUnder } from "@kolu/serve-dir";
import type { ImplementSurfaceDeps, SurfaceCtx } from "@kolu/surface/server";
import { inMemoryStore } from "@kolu/surface/server";
import { unwrapGit } from "@kolu/terminal-workspace/endpoint";
import type { TerminalWorkspaceEndpoint } from "@kolu/terminal-workspace/endpoint";
import { fsGitSurfaceDeps } from "@kolu/terminal-workspace/serveFsGit";
import { quietActivity } from "@kolu/terminal-workspace/serveTerminalWorkspace";
import { ORPCError } from "@orpc/server";
import { assertRealpathUnder, worktreeCreate, worktreeRemove } from "kolu-git";
import { resumeFormFor } from "anyagent/cli";
import {
  agentBucket,
  type AuthoredTerminal,
  type CanvasLayout,
  composeTerminalMetadata,
  type DaemonStatus,
  type RestoreTarget,
  type RightPanelPerTerminalState,
  type SavedSession,
  type SavedSleepingTerminal,
  type TerminalId,
  type TerminalInfo,
  type TerminalSnapshot,
} from "kolu-common/surface";
import type {
  ExportTranscriptHtmlOutput,
  TranscriptHtmlMode,
} from "kolu-common/transcript";
import { readFile, stat } from "node:fs/promises";
import type { Logger } from "pino";
import {
  DEFAULT_PADI_VERSION,
  type PadiSurfaceSpec,
  type PadiTerminal,
  type PadiUrgency,
} from "./surface.ts";

/** One registry entry's two halves — the AUTHORED record and the OBSERVED
 *  snapshot, joined by `composeTerminalMetadata`. The raw shape kolu-server's
 *  registry exposes; the assembly owns the compose. */
export interface PadiRegistryEntry {
  meta: AuthoredTerminal;
  snapshot: TerminalSnapshot;
}

/** The host operations `padiSurface`'s members delegate to. W1.1 injects these
 *  from `packages/server` (they mirror today's `terminal.*` root-oRPC handlers);
 *  W1.2–W1.8 move each backing's code into `@kolu/padi`. Each op preserves its
 *  current handler's behaviour (existence checks, quiet drops, logging) so the
 *  UX stays byte-identical. */
export interface PadiBackings {
  log: Logger;
  /** The fs/git face (`createTerminalWorkspaceEndpoint`) for reads + watchers. */
  endpoint: TerminalWorkspaceEndpoint;

  // ── registry projections (raw halves; the assembly composes) ──
  readRegistry(): Map<TerminalId, PadiRegistryEntry>;
  readRegistryEntry(id: TerminalId): PadiRegistryEntry | undefined;
  readDaemonStatuses(): Map<string, DaemonStatus>;
  readDaemonStatus(id: string): DaemonStatus | undefined;

  // ── lifecycle ──
  createTerminal(input: {
    cwd?: string;
    parentId?: TerminalId;
    themeName?: string;
    canvasLayout?: CanvasLayout;
    subPanel?: { collapsed: boolean; panelSize: number };
    rightPanel?: RightPanelPerTerminalState;
    intent?: string;
  }): TerminalInfo;
  killTerminal(id: TerminalId): Promise<TerminalInfo>;
  killAllTerminals(): Promise<void>;
  sleepTerminal(id: TerminalId): Promise<void>;
  wakeTerminal(id: TerminalId): TerminalInfo;
  discardSleeping(id: TerminalId): void;
  restoreSleeping(record: SavedSleepingTerminal): void;
  /** Quiet-drop resize (a resize can race a kill — an expected drop, not a fault). */
  resize(id: TerminalId, cols: number, rows: number): void;
  /** Quiet-drop input (a late keystroke can land just after a kill). */
  sendInput(id: TerminalId, data: string): void;

  // ── chrome ──
  setTheme(id: TerminalId, themeName: string): void;
  setIntent(id: TerminalId, intent: string): void;
  setParent(id: TerminalId, parentId: TerminalId | null): void;
  setActive(id: TerminalId | null): void;
  setCanvasLayout(id: TerminalId, layout: CanvasLayout): void;
  setSubPanel(
    id: TerminalId,
    state: { collapsed: boolean; panelSize: number },
  ): void;
  setRightPanel(id: TerminalId, state: RightPanelPerTerminalState): void;

  // ── screen + attach + exit ──
  screenState(id: TerminalId): Promise<string>;
  screenText(
    id: TerminalId,
    startLine?: number,
    endLine?: number,
  ): Promise<string>;
  attach(
    id: TerminalId,
    signal: AbortSignal | undefined,
  ): Promise<{ snapshot: string; deltas: AsyncIterable<string> }>;
  /** Throw the typed NOT_FOUND if the terminal is absent — the exit event's
   *  subscribe-time existence check (matches today's `terminalExit` source). */
  assertTerminalExists(id: TerminalId): void;

  // ── bytes ──
  /** Write base64 bytes into the terminal's scratch dir; returns the path. */
  saveTerminalFile(id: TerminalId, name: string, dataBase64: string): string;

  // ── transcript ──
  exportTranscriptHtml(
    id: string,
    mode: TranscriptHtmlMode,
  ): Promise<ExportTranscriptHtmlOutput>;

  // ── session ──
  getSavedSession(): SavedSession | null;
  setSavedSession(session: SavedSession): void;
}

type PadiDeps = Omit<ImplementSurfaceDeps<PadiSurfaceSpec>, "channel">;
type PadiCtx = SurfaceCtx<PadiSurfaceSpec>;

/** Compose the full `terminals` snapshot — every registry entry's two halves
 *  joined. `composeTerminalMetadata` returns the `active`/`sleeping` arms; both
 *  widen to {@link PadiTerminal} (the `host` axis is optional, `parked` reserved). */
function composeAllTerminals(
  backings: PadiBackings,
): Map<TerminalId, PadiTerminal> {
  const out = new Map<TerminalId, PadiTerminal>();
  for (const [id, entry] of backings.readRegistry()) {
    out.set(id, composeTerminalMetadata(entry.meta, entry.snapshot));
  }
  return out;
}

/** The recency-free urgency fold: which ACTIVE terminals await the user. Only
 *  the live (active) arm carries a live agent; `agentBucket("awaiting_user")` is
 *  the "awaiting" bucket. Recency is deliberately absent (nothing cross-host
 *  compares clocks). */
function computeUrgency(backings: PadiBackings): PadiUrgency {
  const awaitingIds: TerminalId[] = [];
  for (const [id, entry] of backings.readRegistry()) {
    if (entry.meta.state !== "active") continue;
    const agent = entry.snapshot.agent;
    if (agent && agentBucket(agent.state) === "awaiting") awaitingIds.push(id);
  }
  return { awaiting: awaitingIds.length, awaitingIds };
}

/** Map a serve-dir lexical-guard status to a typed oRPC error code — the
 *  `..`/`%2f`/absolute-segment rejections the preview route enforces (403s in
 *  the note), re-enforced here. */
function previewGuardError(
  status: 400 | 403 | 404,
  reason: string,
): ORPCError<string, unknown> {
  const code =
    status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : "BAD_REQUEST";
  return new ORPCError(code, { message: `preview: ${reason}` });
}

/** Restore a saved session host-side (the seed of W1.7's client-loop deletion):
 *  seed sleeping records, spawn active ones, resume the opted-in agents. The
 *  UI-coupling (canvas pan, MRU, active-tile protocol) stays client-side — this
 *  is only the terminal side. Zero consumers in W1.1; a real composition, not a
 *  stub. */
function restoreSavedSession(
  backings: PadiBackings,
  session: SavedSession,
  resumeIds: ReadonlySet<string> | undefined,
): void {
  const oldToNew = new Map<string, TerminalId>();
  const resumeIfOptedIn = (
    savedId: string,
    newId: TerminalId,
    target: RestoreTarget | undefined,
  ) => {
    const optedIn = !resumeIds || resumeIds.has(savedId);
    const form = optedIn ? resumeFormFor(target) : null;
    if (form) backings.sendInput(newId, `${form}\r`);
  };
  // Pass 1 — top-level records (no parent): seed sleeping, spawn active.
  for (const t of session.terminals) {
    if (t.parentId !== undefined) continue;
    if (t.state === "sleeping") {
      backings.restoreSleeping(t);
      oldToNew.set(t.id, t.id as TerminalId);
      continue;
    }
    const info = backings.createTerminal({
      cwd: t.cwd,
      themeName: t.themeName,
      canvasLayout: t.canvasLayout,
      subPanel: t.subPanel,
      rightPanel: t.rightPanel,
      intent: t.intent,
    });
    oldToNew.set(t.id, info.id);
    resumeIfOptedIn(t.id, info.id, t.restoreTarget);
  }
  // Pass 2 — sub-terminals: spawn under the (remapped) parent.
  for (const t of session.terminals) {
    if (t.parentId === undefined || t.state !== "active") continue;
    const newParentId = oldToNew.get(t.parentId);
    if (newParentId === undefined) continue;
    const info = backings.createTerminal({
      cwd: t.cwd,
      parentId: newParentId,
      themeName: t.themeName,
      canvasLayout: t.canvasLayout,
      subPanel: t.subPanel,
      rightPanel: t.rightPanel,
      intent: t.intent,
    });
    oldToNew.set(t.id, info.id);
    resumeIfOptedIn(t.id, info.id, t.restoreTarget);
  }
}

/** Build the `padiSurface` server deps (minus `channel`, which kolu-server's
 *  `implementSurfaces` base supplies). Fail-fast complete: every declared member
 *  has a real dep, so `implementSurface` never throws a missing-dep error. */
export function padiInProcessDeps(backings: PadiBackings): PadiDeps {
  const fsGit = fsGitSurfaceDeps(backings.endpoint, backings.log);
  return {
    cells: {
      version: { store: inMemoryStore(DEFAULT_PADI_VERSION) },
      // Computed on read (the registry is the source): a fresh subscriber gets
      // the current fold. Read-only (`verbs: ["get"]`); no client writer.
      urgency: {
        store: { get: () => computeUrgency(backings), set: () => {} },
      },
    },
    collections: {
      // Real read backing (the composed registry); no-op writes (the registry is
      // the authority, exactly as `koluSurface.authored`/`daemonStatus`).
      terminals: {
        readAll: () => composeAllTerminals(backings),
        readOne: (key) => {
          const entry = backings.readRegistryEntry(key as TerminalId);
          return entry
            ? composeTerminalMetadata(entry.meta, entry.snapshot)
            : undefined;
        },
        upsert: () => {},
        remove: () => {},
      },
      daemonStatus: {
        readAll: () => backings.readDaemonStatuses(),
        readOne: (key) => backings.readDaemonStatus(key as string),
        upsert: () => {},
        remove: () => {},
      },
    },
    streams: {
      // No raw byte tap in-process yet (R9 makes it live): the honest empty set.
      activity: quietActivity,
      subscribeRepoChange: fsGit.streams.subscribeRepoChange,
      subscribeFileChange: fsGit.streams.subscribeFileChange,
      terminalAttach: {
        source: async function* ({ id }, signal) {
          const { snapshot, deltas } = await backings.attach(id, signal);
          yield snapshot;
          for await (const data of deltas) yield data;
        },
      },
    },
    events: {
      terminalExit: {
        // Single-yield-then-close, validating existence at subscribe time (the
        // same shape as today's `terminalExit`). The publish side wires when a
        // consumer first exists (W1.4); W1.1 serves the source, zero consumers.
        source: async function* ({ id }, signal, { bus }) {
          backings.assertTerminalExists(id);
          for await (const exitCode of bus.subscribe(signal)) {
            yield exitCode;
            return;
          }
        },
      },
    },
    procedures: {
      lifecycle: {
        create: ({ input }) => backings.createTerminal(input),
        kill: ({ input }) => backings.killTerminal(input.id),
        killAll: () => backings.killAllTerminals(),
        sleep: ({ input }) => backings.sleepTerminal(input.id),
        wake: ({ input }) => backings.wakeTerminal(input.id),
        discardSleeping: ({ input }) => backings.discardSleeping(input.id),
        restoreSleeping: ({ input }) => backings.restoreSleeping(input),
        resize: ({ input }) =>
          backings.resize(input.id, input.cols, input.rows),
        sendInput: ({ input }) => backings.sendInput(input.id, input.data),
      },
      chrome: {
        setTheme: ({ input }) => backings.setTheme(input.id, input.themeName),
        setIntent: ({ input }) => backings.setIntent(input.id, input.intent),
        setParent: ({ input }) => backings.setParent(input.id, input.parentId),
        setActive: ({ input }) => backings.setActive(input.id),
        setCanvasLayout: ({ input }) =>
          backings.setCanvasLayout(input.id, input.layout),
        setSubPanel: ({ input }) =>
          backings.setSubPanel(input.id, {
            collapsed: input.collapsed,
            panelSize: input.panelSize,
          }),
        setRightPanel: ({ input }) => {
          const { id, ...state } = input;
          backings.setRightPanel(id, state);
        },
      },
      screen: {
        state: ({ input }) => backings.screenState(input.id),
        text: ({ input }) =>
          backings.screenText(input.id, input.startLine, input.endLine),
      },
      fs: {
        listAll: ({ input }) => backings.endpoint.fs.listAll(input.repoPath),
        readFile: ({ input }) =>
          backings.endpoint.fs.readFile(input.repoPath, input.filePath),
        statFileMtimeMs: ({ input }) =>
          backings.endpoint.fs.statFileMtimeMs(input.repoPath, input.filePath),
      },
      git: {
        getStatus: ({ input }) =>
          backings.endpoint.git.getStatus(input.repoPath, input.mode),
        getDiff: ({ input }) =>
          backings.endpoint.git.getDiff(
            input.repoPath,
            input.filePath,
            input.mode,
            input.oldPath,
          ),
        worktreeCreate: async ({ input }) =>
          unwrapGit(
            await worktreeCreate(input.repoPath, input.name, backings.log),
          ),
        worktreeRemove: async ({ input }) => {
          unwrapGit(await worktreeRemove(input.worktreePath, backings.log));
        },
      },
      scratch: {
        write: ({ input }) => ({
          path: backings.saveTerminalFile(
            input.terminalId,
            input.name,
            input.data,
          ),
        }),
      },
      preview: {
        read: async ({ input }) => {
          const resolved = resolvePathUnder(input.repoPath, input.filePath);
          if (!resolved.ok) {
            throw previewGuardError(resolved.status, resolved.reason);
          }
          if (!(await assertRealpathUnder(input.repoPath, resolved.abs)).ok) {
            throw previewGuardError(403, "symlink escapes repo root");
          }
          const [bytes, info] = await Promise.all([
            readFile(resolved.abs),
            stat(resolved.abs),
          ]);
          return {
            contentBase64: bytes.toString("base64"),
            contentType: contentTypeForPath(input.filePath),
            mtimeMs: Math.floor(info.mtimeMs),
          };
        },
      },
      transcript: {
        exportHtml: ({ input }) =>
          backings.exportTranscriptHtml(input.id, input.mode),
      },
      session: {
        restore: ({ input }) => {
          const saved = backings.getSavedSession();
          if (!saved) return;
          restoreSavedSession(
            backings,
            saved,
            input.resumeIds ? new Set(input.resumeIds) : undefined,
          );
        },
        import: ({ input }) => {
          backings.setSavedSession(input.session);
          restoreSavedSession(
            backings,
            input.session,
            input.resumeIds ? new Set(input.resumeIds) : undefined,
          );
        },
      },
    },
  } satisfies PadiDeps;
}

// Keep `PadiCtx` referenced for a stable public type even though W1.1 wires no
// live-delta feed off it yet (W1.2+ drives `terminals`/`urgency` deltas here).
export type { PadiCtx };
