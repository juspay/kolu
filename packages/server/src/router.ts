/**
 * oRPC router: implements the contract with terminal lifecycle and I/O handlers.
 *
 * Streaming handlers subscribe to publisher channels over WebSocket.
 * Terminal CRUD (create, kill, etc.) is request-response; list and metadata are live streams.
 */
import { implement, ORPCError } from "@orpc/server";

import { contract } from "kolu-common/contract";
import { TerminalNotFoundError } from "kolu-common/errors";
import {
  type GitResult,
  getDiff,
  getStatus,
  listAll,
  readFile,
  worktreeCreate,
  worktreeRemove,
} from "kolu-git";
import { getActivityFeed, setActivityForTest } from "./activity.ts";
import { saveClipboardImage } from "./clipboard.ts";
import {
  serverHostname,
  serverProcessId,
  serverStartTime,
} from "./hostname.ts";
import { log } from "./log.ts";
import {
  getPreferences,
  setPreferencesForTest,
  updatePreferences,
} from "./preferences.ts";
import { subscribeForTerminal_, subscribeSystem_ } from "./publisher.ts";
import { getSavedSession, setSavedSession } from "./session.ts";
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

export const appRouter = t.router({
  server: {
    info: t.server.info.handler(async () => {
      const m = process.memoryUsage();
      return {
        hostname: serverHostname,
        processId: serverProcessId,
        uptime: Math.floor((Date.now() - serverStartTime) / 1000),
        memory: {
          rss: m.rss,
          heapUsed: m.heapUsed,
          heapTotal: m.heapTotal,
          external: m.external,
        },
      };
    }),
  },
  terminal: {
    create: t.terminal.create.handler(async ({ input }) =>
      createTerminal(input.cwd, input.parentId, {
        themeName: input.themeName,
        canvasLayout: input.canvasLayout,
        subPanel: input.subPanel,
      }),
    ),
    list: t.terminal.list.handler(async function* ({ signal }) {
      yield listTerminals();
      for await (const list of subscribeSystem_("terminal-list", signal)) {
        yield list;
      }
    }),

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
      const live = subscribeForTerminal_("data", input.id, signal);

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

    onMetadataChange: t.terminal.onMetadataChange.handler(async function* ({
      input,
      signal,
    }) {
      const entry = requireTerminal(input.id);
      yield { ...entry.info.meta };
      for await (const meta of subscribeForTerminal_(
        "metadata",
        input.id,
        signal,
      )) {
        yield meta;
      }
    }),

    onExit: t.terminal.onExit.handler(async function* ({ input, signal }) {
      requireTerminal(input.id);
      for await (const exitCode of subscribeForTerminal_(
        "exit",
        input.id,
        signal,
      )) {
        yield exitCode;
        return;
      }
    }),
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
    status: t.git.status.handler(async ({ input }) => {
      return unwrapGit(await getStatus(input.repoPath, input.mode, log));
    }),
    diff: t.git.diff.handler(async ({ input }) => {
      return unwrapGit(
        await getDiff(
          input.repoPath,
          input.filePath,
          input.mode,
          log,
          input.oldPath,
        ),
      );
    }),
  },
  fs: {
    listAll: t.fs.listAll.handler(async ({ input }) => ({
      paths: unwrapGit(await listAll(input.repoPath, log)),
    })),
    readFile: t.fs.readFile.handler(async ({ input }) =>
      unwrapGit(await readFile(input.repoPath, input.filePath, log)),
    ),
  },
  preferences: {
    get: t.preferences.get.handler(async function* ({ signal }) {
      yield getPreferences();
      for await (const prefs of subscribeSystem_(
        "preferences:changed",
        signal,
      )) {
        yield prefs;
      }
    }),
    update: t.preferences.update.handler(async ({ input }) => {
      // Log only patched keys — values may carry user-identifying state.
      log.info(
        {
          keys: Object.keys(input),
          rightPanel: input.rightPanel
            ? Object.keys(input.rightPanel)
            : undefined,
        },
        "preferences update",
      );
      updatePreferences(input);
    }),
    test__set: t.preferences.test__set.handler(async ({ input }) => {
      setPreferencesForTest(input);
    }),
  },
  activity: {
    get: t.activity.get.handler(async function* ({ signal }) {
      yield getActivityFeed();
      for await (const feed of subscribeSystem_("activity:changed", signal)) {
        yield feed;
      }
    }),
    test__set: t.activity.test__set.handler(async ({ input }) => {
      setActivityForTest(input);
    }),
  },
  session: {
    get: t.session.get.handler(async function* ({ signal }) {
      yield getSavedSession();
      for await (const session of subscribeSystem_("session:changed", signal)) {
        yield session;
      }
    }),
    test__set: t.session.test__set.handler(async ({ input }) => {
      setSavedSession(input);
    }),
  },
});
