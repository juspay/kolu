/**
 * AN AGENT THAT STARTS AND THEN REFUSES — the bring-up that has a process to
 * clean up and nothing else.
 *
 * It writes its own pid to the file named by its first argument, then refuses
 * one method: `initialize` by default, or the method named by its second
 * argument (answering `initialize` normally first). The refusal is an ordinary
 * JSON-RPC error, `-32603`, unless a third argument gives the code — `-32000`,
 * nobody signed in, is the one refusal that keeps the process. Every other
 * request is answered with an empty result, and the process stays up reading
 * stdin the way a real adapter does after a refused request. So the only
 * thing that can end it is the client that started it, and a test can ask the
 * operating system whether that happened.
 */

import { writeFileSync } from "node:fs";

const pidFile = process.argv[2];
if (pidFile === undefined) throw new Error("usage: <pid file> [method] [code]");
const refused = process.argv[3] ?? "initialize";
const code = Number(process.argv[4] ?? "-32603");
writeFileSync(pidFile, String(process.pid));

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

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
    if (message.method === refused) {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code, message: "this agent will not start" },
      });
    } else if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
      });
    } else {
      write({ jsonrpc: "2.0", id: message.id, result: {} });
    }
  }
});
