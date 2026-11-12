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
 *   die          — the process EXITS mid-turn, which is an adapter that
 *                  crashed: no answer, a closed pipe, and a client that has
 *                  to notice by itself
 *   roster       — one of the agent's own forwarded messages, naming the model
 *                  it is running and what it reached of the servers it was
 *                  handed
 *   groups       — a `config_option_update` whose model picker sorts its rows
 *                  under HEADINGS, which ACP allows and this adapter does not
 *                  send: only the leaves are values anybody can pick
 *   recorded     — the `config_option_update` the pinned adapter REALLY sent,
 *                  recorded off a live session, and one of the agent's own
 *                  forwarded messages naming a model only that payload offers
 *
 * Six more turns say back what this process was TOLD, which is the only way a
 * test can ask the one thing that knows: `servers` says the server names every
 * open was handed and `serverShapes` those entries verbatim (the stdio/http
 * arm is a key's presence, not a name), `meta` the `_meta` each open carried,
 * `modes` the permission
 * modes that were asked for, `prompts` the bodies of the prompts that have
 * arrived, and `blocks` their CONTENT BLOCKS — whether an attachment really
 * crossed the pipe as an `image`, a `resource` or a `resource_link` is a
 * question only this end can answer. Through the harness's own door rather
 * than around it.
 *
 * `session/set_mode` REFUSES anything but `bypassPermissions`, which is how one
 * fixture covers both halves of the bypass rule: the mode a leg really asks for
 * is confirmed, and a leg that asks for another gets the refusal that must not
 * be fatal. `session/set_config_option` refuses a STRING for the boolean
 * setting, exactly as the pinned adapter refuses one.
 *
 * `session/load` ANSWERS TO THE ID IT IS ASKED FOR, the way a real store does:
 * `gone-…` is a conversation this agent does not have (`-32002 Resource not
 * found: <id>`, the pinned adapter's own refusal for a session id its CLI has
 * forgotten) and `locked-…` is one it will not open for want of a signature
 * (`-32000`). Anything else loads.
 */

interface Message {
  readonly id?: unknown;
  readonly method?: string;
  readonly params?: {
    readonly sessionId?: string;
    readonly modeId?: string;
    readonly configId?: string;
    readonly value?: string | boolean;
    readonly type?: string;
    readonly prompt?: ReadonlyArray<Record<string, unknown>>;
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

/** ... and whether this conversation is on FAST MODE, which is the pinned
 *  adapter's one BOOLEAN setting: no rows to pick from, a `true`/`false`
 *  `currentValue`, and a `session/set_config_option` that takes a real boolean
 *  rather than the string `"true"` — refused here exactly as the adapter
 *  refuses it, because a client that sent the string would otherwise pass a
 *  test and fail against the thing it is a fixture for. */
let fast = false;

/** The server names handed to each open, in the order the opens happened. */
const handed: Array<ReadonlyArray<string>> = [];
/** ... and the ENTRIES themselves, verbatim. The names alone cannot see the
 *  one thing the wire shape turns on: a stdio entry must carry NO `type` key
 *  and an http entry must carry `type: "http"`, because the pinned adapter
 *  reads the arm off the key's presence and silently drops an entry that
 *  carries `type: "stdio"`. A test that only counted names would stay green
 *  while the conductor lost its hands. */
const handedRaw: Array<ReadonlyArray<unknown>> = [];
/** ... and the `_meta` each open carried, same order. */
const metas: Array<unknown> = [];
/** ... and every permission mode asked for, as `[session, mode]`. */
const modes: Array<ReadonlyArray<string>> = [];
/** ... and the BODY of every prompt that has arrived, whole — what the teaching
 *  test needs, because "did the standing prompt ride the second turn" is a
 *  question about a string nobody but this process ever sees. */
const prompts: Array<string> = [];
/** ... and the CONTENT BLOCKS of every prompt, whole. The bodies above are the
 *  text and nothing else; an attachment is a block beside it, and whether an
 *  image arrived as an `image` block with its base64 intact is a question only
 *  the process at the other end of the pipe can answer. */
const blocks: Array<unknown> = [];

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

/**
 * THE SETTINGS THIS CONVERSATION REPORTS — the four the pinned Claude adapter
 * 0.81.2 really sends, in its own shape.
 *
 * A MODEL picker whose values are ALIASES (so the harness's own picker reading
 * is exercised), a MODE selector, which is the row a confirmed
 * `session/set_mode` has to move, an EFFORT selector under the adapter's own
 * `thought_level` category — a select like any other, and the one a panel that
 * filtered sections by category would silently lose — and FAST MODE, which is
 * a BOOLEAN: no rows at all, which is what a popover that only knew how to
 * draw rows rendered as a heading with nothing under it.
 */
const configOptions = () => [
  {
    id: "model",
    name: "Model",
    description: "AI model to use",
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
  {
    id: "effort",
    name: "Effort",
    description: "Available effort levels for this model",
    type: "select",
    category: "thought_level",
    currentValue: "default",
    options: [
      { value: "default", name: "Default" },
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
  {
    id: "fast",
    name: "Fast mode",
    description: "Answer quickly, with a smaller model where it will do",
    type: "boolean",
    category: "model_config",
    currentValue: fast,
  },
];

/**
 * THE PICKER THE REAL ADAPTER REALLY SENDS — one live session's
 * `configOptions`, recorded off the wire (`initialize` + `session/new` against
 * the pinned adapter, driving agent-distro's own `claude`) and pasted here
 * UNEDITED.
 *
 * It is recorded rather than written because the shapes in it are nobody's
 * invention: `_meta` on the mode rows, an `effort` row with six levels, a
 * `fast` row that is a SELECT of on/off rather than the boolean the settings
 * above send, and a model picker whose fourteen rows mix aliases
 * (`opus`, `fable`) with dated API ids. The row that matters is
 * `claude-fable-5-2`: the adapter used to drive the CLI bundled in the Claude
 * Agent SDK, whose picker had five rows and no Fable 5.2 in it at all, so a
 * model the machine's own terminals offered could not be chosen in the
 * conductor — and the missing row read as a reading that dropped what it
 * did not recognise. This payload is what proves that reading keeps it.
 */
const RECORDED = [
  {
    id: "mode",
    name: "Mode",
    description: "Session permission mode",
    category: "mode",
    type: "select",
    currentValue: "default",
    options: [
      {
        value: "default",
        name: "Manual",
        description: "Always ask before making changes",
        _meta: { kind: "standard" },
      },
      {
        value: "acceptEdits",
        name: "Accept edits",
        description: "Automatically accept all file edits",
        _meta: { kind: "standard" },
      },
      {
        value: "plan",
        name: "Plan",
        description: "Create a plan before making changes",
        _meta: { kind: "plan" },
      },
      {
        value: "auto",
        name: "Auto",
        description: "Claude handles permission decisions",
        _meta: { kind: "auto_review" },
      },
      {
        value: "bypassPermissions",
        name: "Bypass permissions",
        description: "Accepts all permissions",
        _meta: { kind: "full_access" },
      },
    ],
  },
  {
    id: "model",
    name: "Model",
    description: "AI model to use",
    category: "model",
    type: "select",
    currentValue: "default",
    options: [
      {
        value: "default",
        name: "Default (recommended)",
        description: "Opus 5.5",
      },
      {
        value: "opus",
        name: "Opus 5.5",
        description: "For complex work and everyday tasks",
      },
      {
        value: "claude-fable-5-2",
        name: "Fable 5.2",
        description: "For your toughest challenges",
      },
      {
        value: "sonnet",
        name: "Sonnet 5.5",
        description: "Most efficient for simpler tasks",
      },
      {
        value: "haiku",
        name: "Haiku 5.5",
        description: "Fastest for quick answers",
      },
      {
        value: "fable",
        name: "Fable 5.1",
        description: "Most capable for your hardest and longest-running tasks",
      },
      {
        value: "claude-haiku-4-5-20251001",
        name: "Haiku 4.5",
        description: "Fastest for quick answers",
      },
      {
        value: "claude-sonnet-5",
        name: "Sonnet 5",
        description: "Efficient for routine tasks",
      },
      {
        value: "claude-opus-5",
        name: "Opus 5",
        description: "Best for everyday, complex tasks",
      },
      {
        value: "claude-fable-5",
        name: "Fable 5",
        description: "Most capable for your hardest and longest-running tasks",
      },
      {
        value: "claude-opus-4-8",
        name: "Opus 4.8",
        description: "Best for everyday, complex tasks",
      },
      {
        value: "claude-opus-4-7",
        name: "Opus 4.7",
        description: "Best for everyday, complex tasks",
      },
      {
        value: "claude-opus-4-6",
        name: "Opus 4.6",
        description: "Best for everyday, complex tasks",
      },
      {
        value: "claude-sonnet-4-6",
        name: "Sonnet 4.6",
        description: "Efficient for routine tasks",
      },
    ],
  },
  {
    id: "effort",
    name: "Effort",
    description: "Available effort levels for this model",
    category: "thought_level",
    type: "select",
    currentValue: "default",
    options: [
      { value: "default", name: "Default" },
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
      { value: "xhigh", name: "Xhigh" },
      { value: "max", name: "Max" },
    ],
  },
  {
    id: "fast",
    name: "Fast mode",
    description: "Faster responses on supported models",
    category: "model_config",
    type: "select",
    currentValue: "off",
    options: [
      { value: "on", name: "On" },
      { value: "off", name: "Off" },
    ],
  },
];

function handle(message: Message): void {
  switch (message.method) {
    case "initialize":
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          // What an attachment is allowed to be, said by the agent — the two
          // the pinned adapter advertises. A client may send an `image` block
          // or embed a file's text only because of this line.
          promptCapabilities: { image: true, embeddedContext: true },
        },
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
      handedRaw.push(message.params?.mcpServers ?? []);
      metas.push(message.params?._meta ?? null);
      respond(message.id, {
        sessionId: session,
        configOptions: configOptions(),
      });
      return;
    case "session/load": {
      // WHICH CONVERSATION THIS AGENT ADMITS TO HAVING, chosen by the id the
      // client asks for — the same trick the turns play with their prompt
      // text, because a resume's only input IS the id.
      //
      // `gone-…` is the one the owner's host hit: a session id kolu wrote
      // down and this CLI knows nothing about, refused with the pinned
      // adapter's own answer (`RequestError.resourceNotFound(sessionId)`,
      // `-32002 Resource not found: <id>`). `locked-…` is the other refusal a
      // load can take — ACP's `-32000`, nobody is signed in — and the two must
      // not be read alike: one is a dead id, the other is a dead agent until
      // somebody signs in.
      const asked = message.params?.sessionId ?? "";
      if (asked.startsWith("gone-")) {
        refuse(message.id, -32002, `Resource not found: ${asked}`);
        return;
      }
      if (asked.startsWith("locked-")) {
        refuse(message.id, -32000, "Authentication required");
        return;
      }
      previous = session === message.params?.sessionId ? previous : session;
      session = message.params?.sessionId ?? session;
      handed.push(
        (message.params?.mcpServers ?? []).map((one) => one.name ?? ""),
      );
      handedRaw.push(message.params?.mcpServers ?? []);
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
    }
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
      // THE BOOLEAN SETTING TAKES A BOOLEAN, which is the pinned adapter's own
      // refusal: `{type: "boolean", value: true}` and nothing else — the
      // string `"true"` is `Invalid value for config option fast` there, so a
      // client that sent one would pass here and fail against the real thing.
      if (message.params?.configId === "fast") {
        if (
          message.params.type !== "boolean" ||
          typeof message.params.value !== "boolean"
        ) {
          refuse(
            message.id,
            -32602,
            `invalid value for config option fast: ${String(message.params.value)}`,
          );
          return;
        }
        fast = message.params.value;
        respond(message.id, { configOptions: configOptions() });
        return;
      }
      if (message.params?.configId !== "model") {
        refuse(message.id, -32602, "there is no such setting");
        return;
      }
      // A VALUE THE PICKER DOES NOT OFFER IS REFUSED, which is what a real
      // agent does with one: the conversation stays on the model it was on,
      // and the client has a refusal to report rather than a confirmation of
      // something that did not happen.
      if (
        typeof message.params.value !== "string" ||
        !["default", "sonnet", "haiku"].includes(message.params.value)
      ) {
        refuse(
          message.id,
          -32602,
          `no model is called \`${String(message.params.value ?? "")}\``,
        );
        return;
      }
      model = message.params.value;
      respond(message.id, { configOptions: configOptions() });
      return;
    case "session/close":
      // A CONVERSATION ENDED, which every agent that holds anything per
      // session has to be told — the pinned adapter holds a `claude` CLI, and
      // a client that opened a second conversation without this left the
      // first one running for the life of the process. This fixture holds
      // nothing, so answering is all there is to do; the subprocess that has
      // to die is `subprocess-agent.ts`'s, where the count is the assertion.
      respond(message.id, {});
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
  const first = message.params?.prompt?.[0];
  const body = typeof first?.text === "string" ? first.text : "";
  prompts.push(body);
  blocks.push(message.params?.prompt ?? []);
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
  if (text === "serverShapes") {
    // ... and the same opens as WHOLE ENTRIES, so a test can read the one key
    // the adapter's arm selection turns on.
    says(JSON.stringify(handedRaw));
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
  if (text === "blocks") {
    // EVERY BLOCK OF EVERY PROMPT, whole and in order — minus this one, which
    // is the question rather than the subject. The only record of what
    // actually crossed the pipe: an `image` block's base64, a `resource`'s
    // embedded text, a `resource_link`'s absolute path.
    says(JSON.stringify(blocks.slice(0, -1)));
    finish(message.id, "end_turn");
    return;
  }
  if (text === "groups") {
    // A GROUPED SELECT, which ACP allows and the pinned adapter does not send:
    // a model picker that sorts its aliases under headings is the shape in the
    // wild, and a client that offered the headings would offer values nobody
    // can pick. ALL groups and no bare rows, because the protocol's own type
    // is `Array<option> | Array<group>` and a mixed list is a frame the SDK
    // refuses before any client sees it.
    update(session, {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          type: "select",
          category: "model",
          currentValue: "sonnet",
          options: [
            {
              group: "anthropic",
              name: "Anthropic",
              options: [
                { value: "sonnet", name: "Sonnet" },
                { value: "haiku", name: "Haiku" },
              ],
            },
            {
              group: "aliases",
              name: "Whatever the host picks",
              options: [{ value: "default", name: "Default" }],
            },
          ],
        },
      ],
    });
    says("grouped");
    finish(message.id, "end_turn");
    return;
  }
  if (text === "recorded") {
    // THE REAL PICKER, pushed whole (see `RECORDED`), and then one of the
    // agent's own forwarded messages naming a model only that payload offers.
    // Both halves in one turn because they are one question: the rows a person
    // is offered and the name the header draws are read off the SAME payload,
    // and a model that survives into the picker but comes back out of the
    // header as a raw id is still a conversation nobody can read.
    update(session, {
      sessionUpdate: "config_option_update",
      configOptions: RECORDED,
    });
    write({
      jsonrpc: "2.0",
      method: "_test/raw",
      params: { model: "claude-fable-5-2" },
    });
    says("recorded");
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
        // THE FLEET GRAMMAR: `lifecycle_create` names the HOST it is creating
        // on (it has no terminal yet to carry one) and answers a REF.
        host: "remote:prod",
        placement: { kind: "toplevel" },
        name: "fix-parser",
        agent: "claude",
      },
      rawOutput: {
        id: "remote:prod/7f3e0a91-0000-4000-8000-000000000000",
        pid: 42,
      },
      _meta: { name: "mcp__kolu__lifecycle_create" },
    });
    finish(message.id, "end_turn");
    return;
  }
  if (text === "slow") {
    slowTurn = message.id;
    return;
  }
  if (text === "die") {
    // THE ADAPTER CRASHES, mid-turn and without an answer — the ending nobody
    // asked for and the one a client finds out about through a closed pipe
    // rather than through a reply.
    process.stderr.write("fixture-agent: gone\n");
    process.exit(1);
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
