/**
 * AN AGENT THAT STARTS AND THEN REFUSES THE HANDSHAKE — the bring-up that has
 * a process to clean up and nothing else.
 *
 * It writes its own pid to the file named by its first argument, answers
 * `initialize` with an ordinary JSON-RPC error (not `-32000`: nobody being
 * signed in is the one refusal that keeps the process), and then stays up,
 * reading stdin, the way a real adapter does after a refused request. So the
 * only thing that can end it is the client that started it, and a test can
 * ask the operating system whether that happened.
 */

import { writeFileSync } from "node:fs";

const pidFile = process.argv[2];
if (pidFile === undefined) throw new Error("usage: <pid file>");
writeFileSync(pidFile, String(process.pid));

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim() === "") continue;
    const message = JSON.parse(line) as { id?: unknown; method?: string };
    if (message.id === undefined) continue;
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "this agent will not start" },
      })}\n`,
    );
  }
});
