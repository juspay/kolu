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
 *   hit the limit    — the account at its usage limit: a JSON-RPC error whose
 *                      `data.errorKind` is `rate_limit`, as the pinned adapter
 *                      sends it, so the row offers the sign-in beside it
 *   who am I         — `you are <account>`: the account this PROCESS read at
 *                      start, which its advertised login moves on, so a
 *                      sign-in shows only once the agent is started again
 *   list the fleet   — the ONE verb that is not scripted: it opens a real MCP
 *                      session on the fleet endpoint this session was handed
 *                      and reads the roster + every host's terminals, then
 *                      says what it read. A kolu whose fleet face cannot reach
 *                      its own hosts answers with the refusal instead.
 *   work quietly     — straight to work: two calls that succeed and one that
 *                      fails, THEN prose — two settled calls in one "Details",
 *                      with the failure left out in the open
 *   work in flight   — two calls that settle, then a third held RUNNING for a
 *                      few seconds before it settles and the agent speaks:
 *                      the turn the chat folds while it is still working
 *   open <title>     — a REAL `work_open` (mode `full`, repo /tmp/kolu-e2e)
 *                      that leaves the on-green question for the human: says
 *                      `opening: <title>` and `opened: <id>` in the SAME
 *                      turn, because asking never waits — whatever they
 *                      answer arrives later as a wake. A `work_open` the
 *                      fleet face REFUSED says `nothing opened: refused:
 *                      <the face's own sentence>`, the way `ran:` prints
 *                      what kolu typed: what kolu would not do, and why,
 *                      is the only thing the person has to read
 *   open trivially <title> in <dir>
 *                    — a REAL `work_open` in mode `trivial` with every answer
 *                      given (on green: merge), so nothing is asked and an
 *                      implementor can be run in it at once
 *   run the implementor in <cwd>
 *                    — a REAL `lifecycle_create` with `work` = the last work
 *                      opened and `role: implementor`. NO command: kolu
 *                      builds one from that work's setup and types it
 *   ask about the work — a REAL `work_ask` ("Approve the plan?", approve or
 *                      revise) about the last work opened; says
 *                      `asked: <ask id>` and ENDS THE TURN. The answer comes
 *                      back as a wake, which this fixture answers
 *                      `answered: <what they said>` (or `declined`)
 *   ask about the plan — a REAL `work_ask` about the last work opened whose
 *                      question NAMES A FILE (`.waterfall/plan.md`): what
 *                      makes every face of it offer to open the reader
 *   note <text>      — a REAL `work_note` on the last work opened
 *   watch <id>       — a plain watch: a REAL `work_open` in mode `watch`
 *                      (host and mode given, nothing asked), then `work_adopt`
 *                      of `local/<id>` with role `other`
 *   run an agent in <cwd>
 *                    — a REAL `work_open` (mode `trivial`, nothing asked,
 *                      keyed by that directory) then a REAL
 *                      `lifecycle_create` with that work and role
 *                      `implementor`. kolu types the command (`claude
 *                      --model …`, off the setup), and the floor's stand-in
 *                      `claude` runs whatever the scenario left in its relay;
 *                      answered `ran: <the tool's answer>`, which carries
 *                      both the fleet ref the create made a member and the
 *                      line kolu typed
 *   tell it <words>  — a REAL `agent_say` to the terminal `run` last started,
 *                      answered verbatim: the tool's report when it landed,
 *                      its refusal sentence when it did not
 *   work for a while — a turn held open for twelve seconds: long enough for a
 *                      member terminal to ring while it runs and be HELD
 *   work until steered — a turn held open until a STEER arrives
 *                      (`_session/steering`), which it then answers as
 *                      `heard: <the steered words>` before ending
 *   a kolu wake      — any prompt kolu-server STARTED (it opens with
 *                      `[kolu] I am waking you`) is answered `woke: <refs>`,
 *                      naming the fleet refs the account carried
 *   be <N> tokens long — reports a context of N tokens out of 1M, as the
 *                      pinned adapter's `usage_update` does after a turn
 *   compact          — a compaction at the start of the turn: the opening
 *                      report, the summary in two chunks, the terminal report
 *                      and its status-only duplicate, then a small context
 *   compact and fail — the opening report, then a failure with a reason
 *   compact until steered — the opening report, then nothing until a steer
 *                      arrives, then the terminal report: a compaction that
 *                      is still running for as long as a scenario needs
 *   which kolu blocks — `carried: <the [kolu] headings this message carried>`,
 *                      or `carried: nothing`: what kolu sent under the words
 *
 * Turns are served FIFO and one at a time: `queued` is a fact about the agent's
 * own queue, so an adapter that answered out of order could not be used to
 * assert it.
 *
 * ITS SESSIONS ARE LAZY, the way the pinned adapter's are: `session/new`
 * answers a fresh id and writes NOTHING, and only the first prompt puts that
 * id in the store — so a `session/load` of an id nobody prompted is refused
 * with the adapter's own `-32002 Resource not found: <id>`, in this process or
 * the next. Measured against `claude-agent-acp` 0.81.2: an unprompted id has
 * no file under `~/.claude/projects/` and its load is refused in exactly those
 * words; a prompted one loads. The store is a directory, named as this
 * program's one argument, holding one empty file per prompted session — kept
 * on disk because a restart of kolu-server is a NEW process of this agent.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_HARNESS } from "./agentDistroFixture.ts";

/** The model every work this fixture opens runs its implementor on. A word,
 *  not an id: the floor's one harness lists no models (`FIXTURE_MODELS`), so
 *  kolu accepts whatever is named and starts it as `claude --model sonnet`. */
const IMPLEMENTOR_MODEL = "sonnet";

/** Where this agent remembers the sessions that had a prompt. Required: a
 *  fixture that silently accepted every id would hide the very defect it is
 *  here to reproduce. Checked only when this file is the PROGRAM — cucumber's
 *  `support/**` glob also imports it into the test runner, where it is never
 *  spoken to and has no argument to read. */
const STORE = process.argv[2] ?? "";
if (import.meta.main && !existsSync(STORE)) {
  throw new Error(
    `acp-fixture-agent: pass the directory of its session store as the one argument (got ${JSON.stringify(process.argv[2])})`,
  );
}

/** The conversation this process is in — minted by `session/new`, or the id a
 *  `session/load` was allowed to open. */
let session = "";

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const respond = (id: unknown, result: unknown): void => {
  write({ jsonrpc: "2.0", id, result });
};

const refuse = (id: unknown, message: string): void => {
  write({ jsonrpc: "2.0", id, error: { code: -32603, message } });
};

/** WHO THIS PROCESS IS SIGNED IN AS — read ONCE, at start, the way the pinned
 *  adapter caches the account it read at `initialize`: a login that changes
 *  the store is invisible to a running process until it is started again.
 *  The store's `.account` holds a count the login moves on, so a scenario
 *  compares the account before and after rather than naming one. */
const ACCOUNT_FILE = join(STORE, ".account");
const ACCOUNT = existsSync(ACCOUNT_FILE)
  ? `account-${readFileSync(ACCOUNT_FILE, "utf8").trim()}`
  : "account-0";

/** The login this agent advertises: a command that moves the store's account
 *  on by one and exits 0 — what `claude auth login` does to its store, minus
 *  the browser. */
const LOGIN = `const f=${JSON.stringify(ACCOUNT_FILE)},fs=require("fs");fs.writeFileSync(f,String((fs.existsSync(f)?Number(fs.readFileSync(f,"utf8")):0)+1));process.stdout.write("signed in\\n")`;

const update = (frame: unknown): void => {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: session, update: frame },
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
    readonly sessionId?: string;
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

/** The kolu MCP server this session was handed, remembered from the open.
 *  `null` until a session is opened, and `null` forever for a kolu that handed
 *  over nothing — which the fleet turn reports rather than papers over. */
let koluServer: { url: string; headers: Record<string, string> } | null = null;

/** WHAT THE SESSION WAS HANDED, kept — on a `session/new` and on a
 *  `session/load` alike, because both carry the servers. kolu-server puts
 *  exactly one MCP server on a session: its own fleet face, at a loopback URL
 *  with a bearer token minted this boot. A real adapter would connect it here;
 *  this one keeps the address and dials it when a turn asks for the fleet,
 *  which is the same proof with less machinery. */
const takeServers = (message: Incoming): void => {
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
};

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
/** One MCP session on the fleet face, opened for `work` and ENDED after it —
 *  the face holds live subscriptions per session, and a scenario that left one
 *  open per turn would leave them behind the server for the worker's life. */
const withFleetSession = async <T>(
  work: (
    server: { url: string; headers: Record<string, string> },
    session: string,
  ) => Promise<T>,
): Promise<T> => {
  if (koluServer === null) {
    throw new Error("this session was handed no kolu MCP server");
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
  try {
    return await work(server, session);
  } finally {
    await fetch(server.url, {
      method: "DELETE",
      headers: { ...server.headers, "mcp-session-id": session },
    }).then((ended) => ended.body?.cancel());
  }
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
  return withFleetSession(async (server, session) => {
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
    return `fleet hosts: ${hosts
      .map((one) => `${one.host}=${one.state}`)
      .join(", ")}; fleet terminals: ${terminals.join(", ")}`;
  });
};

/** One TOOL CALL on the fleet face, answered with its text — or the refusal's
 *  own sentence, because a scenario reading "watching …" must be able to tell
 *  a call that landed from one the face turned down. */
const callTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<string> =>
  withFleetSession(async (server, session) => {
    const { frame } = await mcpCall(server, session, {
      jsonrpc: "2.0",
      id: nextRequestId++,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const result = frame?.result as
      | { isError?: boolean; content?: ReadonlyArray<{ text?: string }> }
      | undefined;
    const text = result?.content?.map((one) => one.text ?? "").join("") ?? "";
    return result?.isError === true ? `refused: ${text}` : text;
  });

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
      sessionId: session,
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

/** Prose, as one chunk — what a scenario waiting on an answer reads. */
const say = (text: string): void => {
  update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });
};

/** The steer the `work until steered` turn is waiting for, while it waits. */
let awaitingSteer: ((text: string) => void) | null = null;

/** The terminal the `run` verb last STARTED, as the fleet ref the create
 *  answered with — what `tell it <words>` speaks to. `null` until one is
 *  started, and the `tell` verb says so rather than inventing a ref. */
let lastStarted: string | null = null;
/** The work the last `open`/`run`/`watch` opened — what every later verb in
 *  this vocabulary names, because a terminal is now created INTO a piece of
 *  work and a question is asked ABOUT one. */
let lastWork: string | null = null;

/** The setup every work this fixture opens is given, with whatever the
 *  scenario did not say left for the human to answer.
 *
 *  `mode` and `on-green` carry kolu's OWN words (`full`/`trivial`/`watch`,
 *  `merge`/`hand-over`): those two answers are read back off the decision, so
 *  the fleet face refuses options that are anything else. The four harness
 *  and model questions are kolu's to offer — this names them and says what
 *  the request already carried, and nothing else: a `question` or `options`
 *  beside one of those keys is refused by the tool's own schema.
 *
 *  The harness is the one the floor under the e2e server carries
 *  ({@link FIXTURE_HARNESS}), because kolu checks a given harness against its
 *  agent-distro listing; the model is a word, which that harness takes as it
 *  lists none ({@link FIXTURE_MODELS}). */
const setupFor = (
  mode: "full" | "trivial" | "watch",
  over: { host?: string; askOnGreen?: boolean; askModel?: boolean } = {},
): Array<Record<string, unknown>> => {
  const given = (
    key: string,
    question: string,
    options: string[],
    answer: string,
  ) => ({ key, question, options, given: answer });
  /** A harness or model question: NAMED, with the answer the request carried.
   *  kolu words it and draws its options. */
  const chosen = (key: string, answer: string) => ({ key, given: answer });
  const setup: Array<Record<string, unknown>> = [
    // The HOST is no longer a setup question: it is part of the work's key.
    given("mode", "Which mode?", [mode], mode),
  ];
  if (mode === "watch") return setup;
  if (mode === "full") {
    setup.push(
      chosen("planner.harness", FIXTURE_HARNESS.name),
      chosen("planner.model", "opus"),
    );
  }
  setup.push(
    chosen("implementor.harness", FIXTURE_HARNESS.name),
    // THE MODEL LEFT TO THE HUMAN, when the scenario is about the form's
    // model question: named, with nothing given, so kolu asks it.
    over.askModel === true
      ? { key: "implementor.model" }
      : chosen("implementor.model", IMPLEMENTOR_MODEL),
  );
  // THE ONE QUESTION LEFT FOR THE HUMAN, when the scenario wants a card with
  // something to answer: the options are kolu's own words, which is what the
  // card draws its buttons from.
  setup.push(
    over.askOnGreen === true
      ? {
          key: "on-green",
          question: "On green?",
          options: ["merge", "hand-over"],
        }
      : given("on-green", "On green?", ["merge"], "merge"),
  );
  return setup;
};

/** Open a piece of work and remember it. Answers the work's id — the call
 *  comes back AT ONCE, whether or not a setup question went to the human:
 *  what they say arrives later, as a wake. */
const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** WHAT THE LAST `work_open` ANSWERED, kept whole — a refusal's own sentence
 *  is all a person gets when no work was opened, so the turn says it rather
 *  than reporting the absence of an id. */
let lastOpenSaid = "";

const openWork = async (
  title: string,
  mode: "full" | "trivial" | "watch",
  over: {
    host?: string;
    repo?: string;
    askOnGreen?: boolean;
    askModel?: boolean;
    watch?: string;
  } = {},
): Promise<string | null> => {
  // A WORK IS ITS KEY. Each title gets a branch of its own, so two scenarios
  // in one worker are two pieces of work — and opening the SAME title twice
  // is the idempotent case: the same key, the same work, no second card.
  //
  // THE REPOSITORY HAS TO BE THERE: kolu asks the work's host which models
  // the chosen harness offers, and it asks IN the work's repository (the
  // profiles a terminal there would get). A placeholder path nobody made is a
  // directory that command cannot run in, so the open would be refused for a
  // reason that has nothing to do with the scenario.
  const repo = over.repo ?? "/tmp/kolu-e2e";
  if (over.watch === undefined) mkdirSync(repo, { recursive: true });
  const answer = await callTool("work_open", {
    title,
    ...(over.watch === undefined
      ? { host: over.host ?? "local", repo, branch: slug(title) }
      : { watch: over.watch }),
    setup: setupFor(mode, over),
  });
  const work = /"work"\s*:\s*"([^"]+)"/.exec(answer)?.[1] ?? null;
  lastOpenSaid = answer;
  lastWork = work;
  return work;
};

const turn = async (
  id: unknown,
  text: string,
  whole: string,
): Promise<void> => {
  reportServers();
  // A TURN KOLU STARTED. Matched on the account's own opening, which is the
  // line kolu-server writes to say who is speaking — the rest of the account
  // names each terminal as a fleet ref, and the answer echoes those refs so a
  // scenario can tell WHICH terminal woke the conversation.
  if (whole.includes("[kolu] I am waking you")) {
    const refs = [...whole.matchAll(/\blocal\/[0-9a-f-]{36}\b/g)].map(
      (one) => one[0],
    );
    // AN ANSWER IS A WAKE LIKE ANY OTHER — the half of this feature a
    // scenario can see from the agent's side: the Conductor asked, ended its
    // turn, and is told later what the human said. The answer is echoed so a
    // scenario can assert the conversation really was woken WITH IT, rather
    // than merely that a form settled on screen.
    const answered = whole.includes("the human ANSWERED")
      ? (/·\s*[^\n:]+:\s*(.+)/.exec(whole)?.[1]?.trim() ?? "")
      : null;
    if (answered !== null) say(`answered: ${answered}`);
    else if (whole.includes("the human DECLINED")) say("declined");
    say(`woke: ${[...new Set(refs)].join(", ")}`);
    endTurn(id);
    return;
  }
  if (text.startsWith("open trivially ")) {
    // A TRIVIAL WORK NOTHING IS ASKED ABOUT: what a scenario about a trivial
    // work's strip needs, with an implementor it can run straight away.
    const said = text.slice("open trivially ".length).trim();
    const at = said.lastIndexOf(" in /");
    const title = at === -1 ? said : said.slice(0, at).trim();
    const repo = at === -1 ? "/tmp/kolu-e2e" : said.slice(at + 4).trim();
    say(`opening: ${title}`);
    const work = await openWork(title, "trivial", { repo });
    say(work === null ? `nothing opened: ${lastOpenSaid}` : `opened: ${work}`);
    endTurn(id);
    return;
  }
  if (text.startsWith("open the model by hand ")) {
    // A TRIVIAL WORK WHOSE MODEL IS THE HUMAN'S TO NAME: everything else is
    // given, so the form is the one model question — what a person sees on a
    // host that could not list its models.
    const said = text.slice("open the model by hand ".length).trim();
    const at = said.lastIndexOf(" in /");
    const title = at === -1 ? said : said.slice(0, at).trim();
    const repo = at === -1 ? "/tmp/kolu-e2e" : said.slice(at + 4).trim();
    say(`opening: ${title}`);
    const work = await openWork(title, "trivial", { repo, askModel: true });
    say(work === null ? `nothing opened: ${lastOpenSaid}` : `opened: ${work}`);
    endTurn(id);
    return;
  }
  if (text.startsWith("open ")) {
    // THE CONDUCTOR STATES ITS INTENT. One `work_open` whose setup leaves the
    // on-green question for the human, so the card has something to answer —
    // and the call ANSWERS AT ONCE: nothing here waits on a person, and the
    // answer reaches this fixture as a wake.
    // A WORK IS A BRANCH IN A REPOSITORY, and kolu asks THAT repository about
    // the branch's pull request — so when the scenario made a repo of its own
    // it says which (`open <title> in <dir>`), and the work is keyed by it.
    // A title with no `in` keeps the placeholder path: those scenarios are
    // about cards and questions, not about a forge.
    const said = text.slice("open ".length).trim();
    const at = said.lastIndexOf(" in /");
    const title = at === -1 ? said : said.slice(0, at).trim();
    const repo = at === -1 ? "/tmp/kolu-e2e" : said.slice(at + 4).trim();
    say(`opening: ${title}`);
    const work = await openWork(title, "full", {
      repo,
      askOnGreen: true,
    });
    say(work === null ? `nothing opened: ${lastOpenSaid}` : `opened: ${work}`);
    endTurn(id);
    return;
  }
  if (text.startsWith("run the implementor in ")) {
    // A MEMBER OF THE WORK ALREADY OPEN, in a directory the scenario made —
    // which is where its `.waterfall/` files and its PR are observed from.
    //
    // NO COMMAND: an implementor is started by KOLU, from the harness and
    // model this work's setup carries — `lifecycle_create` refuses a `run`
    // beside that role. The answer says what kolu typed, as `ran`.
    const cwd = text.slice("run the implementor in ".length).trim();
    if (lastWork === null) {
      say("no work is open");
      endTurn(id);
      return;
    }
    const answer = await callTool("lifecycle_create", {
      host: "local",
      placement: { kind: "toplevel" },
      cwd,
      intent: "build it",
      work: lastWork,
      role: "implementor",
    });
    lastStarted = /\blocal\/[0-9a-f-]{36}\b/.exec(answer)?.[0] ?? null;
    say(`ran: ${answer}`);
    endTurn(id);
    return;
  }
  const looked =
    /^look at the implementor and (?:say where its plan is|name (\S+))$/.exec(
      text,
    );
  if (looked !== null) {
    // THE CONDUCTOR NAMES A FILE IN ITS OWN WORDS, in a turn that is about
    // one work: a real kolu tool card naming the implementor this fixture
    // last started (a screen read), then plain prose with the path in
    // backticks — the plan, or whichever path the step named. The card is
    // what tells kolu which work the reply is about — the sentence names
    // none.
    if (lastStarted === null) {
      say("no implementor was started");
      endTurn(id);
      return;
    }
    update({
      sessionUpdate: "tool_call",
      toolCallId: "call-look",
      title: "screen_text",
      kind: "read",
      status: "in_progress",
      rawInput: { id: lastStarted },
      _meta: { claudeCode: { toolName: "mcp__kolu__screen_text" } },
    });
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-look",
      status: "completed",
      rawOutput: { text: "plan written" },
    });
    say(`It wrote \`${looked[1] ?? ".waterfall/plan.md"}\`.`);
    endTurn(id);
    return;
  }
  if (text === "ask about the work") {
    if (lastWork === null) {
      say("no work is open");
      endTurn(id);
      return;
    }
    // ASK, SAY WHAT YOU ASKED, END THE TURN. The call answers at once with
    // the ask's id and nothing else: whatever the human says arrives later,
    // as the wake handled at the top of this function.
    const answer = await callTool("work_ask", {
      work: lastWork,
      questions: [
        {
          header: "Plan approval",
          question: "Approve the plan?",
          options: ["approve", "revise"],
        },
      ],
    });
    const ask = /"ask"\s*:\s*"([^"]+)"/.exec(answer)?.[1] ?? "";
    say(`asked: ${ask}`);
    endTurn(id);
    return;
  }
  if (text === "ask about the plan") {
    if (lastWork === null) {
      say("no work is open");
      endTurn(id);
      return;
    }
    // THE QUESTION NAMES THE FILE. That one field is what makes the card and
    // the chat offer to open the plan in the reader — the question carries
    // the thing the human has to read before they can answer it.
    const answer = await callTool("work_ask", {
      work: lastWork,
      questions: [
        {
          header: "Plan approval",
          question: "Approve the plan?",
          options: ["approve", "revise"],
          file: ".waterfall/plan.md",
        },
      ],
    });
    say(`asked: ${answer}`);
    endTurn(id);
    return;
  }
  if (text.startsWith("note ")) {
    if (lastWork === null) {
      say("no work is open");
      endTurn(id);
      return;
    }
    await callTool("work_note", {
      work: lastWork,
      text: text.slice("note ".length).trim(),
    });
    say("noted");
    endTurn(id);
    return;
  }
  const joining = /^join ([0-9a-f-]{36}) as (planner|implementor|other)$/.exec(
    text,
  );
  if (joining !== null) {
    if (lastWork === null) {
      say("no work is open");
      endTurn(id);
      return;
    }
    say(
      `joined: ${await callTool("work_adopt", {
        id: `local/${joining[1]}`,
        work: lastWork,
        role: joining[2],
      })}`,
    );
    endTurn(id);
    return;
  }
  if (text.startsWith("watch ")) {
    // A PLAIN WATCH the human asked for: a piece of work in `watch` mode,
    // then the terminal they pointed at adopted into it as `other`.
    const terminalId = text.slice("watch ".length).trim();
    const work = await openWork(`watch ${terminalId}`, "watch", {
      watch: `local/${terminalId}`,
    });
    if (work === null) {
      say("nothing opened");
      endTurn(id);
      return;
    }
    say(
      await callTool("work_adopt", {
        id: `local/${terminalId}`,
        work,
        role: "other",
      }),
    );
    endTurn(id);
    return;
  }
  if (text.startsWith("run an agent in ")) {
    // THE CONDUCTOR STARTS SOMETHING. A piece of work first — nothing is
    // created outside one — then a real `lifecycle_create` on the fleet face.
    // The create makes what it created a MEMBER, so the terminal is watched
    // from the moment it exists and nothing here has to ask for that
    // separately.
    //
    // THE COMMAND IS KOLU'S, built from the work's own setup (`claude` on the
    // model this fixture chose) and typed at the new terminal's first prompt
    // — an implementor given a `run` is refused. What that `claude` actually
    // starts is the scenario's business: it leaves its stand-in agent in the
    // floor's relay (`fixtureClaudeRelay`), because only the test process
    // knows that binary's absolute path.
    //
    // The DIRECTORY the scenario names is both the terminal's cwd and the
    // work's repository, so each scenario's run is a piece of work of its own.
    const cwd = text.slice("run an agent in ".length).trim();
    const work = await openWork(`run ${cwd}`, "trivial", { repo: cwd });
    if (work === null) {
      say("nothing opened");
      endTurn(id);
      return;
    }
    const answer = await callTool("lifecycle_create", {
      host: "local",
      placement: { kind: "toplevel" },
      cwd,
      intent: "bring one up",
      work,
      role: "implementor",
    });
    lastStarted = /\blocal\/[0-9a-f-]{36}\b/.exec(answer)?.[0] ?? null;
    say(`ran: ${answer}`);
    endTurn(id);
    return;
  }
  if (text.startsWith("tell it ")) {
    // SPEAKING TO THE AGENT IT STARTED — `agent_say` on the fleet face, which
    // is the verb that knows the keys. The answer is said verbatim, refusal
    // sentence and all, so a scenario can tell a call that landed from one the
    // face turned down (an agent still coming up is turned down).
    if (lastStarted === null) {
      say("nothing was started to tell");
      endTurn(id);
      return;
    }
    say(
      await callTool("agent_say", {
        id: lastStarted,
        text: text.slice("tell it ".length).trim(),
      }),
    );
    endTurn(id);
    return;
  }
  if (text === "work for a while") {
    const slept = Promise.withResolvers<void>();
    setTimeout(slept.resolve, 12_000);
    await slept.promise;
    say("worked");
    endTurn(id);
    return;
  }
  const tokens = /^be (\d+) tokens long$/.exec(text)?.[1];
  if (tokens !== undefined) {
    update({
      sessionUpdate: "usage_update",
      used: Number(tokens),
      size: 1_000_000,
    });
    say(`now ${tokens}`);
    endTurn(id);
    return;
  }
  if (
    text === "compact" ||
    text === "compact and fail" ||
    text === "compact until steered"
  ) {
    const compactionId = randomUUID();
    const report = (body: Record<string, unknown>): void =>
      update({ sessionUpdate: "compaction_update", compactionId, ...body });
    report({ status: "in_progress" });
    if (text === "compact and fail") {
      report({
        status: "failed",
        error: "the summary request was refused (overloaded)",
      });
      say("carried on");
      endTurn(id);
      return;
    }
    if (text === "compact until steered") {
      const steered = Promise.withResolvers<string>();
      awaitingSteer = steered.resolve;
      const gaveUp = setTimeout(() => steered.resolve("(nothing)"), 30_000);
      await steered.promise;
      clearTimeout(gaveUp);
      awaitingSteer = null;
    }
    for (const chunk of ["Two works are open. ", "Nothing waits on you."])
      update({
        sessionUpdate: "compaction_summary_chunk",
        compactionId,
        content: { type: "text", text: chunk },
      });
    report({ status: "completed" });
    report({
      status: "completed",
      _meta: { contextCompaction: { trigger: "automatic" } },
    });
    update({ sessionUpdate: "usage_update", used: 14_000, size: 1_000_000 });
    say("carried on");
    endTurn(id);
    return;
  }
  if (text === "which kolu blocks") {
    const blocks = [...whole.matchAll(/^# (\[kolu\] .+)$/gm)].map(
      (one) => one[1],
    );
    say(`carried: ${blocks.length === 0 ? "nothing" : blocks.join(" · ")}`);
    endTurn(id);
    return;
  }
  if (text === "work until steered") {
    const steered = Promise.withResolvers<string>();
    awaitingSteer = steered.resolve;
    // Bounded, so a scenario whose steer never arrived ends its turn and
    // fails on the missing `heard:` rather than wedging every later prompt.
    const gaveUp = setTimeout(() => steered.resolve("(nothing)"), 30_000);
    const heard = await steered.promise;
    clearTimeout(gaveUp);
    awaitingSteer = null;
    say(`heard: ${heard}`);
    endTurn(id);
    return;
  }
  if (text === "refuse this") {
    refuse(id, "the model said no");
    return;
  }
  if (text === "hit the limit") {
    // THE ACCOUNT AT ITS LIMIT, as the pinned adapter refuses a turn for it:
    // the SDK's categorical error kind in `data`, never read off the words.
    write({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: "You've hit your weekly limit · resets 4pm",
        data: { errorKind: "rate_limit" },
      },
    });
    return;
  }
  if (text === "who am I") {
    say(`you are ${ACCOUNT}`);
    endTurn(id);
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
        sessionId: session,
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
  if (text === "work quietly" || text === "work in flight") {
    // A TURN THAT OPENS WITH ITS MACHINERY — the common shape: the human asks,
    // the agent goes straight to work, and only then says something. The two
    // settled calls go into one closed "Details" as they settle.
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
    if (text === "work quietly") {
      // The FAILED one is news and stays in the flow.
      call("call-quiet-broken", "failed", "false");
    } else {
      // Still working, nothing said yet: the third call is held open long
      // enough for a reader to see the fold beside it, and to open that fold
      // before the prose arrives — so it can be seen to stay the same fold.
      call("call-quiet-wait", "in_progress", "sleep 6");
      const held = Promise.withResolvers<void>();
      setTimeout(held.resolve, 6000);
      await held.promise;
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-quiet-wait",
        status: "completed",
      });
    }
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

  if (text === "draw a diagram") {
    // A MERMAID BLOCK THAT ARRIVES IN PIECES, the way a model streams one: the
    // opening fence and first line, the middle, then the closing fence on its
    // own — so the block sits unfinished for several pieces, which is exactly
    // when it must stay code and never flash a parse error. A long list comes
    // first, so the fold can be seen to survive the diagram landing; words
    // keep arriving for seconds after it, so the diagram lands WHILE the
    // message is still being rewritten piece by piece — the case in which it
    // must not blink or move — rather than after the turn is over.
    //
    // SLOWER THAN `say a lot`, on purpose. The first diagram in a page boots
    // the sandboxed renderer (it fetches mermaid and starts it), which takes
    // around a second; at 40 ms a piece the whole answer would have landed by
    // then and nothing would arrive after the diagram.
    const pieces = [
      "Here is the plan:\n\n",
      "- check 1\n- check 2\n- check 3\n- check 4\n- check 5\n- check 6\n\n",
      "```mermaid\nflowchart TD\n",
      "  A[Read the plan] --> B{Ready?}\n",
      "  B -->|yes| C[Draw it]\n  B -->|no| A\n",
      "```\n\n",
      "after the diagram",
      ", the answer",
      " keeps",
      " arriving",
      " for a",
      " few",
      " more",
      " seconds,",
      " so you",
      " can watch",
      " it stay",
      " put.",
    ];
    for (const piece of pieces) {
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: piece },
      });
      const tick = Promise.withResolvers<void>();
      setTimeout(tick.resolve, 300);
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
        //
        // ... AND IT TAKES A MESSAGE MID-TURN, both halves the way the pinned
        // adapter says them: `promptQueueing` in its own corner of
        // `agentCapabilities._meta` (a prompt sent while busy waits its turn),
        // and steering beside `agentCapabilities` in the top-level `_meta`
        // (Alt+Enter puts the words into the turn that is running). Without
        // these two lines the composer offers no steer at all.
        respond(message.id, {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: true },
            _meta: { claudeCode: { promptQueueing: true } },
          },
          _meta: { steering: { supported: true } },
          // ONE LOGIN, run by the client — the shape the pinned adapter
          // advertises for `claude auth login`.
          authMethods: [
            {
              id: "claude-ai-login",
              name: "Claude account",
              type: "terminal",
              _meta: {
                "terminal-auth": {
                  command: process.execPath,
                  args: ["-e", LOGIN],
                },
              },
            },
          ],
        });
        // ... and WHO IT IS, said the way the adapter says it: on the
        // connection, not on a session.
        write({
          jsonrpc: "2.0",
          method: "_auth/status_update",
          params: { authStatus: { kind: "account", label: ACCOUNT } },
        });
        continue;
      case "session/new":
        session = randomUUID();
        takeServers(message);
        respond(message.id, { sessionId: session });
        continue;
      case "session/load": {
        // An id is a conversation in this store only once it was prompted —
        // see the module doc. padi keeps the transcript, so a load that IS
        // one has nothing to replay.
        const asked = message.params?.sessionId ?? "";
        if (!existsSync(join(STORE, asked))) {
          write({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32002,
              message: `Resource not found: ${asked}`,
              data: { uri: asked },
            },
          });
          continue;
        }
        session = asked;
        takeServers(message);
        respond(message.id, {});
        continue;
      }
      case "session/set_config_option":
        respond(message.id, {});
        continue;
      case "session/cancel":
        continue;
      case "session/prompt": {
        writeFileSync(join(STORE, session), "");
        const text = lastLine(message);
        const whole = (message.params?.prompt ?? [])
          .map((block) => block.text ?? "")
          .join("\n");
        enqueue(() => turn(message.id, text, whole));
        continue;
      }
      case "_session/steering":
        // The extension, as the pinned adapter behaves it: words go INTO the
        // turn that is running, and when nothing is running they come BACK for
        // the client to send itself (`idleBehavior: "promptRequired"`, which
        // is what kolu asks for on every steer). `draining` is this fixture's
        // whole notion of a turn being in flight.
        respond(message.id, {
          outcome: draining ? "injected" : "promptRequired",
        });
        // ... and the turn that is WAITING for one hears it now, mid-turn,
        // which is the whole difference from a queued prompt.
        if (draining && awaitingSteer !== null)
          awaitingSteer(lastLine(message));
        continue;
      default:
        if (message.id !== undefined) respond(message.id, {});
        continue;
    }
  }
});
