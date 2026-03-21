/**
 * oRPC router: implements the contract with terminal lifecycle and I/O handlers.
 *
 * Streaming uses async generators (eventIterator) over WebSocket.
 * Terminal CRUD is request-response.
 */
import { implement } from "@orpc/server";
import { once } from "node:events";
import { contract } from "kolu-common/contract";
import {
  createTerminal,
  getTerminal,
  listTerminals,
  type TerminalEntry,
  type TerminalEvents,
} from "./registry.ts";

const t = implement(contract);

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalEntry {
  const entry = getTerminal(id);
  if (!entry) throw new Error(`Terminal ${id} not found`);
  return entry;
}

/** Bridge an EventEmitter event to an async iterable, yielding until signal aborts. */
async function* iterateEvent<K extends keyof TerminalEvents>(
  emitter: TerminalEntry["emitter"],
  event: K,
  signal: AbortSignal | undefined,
): AsyncGenerator<TerminalEvents[K][0]> {
  type T = TerminalEvents[K][0];
  const queue: T[] = [];
  let resolve: (() => void) | null = null;

  const handler = (data: T) => {
    queue.push(data);
    resolve?.();
    resolve = null;
  };

  // Wake the consumer loop so it can check signal.aborted and exit
  const onAbort = () => {
    resolve?.();
    resolve = null;
  };

  emitter.on(event, handler);
  signal?.addEventListener("abort", onAbort, { once: true });

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
    signal?.removeEventListener("abort", onAbort);
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
      yield* iterateEvent(entry.emitter, "data", signal);
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
