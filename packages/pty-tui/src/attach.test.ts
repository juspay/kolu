/**
 * End-to-end attach over the REAL transport: an in-process pty-host served on
 * a real unix socket, dialed via `connectPtyHost`, with `runAttach` driven
 * through a fake `AttachTty` (PassThrough stdin, captured stdout) — the whole
 * Phase 2 loop minus the actual tty: spawn → snapshot paint → keystroke
 * round-trip → `~.` detach (PTY survives) → exit-code discrimination.
 * The escape machine's byte-level behaviour is pinned separately in
 * `escape.test.ts`; this file covers the loop's wiring.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  createInProcessPtyHost,
  type InProcessPtyHostDeps,
  type PtyHostSocketListener,
  servePtyHostOverUnixSocket,
} from "@kolu/pty-host";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AttachOutcome, type AttachTty, runAttach } from "./attach.ts";
import { type Connection, connectPtyHost } from "./connect.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as InProcessPtyHostDeps["log"];

interface FakeTty {
  tty: AttachTty;
  /** Everything runAttach painted on the "screen" so far. */
  out(): string;
  /** Type raw bytes as the user. */
  type(s: string): void;
}

function fakeTty(): FakeTty {
  const input = new PassThrough();
  let out = "";
  return {
    tty: {
      input,
      write: async (d) => {
        out += d;
      },
      size: () => ({ cols: 80, rows: 24 }),
      onResize: () => () => {},
      setRawMode: () => {},
    },
    out: () => out,
    type: (s) => input.write(Buffer.from(s, "utf8")),
  };
}

async function until(cond: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

let listener: PtyHostSocketListener;
let conn: Connection;
let killAll: () => Promise<unknown>;

beforeAll(async () => {
  const { servedRouter, client } = createInProcessPtyHost({
    log: silentLog,
    shellDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
    version: "test",
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

afterAll(async () => {
  await killAll();
  conn.dispose();
  listener.close();
});

describe("runAttach — over a real unix socket", () => {
  it("returns not-found for an id no PTY has (before any screen takeover)", async () => {
    const { tty, out } = fakeTty();
    const outcome = await runAttach(
      conn.client,
      "00000000-0000-0000-0000-000000000000",
      { tty },
    );
    expect(outcome).toEqual({ kind: "not-found" });
    // Honest failure: nothing was painted on the local screen.
    expect(out()).toBe("");
  });

  it("paints the snapshot, round-trips a keystroke, detaches on ~., and leaves the PTY alive", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-attach-"));
    const { id, pid } = await conn.client.surface.terminal.spawn({
      cwd: dir,
    });
    const { tty, out, type } = fakeTty();
    const done = runAttach(conn.client, id, { tty });

    // The one-shot notice + the snapshot paint arrive first.
    await until(() => out().includes("snapshot restored"), "attach notice");
    expect(out()).toContain(`PTY pid ${pid}`);

    // A typed command flows stdin → escape machine → write RPC → PTY →
    // deltas → the local screen. $((…)) keeps the marker out of the echoed
    // command line, so a match proves the shell really ran it.
    type("echo MARK-$((6 * 7))\r");
    await until(() => out().includes("MARK-42"), "echo round-trip");

    // Line-start ~. detaches; the PTY must survive the client leaving.
    type("\r~.");
    const outcome = await done;
    expect(outcome).toEqual({ kind: "detached" });
    const { entries } = await conn.client.surface.terminal.list({});
    expect(entries.some((e) => e.id === id)).toBe(true);
  });

  it("reports the real exit code when the PTY's child exits", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-attach-"));
    const { id } = await conn.client.surface.terminal.spawn({ cwd: dir });
    const { tty, out, type } = fakeTty();
    const done = runAttach(conn.client, id, { tty });
    await until(() => out().includes("snapshot restored"), "attach notice");
    type("exit 7\r");
    const outcome = (await done) as Extract<AttachOutcome, { kind: "exited" }>;
    expect(outcome.kind).toBe("exited");
    expect(outcome.exitCode).toBe(7);
  });

  it("~? prints the local help without forwarding anything", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-attach-"));
    const { id } = await conn.client.surface.terminal.spawn({ cwd: dir });
    const { tty, out, type } = fakeTty();
    const done = runAttach(conn.client, id, { tty });
    await until(() => out().includes("snapshot restored"), "attach notice");
    type("~?");
    await until(() => out().includes("kolu-tui escapes"), "help text");
    type("~.");
    expect(await done).toEqual({ kind: "detached" });
    // The help went to the LOCAL tty only — the PTY's screen never saw it.
    const { text } = await conn.client.surface.terminal.getScreenText({
      id,
    });
    expect(text).not.toContain("kolu-tui escapes");
  });
});
