/**
 * PERMISSION MODES — what the client does with a leg's `bypassMode` on every
 * way a conversation is opened (the boot, a new session, a load), and what a
 * refusal of that mode leaves behind.
 *
 * A REQUIRED mode the agent refuses is a conversation that must not run: the
 * open fails, nothing is remembered, no prompt reaches the agent, and a later
 * open can still recover. An OPTIONAL one is a conversation that runs on the
 * agent's own default and says so.
 *
 * Driven against `mode-agent.ts`, which logs every request it gets to
 * `requests.log` in its working directory and refuses `session/set_mode`
 * while a `reject-mode` file sits beside it.
 */

import { Effect } from "effect";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { type Agent, make } from "./agent.ts";
import type { AgentEvent, MemorySnapshot } from "./index.ts";
import { fixtureAgent } from "./testlib/index.ts";
import { SAYS_NOTHING } from "./testlib/legs.ts";

const run = Effect.runPromise;
/** One turn of plain words, in the BLOCKS a prompt is made of. */
const words = (text: string) => [{ type: "text" as const, text }];

const withAgent = async (
  mode: string | null,
  stored: boolean,
  body: (it: {
    agent: Agent;
    events: AgentEvent[];
    remembered: MemorySnapshot[];
    cwd: string;
    requests: () => Array<{
      method: string;
      params?: { sessionId?: string; modeId?: string };
    }>;
  }) => Promise<void>,
  required = true,
) => {
  const cwd = mkdtempSync(join(tmpdir(), "acp-client-mode-"));
  const events: AgentEvent[] = [];
  const remembered: MemorySnapshot[] = [];
  const agent = await run(
    make({
      id: "test-agent",
      leg: {
        ...SAYS_NOTHING,
        bypassMode: mode,
        bypassModeRequired: required,
      },
      command: process.execPath,
      args: [fixtureAgent("mode-agent.ts"), ...(stored ? ["--stored"] : [])],
      cwd,
      // A PRODUCT'S OWN SERVER, as a composition root hands it over: an
      // endpoint with its bearer line already composed.
      tools: () => [
        {
          kind: "http" as const,
          name: "product",
          url: "http://127.0.0.1:7714/mcp",
          headers: { Authorization: "Bearer test" },
        },
      ],
      memory: {
        recall: Effect.succeed(null),
        remember: (value) =>
          Effect.sync(() => {
            remembered.push(value);
          }),
      },
      onEvent: (event) => events.push(event),
    }),
  );
  try {
    await body({
      agent,
      events,
      remembered,
      cwd,
      requests: () =>
        readFileSync(join(cwd, "requests.log"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
    });
  } finally {
    await run(agent.stop);
    rmSync(cwd, { recursive: true, force: true });
  }
};

describe("session permission selection", () => {
  for (const stored of [false, true]) {
    for (const required of [false, true]) {
      for (const mode of ["full", "human", "auto", null]) {
        test(`${stored ? "restored" : "new"} boot and explicit opens preserve ${mode ?? "default"} (${required ? "required" : "optional"})`, async () => {
          await withAgent(
            mode,
            stored,
            async ({ agent, events, requests }) => {
              for (const open of [
                agent.boot,
                agent.newSession,
                agent.loadSession("stored"),
              ]) {
                await run(open);
                const settings = events.findLast(
                  (event) => event._tag === "settings",
                );
                expect(
                  settings?._tag === "settings"
                    ? settings.settings.find((option) => option.id === "mode")
                        ?.value
                    : undefined,
                ).toBe(mode ?? "default");
                await run(agent.prompt(words("report the preset")));
              }
              expect(
                events
                  .filter((event) => event._tag === "said")
                  .map((event) => event.text),
              ).toEqual([
                mode ?? "default",
                mode ?? "default",
                mode ?? "default",
              ]);
              const calls = requests().filter((call) =>
                [
                  "session/new",
                  "session/load",
                  "session/set_mode",
                  "session/prompt",
                ].includes(call.method),
              );
              expect(calls.map((call) => call.method)).toEqual([
                stored ? "session/load" : "session/new",
                ...(mode ? ["session/set_mode"] : []),
                "session/prompt",
                "session/new",
                ...(mode ? ["session/set_mode"] : []),
                "session/prompt",
                "session/load",
                ...(mode ? ["session/set_mode"] : []),
                "session/prompt",
              ]);
              for (let i = 0; i < calls.length; i++) {
                if (mode === null || calls[i]?.method !== "session/set_mode")
                  continue;
                expect(calls[i]?.params).toEqual({
                  modeId: mode,
                  sessionId: calls[i + 1]?.params?.sessionId,
                });
              }
            },
            required,
          );
        });
      }
    }
    test(`rejected ${stored ? "restored" : "new"} boot cannot admit a later prompt; retry can recover`, async () => {
      await withAgent(
        "full",
        stored,
        async ({ agent, events, remembered, cwd, requests }) => {
          writeFileSync(join(cwd, "reject-mode"), "");
          for (const action of [
            agent.boot,
            agent.prompt(words("must not run")),
          ]) {
            const result = await run(Effect.result(action));
            expect(result._tag).toBe("Failure");
            if (result._tag === "Failure")
              expect(result.failure.why).toContain(
                "the permission mode `full` was not selected",
              );
          }
          expect(
            events.some(
              (event) =>
                event._tag === "trouble" &&
                event.message.includes("mode selection refused"),
            ),
          ).toBe(true);
          expect(events.some((event) => event._tag === "session")).toBe(false);
          expect(remembered).toEqual([]);
          await run(agent.sessions); // The fixture sends a late chunk before the list response.
          expect(
            events.some(
              (event) =>
                event._tag === "said" && event.text === "late refused history",
            ),
          ).toBe(false);
          expect(
            requests().some((call) => call.method === "session/prompt"),
          ).toBe(false);
          rmSync(join(cwd, "reject-mode"));
          await run(agent.prompt(words("retry")));
          expect(
            events.some(
              (event) => event._tag === "said" && event.text === "full",
            ),
          ).toBe(true);
        },
      );
    });
  }
  for (const stored of [false, true]) {
    test(`optional mode refusal keeps ${stored ? "loaded" : "new"} boot and subsequent opens usable`, async () => {
      await withAgent(
        "full",
        stored,
        async ({ agent, events, remembered, cwd, requests }) => {
          writeFileSync(join(cwd, "reject-mode"), "");
          for (const open of [
            agent.boot,
            agent.newSession,
            agent.loadSession("stored"),
          ]) {
            events.length = 0;
            const count = remembered.length;
            await run(open);
            expect(events.some((event) => event._tag === "session")).toBe(true);
            expect(remembered).toHaveLength(count + 1);
            expect(
              events.some(
                (event) =>
                  event._tag === "trouble" &&
                  event.message.includes("mode selection refused"),
              ),
            ).toBe(true);
            const settings = events.findLast(
              (event) => event._tag === "settings",
            );
            expect(
              settings?._tag === "settings"
                ? settings.settings.find((option) => option.id === "mode")
                    ?.value
                : undefined,
            ).toBe("default");
            await run(agent.prompt(words("use the existing permissions")));
            expect(
              events.some(
                (event) => event._tag === "said" && event.text === "default",
              ),
            ).toBe(true);
          }
          expect(
            requests().filter((call) => call.method === "session/set_mode"),
          ).toHaveLength(3);
          expect(
            requests().filter((call) => call.method === "session/prompt"),
          ).toHaveLength(3);
          rmSync(join(cwd, "reject-mode"));
          await run(agent.loadSession("stored"));
          await run(agent.prompt(words("selection now succeeds")));
          expect(
            events.some(
              (event) => event._tag === "said" && event.text === "full",
            ),
          ).toBe(true);
        },
        false,
      );
    });
  }
  for (const opening of ["new", "load"] as const) {
    test(`rejected explicit ${opening} does not retain the previous active session`, async () => {
      await withAgent(
        "full",
        false,
        async ({ agent, cwd, events, remembered, requests }) => {
          await run(agent.boot);
          const count = remembered.length;
          events.length = 0;
          writeFileSync(join(cwd, "reject-mode"), "");
          const result = await run(
            Effect.result(
              opening === "new"
                ? agent.newSession
                : agent.loadSession("stored"),
            ),
          );
          expect(result._tag).toBe("Failure");
          if (result._tag === "Failure")
            expect(result.failure.why).toContain("mode selection refused");
          expect(events.some((event) => event._tag === "session")).toBe(false);
          expect(remembered).toHaveLength(count);
          expect(
            (await run(Effect.result(agent.prompt(words("must not run")))))
              ._tag,
          ).toBe("Failure");
          expect(
            requests().some((call) => call.method === "session/prompt"),
          ).toBe(false);
        },
      );
    });
  }
});
