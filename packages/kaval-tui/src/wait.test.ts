/**
 * Integration proof for `wait` over the REAL transport — an in-process pty-host
 * served on a real unix socket, dialed via the CLI's own `connectPtyHost`. Drives
 * `awaitOutputCondition` directly (NOT `cmdWait`, which calls `process.exit` and
 * would kill the runner). The output source is a `cat` PTY: writing to it makes
 * the tty echo bytes back as `terminalAttach` deltas at test-controlled times, so
 * quiescence detection is exercised against real PTY output (no hooks, no
 * busy-word table) with the emit timing in the test's hands.
 *
 * It pins the acceptance criteria: a terminal that goes quiet resolves `idle`
 * after the window; one that keeps emitting blocks until the `--timeout`; a regex
 * matches new output; a terminal that exits first resolves `gone` (exit 3); and a
 * Ctrl+C (signal abort) resolves `interrupted`. `parseUntil` is unit-tested
 * separately (pure, no socket).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInProcessPtyHost,
  type InProcessPtyHostDeps,
  type PtyHostSocketListener,
  servePtyHostOverUnixSocket,
} from "kaval";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Connection, connectPtyHost } from "./connect.ts";
import { buildCreateInput, newPtyId } from "./create.ts";
import { awaitOutputCondition, parseUntil } from "./wait.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as InProcessPtyHostDeps["log"];

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

let listener: PtyHostSocketListener;
let conn: Connection;
let killAll: () => Promise<unknown>;

/** Spawn a `cat` PTY (a pure echo — writes come straight back as output deltas)
 *  and return its id. The id is minted client-side, so it's the resolved full id
 *  with no list round-trip. */
async function spawnCat(): Promise<string> {
  const id = newPtyId();
  await conn.client.surface.terminal.spawn(
    buildCreateInput({ id, cwd: tmpdir(), env: process.env, command: ["cat"] }),
  );
  return id;
}

const write = (id: string, data: string): Promise<unknown> =>
  conn.client.surface.terminal.write({ id, data });

beforeAll(async () => {
  const { servedRouter, client } = createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
  });
  killAll = () => client.surface.terminal.killAll({});
  const socketPath = join(
    mkdtempSync(join(tmpdir(), "kolu-pty-sock-")),
    "pty-host.sock",
  );
  listener = await servePtyHostOverUnixSocket({
    socketPath,
    router: servedRouter,
    log: silentLog,
  });
  conn = await connectPtyHost(socketPath);
});

afterEach(async () => {
  await killAll();
});

afterAll(async () => {
  conn.dispose();
  await listener.close();
});

describe("parseUntil — the --until grammar (pure)", () => {
  it("parses idle:<ms> as a positive integer window", () => {
    expect(parseUntil("idle:800")).toEqual({ kind: "idle", ms: 800 });
    expect(parseUntil("idle:1")).toEqual({ kind: "idle", ms: 1 });
  });

  it("rejects a non-positive / non-integer / empty idle window", () => {
    for (const bad of [
      "idle:0",
      "idle:-5",
      "idle:8.5",
      "idle:8e2",
      "idle:",
      "idle:abc",
    ]) {
      const r = parseUntil(bad);
      expect(r.kind).toBe("error");
    }
  });

  it("parses match:<regex> into a usable RegExp", () => {
    const r = parseUntil("match:DO[N]E");
    expect(r.kind).toBe("match");
    if (r.kind === "match") expect(r.regex.test("xx DONE yy")).toBe(true);
  });

  it("rejects an empty or invalid match pattern", () => {
    expect(parseUntil("match:").kind).toBe("error");
    expect(parseUntil("match:[").kind).toBe("error"); // unterminated class
  });

  it("rejects an unknown --until form", () => {
    expect(parseUntil("settled").kind).toBe("error");
    expect(parseUntil("idle").kind).toBe("error"); // no colon
  });
});

describe("awaitOutputCondition — idle quiescence over a real socket", () => {
  it("resolves `idle` after the window once a terminal goes quiet", async () => {
    const id = await spawnCat(); // cat is silent with no input
    const outcome = await awaitOutputCondition(conn.client, {
      id,
      condition: { kind: "idle", ms: 300 },
      timeoutMs: 5000,
    });
    expect(outcome.kind).toBe("met");
    if (outcome.kind === "met") {
      expect(outcome.fired).toBe("idle");
      // It waited out the quiet window rather than firing instantly.
      expect(outcome.elapsedMs).toBeGreaterThanOrEqual(250);
    }
  });

  it("resolves `idle` after output STOPS (emits, then pauses > window)", async () => {
    const id = await spawnCat();
    const p = awaitOutputCondition(conn.client, {
      id,
      condition: { kind: "idle", ms: 400 },
      timeoutMs: 8000,
    });
    // Emit three bursts ~120ms apart (each resets the window), then stay quiet.
    await sleep(100); // let the subscription + snapshot settle first
    for (let i = 0; i < 3; i++) {
      await write(id, `burst-${i}\n`);
      await sleep(120);
    }
    const outcome = await p;
    expect(outcome.kind).toBe("met");
    if (outcome.kind === "met") {
      expect(outcome.fired).toBe("idle");
      // It fired only AFTER the bursts stopped: ~360ms of emitting + the 400ms
      // window, so the window was reset by each delta rather than firing at 400ms.
      expect(outcome.elapsedMs).toBeGreaterThanOrEqual(600);
    }
  });

  it("BLOCKS until --timeout while output keeps coming", async () => {
    const id = await spawnCat();
    let writing = true;
    // Drive a delta every 100ms — well inside the 500ms idle window, so idle can
    // never accumulate and the wait must run to the 1500ms timeout.
    const pump = (async () => {
      while (writing) {
        await write(id, "x\n");
        await sleep(100);
      }
    })();
    try {
      const t0 = Date.now();
      const outcome = await awaitOutputCondition(conn.client, {
        id,
        condition: { kind: "idle", ms: 500 },
        timeoutMs: 1500,
      });
      expect(outcome.kind).toBe("timeout");
      expect(Date.now() - t0).toBeGreaterThanOrEqual(1400); // ran to the cap
    } finally {
      writing = false;
      await pump;
    }
  });
});

describe("awaitOutputCondition — match, exit, and interrupt", () => {
  it("resolves `match` when new output matches the regex", async () => {
    const id = await spawnCat();
    const p = awaitOutputCondition(conn.client, {
      id,
      condition: { kind: "match", regex: /KAVAL-WAIT-MARK/ },
      timeoutMs: 5000,
    });
    await sleep(100); // subscribe first, so the marker arrives as a delta
    await write(id, "KAVAL-WAIT-MARK\n");
    const outcome = await p;
    expect(outcome.kind).toBe("met");
    if (outcome.kind === "met") {
      expect(outcome.fired).toBe("match");
      // Narrow on the discriminant the assertion above just proved, so reading
      // `matchedLine` needs no presence guard (the split union ties it to
      // `fired === "match"`).
      if (outcome.fired === "match")
        expect(outcome.matchedLine).toContain("KAVAL-WAIT-MARK");
    }
  });

  it("resolves `gone` when the terminal exits before the condition", async () => {
    const id = await spawnCat();
    const p = awaitOutputCondition(conn.client, {
      id,
      // A long idle window the kill must short-circuit before it could fire.
      condition: { kind: "idle", ms: 5000 },
      timeoutMs: 10000,
    });
    await sleep(100);
    const t0 = Date.now();
    await conn.client.surface.terminal.kill({ id });
    const outcome = await p;
    expect(outcome.kind).toBe("gone");
    expect(Date.now() - t0).toBeLessThan(3000); // not the 5s window / 10s timeout
  });

  it("resolves `interrupted` when the caller's signal aborts", async () => {
    const id = await spawnCat(); // silent, so only the abort can settle it
    const abort = new AbortController();
    const p = awaitOutputCondition(conn.client, {
      id,
      condition: { kind: "idle", ms: 9000 },
      signal: abort.signal,
    });
    await sleep(150);
    abort.abort();
    const outcome = await p;
    expect(outcome.kind).toBe("interrupted");
  });
});
