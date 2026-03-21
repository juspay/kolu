/**
 * oRPC router: implements the contract with terminal lifecycle and I/O handlers.
 *
 * Streaming uses async generators (eventIterator) over WebSocket.
 * Terminal CRUD is request-response.
 */
import { implement } from "@orpc/server";
import { contract } from "kolu-common/contract";
import { createTerminal, getTerminal, listTerminals } from "./registry.ts";

const t = implement(contract);

export const appRouter = t.router({
  terminal: {
    create: t.terminal.create.handler(async () => {
      return createTerminal();
    }),

    list: t.terminal.list.handler(async () => {
      return listTerminals();
    }),

    resize: t.terminal.resize.handler(async ({ input }) => {
      const entry = getTerminal(input.id);
      if (!entry) throw new Error(`Terminal ${input.id} not found`);
      entry.handle.resize(input.cols, input.rows);
    }),

    sendInput: t.terminal.sendInput.handler(async ({ input }) => {
      const entry = getTerminal(input.id);
      if (!entry) throw new Error(`Terminal ${input.id} not found`);
      entry.handle.write(input.data);
    }),

    attach: t.terminal.attach.handler(async function* ({ input, signal }) {
      const entry = getTerminal(input.id);
      if (!entry) throw new Error(`Terminal ${input.id} not found`);

      // Replay scrollback first
      const scrollback = entry.handle.getScrollback();
      if (scrollback.length > 0) {
        yield scrollback.toString("utf-8");
      }

      // Then stream live output via queue-based async iteration
      const queue: string[] = [];
      let resolve: (() => void) | null = null;

      const onData = (data: string) => {
        queue.push(data);
        if (resolve) {
          resolve();
          resolve = null;
        }
      };

      entry.emitter.on("data", onData);
      signal?.addEventListener("abort", () => {
        entry.emitter.off("data", onData);
      });

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
        entry.emitter.off("data", onData);
      }
    }),

    onExit: t.terminal.onExit.handler(async function* ({ input, signal }) {
      const entry = getTerminal(input.id);
      if (!entry) throw new Error(`Terminal ${input.id} not found`);

      // If already exited, yield immediately
      if (entry.status === "exited") {
        yield entry.exitCode;
        return;
      }

      // Wait for exit
      const exitCode = await new Promise<number>((resolveExit) => {
        const onExit = (code: number) => resolveExit(code);
        entry.emitter.once("exit", onExit);
        signal?.addEventListener("abort", () => {
          entry.emitter.off("exit", onExit);
        });
      });

      if (!signal?.aborted) {
        yield exitCode;
      }
    }),
  },
});
