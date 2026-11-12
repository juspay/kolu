/**
 * THE ACP ADAPTER THE E2E SUITE RUNS — a scripted agent on stdio.
 *
 * `KOLU_ACP_AGENT` points at this file, so the conductor the browser talks
 * to is a real subprocess speaking the real protocol over a real pipe:
 * kolu-server spawns it, the harness handshakes with it, and every frame the
 * panel draws is a frame an agent could have sent. What it is NOT is a mock of
 * the harness — the scenarios exercise the whole chain, and a stubbed store
 * would have proved only that the browser can render a value somebody put
 * there.
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
 *   list the resources — a tool whose answer is 5 KB of MINIFIED JSON on one
 *                      line with no space in it, i.e. no place a browser may
 *                      break: the payload that pushed the whole document
 *                      wider than the window
 *   ask me something — a form elicitation, which stops the turn until a person
 *                      answers; the turn ends when they do
 *   work slowly      — a turn that stays open long enough for a second prompt
 *                      to be marked `queued` behind it
 *   refuse this      — a JSON-RPC error, which is a turn that ENDED rather than
 *                      an agent that has gone
 *   list the fleet   — the ONE verb that is not scripted: it opens a real MCP
 *                      session on the fleet endpoint this session was handed
 *                      and reads the roster + every host's terminals, then
 *                      says what it read. A kolu whose fleet face cannot reach
 *                      its own hosts answers with the refusal instead.
 *   work quietly     — straight to work: two calls that succeed and one that
 *                      fails, THEN prose — the turn the chat folds into one
 *                      "Details", with the failure left out in the open
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
    /** ACP's own `session/new` field — what kolu-server hands this session.
     *  The fleet face is the ONE entry on it (`type: "http"`, its loopback URL
     *  and the bearer header), which is what lets the `list the fleet` turn
     *  below be a REAL MCP client rather than a scripted answer. */
    readonly mcpServers?: ReadonlyArray<{
      readonly type?: string;
      readonly name?: string;
      readonly url?: string;
      readonly headers?: ReadonlyArray<{
        readonly name: string;
        readonly value: string;
      }>;
    }>;
  };
}

/** The kolu MCP server this session was handed, remembered from `session/new`.
 *  `null` until a session is opened, and `null` forever for a kolu that handed
 *  over nothing — which the fleet turn reports rather than papers over. */
let koluServer: { url: string; headers: Record<string, string> } | null = null;

/** One JSON-RPC call to the fleet's streamable-HTTP door.
 *
 *  Hand-rolled over `fetch` because this fixture is a standalone stdio program
 *  with the ACP wire as its whole dependency surface — the same reason
 *  kolu-server's own endpoint PROOF (`proveFleetMcpEndpoint`) is a bare
 *  `fetch` rather than an SDK client. The door answers a POST with either JSON
 *  or a one-message SSE stream depending on the transport's mood, so both are
 *  read: every `data:` line is a frame, and a plain body is one. */
const mcpCall = async (
  server: { url: string; headers: Record<string, string> },
  session: string | null,
  body: Record<string, unknown>,
): Promise<{
  frame: Record<string, unknown> | null;
  session: string | null;
}> => {
  const answer = await fetch(server.url, {
    method: "POST",
    headers: {
      ...server.headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session === null ? {} : { "mcp-session-id": session }),
    },
    body: JSON.stringify(body),
  });
  const text = await answer.text();
  if (!answer.ok) {
    throw new Error(`${body.method as string}: HTTP ${answer.status} ${text}`);
  }
  const lines = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  const payloads = lines.length > 0 ? lines : text.trim() === "" ? [] : [text];
  const frames = payloads.map(
    (one) => JSON.parse(one) as Record<string, unknown>,
  );
  const frame = frames.find((one) => "result" in one || "error" in one) ?? null;
  const failure = frame?.error as { message?: string } | undefined;
  if (failure !== undefined) {
    throw new Error(
      `${body.method as string}: ${failure.message ?? "refused"}`,
    );
  }
  return { frame, session: answer.headers.get("mcp-session-id") ?? session };
};

/** Read one `surface://` resource off the fleet face and parse its one text
 *  body — what every resource on that face answers with. */
const readResource = async (
  server: { url: string; headers: Record<string, string> },
  session: string,
  uri: string,
): Promise<unknown> => {
  const { frame } = await mcpCall(server, session, {
    jsonrpc: "2.0",
    id: nextRequestId++,
    method: "resources/read",
    params: { uri },
  });
  const result = frame?.result as
    | { contents?: ReadonlyArray<{ text?: string }> }
    | undefined;
  const body = result?.contents?.[0]?.text;
  if (body === undefined) throw new Error(`${uri}: answered no text body`);
  return JSON.parse(body);
};

/** THE FLEET, READ BY THE AGENT ITSELF — the roster and every host's
 *  terminals, through the MCP server kolu-server handed this session.
 *
 *  This is the one turn that proves the hands work. Everything else this
 *  fixture answers is scripted; this opens a real session on the real
 *  endpoint and reads the real resources, so a kolu whose fleet face cannot
 *  reach its own hosts answers here with the refusal instead of a roster. */
const readFleet = async (): Promise<string> => {
  if (koluServer === null) {
    return "fleet read failed: this session was handed no kolu MCP server";
  }
  const server = koluServer;
  const opened = await mcpCall(server, null, {
    jsonrpc: "2.0",
    id: nextRequestId++,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "kolu-e2e-fixture-agent", version: "0.0.0" },
    },
  });
  const session = opened.session;
  if (session === null) {
    throw new Error("initialize: the door opened no session");
  }
  await mcpCall(server, session, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  const hosts = (await readResource(
    server,
    session,
    "surface://cells/hosts",
  )) as ReadonlyArray<{ host: string; state: string }>;
  const terminals = (await readResource(
    server,
    session,
    "surface://collections/terminals",
  )) as readonly string[];
  // The agent's own session, ended by the agent — the fleet face behind it
  // holds live subscriptions, and a scenario that opened one per turn would
  // leave them behind the server for the rest of the worker's life.
  await fetch(server.url, {
    method: "DELETE",
    headers: { ...server.headers, "mcp-session-id": session },
  }).then((ended) => ended.body?.cancel());
  return `fleet hosts: ${hosts
    .map((one) => `${one.host}=${one.state}`)
    .join(", ")}; fleet terminals: ${terminals.join(", ")}`;
};

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

/** A MINIFIED MCP RESOURCE LISTING, the shape that broke the layout — copied
 *  from the listing the owner's own deploy printed, character classes and all.
 *
 *  `ListMcpResourcesTool` answers with its JSON as ONE STRING, minified. What
 *  makes it lethal is not its length but that it holds NO BREAK OPPORTUNITY:
 *  quotes forbid a break on either side of the commas and colons between them
 *  (UAX #14 LB19), so a browser may not wrap this line anywhere, however much
 *  room it is given. A HYPHEN or a space anywhere in it would let the text
 *  wrap and the bug would not reproduce — which is exactly what happened to
 *  the first version of this fixture, whose `terminals-0` names wrapped
 *  harmlessly. 5 KB is the size the owner's deploy produced with five hosts. */
const WIDE_PAYLOAD = ((): string => {
  // One value with NO punctuation in it at all: a 4 KB run of hex, the shape a
  // commit/closure hash takes when something concatenates a list of them. Not
  // one character of it is a place a browser may break, so a block that holds
  // it has to scroll or be told to break mid-word — wrapping alone cannot.
  const unbreakable = "a1b2c3d4e5f6".repeat(340);
  const entry =
    '{"name":"terminals","uri":"surface://collections/terminals","mimeType":"application/json","server":"kolu"}';
  let body = `{"sha":"${unbreakable}"}`;
  while (body.length < 5_120) body += `,${entry}`;
  return `[${body}]`;
})();

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
    // leave the card hostless and nothing to open. The rest is the tool's own
    // argument set: the canvas label (`intent`) the card names it by, and the
    // command typed at its first prompt (`run`).
    update({
      sessionUpdate: "tool_call",
      toolCallId: "call-create",
      title: "lifecycle_create",
      kind: "other",
      status: "in_progress",
      rawInput: {
        host: "local",
        placement: { kind: "toplevel" },
        cwd: "/tmp/kolu-e2e",
        intent: "fix-parser",
        run: "claude",
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
  if (text === "list the fleet") {
    // A REAL MCP ROUND TRIP, drawn as the tool card an agent's own read would
    // draw. The card is `other`/generic — this is the agent reading a
    // RESOURCE, not calling one of kolu's tools — and the prose underneath it
    // is what the scenario asserts, because that prose is the answer the fleet
    // face gave.
    update({
      sessionUpdate: "tool_call",
      toolCallId: "call-fleet",
      title: "ReadMcpResource",
      kind: "read",
      status: "in_progress",
      rawInput: { server: "kolu", uri: "surface://cells/hosts" },
      _meta: { claudeCode: { toolName: "ReadMcpResourceTool" } },
    });
    const said = await readFleet().catch(
      (err: unknown) =>
        `fleet read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-fleet",
      status: "completed",
      rawOutput: { said },
    });
    update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: said },
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
  if (text === "list the resources") {
    // ONE UNBROKEN LINE, on purpose. The card folds this into its `<details>`
    // body, and the body is the only thing standing between a 5 KB line with
    // no break opportunity in it and a document wider than the window.
    update({
      sessionUpdate: "tool_call",
      toolCallId: "call-resources",
      title: "ListMcpResources",
      kind: "read",
      status: "completed",
      rawInput: { server: "kolu" },
      rawOutput: WIDE_PAYLOAD,
      // BOTH CHANNELS AN MCP ANSWER REACHES A CARD BY, because they land in two
      // different blocks with two different sets of rules: `rawOutput` is
      // folded into the `<details>` (escaped, by `detailOf`), while the content
      // block becomes the card's `progress` pre — the RAW line, unescaped,
      // which is the one the owner's deploy printed across the window.
      content: [
        { type: "content", content: { type: "text", text: WIDE_PAYLOAD } },
      ],
      _meta: { claudeCode: { toolName: "ListMcpResourcesTool" } },
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
  if (text === "work quietly") {
    // A TURN THAT OPENS WITH ITS MACHINERY — the common shape: the human asks,
    // the agent goes straight to work, and only then says something. The
    // prose that closes the run is what folds it: the two settled calls go
    // into one closed "Details"; the FAILED one is news and stays in the flow.
    const call = (id: string, status: string, command: string): void =>
      update({
        sessionUpdate: "tool_call",
        toolCallId: id,
        title: "Bash",
        kind: "execute",
        status,
        rawInput: { command },
        _meta: { claudeCode: { toolName: "Bash" } },
      });
    call("call-quiet-ls", "completed", "ls");
    call("call-quiet-log", "completed", "git log -1");
    call("call-quiet-broken", "failed", "false");
    update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Found what I needed." },
    });
    endTurn(id);
    return;
  }

  if (text === "say a lot") {
    // A TURN LONGER THAN THE PANE, chunk by chunk, a frame or so apart — the
    // shape a real model streams in, and the only shape in which a follow rule
    // can be seen to work: a single frame carrying the whole answer would land
    // the view at the end whether anything followed anything or not.
    //
    // EACH CHUNK IS THREE PARAGRAPHS, which is not decoration. A chunk that
    // grows the column by LESS than the transcript's follow slack (48px) is
    // one a broken rule survives — it measures the container after drawing and
    // still finds itself within slack of the end. The defect only shows for a
    // chunk taller than that, which is most of what a model actually says.
    for (let line = 1; line <= 30; line += 1) {
      update({
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `line ${line}\n\nthe agent keeps talking (${line})\n\nand keeps talking (${line})\n\n`,
        },
      });
      const tick = Promise.withResolvers<void>();
      setTimeout(tick.resolve, 40);
      await tick.promise;
    }
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
      case "session/new": {
        // WHAT THE SESSION WAS HANDED, kept: kolu-server puts exactly one MCP
        // server on a new session — its own fleet face, at a loopback URL with
        // a bearer token minted this boot. A real adapter would connect it
        // here; this one keeps the address and dials it when a turn asks for
        // the fleet, which is the same proof with less machinery.
        const kolu = (message.params?.mcpServers ?? []).find(
          (one) => one.name === "kolu" && one.url !== undefined,
        );
        koluServer =
          kolu?.url === undefined
            ? null
            : {
                url: kolu.url,
                headers: Object.fromEntries(
                  (kolu.headers ?? []).map((h) => [h.name, h.value]),
                ),
              };
        respond(message.id, { sessionId: SESSION });
        continue;
      }
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
