/**
 * oRPC router: implements the contract with terminal lifecycle and I/O handlers.
 *
 * Streaming handlers (attach, onExit) use async generators over WebSocket.
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
  type TerminalEntry,
} from "./terminals.ts";
import { saveClipboardImage } from "./clipboard.ts";
import { subscribeAndYield } from "./streaming.ts";
import { serverHostname } from "./hostname.ts";
import { toCwdInfo, watchGitDir } from "./git.ts";

const t = implement(contract);

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: number): TerminalEntry {
  const entry = getTerminal(id);
  if (!entry) throw new TerminalNotFoundError(id);
  return entry;
}

export const appRouter = t.router({
  server: {
    info: t.server.info.handler(async () => ({
      hostname: serverHostname,
    })),
  },
  terminal: {
    create: t.terminal.create.handler(async ({ input }) =>
      createTerminal(input.cwd),
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
      // steps is queued inside the generator, not lost.
      const live = subscribeAndYield(entry.emitter, "data", signal);

      const screenState = entry.handle.getScreenState();
      if (screenState) yield screenState;

      yield* live;
    }),

    screenState: t.terminal.screenState.handler(async ({ input }) => {
      return requireTerminal(input.id).handle.getScreenState();
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

    killAll: t.terminal.killAll.handler(async () => {
      killAllTerminals();
    }),

    onCwdChange: t.terminal.onCwdChange.handler(async function* ({
      input,
      signal,
    }) {
      const entry = requireTerminal(input.id);
      let gitWatchAc: AbortController | null = null;
      let watchedCwd: string | null = null;

      // Watch .git/HEAD for the current CWD. On change, re-emit a
      // "cwd" event so the main loop re-resolves git context naturally.
      // Only restarts the watcher when CWD actually changes.
      const ensureGitWatch = (cwd: string) => {
        if (cwd === watchedCwd) return;
        gitWatchAc?.abort();
        gitWatchAc = new AbortController();
        watchedCwd = cwd;
        void (async () => {
          for await (const _ of watchGitDir(cwd, gitWatchAc!.signal)) {
            entry.emitter.emit("cwd", cwd);
          }
        })();
      };

      try {
        // Yield current CWD with git context immediately
        yield await toCwdInfo(entry.handle.cwd);
        ensureGitWatch(entry.handle.cwd);

        // Stream changes — from OSC 7 prompts AND git watcher re-emits
        for await (const rawCwd of subscribeAndYield<string>(
          entry.emitter,
          "cwd",
          signal,
        )) {
          yield await toCwdInfo(rawCwd);
          ensureGitWatch(rawCwd);
        }
      } finally {
        gitWatchAc?.abort();
      }
    }),

    onActivityChange: t.terminal.onActivityChange.handler(async function* ({
      input,
      signal,
    }) {
      const entry = requireTerminal(input.id);

      // Yield current state immediately (isActive lives on TerminalBase, always available)
      yield entry.isActive;

      // Then stream changes (activity events emit booleans)
      yield* subscribeAndYield<boolean>(entry.emitter, "activity", signal);
    }),

    onExit: t.terminal.onExit.handler(async function* ({ input, signal }) {
      const entry = requireTerminal(input.id);

      // Use subscribeAndYield instead of events.once() — it handles abort
      // gracefully (clean return, no thrown AbortError) when clients disconnect.
      for await (const exitCode of subscribeAndYield<number>(
        entry.emitter,
        "exit",
        signal,
      )) {
        yield exitCode;
        return;
      }
    }),
  },
});
