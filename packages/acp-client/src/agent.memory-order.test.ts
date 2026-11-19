import { expect, test } from "vitest";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { make } from "./agent.ts";
import { SAYS_NOTHING } from "./testlib/legs.ts";
import type { AgentEvent } from "./events.ts";
import { MemoryFailure, type MemorySnapshot } from "./memory.ts";

for (const opening of ["new", "load"] as const) {
  for (const fails of [false, true]) {
    test(`${opening} waits for memory ${fails ? "failure" : "success"} before publishing the session`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), "olai-memory-order-"));
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const events: AgentEvent[] = [];
      const remembered: MemorySnapshot[] = [];
      let hold = false;
      const agent = await Effect.runPromise(
        make({
          id: "test-agent",
          leg: SAYS_NOTHING,
          command: process.execPath,
          args: [join(import.meta.dirname, "fixtures/mode-agent.ts")],
          cwd,
          tools: () => [],
          memory: {
            recall: Effect.succeed(null),
            remember: (value) =>
              Effect.gen(function* () {
                if (hold) {
                  entered.resolve();
                  yield* Effect.promise(() => release.promise);
                  if (fails)
                    return yield* new MemoryFailure({
                      why: "test write refused",
                    });
                }
                remembered.push(value);
              }),
          },
          onEvent: (event) => events.push(event),
        }),
      );
      let pending: Promise<void> | undefined;
      try {
        await Effect.runPromise(agent.boot);
        const previous = [...remembered];
        events.length = 0;
        hold = true;
        pending = Effect.runPromise(
          opening === "new" ? agent.newSession : agent.loadSession("stored"),
        );
        await entered.promise;
        // The browser treats the session event as ready/idle. Restarting at
        // that boundary must not race the still-pending local-state write.
        expect(remembered).toEqual(previous);
        expect(events.some((event) => event._tag === "session")).toBe(false);
        release.resolve();
        await pending;
        const session = events.find((event) => event._tag === "session");
        expect(session?._tag).toBe("session");
        if (fails) {
          expect(remembered).toEqual(previous);
          expect(
            events.some(
              (event) =>
                event._tag === "trouble" &&
                event.message.includes(
                  "this conversation will not be restored after a restart: test write refused",
                ),
            ),
          ).toBe(true);
        } else {
          expect(session?._tag === "session" ? session.id : null).toBe(
            remembered.at(-1)?.session ?? null,
          );
        }
      } finally {
        release.resolve();
        await pending;
        await Effect.runPromise(agent.stop);
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
}
