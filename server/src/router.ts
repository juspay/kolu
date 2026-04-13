/**
 * oRPC router: implements the contract with terminal lifecycle and I/O handlers.
 *
 * Streaming handlers subscribe to publisher channels over WebSocket.
 * Terminal CRUD (create, kill, etc.) is request-response; list and metadata are live streams.
 */
import { implement } from "@orpc/server";

import { contract } from "kolu-common/contract";
import { TerminalNotFoundError } from "kolu-common/errors";
import {
  createTerminal,
  getTerminal,
  listTerminals,
  killTerminal,
  killAllTerminals,
  setTerminalTheme,
  setTerminalParent,
  reorderTerminals,
  type TerminalProcess,
} from "./terminals.ts";
import { saveClipboardImage } from "./clipboard.ts";
import { subscribeForTerminal_, subscribeSystem_ } from "./publisher.ts";
import { serverHostname, serverProcessId } from "./hostname.ts";
import { worktreeCreate, worktreeRemove } from "./git.ts";
import {
  getServerState,
  testSetServerState,
  updateServerState,
} from "./state.ts";
import { log } from "./log.ts";
import { WorkspaceFsService } from "kolu-workspace-fs";

const t = implement(contract);

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalProcess {
  const entry = getTerminal(id);
  if (!entry) throw new TerminalNotFoundError(id);
  return entry;
}

export const appRouter = t.router({
  server: {
    info: t.server.info.handler(async () => ({
      hostname: serverHostname,
      processId: serverProcessId,
    })),
  },
  terminal: {
    create: t.terminal.create.handler(async ({ input }) =>
      createTerminal(input.cwd, input.parentId),
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
      const path = saveClipboardImage(entry.clipboardDir, input.data);
      log.info({ terminal: input.id, bytes, path }, "paste image");
    }),

    kill: t.terminal.kill.handler(async ({ input }) => {
      const info = killTerminal(input.id);
      if (!info) throw new TerminalNotFoundError(input.id);
      return info;
    }),

    reorder: t.terminal.reorder.handler(async ({ input }) => {
      log.info({ count: input.ids.length }, "reorder terminals");
      reorderTerminals(input.ids);
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

    onActivityChange: t.terminal.onActivityChange.handler(async function* ({
      input,
      signal,
    }) {
      const entry = requireTerminal(input.id);
      yield { kind: "snapshot" as const, samples: [...entry.activityHistory] };
      for await (const sample of subscribeForTerminal_(
        "activity",
        input.id,
        signal,
      )) {
        yield { kind: "delta" as const, sample };
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
  claude: {
    getTranscript: t.claude.getTranscript.handler(async ({ input }) => {
      const entry = requireTerminal(input.id);
      return entry.getClaudeDebug?.() ?? null;
    }),
  },
  git: {
    worktreeCreate: t.git.worktreeCreate.handler(async ({ input }) => {
      log.info({ repo: input.repoPath }, "worktree create");
      const result = await worktreeCreate(input.repoPath);
      log.info(
        { repo: input.repoPath, path: result.path, branch: result.branch },
        "worktree created",
      );
      return result;
    }),
    worktreeRemove: t.git.worktreeRemove.handler(async ({ input }) => {
      log.info({ worktree: input.worktreePath }, "worktree remove");
      await worktreeRemove(input.worktreePath);
    }),
  },
  state: {
    get: t.state.get.handler(async function* ({ signal }) {
      yield getServerState();
      for await (const state of subscribeSystem_("state:changed", signal)) {
        yield state;
      }
    }),
    update: t.state.update.handler(async ({ input }) => {
      // Log only the keys being patched — values may carry session blobs,
      // recent-repo paths, or other content not safe for the operator log.
      log.info(
        {
          keys: Object.keys(input),
          preferences: input.preferences
            ? Object.keys(input.preferences)
            : undefined,
        },
        "state update",
      );
      updateServerState(input);
    }),
    test__set: t.state.test__set.handler(async ({ input }) => {
      testSetServerState(input);
    }),
  },
  fs: {
    search: t.fs.search.handler(async ({ input }) => {
      const svc = WorkspaceFsService.acquire(input.root);
      try {
        await svc.waitReady();
        return svc.search(input.query, input.limit);
      } finally {
        WorkspaceFsService.release(input.root);
      }
    }),
    listDir: t.fs.listDir.handler(async ({ input }) => {
      const svc = WorkspaceFsService.acquire(input.root);
      try {
        await svc.waitReady();
        return svc.listDir(input.dirPath);
      } finally {
        WorkspaceFsService.release(input.root);
      }
    }),
    readFile: t.fs.readFile.handler(async ({ input }) => {
      const svc = WorkspaceFsService.acquire(input.root);
      try {
        await svc.waitReady();
        return await svc.readFile(input.filePath);
      } finally {
        WorkspaceFsService.release(input.root);
      }
    }),
    fileDiff: t.fs.fileDiff.handler(async ({ input }) => {
      const svc = WorkspaceFsService.acquire(input.root);
      try {
        await svc.waitReady();
        return await svc.fileDiff(input.filePath);
      } finally {
        WorkspaceFsService.release(input.root);
      }
    }),
    blame: t.fs.blame.handler(async ({ input }) => {
      const svc = WorkspaceFsService.acquire(input.root);
      try {
        await svc.waitReady();
        return await svc.blame(input.filePath);
      } finally {
        WorkspaceFsService.release(input.root);
      }
    }),
    stage: t.fs.stage.handler(async ({ input }) => {
      const svc = WorkspaceFsService.acquire(input.root);
      try {
        await svc.waitReady();
        await svc.stageFile(input.filePath);
      } finally {
        WorkspaceFsService.release(input.root);
      }
    }),
    unstage: t.fs.unstage.handler(async ({ input }) => {
      const svc = WorkspaceFsService.acquire(input.root);
      try {
        await svc.waitReady();
        await svc.unstageFile(input.filePath);
      } finally {
        WorkspaceFsService.release(input.root);
      }
    }),
    /**
     * Stream filesystem change notifications for a workspace root.
     * Yields an initial event immediately, then yields on each change batch.
     */
    onChange: t.fs.onChange.handler(async function* ({ input, signal }) {
      const svc = WorkspaceFsService.acquire(input.root);
      let unsub: (() => void) | null = null;
      try {
        await svc.waitReady();
        yield { updatedAt: Date.now() };

        // Convert callback-based onChange to async iterator
        let waiting: ((value: void) => void) | null = null;
        let pending = false;

        unsub = svc.onChange(() => {
          if (waiting) {
            const resolve = waiting;
            waiting = null;
            resolve();
          } else {
            pending = true;
          }
        });

        signal?.addEventListener("abort", () => {
          // Unblock any pending await so the loop exits
          if (waiting) {
            waiting();
            waiting = null;
          }
        });

        while (!signal?.aborted) {
          if (pending) {
            pending = false;
            yield { updatedAt: Date.now() };
          } else {
            await new Promise<void>((resolve) => {
              waiting = resolve;
            });
            if (!signal?.aborted) {
              yield { updatedAt: Date.now() };
            }
          }
        }
      } finally {
        unsub?.();
        WorkspaceFsService.release(input.root);
      }
    }),
  },
});
