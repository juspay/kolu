/**
 * oRPC router: implements the contract with terminal lifecycle and I/O handlers.
 *
 * Streaming uses async generators (eventIterator) over WebSocket.
 * Terminal CRUD is request-response.
 */
import { implement } from "@orpc/server";
import { contract } from "kolu-common/contract";
import {
  createTerminal,
  getTerminal,
  listTerminals,
  type TerminalEntry,
} from "./registry.ts";

const t = implement(contract);

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalEntry {
  const entry = getTerminal(id);
  if (!entry) throw new Error(`Terminal ${id} not found`);
  return entry;
}

/** Bridge an EventEmitter event to an async iterable, yielding until signal aborts. */
async function* iterateEvent<T>(
  emitter: TerminalEntry["emitter"],
  event: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  const queue: T[] = [];
  let resolve: (() => void) | null = null;

  const handler = (data: T) => {
    queue.push(data);
    resolve?.();
    resolve = null;
  };

  emitter.on(event, handler);
  signal?.addEventListener("abort", () => emitter.off(event, handler));

  try {
    while (!signal?.aborted) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
    }
  } finally {
    emitter.off(event, handler);
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

    attach: t.terminal.attach.handler(async function* ({ input, signal }) {
      const entry = requireTerminal(input.id);

      // Replay scrollback first so late-joining clients see prior output
      const scrollback = entry.handle.getScrollback();
      if (scrollback.length > 0) yield scrollback.toString("utf-8");

      // Then stream live output via queue-based async iteration
      yield* iterateEvent<string>(entry.emitter, "data", signal);
    }),

    onExit: t.terminal.onExit.handler(async function* ({ input, signal }) {
      const entry = requireTerminal(input.id);

      // If already exited, yield immediately
      if (entry.status === "exited") {
        yield entry.exitCode;
        return;
      }

      // Wait for exit event (can't reuse iterateEvent — this is a one-shot "once")
      const exitCode = await new Promise<number>((resolveExit) => {
        const onExit = (code: number) => resolveExit(code);
        entry.emitter.once("exit", onExit);
        signal?.addEventListener("abort", () =>
          entry.emitter.off("exit", onExit),
        );
      });

      if (!signal?.aborted) yield exitCode;
    }),
  },
});
