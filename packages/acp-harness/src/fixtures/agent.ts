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
 * EVERY OPEN GETS ITS OWN SESSION ID, the way a real agent's does. A fixture
 * that answered `sess-1` to every `session/new` made the leftover-frame fence
 * untestable: the id a client had just left and the id it had just entered
 * were the same string, so a stale frame addressed to the first was news about
 * the second whatever the client did.
 *
 * What a turn does is chosen by its prompt text, so one fixture covers the
 * suite:
 *
 *   hello        — one chunk of prose, then `end_turn`
 *   stale        — a frame for the session this client has LEFT (the real id
 *                  of the previous open), then one for the live one; the first
 *                  must not be drawn
 *   ask          — an `elicitation/create` the agent waits on; `session/cancel`
 *                  ends the turn as `cancelled`
 *   background   — a call that ARMS a background task and does not report back
 *   reap         — ... and the frame that says how that task ended
 *   kolu         — an MCP call to the `kolu` server, with a structured answer
 *   slow         — a turn held open until a SECOND prompt arrives, so one can
 *                  be queued behind it without anybody timing anything
 *   fail         — a JSON-RPC error, after writing to stderr
 *   roster       — one of the agent's own forwarded messages, naming the model
 *                  it is running and what it reached of the servers it was
 *                  handed
 *
 * Four more turns say back what this process was TOLD, which is the only way a
 * test can ask the one thing that knows: `servers` says the server names every
 * open was handed, `meta` the `_meta` each open carried, `modes` the permission
 * modes that were asked for, and `prompts` the bodies of the prompts that have
 * arrived. Through the harness's own door rather than around it.
 *
 * `session/set_mode` REFUSES anything but `bypassPermissions`, which is how one
 * fixture covers both halves of the bypass rule: the mode a leg really asks for
 * is confirmed, and a leg that asks for another gets the refusal that must not
 * be fatal.
 */

interface Message {
  readonly id?: unknown;
  readonly method?: string;
  readonly params?: {
    readonly sessionId?: string;
    readonly modeId?: string;
    readonly configId?: string;
    readonly value?: string;
    readonly prompt?: ReadonlyArray<{ readonly text?: string }>;
    readonly mcpServers?: ReadonlyArray<{ readonly name?: string }>;
    readonly _meta?: unknown;
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

/** The conversation this process is in, and the one before it. A fresh id per
 *  `session/new` — `sess-1`, `sess-2`, … — so "the session we left" is a
 *  different string from "the session we are in", which is the whole subject of
 *  the leftover fence. */
let opened = 0;
let session = "sess-1";
let previous: string | null = null;

/** The model this conversation is on, as the picker's own value. Moved by
 *  `session/set_config_option` and reported back in `configOptions`, which is
 *  how a client's remembered model is put back after an open. */
let model = "default";

/** The server names handed to each open, in the order the opens happened. */
const handed: Array<ReadonlyArray<string>> = [];
/** ... and the `_meta` each open carried, same order. */
const metas: Array<unknown> = [];
/** ... and every permission mode asked for, as `[session, mode]`. */
const modes: Array<ReadonlyArray<string>> = [];
/** ... and the BODY of every prompt that has arrived, whole — what the teaching
 *  test needs, because "did the standing prompt ride the second turn" is a
 *  question about a string nobody but this process ever sees. */
const prompts: Array<string> = [];

/** The turn whose prompt is still unanswered, so a cancel can end it. */
let openTurn: unknown = null;
/** ... and the `slow` turn, which is held open until a SECOND prompt arrives.
 *  A TRIGGER rather than a timer: the test about a queued message is about the
 *  message waiting its turn, and a fixture that released on a clock made it a
 *  test about how fast a machine is. */
let slowTurn: unknown = null;
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
    // The second prompt is what lets the first one go: see `slowTurn`.
    if (slowTurn !== null) {
      const held = slowTurn;
      slowTurn = null;
      finish(held, "end_turn");
    }
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

/** The settings this conversation reports: a model picker whose values are
 *  ALIASES (so the harness's own picker reading is exercised) and a mode
 *  selector, which is the row a confirmed `session/set_mode` has to move. */
const configOptions = () => [
  {
    id: "model",
    name: "Model",
    type: "select",
    category: "model",
    currentValue: model,
    options: [
      { value: "default", name: "Default" },
      { value: "sonnet", name: "Sonnet" },
      { value: "haiku", name: "Haiku" },
    ],
  },
  {
    id: "mode",
    name: "Permission mode",
    type: "select",
    category: "mode",
    currentValue: "default",
    options: [
      { value: "default", name: "Ask every time" },
      { value: "bypassPermissions", name: "Bypass permissions" },
    ],
  },
];

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
      opened += 1;
      previous = opened === 1 ? null : session;
      session = `sess-${opened}`;
      handed.push(
        (message.params?.mcpServers ?? []).map((one) => one.name ?? ""),
      );
      metas.push(message.params?._meta ?? null);
      respond(message.id, {
        sessionId: session,
        configOptions: configOptions(),
      });
      return;
    case "session/load":
      previous = session === message.params?.sessionId ? previous : session;
      session = message.params?.sessionId ?? session;
      handed.push(
        (message.params?.mcpServers ?? []).map((one) => one.name ?? ""),
      );
      metas.push(message.params?._meta ?? null);
      // A LOAD REPLAYS, then answers — and what it replays is TWO unlike
      // things down one stream. These two frames are the conversation this
      // client is coming back to, as the agent remembers it: history the
      // client already holds, which is what makes dropping them the point.
      update(session, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "what did I ask you before?" },
      });
      update(session, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "the answer you already have" },
      });
      // ... and these two are the session AS IT STANDS — the slash commands it
      // offers and how full its context is. Nobody but this process knows
      // either, so a client that dropped the whole stream would come back to a
      // conversation with no completion and no context meter.
      update(session, {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "compact", description: "summarise the conversation" },
          { name: "cost", description: "what this has cost" },
        ],
      });
      update(session, {
        sessionUpdate: "usage_update",
        used: 22102,
        size: 200000,
      });
      respond(message.id, { configOptions: configOptions() });
      return;
    case "session/set_mode":
      // POSITIVELY: the one mode this fixture has, and a refusal for anything
      // else — the shape a host that cannot have the mode really answers with.
      if (message.params?.modeId !== "bypassPermissions") {
        refuse(
          message.id,
          -32602,
          `mode \`${message.params?.modeId ?? ""}\` is not available here`,
        );
        return;
      }
      modes.push([
        message.params?.sessionId ?? "",
        message.params?.modeId ?? "",
      ]);
      // Acknowledged WITHOUT a `config_option_update`, exactly as the pinned
      // adapter does: whether the mode row on screen follows is the client's
      // problem to solve, and it is one the client is supposed to have solved.
      respond(message.id, {});
      return;
    case "session/set_config_option":
      if (message.params?.configId !== "model") {
        refuse(message.id, -32602, "there is no such setting");
        return;
      }
      // A VALUE THE PICKER DOES NOT OFFER IS REFUSED, which is what a real
      // agent does with one: the conversation stays on the model it was on,
      // and the client has a refusal to report rather than a confirmation of
      // something that did not happen.
      if (
        !["default", "sonnet", "haiku"].includes(message.params?.value ?? "")
      ) {
        refuse(
          message.id,
          -32602,
          `no model is called \`${message.params?.value ?? ""}\``,
        );
        return;
      }
      model = message.params?.value ?? model;
      respond(message.id, { configOptions: configOptions() });
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
  prompts.push(body);
  const text = body.trimEnd().split("\n").pop() ?? "";
  const says = (said: string): void => {
    update(session, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: said },
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
  if (text === "meta") {
    says(JSON.stringify(metas));
    finish(message.id, "end_turn");
    return;
  }
  if (text === "modes") {
    says(JSON.stringify(modes));
    finish(message.id, "end_turn");
    return;
  }
  if (text === "prompts") {
    // Every prompt BODY this process has been sent, whole and in order — minus
    // this one, which is the question rather than the subject.
    says(JSON.stringify(prompts.slice(0, -1)));
    finish(message.id, "end_turn");
    return;
  }
  if (text === "stale") {
    // The leftover FIRST, so a client that drew it would have it above the
    // live one and no later frame could take it back. Addressed to the id this
    // client really held a moment ago, which is the only version of this frame
    // the fence has to catch.
    update(previous ?? "sess-0", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "from the conversation you left" },
    });
    says("live");
    finish(message.id, "end_turn");
    return;
  }
  if (text === "roster") {
    // ONE OF THE AGENT'S OWN MESSAGES, forwarded because the open asked for it
    // — the model this turn is really running on, and what the agent reached
    // of the servers it was handed. `ghost` is a server nobody gave it: a row
    // for that one would be the roster answering a question nobody asked.
    write({
      jsonrpc: "2.0",
      method: "_test/raw",
      params: {
        model: "sonnet",
        servers: [
          { name: "kolu", status: "connected" },
          { name: "ghost", status: "connected" },
        ],
      },
    });
    says("said");
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
        sessionId: session,
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
    update(session, {
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
    update(session, {
      sessionUpdate: "tool_call_update",
      toolCallId: "task-1",
      status: "completed",
      _meta: { background: { task: "build-watch", ended: "completed" } },
    });
    finish(message.id, "end_turn");
    return;
  }
  if (text === "kolu") {
    update(session, {
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
    slowTurn = message.id;
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
