/**
 * oRPC router: implements the contract with terminal lifecycle and I/O handlers.
 *
 * Streaming handlers (attach, onExit) use async generators over WebSocket.
 * Terminal CRUD is request-response.
 */
import { implement } from "@orpc/server";
import { once } from "node:events";
import { contract } from "kolu-common/contract";
import { TerminalNotFoundError } from "kolu-common/errors";
import {
  createTerminal,
  getTerminal,
  listTerminals,
  killAllTerminals,
  setTerminalTheme,
  type TerminalEntry,
} from "./terminals.ts";
import { subscribeAndYield } from "./streaming.ts";
import { log } from "./log.ts";

const t = implement(contract);

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalEntry {
  const entry = getTerminal(id);
  if (!entry) throw new TerminalNotFoundError(id);
  return entry;
}

export const appRouter = t.router({
  terminal: {
    create: t.terminal.create.handler(async () => createTerminal()),
    list: t.terminal.list.handler(async () => listTerminals()),

    resize: t.terminal.resize.handler(async ({ input }) => {
      requireTerminal(input.id).handle.resize(input.cols, input.rows);
    }),

    sendInput: t.terminal.sendInput.handler(async ({ input }) => {
      requireTerminal(input.id).handle.write(input.data);
    }),

    setTheme: t.terminal.setTheme.handler(async ({ input }) => {
      requireTerminal(input.id); // validate terminal exists
      log.info({ id: input.id, theme: input.themeName }, "terminal theme set");
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
      log.info({ id: input.id }, "attach stream started");

      // Subscribe FIRST, then serialize — any output between these two
      // steps is queued inside the generator, not lost.
      const live = subscribeAndYield(entry.emitter, "data", signal);

      const screenState = entry.handle.getScreenState();
      if (screenState) yield screenState;

      try {
        yield* live;
      } finally {
        log.info({ id: input.id }, "attach stream ended");
      }
    }),

    screenState: t.terminal.screenState.handler(async ({ input }) => {
      return requireTerminal(input.id).handle.getScreenState();
    }),

    killAll: t.terminal.killAll.handler(async () => {
      killAllTerminals();
    }),

    onExit: t.terminal.onExit.handler(async function* ({ input, signal }) {
      const entry = requireTerminal(input.id);
      log.info({ id: input.id, status: entry.status }, "onExit stream started");

      // If already exited, yield immediately
      if (entry.status === "exited") {
        yield entry.exitCode;
        return;
      }

      // events.once() handles abort cleanup internally — no manual listener wiring needed
      const [exitCode] = (await once(entry.emitter, "exit", {
        signal,
      })) as [number];

      if (!signal?.aborted) yield exitCode;
    }),
  },
});
