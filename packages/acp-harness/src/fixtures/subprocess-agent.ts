/**
 * AN AGENT WHOSE EVERY CONVERSATION OWNS A SUBPROCESS — the shape of the
 * pinned Claude adapter, and the one hazard the other fixtures cannot express.
 *
 * `claude-agent-acp` 0.81.2 gives each session its own SDK `query()`, and
 * `query()` spawns a `claude` CLI the moment the session is made — before a
 * word has been prompted. Nothing ends that CLI but `session/close` (cancel,
 * end the input stream, `query.close()`) or the whole connection dying. So a
 * client that opens a second conversation down one adapter and never closes
 * the first leaves the first CLI running for the life of the process: one
 * `session/new`, one `claude`, for ever — five of them at ~35% CPU each on the
 * padi where this was found.
 *
 * This fixture is that adapter in miniature: one REAL child process per
 * session, spawned at `session/new`, killed at `session/close` and counted
 * through the harness's own door. The child is a real fork rather than a
 * number because the fact under test is a fact about processes — a bookkeeping
 * mock could be made to agree with a client that leaked every one of them.
 *
 *   children  — says `{live, closed}`: how many session subprocesses are still
 *               running, and which sessions were closed, in order
 *
 * Anything else prompted gets one chunk of prose and an `end_turn`, which is
 * all the tests here need it to be.
 *
 * It IMPORTS, which the fixtures beside it deliberately do not: a subprocess
 * is the subject, and `node:child_process` is the only way to have one. That
 * also makes the file a module on its own, so it carries no `export {}`.
 */

import { type ChildProcess, spawn } from "node:child_process";

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const respond = (id: unknown, result: unknown): void => {
  write({ jsonrpc: "2.0", id, result });
};

interface Message {
  readonly id?: unknown;
  readonly method?: string;
  readonly params?: {
    readonly sessionId?: string;
    readonly prompt?: ReadonlyArray<Record<string, unknown>>;
  };
}

/** The "CLI" each conversation is holding, by session id. A child that sleeps
 *  until it is killed: the point is that it EXISTS and that something has to
 *  end it, not what it does. */
const queries = new Map<string, ChildProcess>();
/** ... and the sessions somebody asked to close, in the order they were asked
 *  about — so a test can read WHICH conversation a client ended, not merely
 *  how many it ended. */
const ended: Array<string> = [];
let opened = 0;

const startQuery = (): string => {
  opened += 1;
  const id = `sess-${opened}`;
  queries.set(
    id,
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], {
      stdio: "ignore",
    }),
  );
  return id;
};

/** Kill this session's subprocess and answer only when it is really gone:
 *  a close that returned while the process was still dying would let a test
 *  pass on a race rather than on a reaped child. */
const endQuery = (id: string, done: () => void): void => {
  const child = queries.get(id);
  if (child === undefined) {
    done();
    return;
  }
  queries.delete(id);
  ended.push(id);
  child.once("exit", () => {
    done();
  });
  child.kill("SIGKILL");
};

/** Nothing this process spawned outlives it. The harness kills the whole
 *  process group, which already reaches these children; this covers the other
 *  ending — a closed pipe and an ordinary exit. */
const killAll = (): void => {
  for (const child of queries.values()) child.kill("SIGKILL");
  queries.clear();
};
process.on("exit", killAll);

process.stderr.write("subprocess-agent: started\n");

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
process.stdin.on("end", () => {
  killAll();
  process.exit(0);
});

function handle(message: Message): void {
  switch (message.method) {
    case "initialize":
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, embeddedContext: true },
        },
        authMethods: [],
      });
      return;
    case "session/new":
      respond(message.id, { sessionId: startQuery(), configOptions: [] });
      return;
    case "session/close":
      // THE WHOLE SUBJECT: a conversation ends here, and so does the process
      // it was holding. Answered after the child is reaped.
      endQuery(message.params?.sessionId ?? "", () => {
        respond(message.id, {});
      });
      return;
    // The permission mode a leg asks for on every open. Answered rather than
    // ignored: an unanswered request is a bring-up that hangs until the boot
    // deadline, which is a worse failure than any assertion.
    case "session/set_mode":
      respond(message.id, {});
      return;
    case "session/prompt": {
      // The LAST line, like the agent fixture beside it: a real prompt carries
      // kolu's standing instruction above the words somebody typed.
      const first = message.params?.prompt?.[0];
      const body = typeof first?.text === "string" ? first.text : "";
      const asked = body.trimEnd().split("\n").pop() ?? "";
      const said =
        asked === "children"
          ? JSON.stringify({
              live: [...queries.values()].filter(
                (child) =>
                  child.exitCode === null && child.signalCode === null,
              ).length,
              closed: ended,
            })
          : "hello back";
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params?.sessionId ?? "",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: said },
          },
        },
      });
      respond(message.id, { stopReason: "end_turn" });
      return;
    }
    default:
      return;
  }
}
