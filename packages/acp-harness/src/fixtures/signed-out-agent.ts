/**
 * AN AGENT NOBODY IS SIGNED IN TO — the one refusal with something to do about
 * it.
 *
 * ACP spells "authenticate first" as an error RESPONSE (`-32000`) to whatever
 * was refused, so the way an agent asks for a signature is to say no to
 * `session/new`. This fixture does exactly that, and advertises the two kinds
 * of sign-in a client may be offered so the method reading has both to read:
 * a `terminal` one, whose command line it hands over in its own `_meta` corner,
 * and an `env_var` one, which this harness deliberately does not offer.
 */

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

interface Message {
  readonly id?: unknown;
  readonly method?: string;
}

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
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: "Authentication required" },
      });
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
