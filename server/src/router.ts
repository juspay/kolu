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
  type TerminalEntry,
} from "./registry.ts";

const t = implement(contract);

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalEntry {
  const entry = getTerminal(id);
  if (!entry) throw new Error(`Terminal ${id} not found`);
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

    attach: t.terminal.attach.handler(async function* ({ input, signal }) {
      const entry = requireTerminal(input.id);

      // Race-free ordering: subscribe to live output FIRST, then capture
      // screen state. Any output arriving during/after getScreenState() is
      // queued and yielded after the screen state.
      const queue: string[] = [];
      let resolveNext: (() => void) | null = null;

      const listener = (data: string) => {
        queue.push(data);
        resolveNext?.();
      };
      entry.emitter.on("data", listener);

      const cleanup = () => {
        entry.emitter.off("data", listener);
        // Unblock the await below so the loop exits on abort
        resolveNext?.();
      };
      signal?.addEventListener("abort", cleanup, { once: true });

      try {
        // Capture screen state AFTER subscription — guarantees no missed output
        const screenState = entry.handle.getScreenState();
        if (screenState) yield screenState;

        // Drain queued output then continue with live stream
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
