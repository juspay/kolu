/**
 * Pins the live-feed write against the transport the incident used: the CLI
 * child's `process.stdout` as a real pipe(2), driven by the SHIPPED pump. An
 * in-process Writable (PassThrough, `cat.stdin` from the test process) is a
 * different fd and did not catch a direct-pipe miss.
 *
 * Two properties, and a feed needs BOTH — the second is the one a hand-rolled
 * `writeSync` on the fd quietly trades away, because libuv leaves fd 1
 * non-blocking for a pipe and a full pipe then answers EAGAIN:
 *
 *   1. **promptness** — a line is readable with no later write behind it.
 *   2. **backpressure** — a consumer that stops reading (`| less`, a paused
 *      pager, a supervisor that is busy) SLOWS the writer; it does not kill it.
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
const FIXTURE = resolve(here, "stdoutPump.fixture.ts");

/** The fixture behind a shell pipeline, so the consumer is a real process on
 *  the other end of a pipe(2) rather than a Node `data` listener. */
const pipeline = (flags: string, consumer: string): string =>
  `${JSON.stringify(process.execPath)} --import ${JSON.stringify(TSX_LOADER)} ${JSON.stringify(FIXTURE)} ${flags} | ${consumer}`;

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

describe("the live-feed pump over a real pipe(2)", () => {
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const c of children.splice(0)) {
      if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
    }
  });

  const run = (script: string): ChildProcess => {
    const child = spawn("bash", ["-lc", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    return child;
  };

  const stdoutOf = (child: ChildProcess): NodeJS.ReadableStream => {
    if (child.stdout === null) throw new Error("spawned without stdout pipe");
    return child.stdout;
  };

  it("goes red when the line has no newline — the pin is not vacuous", async () => {
    const child = run(pipeline("--unterminated", "head -1"));
    await expect(readTerminatedLine(stdoutOf(child), 1500)).rejects.toThrow(
      /no terminated line/,
    );
  });

  it("`writer | head -1` sees the line with no later write", async () => {
    const child = run(pipeline("", "head -1"));
    const line = await readTerminatedLine(stdoutOf(child), 2500);
    expect(line.startsWith("\n")).toBe(false);
    expect(line).toBe("SNAPSHOT\n");
  });

  it("a slow head that stays open still prints the first line", async () => {
    // `head` (10 lines) stays open; `stdbuf -oL` is the line-buffered TTY
    // equivalent so this pin is about the WRITER, not GNU head's own fully
    // buffered stdout when the test captures it through a pipe.
    const child = run(pipeline("", "stdbuf -oL head"));
    const line = await readTerminatedLine(stdoutOf(child), 2500);
    expect(line).toBe("SNAPSHOT\n");
  });

  it("a consumer that STOPS reading slows the writer instead of killing it", async () => {
    // Nobody ever reads this pipe, so it fills. A `writeSync` on fd 1 answers
    // EAGAIN once it does and the feed dies mid-run — which reads as "stdout
    // died" to `kolu watch` and as "the consumer hung up" to `padi-tui`. The
    // sink waits on `drain`, so the writer simply waits with it.
    const child = spawn(
      process.execPath,
      ["--import", TSX_LOADER, FIXTURE, "--flood"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(child);
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const died = await Promise.race([
      new Promise<string>((resolve) => {
        child.on("exit", (code, signal) =>
          resolve(`exited code=${code} signal=${signal}: ${stderr.trim()}`),
        );
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    expect(died).toBeNull();
  });
});
