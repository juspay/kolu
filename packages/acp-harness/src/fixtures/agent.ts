/**
 * A REAL ACP AGENT, small enough to read — the one the harness's tests talk to.
 *
 * Spawned as `process.execPath <this file>`: Node strips the types itself, so
 * there is no loader, no build step and no second toolchain between a test and
 * the subprocess it is asserting about. The tests spawn this rather than mock a
 * connection because every hazard this package exists to handle — a frame from
 * a session we left, a question still open when a turn is cancelled, a prompt
 * that arrives while the agent is busy — is a fact about TWO processes and a
 * pipe, and a mock that could express it would be the harness written twice.
 *
 * What a turn does is chosen by its prompt text, so one fixture covers the
 * suite:
 *
 *   hello        — one chunk of prose, then `end_turn`
 *   stale        — a frame for a session this client has LEFT, then one for the
 *                  live one; the first must not be drawn
 *   ask          — an `elicitation/create` the agent waits on; `session/cancel`
 *                  ends the turn as `cancelled`
 *   background   — a call that ARMS a background task and does not report back
 *   reap         — ... and the frame that says how that task ended
 *   kolu         — an MCP call to the `kolu` server, with a structured answer
 *   slow         — `end_turn` after a beat, so a second prompt can queue
 *   fail         — a JSON-RPC error, after writing to stderr
 *
 * `servers` is a turn of its own rather than a door of its own: every
 * `session/new` and `session/load` records the server NAMES it was handed, and
 * that turn says the record back — which is how the test that cares whether a
 * LOAD passes the same servers as a NEW asks the only process that knows,
 * through the harness's own door rather than around it.
 */

interface Message {
  readonly id?: unknown;
  readonly method?: string;
  readonly params?: {
    readonly sessionId?: string;
    readonly prompt?: ReadonlyArray<{ readonly text?: string }>;
    readonly mcpServers?: ReadonlyArray<{ readonly name?: string }>;
  };
  readonly result?: unknown;
}

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const respond = (id: unknown, result: unknown): void => {
  write({ jsonrpc: "2.0", id, result });
};

const refuse = (id: unknown, code: number, message: string): void => {
  write({ jsonrpc: "2.0", id, error: { code, message } });
};

const update = (sessionId: string, body: unknown): void => {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update: body },
  });
};

const SESSION = "sess-1";
/** A conversation this client will have LEFT by the time the `stale` turn sends
 *  a frame for it — the leftover the fence is supposed to drop. */
const GHOST = "sess-ghost";

/** The server names handed to each open, in the order the opens happened. */
const handed: Array<ReadonlyArray<string>> = [];
/** The turn whose prompt is still unanswered, so a cancel can end it. */
let openTurn: unknown = null;
/**
 * ONE TURN AT A TIME, with the rest behind it — which is what every agent kolu
 * talks to does with a prompt sent while it is busy, and what the harness's
 * `queued` mark is a claim about. A fixture that answered its prompts in
 * whatever order they finished would make the queue's whole subject —
 * the message waiting its turn, got to in order — unassertable.
 */
const waiting: Array<Message> = [];
let busy = false;

function enqueue(message: Message): void {
  if (busy) {
    waiting.push(message);
    return;
  }
  busy = true;
  turn(message);
}

/** A turn's answer, and the next one off the queue. Every ending goes through
 *  here, including the cancel's, so the queue cannot be left holding a turn
 *  nothing is going to start. */
function finish(id: unknown, stopReason: string): void {
  respond(id, { stopReason });
  busy = false;
  const next = waiting.shift();
  if (next !== undefined) {
    busy = true;
    turn(next);
  }
}
/** Outgoing requests of our own (the elicitation), by id. */
let asked = 0;

process.stderr.write("fixture-agent: started\n");

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim() === "") continue;
    handle(JSON.parse(line) as Message);
  }
});

function handle(message: Message): void {
  switch (message.method) {
    case "initialize":
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        authMethods: [
          { id: "subscription", name: "Claude subscription", type: "terminal" },
        ],
      });
      return;
    case "session/new":
      handed.push(
        (message.params?.mcpServers ?? []).map((one) => one.name ?? ""),
      );
      respond(message.id, { sessionId: SESSION, configOptions: [] });
      return;
    case "session/load":
      handed.push(
        (message.params?.mcpServers ?? []).map((one) => one.name ?? ""),
      );
      respond(message.id, { configOptions: [] });
      return;
    case "session/cancel":
      if (openTurn !== null) {
        finish(openTurn, "cancelled");
        openTurn = null;
      }
      return;
    case "session/prompt":
      enqueue(message);
      return;

    default:
      // A response to a request WE made — the elicitation. Nothing to do: the
      // turn it belongs to ends when the harness cancels or answers.
      if (message.method === undefined && openTurn !== null) {
        finish(openTurn, "end_turn");
        openTurn = null;
      }
      return;
  }
}

function turn(message: Message): void {
  // THE LAST LINE, not the whole message. A real prompt carries kolu's standing
  // instruction above the words somebody typed, and that instruction is prose
  // about asking, waiting and servers — so a fixture that matched anywhere in
  // the body answered the teaching rather than the turn.
  const body = message.params?.prompt?.[0]?.text ?? "";
  const text = body.trimEnd().split("\n").pop() ?? "";
  const says = (body: string): void => {
    update(SESSION, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: body },
    });
  };
  if (text === "servers") {
    // WHAT EVERY OPEN OF THIS PROCESS WAS HANDED, in order — the only process
    // that knows, answering the only question a test can ask it through the
    // harness's own door.
    says(JSON.stringify(handed));
    finish(message.id, "end_turn");
    return;
  }
  if (text === "stale") {
    // The leftover FIRST, so a client that drew it would have it above the
    // live one and no later frame could take it back.
    update(GHOST, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "from the conversation you left" },
    });
    says("live");
    finish(message.id, "end_turn");
    return;
  }
  if (text === "ask") {
    openTurn = message.id;
    write({
      jsonrpc: "2.0",
      id: `elicit-${++asked}`,
      method: "elicitation/create",
      params: {
        sessionId: SESSION,
        mode: "form",
        message: "Which branch should I use?",
        requestedSchema: {
          type: "object",
          properties: {
            branch: { type: "string", title: "Branch" },
          },
          required: ["branch"],
        },
      },
    });
    return;
  }
  if (text === "background") {
    update(SESSION, {
      sessionUpdate: "tool_call",
      toolCallId: "task-1",
      title: "Monitor the build",
      status: "in_progress",
      _meta: {
        background: { task: "build-watch", description: "watch the build" },
      },
    });
    finish(message.id, "end_turn");
    return;
  }
  if (text === "reap") {
    update(SESSION, {
      sessionUpdate: "tool_call_update",
      toolCallId: "task-1",
      status: "completed",
      _meta: { background: { task: "build-watch", ended: "completed" } },
    });
    finish(message.id, "end_turn");
    return;
  }
  if (text === "kolu") {
    update(SESSION, {
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "mcp__kolu__lifecycle_create",
      status: "completed",
      rawInput: {
        placement: { kind: "toplevel" },
        name: "fix-parser",
        agent: "claude",
      },
      rawOutput: { id: "7f3e0a91-0000-4000-8000-000000000000", pid: 42 },
      _meta: { name: "mcp__kolu__lifecycle_create" },
    });
    finish(message.id, "end_turn");
    return;
  }
  if (text === "slow") {
    setTimeout(() => finish(message.id, "end_turn"), 300);
    return;
  }
  if (text === "fail") {
    process.stderr.write("fixture-agent: json-rpc boom\n");
    refuse(message.id, -32603, "the model said no");
    return;
  }
  says("hello back");
  finish(message.id, "end_turn");
}

// A MODULE, not a script: these files import nothing, and two scripts in one
// program share a scope — so `write` here and `write` next door would be one
// redeclared binding rather than two private ones.
export {};
