/**
 * Pins the live-feed write against the transport the incident used: the CLI
 * child's `process.stdout` as a real pipe(2) into GNU `head`, one line, no
 * later write. An in-process Writable (PassThrough, `cat.stdin` from the test
 * process) is a different fd and did not catch a direct-pipe miss.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;
const FIXTURE = resolve(here, "writeStdout.fixture.ts");

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

/**
 * The live incident was not an in-process Writable: it was the CLI's
 * `process.stdout` as a real pipe(2) into GNU `head`, and the snapshot sat
 * until a later write. This pin spawns the same pump the verb uses, one line,
 * no heartbeat, and lets `head -1` be the consumer — a delayed Node `data`
 * listener is a different transport.
 */
describe("process.stdout | head — CLI child, real pipe(2), no later write", () => {
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const c of children.splice(0)) {
      if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
    }
  });

  it("goes red when the child writes no newline — the pin is not vacuous", async () => {
    const pipeline = spawn(
      "bash",
      [
        "-lc",
        `${JSON.stringify(process.execPath)} --import ${JSON.stringify(TSX_LOADER)} ${JSON.stringify(FIXTURE)} --unterminated | head -1`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(pipeline);
    if (pipeline.stdout === null) {
      throw new Error("pipeline spawned without stdout pipe");
    }
    await expect(readTerminatedLine(pipeline.stdout, 1500)).rejects.toThrow(
      /no terminated line/,
    );
  });

  it("a plain shell pipeline `writer | head -1` sees the same line", async () => {
    const pipeline = spawn(
      "bash",
      [
        "-lc",
        `${JSON.stringify(process.execPath)} --import ${JSON.stringify(TSX_LOADER)} ${JSON.stringify(FIXTURE)} | head -1`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(pipeline);
    if (pipeline.stdout === null) {
      throw new Error("pipeline spawned without stdout pipe");
    }
    const line = await readTerminatedLine(pipeline.stdout, 2500);
    expect(line.startsWith("\n")).toBe(false);
    expect(line).toBe("SNAPSHOT\n");
  });

  it("a slow head that stays open still prints the first line with no later write", async () => {
    // `head` (10 lines) stays open; `stdbuf -oL` is the line-buffered TTY
    // equivalent so this pin is about the WRITER, not GNU head's own fully
    // buffered stdout when the test captures it through a pipe.
    const pipeline = spawn(
      "bash",
      [
        "-lc",
        `${JSON.stringify(process.execPath)} --import ${JSON.stringify(TSX_LOADER)} ${JSON.stringify(FIXTURE)} | stdbuf -oL head`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(pipeline);
    if (pipeline.stdout === null) {
      throw new Error("pipeline spawned without stdout pipe");
    }
    const line = await readTerminatedLine(pipeline.stdout, 2500);
    expect(line).toBe("SNAPSHOT\n");
  });
});
