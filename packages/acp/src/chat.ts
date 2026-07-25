/**
 * `acp-chat` — a REPL against an `acp-proxy` socket.
 *
 *     acp-chat <socket-path>
 *
 * Each line you type is one `session/prompt`; the reply streams back as
 * `session/update` frames. It is the stand-in for pesu until pesu exists, and
 * proves the exact client path pesu will reuse — same library, same socket,
 * same frames — while staying useful afterwards as a debugging client.
 *
 * Reads piped stdin just as happily as a tty, which is what makes it scriptable
 * (`echo "reply with exactly: pong" | acp-chat <sock>`).
 */

import { connect } from "node:net";
import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import {
  type Client,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  RequestError,
  type SessionNotification,
} from "@zed-industries/agent-client-protocol";

const USAGE = "usage: acp-chat <socket-path>";

async function main(): Promise<void> {
  const socketPath = process.argv[2];
  if (!socketPath) throw new Error(USAGE);

  const socket = await new Promise<ReturnType<typeof connect>>(
    (resolve, reject) => {
      const s = connect(socketPath)
        .once("connect", () => resolve(s))
        .once("error", reject);
    },
  );

  /** Whether the agent is mid-sentence, so a tool line never lands inside one. */
  let streaming = false;
  const endStream = () => {
    if (!streaming) return;
    process.stdout.write("\n");
    streaming = false;
  };

  const client: Client = {
    sessionUpdate: async (params: SessionNotification) => {
      const update = params.update;
      switch (update.sessionUpdate) {
        case "agent_message_chunk": {
          if (update.content.type !== "text") return;
          if (!streaming) {
            process.stdout.write("agent ▸ ");
            streaming = true;
          }
          process.stdout.write(update.content.text);
          return;
        }
        case "tool_call": {
          endStream();
          process.stdout.write(
            `  · ${update.kind ?? "other"}: ${update.title}\n`,
          );
          return;
        }
        case "tool_call_update": {
          if (update.status !== "completed" && update.status !== "failed")
            return;
          endStream();
          process.stdout.write(`  · ${update.status}\n`);
          return;
        }
        default:
          return;
      }
    },
    // The proxy answers permission requests itself until they are forwarded to
    // the thread, so reaching this is a contract break, not a prompt to guess.
    requestPermission: async (params: RequestPermissionRequest) => {
      throw RequestError.internalError({
        reason: `the proxy forwarded a permission request this client cannot answer: ${
          params.toolCall.title ?? params.toolCall.toolCallId
        }`,
      });
    },
  };

  const connection = new ClientSideConnection(
    () => client,
    ndJsonStream(Writable.toWeb(socket), Readable.toWeb(socket)),
  );

  await connection.initialize({ protocolVersion: PROTOCOL_VERSION });
  const session = await connection.newSession({
    cwd: process.cwd(),
    mcpServers: [],
  });

  const repl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const interactive = process.stdin.isTTY === true;
  const showPrompt = () => {
    if (interactive) process.stdout.write("> ");
  };

  let turnRunning = false;
  /** Lines are answered one at a time: one session, one turn. */
  let queue: Promise<void> = Promise.resolve();

  const runTurn = async (text: string): Promise<void> => {
    turnRunning = true;
    try {
      const response = await connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text }],
      });
      endStream();
      if (response.stopReason !== "end_turn") {
        process.stdout.write(`  · turn ended: ${response.stopReason}\n`);
      }
    } catch (error) {
      endStream();
      process.stdout.write(`  · turn failed: ${String(error)}\n`);
    } finally {
      turnRunning = false;
      showPrompt();
    }
  };

  showPrompt();
  repl.on("line", (line) => {
    const text = line.trim();
    if (!text) {
      showPrompt();
      return;
    }
    queue = queue.then(() => runTurn(text));
  });

  // Ctrl+C cancels the turn in flight; with nothing running it means "quit".
  repl.on("SIGINT", () => {
    if (!turnRunning) {
      repl.close();
      return;
    }
    void connection.cancel({ sessionId: session.sessionId });
  });

  await new Promise<void>((resolve) => repl.once("close", () => resolve()));
  await queue;
  socket.destroy();
}

await main().catch((error) => {
  process.stderr.write(`acp-chat: ${String(error)}\n`);
  process.exit(1);
});
