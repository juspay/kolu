/**
 * oRPC router: implements the contract with terminal lifecycle and I/O handlers.
 *
 * Streaming handlers subscribe to publisher channels over WebSocket.
 * Terminal CRUD (create, kill, etc.) is request-response; list and metadata are live streams.
 */
import {
  cellHandlers,
  eventHandlers,
  pollOnEvent,
  streamHandlers,
} from "@kolu/cells/server";
import { implement, ORPCError } from "@orpc/server";

import { loadClaudeCodeTranscript } from "kolu-claude-code";
import { loadCodexTranscript } from "kolu-codex";
import type { Transcript, TranscriptPr } from "kolu-common";
import {
  activityFeedCell,
  applyPreferencesPatch,
  fsListAllStream,
  fsReadFileStream,
  gitDiffStream,
  gitStatusStream,
  preferencesCell,
  savedSessionCell,
  terminalExitEvent,
  terminalListCell,
} from "kolu-common/surface";
import { contract } from "kolu-common/contract";
import { TerminalNotFoundError } from "kolu-common/errors";
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
  cellBus,
  preferencesStore,
  savedSessionStore,
} from "./cells.ts";
import { saveClipboardImage } from "./clipboard.ts";
import { serverHostname, serverProcessId } from "./hostname.ts";
import { log } from "./log.ts";
import { terminalChannels } from "./publisher.ts";
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

// ── Cell / Stream handler wiring (framework: @kolu/cells/server) ───────
// Each block produces the snapshot+deltas + mutate handlers that plug
// into the contract's typed router. Domain modules (preferences.ts,
// activity.ts, session.ts, terminals.ts) remain the source of truth
// for *what* the data is; the framework owns *how* it's delivered and
// *how* mutations propagate (validate → persist → publish to bus).

const preferencesHandlers = cellHandlers(preferencesCell, {
  store: preferencesStore,
  bus: cellBus.preferences,
  patch: applyPreferencesPatch,
  // Log only patched keys — values may carry user-identifying state
  // (themes, file paths in rightPanel.tab) that have no business in
  // operator logs. Same shape as the pre-framework inline log.info.
  onMutate: (patch) =>
    log.info(
      {
        keys: Object.keys(patch),
        rightPanel: patch.rightPanel
          ? Object.keys(patch.rightPanel)
          : undefined,
      },
      "preferences update",
    ),
});

const activityHandlers = cellHandlers(activityFeedCell, {
  store: activityFeedStore,
  bus: cellBus.activityFeed,
});

const sessionHandlers = cellHandlers(savedSessionCell, {
  // Reads through getSavedSession to keep the "empty terminals = null"
  // legacy normalization at one site (session.ts owns that invariant).
  store: { get: () => getSavedSession(), set: savedSessionStore.set },
  bus: cellBus.savedSession,
});

const terminalListHandlers = cellHandlers(terminalListCell, {
  // Live list — no persistence; the registry is the source of truth.
  store: { get: () => listTerminals(), set: () => {} },
  bus: cellBus.terminalList,
});

const gitStatusHandlers = streamHandlers(gitStatusStream, {
  source: (input, signal) =>
    pollOnEvent({
      read: async () =>
        unwrapGit(await getStatus(input.repoPath, input.mode, log)),
      isEqual: gitStatusOutputEqual,
      install: (cb) => subscribeRepoChange(input.repoPath, cb, log),
      signal,
      // Transient git errors shouldn't tear down the long-lived
      // subscription — the upstream debounce will tick again and the
      // next read may succeed. Log loud enough that a *persistent*
      // failure is visible to operators (a stuck stream silently
      // returning stale state is the worse failure mode).
      onReadError: (e) => {
        log.error(
          { err: e instanceof Error ? e.message : String(e) },
          "stream snapshot read failed",
        );
      },
    }),
});

const gitDiffHandlers = streamHandlers(gitDiffStream, {
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
      // Transient git errors shouldn't tear down the long-lived
      // subscription — the upstream debounce will tick again and the
      // next read may succeed. Log loud enough that a *persistent*
      // failure is visible to operators (a stuck stream silently
      // returning stale state is the worse failure mode).
      onReadError: (e) => {
        log.error(
          { err: e instanceof Error ? e.message : String(e) },
          "stream snapshot read failed",
        );
      },
    }),
});

const fsListAllHandlers = streamHandlers(fsListAllStream, {
  source: (input, signal) =>
    pollOnEvent({
      read: async () => ({
        paths: unwrapGit(await listAll(input.repoPath, log)),
      }),
      isEqual: fsListAllOutputEqual,
      install: (cb) => subscribeRepoChange(input.repoPath, cb, log),
      signal,
      // Transient git errors shouldn't tear down the long-lived
      // subscription — the upstream debounce will tick again and the
      // next read may succeed. Log loud enough that a *persistent*
      // failure is visible to operators (a stuck stream silently
      // returning stale state is the worse failure mode).
      onReadError: (e) => {
        log.error(
          { err: e instanceof Error ? e.message : String(e) },
          "stream snapshot read failed",
        );
      },
    }),
});

const fsReadFileHandlers = streamHandlers(fsReadFileStream, {
  source: (input, signal) =>
    pollOnEvent({
      read: async () =>
        unwrapGit(await readFile(input.repoPath, input.filePath, log)),
      isEqual: fsReadFileOutputEqual,
      install: (cb) =>
        subscribeFileChange(input.repoPath, input.filePath, cb, log),
      signal,
      // Transient git errors shouldn't tear down the long-lived
      // subscription — the upstream debounce will tick again and the
      // next read may succeed. Log loud enough that a *persistent*
      // failure is visible to operators (a stuck stream silently
      // returning stale state is the worse failure mode).
      onReadError: (e) => {
        log.error(
          { err: e instanceof Error ? e.message : String(e) },
          "stream snapshot read failed",
        );
      },
    }),
});

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalProcess {
  const entry = getTerminal(id);
  if (!entry) throw new TerminalNotFoundError(id);
  return entry;
}

const terminalExitHandlers = eventHandlers(terminalExitEvent, {
  // Single-yield-then-close: validate the terminal exists at subscribe
  // time (TerminalNotFoundError propagates as an ORPCError, not retried
  // by STREAM_RETRY's `shouldRetry`), then forward the first exit-channel
  // yield and return — the iterator naturally completes after one
  // occurrence.
  source: async function* (input, signal) {
    requireTerminal(input.id);
    for await (const exitCode of terminalChannels
      .exit(input.id)
      .subscribe(signal)) {
      yield exitCode;
      return;
    }
  },
});

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

export const appRouter = t.router({
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
    list: t.terminal.list.handler(terminalListHandlers.get),

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

    onMetadataChange: t.terminal.onMetadataChange.handler(async function* ({
      input,
      signal,
    }) {
      const entry = requireTerminal(input.id);
      yield { ...entry.info.meta };
      for await (const meta of terminalChannels
        .metadata(input.id)
        .subscribe(signal)) {
        yield meta;
      }
    }),

    onExit: t.terminal.onExit.handler(terminalExitHandlers.get),
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
    onStatusChange: t.git.onStatusChange.handler(gitStatusHandlers.get),
    onDiffChange: t.git.onDiffChange.handler(gitDiffHandlers.get),
  },
  fs: {
    onListAllChange: t.fs.onListAllChange.handler(fsListAllHandlers.get),
    onReadFileChange: t.fs.onReadFileChange.handler(fsReadFileHandlers.get),
  },
  preferences: {
    get: t.preferences.get.handler(preferencesHandlers.get),
    update: t.preferences.update.handler(preferencesHandlers.patch),
    test__set: t.preferences.test__set.handler(preferencesHandlers.test__set),
  },
  activity: {
    get: t.activity.get.handler(activityHandlers.get),
    test__set: t.activity.test__set.handler(activityHandlers.test__set),
  },
  session: {
    get: t.session.get.handler(sessionHandlers.get),
    test__set: t.session.test__set.handler(sessionHandlers.test__set),
  },
});
