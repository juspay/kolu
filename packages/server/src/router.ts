/**
 * oRPC router: implements the contract.
 *
 * The typed reactive layer (cells/collections/streams/events) goes through
 * `implementSurface(surface, deps)`; raw oRPC procedures (terminal lifecycle,
 * attach, git mutations, server info) stay hand-listed and spread alongside.
 */
import {
  implementSurface,
  pollOnEvent,
  publisherChannel,
} from "@kolu/cells/server";
import { implement, ORPCError } from "@orpc/server";

import { loadClaudeCodeTranscript } from "kolu-claude-code";
import { loadCodexTranscript } from "kolu-codex";
import type { Transcript, TranscriptPr } from "kolu-common";
import { contract } from "kolu-common/contract";
import { TerminalNotFoundError } from "kolu-common/errors";
import { surface } from "kolu-common/surface";
import {
  fsListAllOutputEqual,
  fsReadFileOutputEqual,
  type GitResult,
  getDiff,
  getStatus,
  gitDiffOutputEqual,
  gitStatusOutputEqual,
  listAll,
  readFile,
  subscribeFileChange,
  subscribeRepoChange,
  worktreeCreate,
  worktreeRemove,
} from "kolu-git";
import { prValue } from "kolu-github/schemas";
import { loadOpenCodeTranscript } from "kolu-opencode";
import { transcriptToHtml } from "kolu-transcript-html";
import { match } from "ts-pattern";
import {
  activityFeedStore,
  preferencesStore,
  savedSessionStore,
} from "./cells.ts";
import { saveClipboardImage } from "./clipboard.ts";
import { serverHostname, serverProcessId } from "./hostname.ts";
import { log } from "./log.ts";
import { publisher, terminalChannels } from "./publisher.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { getSavedSession } from "./session.ts";
import {
  createTerminal,
  getTerminal,
  killAllTerminals,
  killTerminal,
  listTerminals,
  setActiveTerminalId,
  setCanvasLayout,
  setSubPanelState,
  setTerminalParent,
  setTerminalTheme,
  type TerminalProcess,
} from "./terminals.ts";

const t = implement(contract);

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalProcess {
  const entry = getTerminal(id);
  if (!entry) throw new TerminalNotFoundError(id);
  return entry;
}

/** Unwrap a GitResult or throw an ORPCError for the client. */
function unwrapGit<T>(result: GitResult<T>): T {
  if (result.ok) return result.value;
  const e = result.error;
  const status =
    e.code === "BASE_BRANCH_NOT_FOUND"
      ? "PRECONDITION_FAILED"
      : "INTERNAL_SERVER_ERROR";
  const message =
    e.code === "PATH_ESCAPES_ROOT"
      ? `path escapes root: ${e.child}`
      : e.code === "BASE_BRANCH_NOT_FOUND"
        ? e.message
        : "message" in e
          ? e.message
          : `Git operation failed: ${e.code}`;
  throw new ORPCError(status, { message });
}

// ── Surface (typed reactive layer) ─────────────────────────────────────
//
// One declarative call wires every cell, collection, stream, and event.
// The `channel` factory hands the surface the same publisher domain
// modules (preferences.ts, activity.ts, session.ts, terminals.ts) write
// through, so direct publishes and surface-driven reads share channels.

const surfaceRouter = implementSurface(surface, {
  channel: <T>(name: string) => publisherChannel<T>(publisher, name),

  cells: {
    preferences: {
      store: preferencesStore,
      onMutate: (patch) =>
        // Log only patched keys — values may carry user-identifying state
        // (themes, file paths in rightPanel.tab) that have no business in
        // operator logs.
        log.info(
          {
            keys: Object.keys(patch),
            rightPanel: patch.rightPanel
              ? Object.keys(patch.rightPanel)
              : undefined,
          },
          "preferences update",
        ),
    },
    activityFeed: { store: activityFeedStore },
    session: {
      // Reads through getSavedSession to keep the "empty terminals = null"
      // legacy normalization at one site (session.ts owns that invariant).
      store: { get: () => getSavedSession(), set: savedSessionStore.set },
    },
    terminalList: {
      // Live list — no persistence; the registry is the source of truth.
      store: { get: () => listTerminals(), set: () => {} },
    },
  },

  collections: {
    terminalMetadata: {
      readAll: () => {
        const map = new Map<string, ReturnType<typeof terminalMeta>>();
        for (const info of listTerminals()) {
          map.set(info.id, terminalMeta(info.id));
        }
        return map;
      },
      readOne: (key) => {
        const term = getTerminal(key);
        return term ? term.info.meta : undefined;
      },
      // Per-terminal metadata writes happen via domain providers
      // (`updateServerMetadata`); the surface never receives client-driven
      // upserts. Stub these so the framework's wiring is satisfied.
      upsert: () => {},
      remove: () => {},
    },
  },

  streams: {
    gitStatus: {
      source: (input, signal) =>
        pollOnEvent({
          read: async () =>
            unwrapGit(await getStatus(input.repoPath, input.mode, log)),
          isEqual: gitStatusOutputEqual,
          install: (cb) => subscribeRepoChange(input.repoPath, cb, log),
          signal,
          onReadError: (e) => logStreamReadError(e),
        }),
    },
    gitDiff: {
      source: (input, signal) =>
        pollOnEvent({
          read: async () =>
            unwrapGit(
              await getDiff(
                input.repoPath,
                input.filePath,
                input.mode,
                log,
                input.oldPath,
              ),
            ),
          isEqual: gitDiffOutputEqual,
          install: (cb) => subscribeRepoChange(input.repoPath, cb, log),
          signal,
          onReadError: (e) => logStreamReadError(e),
        }),
    },
    fsListAll: {
      source: (input, signal) =>
        pollOnEvent({
          read: async () => ({
            paths: unwrapGit(await listAll(input.repoPath, log)),
          }),
          isEqual: fsListAllOutputEqual,
          install: (cb) => subscribeRepoChange(input.repoPath, cb, log),
          signal,
          onReadError: (e) => logStreamReadError(e),
        }),
    },
    fsReadFile: {
      source: (input, signal) =>
        pollOnEvent({
          read: async () =>
            unwrapGit(await readFile(input.repoPath, input.filePath, log)),
          isEqual: fsReadFileOutputEqual,
          install: (cb) =>
            subscribeFileChange(input.repoPath, input.filePath, cb, log),
          signal,
          onReadError: (e) => logStreamReadError(e),
        }),
    },
  },

  events: {
    terminalExit: {
      // Single-yield-then-close: validate the terminal exists at subscribe
      // time (TerminalNotFoundError propagates as an ORPCError, not retried
      // by STREAM_RETRY's `shouldRetry`), then forward the first exit-channel
      // yield and return.
      source: async function* (input, signal) {
        requireTerminal(input.id);
        for await (const exitCode of terminalChannels
          .exit(input.id)
          .subscribe(signal)) {
          yield exitCode;
          return;
        }
      },
    },
  },
});

/** Stream snapshot reads can transiently fail (git index lock, etc.); a
 *  persistent failure should be visible to operators (a stuck stream
 *  silently returning stale state is the worse failure mode). */
function logStreamReadError(e: unknown): void {
  log.error(
    { err: e instanceof Error ? e.message : String(e) },
    "stream snapshot read failed",
  );
}

/** Read the metadata for a terminal — used by `surface.terminalMetadata.readAll`. */
function terminalMeta(id: string) {
  const term = getTerminal(id);
  if (!term) {
    throw new TerminalNotFoundError(id);
  }
  return term.info.meta;
}

// ── Raw oRPC handlers (non-surface RPCs) ───────────────────────────────

export const appRouter = t.router({
  ...surfaceRouter,
  server: {
    info: t.server.info.handler(async () => ({
      identity: pwaIdentityForHostname(serverHostname),
      processId: serverProcessId,
    })),
  },
  terminal: {
    create: t.terminal.create.handler(async ({ input }) =>
      createTerminal(input.cwd, input.parentId, {
        themeName: input.themeName,
        canvasLayout: input.canvasLayout,
        subPanel: input.subPanel,
      }),
    ),

    resize: t.terminal.resize.handler(async ({ input }) => {
      requireTerminal(input.id).handle.resize(input.cols, input.rows);
    }),

    sendInput: t.terminal.sendInput.handler(async ({ input }) => {
      requireTerminal(input.id).handle.write(input.data);
    }),

    setTheme: t.terminal.setTheme.handler(async ({ input }) => {
      requireTerminal(input.id);
      log.info({ terminal: input.id, theme: input.themeName }, "set theme");
      setTerminalTheme(input.id, input.themeName);
    }),

    setCanvasLayout: t.terminal.setCanvasLayout.handler(async ({ input }) => {
      requireTerminal(input.id);
      setCanvasLayout(input.id, input.layout);
    }),

    setSubPanel: t.terminal.setSubPanel.handler(async ({ input }) => {
      requireTerminal(input.id);
      setSubPanelState(input.id, {
        collapsed: input.collapsed,
        panelSize: input.panelSize,
      });
    }),

    setActive: t.terminal.setActive.handler(async ({ input }) => {
      setActiveTerminalId(input.id);
    }),

    /**
     * Attach to a terminal's output stream.
     *
     * Yields serialized screen state first (for late-joining clients),
     * then streams live output. Subscribe-before-serialize ordering
     * guarantees no output is lost between snapshot and live stream.
     */
    attach: t.terminal.attach.handler(async function* ({ input, signal }) {
      const entry = requireTerminal(input.id);

      // Subscribe FIRST, then serialize — any output between these two
      // steps is queued inside the publisher, not lost.
      const live = terminalChannels.data(input.id).subscribe(signal);

      const screenState = entry.handle.getScreenState();
      if (screenState) yield screenState;

      for await (const data of live) yield data;
    }),

    screenState: t.terminal.screenState.handler(async ({ input }) => {
      return requireTerminal(input.id).handle.getScreenState();
    }),

    screenText: t.terminal.screenText.handler(async ({ input }) => {
      return requireTerminal(input.id).handle.getScreenText(
        input.startLine,
        input.endLine,
      );
    }),

    pasteImage: t.terminal.pasteImage.handler(async ({ input }) => {
      const entry = requireTerminal(input.id);
      // base64 → decoded byte count: (len * 3/4) minus padding
      const padding = input.data.endsWith("==")
        ? 2
        : input.data.endsWith("=")
          ? 1
          : 0;
      const bytes = Math.floor((input.data.length * 3) / 4) - padding;
      const path = saveClipboardImage(input.id, input.data);
      // Bracketed-paste the saved path into the PTY. Agents that accept
      // paste-as-file-path (codex, Claude Code) auto-attach the image.
      entry.handle.write(`\x1b[200~${path}\x1b[201~`);
      log.info({ terminal: input.id, bytes, path }, "paste image");
    }),

    kill: t.terminal.kill.handler(async ({ input }) => {
      const info = killTerminal(input.id);
      if (!info) throw new TerminalNotFoundError(input.id);
      return info;
    }),

    setParent: t.terminal.setParent.handler(async ({ input }) => {
      requireTerminal(input.id);
      log.info(
        { terminal: input.id, parent: input.parentId },
        "set terminal parent",
      );
      setTerminalParent(input.id, input.parentId);
    }),

    killAll: t.terminal.killAll.handler(async () => {
      killAllTerminals();
    }),

    exportTranscriptHtml: t.terminal.exportTranscriptHtml.handler(
      async ({ input }) => {
        const term = requireTerminal(input.id);
        const agent = term.info.meta.agent;
        if (!agent) {
          throw new ORPCError("PRECONDITION_FAILED", {
            message:
              "No active agent session in this terminal — start Claude Code, OpenCode, or Codex first",
          });
        }
        const cwd = term.info.meta.cwd;
        const repoName = term.info.meta.git?.repoName ?? null;
        const prInfo = prValue(term.info.meta.pr);
        const pr: TranscriptPr | null = prInfo
          ? { number: prInfo.number, url: prInfo.url }
          : null;
        const transcript = match<typeof agent, Transcript | null>(agent)
          .with({ kind: "claude-code" }, (a) =>
            loadClaudeCodeTranscript({
              sessionId: a.sessionId,
              cwd,
              title: a.summary,
              repoName,
              model: a.model,
              contextTokens: a.contextTokens,
              pr,
            }),
          )
          .with({ kind: "opencode" }, (a) =>
            loadOpenCodeTranscript(
              {
                sessionId: a.sessionId,
                title: a.summary,
                repoName,
                cwd,
                model: a.model,
                contextTokens: a.contextTokens,
                pr,
              },
              log,
            ),
          )
          .with({ kind: "codex" }, (a) =>
            loadCodexTranscript(
              {
                sessionId: a.sessionId,
                title: a.summary,
                repoName,
                cwd,
                model: a.model,
                contextTokens: a.contextTokens,
                pr,
              },
              log,
            ),
          )
          .exhaustive();
        if (!transcript) {
          throw new ORPCError("NOT_FOUND", {
            message: `Transcript not found for ${agent.kind} session ${agent.sessionId}`,
          });
        }
        const html = await transcriptToHtml(transcript);
        const safeId = agent.sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
        const filename = `kolu-${agent.kind}-${safeId.slice(0, 12)}.html`;
        return { html, filename };
      },
    ),
  },
  git: {
    worktreeCreate: t.git.worktreeCreate.handler(async ({ input }) => {
      log.info({ repo: input.repoPath }, "worktree create");
      const result = unwrapGit(await worktreeCreate(input.repoPath, log));
      log.info(
        { repo: input.repoPath, path: result.path, branch: result.branch },
        "worktree created",
      );
      return result;
    }),
    worktreeRemove: t.git.worktreeRemove.handler(async ({ input }) => {
      log.info({ worktree: input.worktreePath }, "worktree remove");
      unwrapGit(await worktreeRemove(input.worktreePath, log));
    }),
  },
});
