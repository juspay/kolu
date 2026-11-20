import { type ChildProcess, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterEach, describe, expect, it } from "vitest";
import { readTerminatedLine, TSX_LOADER } from "../e2eDaemon.testlib.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "stdoutPump.fixture.ts");

const pipeline = (flags: string, consumer: string): string =>
  `${JSON.stringify(process.execPath)} --import ${JSON.stringify(TSX_LOADER)} ${JSON.stringify(FIXTURE)} ${flags} | ${consumer}`;

const children: ChildProcess[] = [];
const reapChildren = (): void => {
  for (const c of children.splice(0)) {
    if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  }
};

describe("the live-feed pump over a real pipe(2)", () => {
  afterEach(reapChildren);

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

  const lineOrThrow = async (
    stream: NodeJS.ReadableStream,
    ms: number,
  ): Promise<string> => {
    const read = await readTerminatedLine(stream, ms);
    switch (read.kind) {
      case "line":
        return read.line;
      case "partial":
        throw new Error(
          `no terminated line in ${ms}ms; unterminated bytes: ${JSON.stringify(read.bytes)}`,
        );
      case "timeout":
        throw new Error(`no terminated line in ${ms}ms; no bytes at all`);
    }
  };

  const FIRST_LINE_MS = 15_000;

  it(
    "goes red when the line has no newline — the pin is not vacuous",
    async () => {
      const child = run(pipeline("--unterminated", "head -1"));
      const read = await readTerminatedLine(stdoutOf(child), FIRST_LINE_MS);
      expect(read.kind).not.toBe("line");
    },
    FIRST_LINE_MS * 2,
  );

  it(
    "`writer | head -1` sees the line with no later write",
    async () => {
      const child = run(pipeline("", "head -1"));
      const line = await lineOrThrow(stdoutOf(child), FIRST_LINE_MS);
      expect(line.startsWith("\n")).toBe(false);
      expect(line).toBe("SNAPSHOT\n");
    },
    FIRST_LINE_MS * 2,
  );

  it(
    "a slow head that stays open still prints the first line",
    async () => {
      const child = run(pipeline("", "stdbuf -oL head"));
      const line = await lineOrThrow(stdoutOf(child), FIRST_LINE_MS);
      expect(line).toBe("SNAPSHOT\n");
    },
    FIRST_LINE_MS * 2,
  );
});

describeDaemon("the live-feed pump under a consumer that stops reading", () => {
  afterEach(reapChildren);

  it("a consumer that STOPS reading slows the writer instead of killing it", async () => {
    assertDaemonSpawnAllowed("a flooding writer against an unread pipe");
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
