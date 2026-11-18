/**
 * AN AGENT NOBODY IS SIGNED IN TO — the one refusal with something to do about
 * it, and what happens after somebody does it.
 *
 * ACP spells "authenticate first" as an error RESPONSE (`-32000`) to whatever
 * was refused, so the way an agent asks for a signature is to say no to
 * `session/new`. This fixture does exactly that, and advertises the two kinds
 * of sign-in a client may be offered so the method reading has both to read:
 * a `terminal` one, whose command line it hands over in its own `_meta` corner,
 * and an `env_var` one, which this harness deliberately does not offer.
 *
 * THE SECOND `session/new` SUCCEEDS, and that is not a trick: a terminal
 * sign-in is a SEPARATE process writing a credential store, so what the agent
 * sees is simply a later call made by a client that now has a signature. The
 * fixture cannot watch that process and does not need to — "refused once, then
 * open" is the whole of what the agent experiences.
 */

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

interface Message {
  readonly id?: unknown;
  readonly method?: string;
}

/** How many opens have been refused. ONE, because the sign-in a client runs
 *  between the first and the second is the whole subject. */
let refusals = 0;

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
          agentCapabilities: {},
          authMethods: [
            {
              id: "subscription",
              name: "Claude subscription",
              type: "terminal",
              args: [],
              env: {},
              _meta: {
                "terminal-auth": {
                  command: process.execPath,
                  args: [
                    "-e",
                    "process.stdout.write('visit https://example.invalid\\n')",
                  ],
                },
              },
            },
            { id: "api-key", name: "API key", type: "env_var" },
          ],
        },
      });
      continue;
    }
    if (message.method === "session/new") {
      if (refusals === 0) {
        refusals += 1;
        write({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: "Authentication required" },
        });
        continue;
      }
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: "sess-1", configOptions: [] },
      });
      continue;
    }
    // A LOAD IS REFUSED FOR THE ID, always: this fixture's store is empty, so
    // the only honest answer to any session id is that there is no such
    // conversation. Paired with the `session/new` above it, that is both
    // halves of one bring-up — the id is gone AND nobody is signed in — which
    // is the case where the break a fall-through mints has to come back out.
    if (message.method === "session/load") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32002, message: "Resource not found" },
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
    if (message.method === "authenticate") {
      write({ jsonrpc: "2.0", id: message.id, result: {} });
    }
  }
});

// A MODULE, not a script: these files import nothing, and two scripts in one
// program share a scope — so `write` here and `write` next door would be one
// redeclared binding rather than two private ones.
export {};
