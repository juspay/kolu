/**
 * oRPC router: implements the contract with terminal lifecycle and I/O handlers.
 *
 * Streaming handlers (attach, onExit) use async generators over WebSocket.
 * Terminal CRUD is request-response.
 */
import { implement } from "@orpc/server";
import { once } from "node:events";
import { contract } from "kolu-common/contract";
import {
  createTerminal,
  getTerminal,
  listTerminals,
  killAllTerminals,
  setTerminalTheme,
  type TerminalEntry,
} from "./registry.ts";

const t = implement(contract);

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalEntry {
  const entry = getTerminal(id);
  if (!entry) throw new Error(`Terminal ${id} not found`);
  return entry;
}

/**
 * Subscribe to an emitter event and yield items as an async iterable.
 *
 * Subscribes BEFORE returning so callers can capture a snapshot between
 * subscription and first yield — any events firing in that gap are queued.
 * Terminates when the AbortSignal fires.
 */
async function* subscribeAndYield(
  emitter: TerminalEntry["emitter"],
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  const queue: string[] = [];
  let resolveNext: (() => void) | null = null;

  const listener = (data: string) => {
    queue.push(data);
    resolveNext?.();
  };
  emitter.on("data", listener);

  const cleanup = () => {
    emitter.off("data", listener);
    resolveNext?.();
  };
  signal?.addEventListener("abort", cleanup, { once: true });

  try {
    while (!signal?.aborted) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
      resolveNext = null;
    }
  } finally {
    cleanup();
    signal?.removeEventListener("abort", cleanup);
  }
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
      const live = subscribeAndYield(entry.emitter, signal);

      const screenState = entry.handle.getScreenState();
      if (screenState) yield screenState;

      yield* live;
    }),

    screenState: t.terminal.screenState.handler(async ({ input }) => {
      return requireTerminal(input.id).handle.getScreenState();
    }),

    killAll: t.terminal.killAll.handler(async () => {
      killAllTerminals();
    }),

    onExit: t.terminal.onExit.handler(async function* ({ input, signal }) {
      const entry = requireTerminal(input.id);

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
