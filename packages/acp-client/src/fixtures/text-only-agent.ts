/**
 * AN AGENT THAT TAKES TEXT AND NOTHING ELSE — the advertisement an attachment
 * is refused against.
 *
 * ACP makes every block beyond text OPT-IN at the AGENT's end: an `image` needs
 * `promptCapabilities.image` and an embedded file needs `embeddedContext`, and
 * an agent that advertises neither — as this one does by saying nothing about
 * them — is one those blocks are not legal to send to. The pinned Claude
 * adapter advertises both, so the only way to test the refusal is a second
 * process that advertises neither.
 *
 * It opens a conversation and answers a prompt, because the refusal under test
 * is kolu's own and happens BEFORE anything reaches the wire: a harness that
 * could not come up against this fixture would be testing bring-up instead.
 */

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

interface Message {
  readonly id?: unknown;
  readonly method?: string;
  readonly params?: { readonly sessionId?: string };
}

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim() === "") continue;
    const message = JSON.parse(line) as Message;
    if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          // NOTHING about what a prompt may carry. An absent
          // `promptCapabilities` is the honest shape of an agent that takes
          // text and resource links and no more.
          agentCapabilities: { loadSession: true },
          authMethods: [],
        },
      });
      continue;
    }
    if (message.method === "session/new") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: "sess-1", configOptions: [] },
      });
      continue;
    }
    // The permission mode a leg asks for on every open, and the prompt itself.
    // Answered rather than ignored: a request nobody replies to is a bring-up
    // that hangs until the boot deadline, which is a worse test failure than
    // any assertion.
    if (message.method === "session/set_mode") {
      write({ jsonrpc: "2.0", id: message.id, result: {} });
      continue;
    }
    if (message.method === "session/prompt") {
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params?.sessionId ?? "sess-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "text is all I take" },
          },
        },
      });
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: { stopReason: "end_turn" },
      });
    }
  }
});

// A MODULE, not a script: these files import nothing, and two scripts in one
// program share a scope — so `write` here and `write` next door would be one
// redeclared binding rather than two private ones.
export {};
