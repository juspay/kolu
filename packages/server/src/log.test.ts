/** kolu-server's durable log file (juspay/kolu#2183).
 *
 *  The gap this covers is NOT a missing log line — the convergence decision that
 *  SIGTERM'd a healthy padi was already logged at WARN with its full evidence
 *  (`endpoint.ts`'s takeover observation). It went to the PTY `kolu web` was
 *  launched from and died with it, so the incident could only be reconstructed by
 *  reading source. These tests pin the DELIVERY half: where the file goes, that
 *  both destinations stay wired, that a boot leaves a real file behind, and that a
 *  root it cannot write refuses to boot quietly.
 *
 *  The live-write case runs OUT OF PROCESS on purpose. A pino transport is a worker
 *  thread, and one built inside the vitest worker keeps it alive past the run — the
 *  suite hangs rather than fails, which is why padi has never unit-tested its own
 *  identical logger. A child process both dodges that and exercises the real exit
 *  path, where the flush that matters actually happens. */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KOLU_SERVER_LOG_FILE,
  koluServerLogPath,
  serverLogTargets,
} from "./log.ts";

const freshRoot = (): string => mkdtempSync(join(tmpdir(), "kolu-log-test-"));

describe("koluServerLogPath", () => {
  it("puts the log beside config.json under the state root", () => {
    expect(koluServerLogPath("/var/lib/kolu")).toBe(
      `/var/lib/kolu/${KOLU_SERVER_LOG_FILE}`,
    );
  });

  it("resolves a relative root, so a later cwd change cannot move the file", () => {
    expect(koluServerLogPath("./state")).toBe(
      join(process.cwd(), "state", KOLU_SERVER_LOG_FILE),
    );
  });
});

describe("serverLogTargets", () => {
  const targets = serverLogTargets("/var/lib/kolu");

  it("keeps BOTH destinations — dropping stdout would silence a foreground run", () => {
    // The point of the multistream: the file is ADDED, nothing is taken away. A
    // regression to a file-only logger looks fine in a post-mortem and blinds
    // `kolu web` in a terminal, plus journald under systemd.
    expect(targets).toHaveLength(2);
    const stdout = targets.find((t) => t.options?.destination === 1);
    expect(stdout).toBeDefined();
  });

  it("caps the file, so an unattended server cannot fill its state root", () => {
    const roll = targets.find((t) => t.target === "pino-roll");
    expect(roll?.options).toMatchObject({
      file: `/var/lib/kolu/${KOLU_SERVER_LOG_FILE}`,
      size: "10m",
      // `removeOtherLogFiles` is load-bearing, not decoration: without it pino-roll
      // prunes only what THIS process wrote, so the cap resets every restart and the
      // generations pile up (padi's config omits it and holds 7 against `count: 3`).
      limit: { count: 3, removeOtherLogFiles: true },
    });
  });
});

/** A child that boots `tsx` plus a pino transport takes tens of seconds on a cold
 *  cache — well past vitest's 5s default, which is what made the first draft of this
 *  suite look like a hang rather than a slow test. */
const CHILD_TIMEOUT_MS = 90_000;

const LOG_MODULE = fileURLToPath(new URL("./log.ts", import.meta.url));

/** Run a snippet against the real logger in a child process, and return its exit code.
 *  `--import tsx` so the TypeScript source loads exactly as the suite's does. */
function runAgainstLogger(body: string): number {
  const script = [
    `import { configureServerLog, log } from ${JSON.stringify(LOG_MODULE)};`,
    body,
  ].join("\n");
  const done = spawnSync(
    process.execPath,
    ["--import", "tsx", "--eval", script],
    {
      // Production mode so the child's stdout target is plain JSON rather than
      // pino-pretty — these assert the FILE, and a pretty stdout is just noise.
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "ignore",
      timeout: 60_000,
    },
  );
  if (done.error) throw done.error;
  return done.status ?? -1;
}

describe("configureServerLog", () => {
  it(
    "leaves the server's own log lines on disk after the process exits",
    () => {
      const root = freshRoot();
      // The shape of the line #2183 needed and never got: a convergence decision
      // carrying the evidence that drove it.
      const code = runAgainstLogger(
        `configureServerLog(${JSON.stringify(root)});
       log.warn({ pid: 452035, trigger: "silence" }, "convergence: TOOK OVER the daemon");
       // pino-roll writes from a worker thread; hold the loop open long enough for
       // the line to land, since a bare --eval otherwise exits first.
       await new Promise((r) => setTimeout(r, 750));`,
      );
      expect(code).toBe(0);

      // pino-roll appends a GENERATION NUMBER — the lines land in `kolu-server.log.1`,
      // never in the base path. Reading the base is what an operator does first and what
      // this test did at first too; both find an empty file.
      const written = readFileSync(`${koluServerLogPath(root)}.1`, "utf8");
      expect(written).toContain("convergence: TOOK OVER the daemon");
      expect(written).toContain('"trigger":"silence"');
      // `base` rides every line — `serverId` is what pins a line to one process run,
      // which is the whole basis of a post-mortem across restarts.
      expect(written).toContain('"serverId"');
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "leaves no misleading empty file at the un-numbered base path",
    () => {
      const root = freshRoot();
      runAgainstLogger(
        `configureServerLog(${JSON.stringify(root)});
       log.info("hello");
       await new Promise((r) => setTimeout(r, 750));`,
      );
      // The writability probe must clean up after itself. padi's equivalent does not,
      // and its `padi.log` has sat at zero bytes since July while `.1`–`.7` filled up.
      expect(existsSync(koluServerLogPath(root))).toBe(false);
    },
    CHILD_TIMEOUT_MS,
  );

  // Root ignores the mode bits this case rests on, so there is no unwritable
  // directory to hand it. Skip rather than assert something that cannot hold.
  const asNonRoot = process.getuid?.() === 0 ? it.skip : it;

  asNonRoot(
    "fails loudly when the state root cannot be written",
    () => {
      // A server that cannot open its log must crash at boot rather than run
      // log-less — the fail-fast doctrine, and the entire point of the file.
      const locked = freshRoot();
      chmodSync(locked, 0o500); // r-x: the mkdir inside it must fail
      try {
        expect(
          runAgainstLogger(
            `configureServerLog(${JSON.stringify(join(locked, "state"))});`,
          ),
        ).not.toBe(0);
      } finally {
        chmodSync(locked, 0o700); // so the tmp dir can be cleaned up
      }
    },
    CHILD_TIMEOUT_MS,
  );
});
