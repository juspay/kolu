/**
 * THE ACP ADAPTER THE E2E SUITE RUNS — a scripted agent on stdio.
 *
 * `KOLU_ACP_AGENT` points at this file, so the orchestrator the browser talks
 * to is a real subprocess speaking the real protocol over a real pipe: padi
 * spawns it, the harness handshakes with it, and every frame the panel draws
 * is a frame an agent could have sent. What it is NOT is a mock of the
 * harness — the scenarios exercise the whole chain, and a stubbed store would
 * have proved only that the browser can render a value somebody put there.
 *
 * It answers on the LAST LINE of a prompt, because the standing instruction
 * kolu teaches every new session rides above the person's words. The vocabulary
 * is small and each entry exists for one scenario:
 *
 *   say hello        — prose, so a round trip has something to assert
 *   adopt <id>       — a `lifecycle_create` call naming its host and answering
 *                      with the fleet ref `local/<id>`, so the card names a
 *                      host and a terminal that really exist
 *   use its own tool — a call named the way an agent's OWN tool is named, which
 *                      must get the generic card and never a kolu reading
 *   ask me something — a form elicitation, which stops the turn until a person
 *                      answers; the turn ends when they do
 *   work slowly      — a turn that stays open long enough for a second prompt
 *                      to be marked `queued` behind it
 *   refuse this      — a JSON-RPC error, which is a turn that ENDED rather than
 *                      an agent that has gone
 *
 * Turns are served FIFO and one at a time: `queued` is a fact about the agent's
 * own queue, so an adapter that answered out of order could not be used to
 * assert it.
 */

const SESSION = "kolu-e2e-session";

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const respond = (id: unknown, result: unknown): void => {
  write({ jsonrpc: "2.0", id, result });
};

const refuse = (id: unknown, message: string): void => {
  write({ jsonrpc: "2.0", id, error: { code: -32603, message } });
};

const update = (frame: unknown): void => {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: SESSION, update: frame },
  });
};

/** A request this end makes OF the client — the one direction a scripted agent
 *  needs, for the elicitation that stops a turn. */
let nextRequestId = 1;
const pendingAsks = new Map<string, () => void>();
const askClient = (params: unknown, onAnswered: () => void): void => {
  const id = nextRequestId++;
  pendingAsks.set(String(id), onAnswered);
  write({ jsonrpc: "2.0", id, method: "elicitation/create", params });
};

interface Incoming {
  readonly id?: unknown;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly params?: {
    readonly prompt?: ReadonlyArray<{ readonly text?: string }>;
  };
}

/** The agent's own word for the turn, sent only once the work is done — so a
 *  scenario that waits for prose is waiting on the same thing the panel is. */
const endTurn = (id: unknown): void => respond(id, { stopReason: "end_turn" });

const lastLine = (message: Incoming): string => {
  const whole = (message.params?.prompt ?? [])
    .map((block) => block.text ?? "")
    .join("\n")
    .trimEnd();
  const lines = whole.split("\n");
  return (lines[lines.length - 1] ?? "").trim();
};

/** One turn at a time, in arrival order. The agent is where a queue lives, so
 *  this is the fixture's half of the `queued` mark. */
const queue: Array<() => Promise<void>> = [];
let draining = false;
const enqueue = (run: () => Promise<void>): void => {
  queue.push(run);
  if (draining) return;
  draining = true;
  void (async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next !== undefined) await next();
    }
    draining = false;
  })();
};

/** WHAT THE CLI SAYS ABOUT THE SERVERS IT WAS HANDED, in the one message kolu's
 *  Claude leg reads it from — the adapter forwards the CLI's `system`/`init`
 *  over `_claude/sdkMessage`, and `liveServersIn` reads `mcp_servers` off it.
 *
 *  Sent at the START OF EVERY TURN, which is where the real CLI sends it and
 *  therefore the only moment the roster can ever leave `handed`. A conversation
 *  nobody has spoken to says `handed` forever, and that is the truth: nothing
 *  has reported either way.
 *
 *  It says `connected` because this fixture IS reachable — padi proves its
 *  rendezvous before it hands the path over, so a conversation that opened at
 *  all is one whose kolu server was there. */
const reportServers = (): void => {
  write({
    jsonrpc: "2.0",
    method: "_claude/sdkMessage",
    params: {
      sessionId: SESSION,
      message: {
        type: "system",
        subtype: "init",
        mcp_servers: [{ name: "kolu", status: "connected" }],
      },
    },
  });
};

const turn = async (id: unknown, text: string): Promise<void> => {
  reportServers();
  if (text === "refuse this") {
    refuse(id, "the model said no");
    return;
  }
  if (text === "work slowly") {
    const slept = Promise.withResolvers<void>();
    setTimeout(slept.resolve, 1500);
    await slept.promise;
    endTurn(id);
    return;
  }
  if (text.startsWith("adopt ")) {
    const terminalId = text.slice("adopt ".length).trim();
    // THE FLEET GRAMMAR, both halves. One conversation covers every host, so
    // `lifecycle_create` is the call that NAMES its host (it has no terminal
    // yet to carry one) and answers with a `host/id` ref. The suite's worker
    // has exactly one padi, so that host is `local` — but the shape is the
    // fleet's, which is what the card reads to say which machine the agent
    // typed on and which tab its *open tile* goes to. A bare id here would
    // leave the card hostless and nothing to open.
    update({
      sessionUpdate: "tool_call",
      toolCallId: "call-create",
      title: "lifecycle_create",
      kind: "other",
      status: "in_progress",
      rawInput: {
        name: "fix-parser",
        cwd: "/tmp/kolu-e2e",
        agent: "claude",
        host: "local",
      },
      _meta: { claudeCode: { toolName: "mcp__kolu__lifecycle_create" } },
    });
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-create",
      status: "completed",
      rawOutput: { id: `local/${terminalId}` },
    });
    endTurn(id);
    return;
  }
  if (text === "use its own tool") {
    update({
      sessionUpdate: "tool_call",
      toolCallId: "call-bash",
      title: "Bash",
      kind: "execute",
      status: "completed",
      rawInput: { command: "echo hi" },
      _meta: { claudeCode: { toolName: "Bash" } },
    });
    endTurn(id);
    return;
  }
  if (text === "ask me something") {
    const answered = Promise.withResolvers<void>();
    askClient(
      {
        sessionId: SESSION,
        mode: "form",
        message: "Retention in days for the new bucket?",
        requestedSchema: {
          type: "object",
          properties: {
            days: {
              type: "string",
              title: "Retention",
              enum: ["7", "30"],
              enumNames: ["7 days", "30 days"],
            },
          },
          required: ["days"],
        },
      },
      answered.resolve,
    );
    await answered.promise;
    endTurn(id);
    return;
  }
  update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "hello back" },
  });
  endTurn(id);
};

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim() === "") continue;
    const message = JSON.parse(line) as Incoming;
    // An ANSWER to the elicitation this end asked — the only reply the fixture
    // reads, and what releases the turn that was waiting on a person.
    // An ANSWER to the elicitation this end asked. Keyed by the id as a
    // STRING: JSON-RPC allows a string or a number, the SDK is free to echo
    // either, and a map keyed by number silently misses a string echo — which
    // leaves the turn waiting forever and every later prompt `queued` behind
    // it, in a scenario that looks like it is about something else entirely.
    if (message.method === undefined && message.id !== undefined) {
      const release = pendingAsks.get(String(message.id));
      if (release !== undefined) {
        pendingAsks.delete(String(message.id));
        release();
      }
      continue;
    }
    switch (message.method) {
      case "initialize":
        // `promptCapabilities.image` is OPT-IN at the AGENT's end in ACP, and
        // the harness refuses a picture nobody advertised for — before any row
        // is minted, so a fixture that stayed silent here made a pasted image
        // vanish with only a toast to say why. This end can take one: the
        // image block rides the prompt and the turn answers as usual.
        respond(message.id, {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: true },
          },
        });
        continue;
      case "session/new":
        respond(message.id, { sessionId: SESSION });
        continue;
      case "session/load":
        // padi keeps the transcript, so a load has nothing to replay — it only
        // has to accept the id it minted, which is what resume IS.
        respond(message.id, {});
        continue;
      case "session/set_config_option":
        respond(message.id, {});
        continue;
      case "session/cancel":
        continue;
      case "session/prompt": {
        const text = lastLine(message);
        enqueue(() => turn(message.id, text));
        continue;
      }
      default:
        if (message.id !== undefined) respond(message.id, {});
        continue;
    }
  }
});

export {};
