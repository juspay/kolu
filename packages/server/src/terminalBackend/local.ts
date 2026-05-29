/**
 * `LocalTerminalBackend` — this kolu process. Since #951 R4b it is a pure
 * *consumer* of the in-process **agent** (`./agent.ts`): the agent owns
 * `@kolu/pty-host` AND the per-terminal provider DAG and emits an enriched
 * per-terminal metadata stream; this backend subscribes to that stream and
 * mirrors it onto kolu-server's surface plumbing. It no longer runs
 * `startProviders` itself — the providers run *inside* the agent, where a
 * future ssh agent will run them too (same code, different transport).
 *
 * Three things stay on this side of the boundary, because they're
 * cross-terminal / UI concerns the agent can't own once it's remote:
 *
 *   - the `terminalMetadata` collection + the `terminals:dirty` autosave
 *     trigger (fired only for the stream's `metadataPersisted` half);
 *   - the activity feed (recent-repos / recent-agents MRUs), fed by the
 *     stream's `recentRepo` / `recentAgent` events;
 *   - `TerminalBackend.fs/git`, which stay abstracted per-location and (for
 *     local) shell out to `kolu-git` directly.
 *
 * `attach` and the byte-stream handle delegate straight to the agent (which
 * delegates to pty-host's race-free snapshot+delta primitive).
 */

import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common/surface";
import type {
  PtySpawnOpts,
  TerminalAttachment,
  TerminalBackend,
  TerminalBackendFs,
  TerminalBackendGit,
} from "kolu-common/terminalBackend";
import {
  type FsListAllOutput,
  type GitDiffOutput,
  type GitStatusOutput,
  getDiff,
  getStatus,
  listAll,
  readFile,
  statFileMtimeMs,
  subscribeFileChange,
  subscribeRepoChange,
} from "kolu-git";
import type { GitDiffMode } from "kolu-git/schemas";
import { cleanEnv, koluIdentityEnv, prepareShellInit } from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { trackRecentAgent, trackRecentRepo } from "../activity.ts";
import { koluShellDir } from "../koluRoot.ts";
import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surfaceCtx.ts";
import {
  drainTerminals,
  getTerminal,
  listTerminals,
  registerTerminal,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { cleanupTerminalScratch } from "../terminalScratch.ts";
import { unwrapGit } from "../unwrapGit.ts";
import { type AgentMetadataEvent, createAgent } from "./agent.ts";
import { updateServerLiveMetadata, updateServerMetadata } from "./metadata.ts";

// ── PTY-state notification helpers ─────────────────────────────────────

/** Notify that terminal state changed (drives debounced session
 *  auto-save). Distinct from the `terminalList` cell's content channel:
 *  this is the *trigger*, not the saved content. */
function emitTerminalsDirty(): void {
  terminalsDirtyChannel.publish({});
}

/** Republish the live `terminalList` cell. Backend lifecycle calls this
 *  on create / kill; client metadata setters (`setTerminalParent`, …)
 *  publish via the metadata collection instead, so no list republish
 *  is needed there. */
function emitTerminalListChanged(): void {
  surfaceCtx.cells.terminalList.set(listTerminals());
}

// ── Local fs/git surfaces ──────────────────────────────────────────────

const localFs: TerminalBackendFs = {
  async listAll(repoPath: string): Promise<FsListAllOutput> {
    return { paths: unwrapGit(await listAll(repoPath, log)) };
  },
  async readFile(repoPath, filePath) {
    return unwrapGit(await readFile(repoPath, filePath, log));
  },
  async statFileMtimeMs(repoPath, filePath) {
    return unwrapGit(await statFileMtimeMs(repoPath, filePath, log));
  },
  subscribeRepoChange(repoPath, onChange) {
    return subscribeRepoChange(repoPath, onChange, log);
  },
  subscribeFileChange(repoPath, filePath, onChange) {
    return subscribeFileChange(repoPath, filePath, onChange, log);
  },
};

const localGit: TerminalBackendGit = {
  async getStatus(repoPath, mode: GitDiffMode): Promise<GitStatusOutput> {
    return unwrapGit(await getStatus(repoPath, mode, log));
  },
  async getDiff(repoPath, filePath, mode, oldPath): Promise<GitDiffOutput> {
    return unwrapGit(await getDiff(repoPath, filePath, mode, log, oldPath));
  },
};

// ── The in-process agent (owns pty-host + the provider DAG) ─────────────

/** The single agent for this kolu process. kolu-server is its consumer. */
const agent = createAgent({ log });

// ── Backend implementation ─────────────────────────────────────────────

class LocalTerminalBackend implements TerminalBackend {
  readonly fs = localFs;
  readonly git = localGit;

  constructor() {
    // Subscribe ONCE, at construction (before any spawn), so no metadata
    // event is missed. Events are tagged by terminal id; we demux here.
    // The subscription lives for the whole process — no teardown needed.
    agent.metadata.consume({
      onEvent: (ev) => this.applyAgentEvent(ev),
      onError: (err) => log.error({ err }, "agent metadata stream failed"),
    });
  }

  /** Mirror one agent-stream event onto kolu-server state. The event type
   *  carries the autosave fence: `metadataPersisted` routes through the
   *  persisting helper (fires `terminals:dirty`), `metadataLive` through
   *  the live one (does not). Each carries only its half of the partition,
   *  so applying it is one fenced `Object.assign` — no field enumeration.
   *
   *  Per-event try/catch is load-bearing: this runs inside ONE shared
   *  `consume` loop for every terminal, and `consume` ends its loop if its
   *  `onEvent` throws (`@kolu/surface/server`). A single bad event (a failed
   *  publish, a scratch-cleanup `fs` error, …) must therefore not escape, or
   *  it would silence metadata + exit mirroring for ALL terminals. Log and
   *  keep the subscription alive. */
  private applyAgentEvent(ev: AgentMetadataEvent): void {
    try {
      switch (ev.kind) {
        case "metadataPersisted": {
          const entry = getTerminal(ev.id);
          // No entry ⟹ the terminal is being torn down (kill/exit raced
          // this event). Dropping is correct — the entry is gone for good.
          if (!entry) return;
          updateServerMetadata(entry, ev.id, (m) => {
            Object.assign(m, ev.fields);
          });
          return;
        }
        case "metadataLive": {
          const entry = getTerminal(ev.id);
          if (!entry) return;
          updateServerLiveMetadata(entry, ev.id, (m) => {
            Object.assign(m, ev.fields);
          });
          return;
        }
        case "recentRepo":
          trackRecentRepo(ev.root, ev.name);
          return;
        case "recentAgent":
          trackRecentAgent(ev.command);
          return;
        case "exit":
          this.handleExit(ev.id, ev.exitCode);
          return;
      }
    } catch (err) {
      log.error(
        { err, kind: ev.kind },
        "failed to apply agent metadata event (subscription kept alive)",
      );
    }
  }

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const tlog = log.child({ terminal: id });

    // Env layering, ordered least → most authoritative:
    //   1. cleanEnv()        — parent env passthrough (Nix devshell filter).
    //   2. koluIdentityEnv() — Kolu's identity vars (stomps parent).
    //   3. shellInit.env     — per-PTY overrides (e.g. ZDOTDIR for zsh).
    const env = cleanEnv();
    const shell = env.SHELL ?? "/bin/sh";
    const cwd = opts.cwd || env.HOME || "/";
    Object.assign(env, koluIdentityEnv(pkg.version));
    const shellInit = prepareShellInit({
      shell,
      home: env.HOME,
      terminalId: id,
      rcDir: koluShellDir,
    });
    Object.assign(env, shellInit.env);

    const {
      pid,
      meta: serverMeta,
      handle,
    } = agent.spawn({
      id,
      shell,
      args: shellInit.args,
      env,
      cwd,
      onDispose: shellInit.cleanup,
      // Server-persisted recency, restored across session reload: seed it
      // INSIDE the agent (its `record.meta` is separate from `entry.meta`)
      // so re-detecting a resumed agent doesn't reset it to "now".
      restoredActivityAt: opts.initialMetadata?.lastActivityAt,
    });

    // Build the registry entry from the agent's initial server+live
    // metadata, then layer on the client-owned fields. The agent never
    // sees client fields (theme, layout, parentId, …) — they're kolu-server
    // UI state — so seeding them here BEFORE registration is what makes the
    // first `terminalMetadata` collection yield carry them (see #642).
    const meta: TerminalMetadata = { ...serverMeta };
    if (opts.parentId) meta.parentId = opts.parentId;
    // Only the client-owned fields are seeded here; server-persisted ones
    // (incl. the restored `lastActivityAt`) ride in on `serverMeta`.
    const initial = opts.initialMetadata;
    if (initial?.themeName) meta.themeName = initial.themeName;
    if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
    if (initial?.subPanel) meta.subPanel = initial.subPanel;
    if (initial?.rightPanel) meta.rightPanel = initial.rightPanel;
    if (initial?.intent) meta.intent = initial.intent;

    // `handle` is the host-vended byte-stream handle from `spawn`, already
    // narrowed to `TerminalHandle` (write/resize/getScreenState/
    // getScreenText/pid) so router.ts can't reach the host-only members
    // (cwd, process, foregroundPid) the providers read inside the agent.
    const entry: TerminalProcess = {
      info: { id, pid },
      meta,
      handle,
    };
    registerTerminal(id, entry);

    tlog.info({ pid, total: listTerminals().length }, "created");
    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  /** A terminal's PTY exited naturally (the agent emits `exit` only for
   *  natural exits — an intentional kill drives its own cleanup below).
   *  Publish the exit event, drop the entry, and save the session. */
  private handleExit(id: TerminalId, exitCode: number): void {
    const entry = getTerminal(id);
    // Absent ⟹ already torn down by a kill path; nothing to do.
    if (!entry) return;
    log.child({ terminal: id }).info({ exitCode }, "exited");
    cleanupTerminalScratch(id);
    surfaceCtx.events.terminalExit.publish({ id }, exitCode);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
  }

  killTerminal(id: TerminalId): TerminalInfo | undefined {
    const entry = getTerminal(id);
    if (!entry) return undefined;
    log.child({ terminal: id }).info({ pid: entry.info.pid }, "killing");
    // The agent stops the providers + kills the PTY; unregistering here
    // BEFORE the delayed natural-exit signal means `handleExit` finds no
    // entry and stays quiet — so an intentional kill never publishes
    // `terminalExit` (the kill RPC response drives client cleanup).
    agent.kill(id);
    cleanupTerminalScratch(id);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  killAllTerminals(): void {
    // Drain the registry BEFORE killing so the delayed exit signals can't
    // find entries and trigger session saves.
    const entries = drainTerminals();
    log.info({ count: entries.length }, "killing all terminals");
    agent.killAll();
    for (const entry of entries) cleanupTerminalScratch(entry.info.id);
    emitTerminalListChanged();
  }

  attach(id: TerminalId, signal: AbortSignal | undefined): TerminalAttachment {
    return agent.attach(id, signal);
  }
}

export const localTerminalBackend: TerminalBackend = new LocalTerminalBackend();
