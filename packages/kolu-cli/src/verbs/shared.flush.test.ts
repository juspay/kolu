/**
 * Pins the live-feed write: a piped consumer sees each line TERMINATED in the
 * tick it was emitted, without needing a subsequent write to complete it.
 *
 * The one-event lag: if the writer emits payload without a trailing newline
 * (or puts the newline on the NEXT write), `grep`/`awk`/`head` sit on an
 * unterminated line until the next event arrives — and the last event is
 * invisible until the process exits. A file looks complete because the next
 * write is already in it.
 */

import { spawn } from "node:child_process";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { writeFlushedLine } from "./shared.ts";

/** Read one terminated line from a pipe, or fail naming the unterminated bytes
 *  we did get — that is the lag, not a timeout with no diagnosis. */
function readTerminatedLine(
  stream: NodeJS.ReadableStream,
  ms: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: string | Buffer): void => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      cleanup();
      resolve(buf.slice(0, nl + 1));
    };
    const t = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `no terminated line in ${ms}ms; unterminated bytes: ${JSON.stringify(buf)}`,
        ),
      );
    }, ms);
    const cleanup = (): void => {
      clearTimeout(t);
      stream.off("data", onData);
    };
    stream.setEncoding("utf8");
    stream.on("data", onData);
  });
}

/** A real OS pipe (`cat` stdin→stdout), not a PassThrough — the lag is a pipe
 *  consumer waiting on a newline. */
function pipeCat(): {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  kill: () => void;
} {
  const child = spawn("cat", [], { stdio: ["pipe", "pipe", "ignore"] });
  if (child.stdin === null || child.stdout === null) {
    child.kill("SIGKILL");
    throw new Error("cat spawned without a pipe pair");
  }
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    kill: () => child.kill("SIGKILL"),
  };
}

describe("writeFlushedLine — one flushed unit, trailing newline", () => {
  const cats: Array<{ kill: () => void }> = [];
  afterEach(() => {
    for (const c of cats.splice(0)) c.kill();
  });

  it("a pipe sees a terminated line without any subsequent write", async () => {
    const cat = pipeCat();
    cats.push(cat);
    const pending = readTerminatedLine(cat.stdout, 2000);
    await Effect.runPromise(writeFlushedLine(cat.stdin, "SNAPSHOT"));
    const line = await pending;
    expect(line.startsWith("\n")).toBe(false);
    expect(line.endsWith("\n")).toBe(true);
    expect(line).toBe("SNAPSHOT\n");
  });

  it("the second line is not what terminates the first", async () => {
    const cat = pipeCat();
    cats.push(cat);
    const firstPending = readTerminatedLine(cat.stdout, 2000);
    await Effect.runPromise(writeFlushedLine(cat.stdin, "FIRST"));
    const first = await firstPending;
    expect(first).toBe("FIRST\n");
    const secondPending = readTerminatedLine(cat.stdout, 2000);
    await Effect.runPromise(writeFlushedLine(cat.stdin, "SECOND"));
    expect(await secondPending).toBe("SECOND\n");
  });
});
