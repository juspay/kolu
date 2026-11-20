import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_HARNESS } from "./agentDistroFixture.ts";

const IMPLEMENTOR_MODEL = "sonnet";

const STORE = process.argv[2] ?? "";
if (import.meta.main && !existsSync(STORE)) {
  throw new Error(
    `acp-fixture-agent: pass the directory of its session store as the one argument (got ${JSON.stringify(process.argv[2])})`,
  );
}

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

const ACCOUNT_FILE = join(STORE, ".account");
const ACCOUNT = existsSync(ACCOUNT_FILE)
  ? `account-${readFileSync(ACCOUNT_FILE, "utf8").trim()}`
  : "account-0";

const LOGIN = `const f=${JSON.stringify(ACCOUNT_FILE)},fs=require("fs");fs.writeFileSync(f,String((fs.existsSync(f)?Number(fs.readFileSync(f,"utf8")):0)+1));process.stdout.write("signed in\\n")`;

const update = (frame: unknown): void => {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: session, update: frame },
  });
};

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

let koluServer: { url: string; headers: Record<string, string> } | null = null;

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

const endTurn = (id: unknown): void => respond(id, { stopReason: "end_turn" });

const lastLine = (message: Incoming): string => {
  const whole = (message.params?.prompt ?? [])
    .map((block) => block.text ?? "")
    .join("\n")
    .trimEnd();
  const lines = whole.split("\n");
  return (lines[lines.length - 1] ?? "").trim();
};

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

const WIDE_PAYLOAD = ((): string => {
  const unbreakable = "a1b2c3d4e5f6".repeat(340);
  const entry =
    '{"name":"terminals","uri":"surface://collections/terminals","mimeType":"application/json","server":"kolu"}';
  let body = `{"sha":"${unbreakable}"}`;
  while (body.length < 5_120) body += `,${entry}`;
  return `[${body}]`;
})();

const say = (text: string): void => {
  update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });
};

let awaitingSteer: ((text: string) => void) | null = null;

let lastStarted: string | null = null;
let lastWork: string | null = null;

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
  const chosen = (key: string, answer: string) => ({ key, given: answer });
  const setup: Array<Record<string, unknown>> = [
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
    over.askModel === true
      ? { key: "implementor.model" }
      : chosen("implementor.model", IMPLEMENTOR_MODEL),
  );
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

const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

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
  if (whole.includes("[kolu] I am waking you")) {
    const refs = [...whole.matchAll(/\blocal\/[0-9a-f-]{36}\b/g)].map(
      (one) => one[0],
    );
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
  if (text.startsWith("watch ")) {
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
  if (text === "work until steered") {
    const steered = Promise.withResolvers<string>();
    awaitingSteer = steered.resolve;
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
    update({
      sessionUpdate: "tool_call",
      toolCallId: "call-resources",
      title: "ListMcpResources",
      kind: "read",
      status: "completed",
      rawInput: { server: "kolu" },
      rawOutput: WIDE_PAYLOAD,
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
      call("call-quiet-broken", "failed", "false");
    } else {
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
        respond(message.id, {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: true },
            _meta: { claudeCode: { promptQueueing: true } },
          },
          _meta: { steering: { supported: true } },
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
        respond(message.id, {
          outcome: draining ? "injected" : "promptRequired",
        });
        if (draining && awaitingSteer !== null)
          awaitingSteer(lastLine(message));
        continue;
      default:
        if (message.id !== undefined) respond(message.id, {});
        continue;
    }
  }
});
