/**
 * AN AGENT NOBODY IS SIGNED IN TO THAT OPENS THE CONVERSATION ANYWAY — the
 * shape the pair kolu actually ships has, and the one no fixture had.
 *
 * `signed-out-agent.ts` next door refuses `session/new` with ACP's `-32000`,
 * which is the protocol's own way of asking for a signature and was the only
 * way kolu ever heard one. MEASURED against the pinned adapter
 * (`@agentclientprotocol/claude-agent-acp` 0.81.2) driving agent-distro's
 * `claude` 2.1.319 with an empty `$HOME`, the real sequence is different and
 * no refusal of the open appears in it at all:
 *
 *   → initialize                 ← authMethods: claude-ai-login, console-login
 *                                  (both `terminal`, both carrying a command
 *                                  line in `_meta["terminal-auth"]`)
 *   ← _auth/status_update        {"authStatus":{"kind":"none",
 *                                  "label":"Not logged in"}}
 *   → session/new                ← OK, sessionId
 *   → session/prompt             ← -32000 "Authentication required"
 *
 * So this fixture says "nobody is signed in" the way that pair says it, opens
 * the session, and refuses the TURN. Both of those are a sign-in offer, and
 * neither used to be one.
 *
 * `--no-methods` is the SAME agent with nothing to advertise: a signed-out
 * handshake whose `authMethods` is empty, which is the dead end a panel must
 * describe rather than paper over with a button that would run nothing.
 *
 * `--no-status` is the same agent with nothing to SAY about its identity: it
 * pushes no `_auth/status_update` at all, so the only word it ever gives is
 * the refused turn. That is the other door, and it has to work on its own.
 *
 * `session/load` is REFUSED here, with `-32002 Resource not found` rather than
 * `-32000`: a panel that is signed out was signed in once, so it comes back
 * holding a session id, and on the owner's host that id was one the CLI no
 * longer had. That refusal is about the ID, and reading it as "the agent is
 * broken" is what used to kill the adapter the sign-in had to run against.
 */

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

interface Message {
  readonly id?: unknown;
  readonly method?: string;
  readonly params?: { readonly sessionId?: string };
}

/** Whether this run advertises a way in. Off is the honest dead end. */
const mute = process.argv.includes("--no-methods");

/** Whether this run says who it is. Off leaves the refused TURN as the only
 *  thing that ever asks for a signature. */
const silent = process.argv.includes("--no-status");

/** The method the real adapter hands over, in its shape: a command line in the
 *  `_meta` corner, which the harness RUNS. This one prints a URL and then
 *  reads a line from its stdin — the two halves of a terminal sign-in a person
 *  sees — and exits 0 on anything typed, because what is under test here is
 *  the flow rather than an OAuth exchange. */
const METHODS = [
  {
    id: "console-login",
    name: "Anthropic Console",
    description: "Use Anthropic Console (API usage billing)",
    type: "terminal",
    args: [],
    env: {},
    _meta: {
      "terminal-auth": {
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write('visit https://example.invalid/oauth\\nPaste code here if prompted > ');" +
            "process.stdin.setEncoding('utf8');" +
            "process.stdin.once('data', () => { process.stdout.write('\\nsigned in\\n'); process.exit(0); });",
        ],
        label: "Anthropic Console Login",
      },
    },
  },
];

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
          agentCapabilities: { _meta: { authStatus: {} } },
          agentInfo: { name: "fixture-agent", version: "0.0.1" },
          authMethods: mute ? [] : METHODS,
        },
      });
      // AFTER the reply, the way the adapter sends it: the identity is a
      // CONNECTION fact it pushes once it has probed its CLI, and a client
      // that read it off the handshake would be reading a field the protocol
      // does not have.
      if (!silent) {
        write({
          jsonrpc: "2.0",
          method: "_auth/status_update",
          params: { authStatus: { kind: "none", label: "Not logged in" } },
        });
      }
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
    // ... AND THE STALE ID THE OWNER'S HOST ACTUALLY HAD. A signed-out panel
    // is a panel that was signed in once, so there IS a remembered session id
    // — and the CLI behind this adapter no longer has it. Refused with the
    // pinned adapter's own answer, which is a refusal and not a sign-in
    // request: this agent would open a conversation for anybody, just not
    // THAT one.
    if (message.method === "session/load") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32002,
          message: `Resource not found: ${message.params?.sessionId ?? ""}`,
        },
      });
      continue;
    }
    // The permission mode a leg asks for on every open. Answered rather than
    // ignored: a request nobody replies to is a bring-up that hangs until the
    // boot deadline, which is a worse test failure than any assertion.
    if (message.method === "session/set_mode") {
      write({ jsonrpc: "2.0", id: message.id, result: {} });
      continue;
    }
    if (message.method === "session/prompt") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: "Authentication required" },
      });
      continue;
    }
    if (message.method === "session/close") {
      write({ jsonrpc: "2.0", id: message.id, result: {} });
    }
  }
});

// A MODULE, not a script: these files import nothing, and two scripts in one
// program share a scope — so `write` here and `write` next door would be one
// redeclared binding rather than two private ones.
export {};
