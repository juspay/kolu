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
  setTerminalParent,
  reorderTerminals,
  type TerminalEntry,
} from "./terminals.ts";
import { saveClipboardImage } from "./clipboard.ts";
import { subscribeAndYield } from "./streaming.ts";
import { serverHostname } from "./hostname.ts";
import { toCwdInfo } from "./git.ts";
import { resolveAgentStatus } from "./agent.ts";
import type { ActivityInfo } from "kolu-common";

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

    onCwdChange: t.terminal.onCwdChange.handler(async function* ({
      input,
      signal,
    }) {
      const entry = requireTerminal(input.id);

      // Yield current CWD with git context immediately
      yield await toCwdInfo(entry.handle.cwd);

      // Then stream changes, enriching each with git context
      for await (const rawCwd of subscribeAndYield(
        entry.emitter,
        "cwd",
        signal,
      )) {
        yield await toCwdInfo(rawCwd);
      }
    }),

    onActivityChange: t.terminal.onActivityChange.handler(async function* ({
      input,
      signal,
    }) {
      const entry = requireTerminal(input.id);

      /** Enrich a raw activity boolean with foreground process + agent context. */
      function toActivityInfo(isActive: boolean): ActivityInfo {
        const fg = entry.handle.foregroundProcess;
        return {
          isActive,
          foregroundProcess: fg,
          agent: resolveAgentStatus(
            fg,
            isActive,
            entry.handle.getScreenState(),
          ),
        };
      }

      // Yield current state immediately, enriched with agent context
      yield toActivityInfo(entry.isActive);

      // Then stream changes, enriching each with agent context
      for await (const isActive of subscribeAndYield<boolean>(
        entry.emitter,
        "activity",
        signal,
      )) {
        yield toActivityInfo(isActive);
      }
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
