#!/usr/bin/env bun
/** Records ACP requests; every open resets the preset, as adapters may do. */
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let pending = "";
let news = 0;
let mode = "default";
let rejected: string | null = null;
const configOptions = () => [
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: mode,
    options: ["default", "full", "human", "auto"].map((value) => ({
      value,
      name: value,
    })),
  },
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "test-model",
    options: [{ value: "test-model", name: "Test model" }],
  },
];
const write = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value)}\n`);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    appendFileSync("requests.log", `${line}\n`);
    const respond = (result: unknown) =>
      write({ jsonrpc: "2.0", id: message.id, result });
    switch (message.method) {
      case "initialize":
        respond({
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { list: {} },
          },
        });
        break;
      case "session/list":
        if (rejected !== null) {
          write({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: rejected,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "late refused history" },
              },
            },
          });
          rejected = null;
        }
        respond({
          sessions: process.argv.includes("--stored")
            ? [{ sessionId: "stored", cwd: process.cwd() }]
            : [],
        });
        break;
      case "session/new":
        mode = "default";
        respond({ sessionId: `new-${++news}`, configOptions: configOptions() });
        break;
      case "session/load":
        mode = "default";
        if (process.argv.includes("--history")) {
          write({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: message.params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "restored history" },
              },
            },
          });
        }
        respond({ configOptions: configOptions() });
        break;
      case "session/set_mode":
        if (existsSync(join(process.cwd(), "reject-mode"))) {
          rejected = message.params.sessionId;
          write({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32602, message: "mode selection refused" },
          });
        } else {
          mode = message.params.modeId;
          respond({});
        }
        break;
      case "session/prompt":
        write({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: message.params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: mode },
            },
          },
        });
        respond({ stopReason: "end_turn" });
        break;
    }
  }
});
