/**
 * oRPC router: implements the contract with terminal lifecycle and I/O handlers.
 *
 * Streaming handlers use the publisher for push-based events over WebSocket.
 * Terminal CRUD is request-response.
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
  type TerminalEntry,
} from "./terminals.ts";
import { saveClipboardImage } from "./clipboard.ts";
import { publisher } from "./publisher.ts";
import { serverHostname, serverProcessId } from "./hostname.ts";
import { worktreeCreate, worktreeRemove } from "./git.ts";
import { getRecentRepos } from "./state.ts";
import {
  getSavedSession,
  clearSavedSession,
  setSavedSession,
} from "./session.ts";

const t = implement(contract);

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalEntry {
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
    list: t.terminal.list.handler(async () => listTerminals()),

    resize: t.terminal.resize.handler(async ({ input }) => {
      requireTerminal(input.id).handle.resize(input.cols, input.rows);
    }),

    sendInput: t.terminal.sendInput.handler(async ({ input }) => {
      requireTerminal(input.id).handle.write(input.data);
    }),

    setTheme: t.terminal.setTheme.handler(async ({ input }) => {
      requireTerminal(input.id);
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
      const live = publisher.subscribe("data", { signal });

      const screenState = entry.handle.getScreenState();
      if (screenState) yield screenState;

      for await (const event of live) {
        if (event.terminalId === input.id) yield event.data;
      }
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
      saveClipboardImage(entry.clipboardDir, input.data);
    }),

    kill: t.terminal.kill.handler(async ({ input }) => {
      const info = killTerminal(input.id);
      if (!info) throw new TerminalNotFoundError(input.id);
      return info;
    }),

    reorder: t.terminal.reorder.handler(async ({ input }) => {
      reorderTerminals(input.ids);
    }),

    setParent: t.terminal.setParent.handler(async ({ input }) => {
      requireTerminal(input.id);
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

      // Yield current metadata immediately
      yield { ...entry.metadata };

      // Then stream changes via publisher (typed, no manual queue plumbing)
      for await (const event of publisher.subscribe("metadata", { signal })) {
        if (event.terminalId === input.id) yield event.metadata;
      }
    }),

    onActivityChange: t.terminal.onActivityChange.handler(async function* ({
      input,
      signal,
    }) {
      const entry = requireTerminal(input.id);

      // Yield current state immediately
      yield entry.isActive;

      // Then stream changes via publisher
      for await (const event of publisher.subscribe("activity", { signal })) {
        if (event.terminalId === input.id) yield event.isActive;
      }
    }),

    onExit: t.terminal.onExit.handler(async function* ({ input, signal }) {
      requireTerminal(input.id);

      for await (const event of publisher.subscribe("exit", { signal })) {
        if (event.terminalId === input.id) {
          yield event.exitCode;
          return;
        }
      }
    }),
  },
  git: {
    worktreeCreate: t.git.worktreeCreate.handler(async ({ input }) =>
      worktreeCreate(input.repoPath),
    ),
    worktreeRemove: t.git.worktreeRemove.handler(async ({ input }) => {
      await worktreeRemove(input.worktreePath);
    }),
    recentRepos: t.git.recentRepos.handler(async () => getRecentRepos()),
  },
  session: {
    get: t.session.get.handler(async () => getSavedSession()),
    clear: t.session.clear.handler(async () => {
      clearSavedSession();
    }),
    test__set: t.session.test__set.handler(async ({ input }) => {
      setSavedSession(input);
    }),
  },
});
