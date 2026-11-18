#!/usr/bin/env bun
/**
 * An ACP agent that, on the SECOND `session/new`, first emits leftovers from
 * the conversation just closed — a forwarded `init` with servers `connected`,
 * and a `session/update` chunk of the last turn — and only then answers.
 *
 * ITS PRIVATE CHANNEL IS MADE UP, and deliberately: it used to be the Claude
 * Code adapter's own `_claude/sdkMessage`, which put one engine's spelling in a
 * core package after the engines became plugins. What this fixture is about is
 * a WINDOW in `agent.ts` — a message forwarded for a conversation that has
 * closed — and any wire that forwards messages has it. The leg the bench reads
 * it with is the matching fixture (`../agents/legs.testlib.ts`'s `FORWARDS`);
 * each real engine's own spelling is asserted in that engine's package.
 *
 * That is the load-shaped window the conversations-servers flake sits in:
 * olai has already announced the next roster as `handed` and emptied the
 * transcript, and `session` is still null waiting for this answer. Pre-fix,
 * both leftovers land. Post-fix, neither does.
 *
 * `session/load` of the first conversation still replays, so the un-close
 * that makes a return visit draw is pinned beside the drop.
 */

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const respond = (id: unknown, result: unknown): void => {
  write({ jsonrpc: "2.0", id, result });
};

const notify = (method: string, params: unknown): void => {
  write({ jsonrpc: "2.0", method, params });
};

const leftoverInit = (sessionId: string): void => {
  notify("_x/agentMessage", {
    sessionId,
    opened: {
      model: "fake-model-1",
      servers: [{ name: "olai", live: true }],
    },
  });
};

const leftoverSaid = (sessionId: string): void => {
  notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "leftover from the last conversation" },
    },
  });
};

export {};

let pending = "";
let news = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim() === "") continue;
    const message = JSON.parse(line) as {
      readonly id?: unknown;
      readonly method?: string;
      readonly params?: {
        readonly prompt?: ReadonlyArray<{ readonly text?: string }>;
        readonly sessionId?: string;
        readonly _meta?: { readonly forward?: unknown };
      };
    };
    switch (message.method) {
      case "initialize":
        respond(message.id, {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
        });
        continue;
      case "session/new": {
        news += 1;
        const sessionId = `sess-${news}`;
        if (news >= 2) {
          leftoverInit("sess-1");
          leftoverSaid("sess-1");
        }
        respond(message.id, { sessionId });
        continue;
      }
      case "session/prompt": {
        leftoverInit("sess-1");
        respond(message.id, { stopReason: "end_turn" });
        continue;
      }
      case "session/set_mode":
        respond(message.id, {});
        continue;
      case "session/load": {
        const sessionId = message.params?.sessionId ?? "sess-1";
        leftoverSaid(sessionId);
        leftoverInit(sessionId);
        respond(message.id, {});
        continue;
      }
    }
  }
});
