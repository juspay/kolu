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
 *
 * The connection rules live in `connect.ts`; the frame vocabulary lives in
 * `render.ts`. This file is the REPL and nothing else — a second switch over
 * the frame union here is how one bin silently stops showing a frame kind the
 * other still does.
 */

import { once } from "node:events";
import { createInterface } from "node:readline";
import { connectToProxy } from "./connect.ts";
import { describeError } from "./errors.ts";
import { formatUpdate } from "./render.ts";

const USAGE = "usage: acp-chat <socket-path>";

async function main(): Promise<void> {
  const socketPath = process.argv[2];
  if (!socketPath) throw new Error(USAGE);

  const client = await connectToProxy(socketPath);

  /** Whether the agent is mid-sentence, so nothing lands inside one. */
  let streaming = false;
  const endStream = () => {
    if (!streaming) return;
    process.stdout.write("\n");
    streaming = false;
  };

  client.onUpdate((update) => {
    // The one frame kind the REPL renders itself: message text streams a token
    // at a time and should read as a sentence, not a line per token.
    if (update.sessionUpdate === "agent_message_chunk") {
      if (update.content.type !== "text") return;
      if (!streaming) {
        process.stdout.write("agent ▸ ");
        streaming = true;
      }
      process.stdout.write(update.content.text);
      return;
    }
    const line = formatUpdate(update);
    if (line === null) return;
    endStream();
    process.stdout.write(`  ${line}\n`);
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
  /** Sequences this REPL's own output state — the prompt redraw and
   *  `turnRunning`. The transport-level queue in `connectToProxy` is a
   *  different job: it serializes the turns themselves. */
  let queue: Promise<void> = Promise.resolve();

  const runTurn = async (text: string): Promise<void> => {
    turnRunning = true;
    try {
      const response = await client.prompt(text);
      endStream();
      if (response.stopReason !== "end_turn") {
        process.stdout.write(`  · turn ended: ${response.stopReason}\n`);
      }
    } catch (error) {
      endStream();
      process.stdout.write(`  · turn failed: ${describeError(error)}\n`);
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
    client.cancel();
  });

  // A proxy that goes away ends the session; carrying on prompting into a dead
  // socket would just queue turns nobody will answer.
  void client.closed.then(() => {
    process.stderr.write("acp-chat: the proxy closed the connection\n");
    process.exitCode = 1;
    repl.close();
  });

  await once(repl, "close");
  await queue;
  client.close();
}

await main().catch((error) => {
  process.stderr.write(`acp-chat: ${describeError(error)}\n`);
  process.exit(1);
});
