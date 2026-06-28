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
  type PtyHostSpawnInput,
  servePtyHostOverUnixSocket,
} from "kaval";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AttachOutcome, type AttachTty, runAttach } from "./attach.ts";
import {
  type Connection,
  connectPtyHost,
  type PtyTuiClient,
} from "./connect.ts";
import { buildCreateInput, newPtyId } from "./create.ts";
import { runKill } from "./kill.ts";
import { resolveTerminalId, shortId } from "./render.ts";
import { planSend } from "./send.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as InProcessPtyHostDeps["log"];

/** A minimal fully-specified spawn — a plain `$SHELL` run with no login flag, no
 *  rc files (the host derives nothing from policy since B0). Delegates to the
 *  production composer so the test shape can't drift from what `create` sends. */
const spawnInput = (cwd: string): PtyHostSpawnInput =>
  buildCreateInput({ id: newPtyId(), cwd, env: process.env });

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

/** A view of `client` whose `surface.terminal.write` runs `hook` (e.g. a delay)
 *  before delegating — used to widen the window between "write enqueued" and
 *  "write landed" so the detach-ordering guarantee is testable. Everything else
 *  passes straight through. */
function clientWithSlowWrite(
  client: PtyTuiClient,
  hook: () => Promise<void>,
): PtyTuiClient {
  const terminal = new Proxy(client.surface.terminal, {
    get(target, prop, receiver) {
      if (prop === "write") {
        return async (input: { id: string; data: string }) => {
          await hook();
          return target.write(input);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const surface = new Proxy(client.surface, {
    get: (t, p, r) => (p === "terminal" ? terminal : Reflect.get(t, p, r)),
  });
  return new Proxy(client, {
    get: (t, p, r) => (p === "surface" ? surface : Reflect.get(t, p, r)),
  });
}

async function until(
  cond: () => boolean,
  what: string,
  poll?: () => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await poll?.();
    await new Promise((r) => setTimeout(r, 50));
  }
}

let listener: PtyHostSocketListener;
let conn: Connection;
let killAll: () => Promise<unknown>;

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

  it("create's composed input spawns a PTY that echoes the minted id and is listable", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-create-"));
    // A client-minted id, exactly as `newPtyId()` produces — assert the host
    // accepts our fully-specified input and echoes the id back (the round-trip
    // `create` relies on so the printed id is the one `attach` then resolves).
    const id = "11111111-2222-3333-4444-555555555555";
    const result = await conn.client.surface.terminal.spawn(
      buildCreateInput({ id, cwd: dir, env: process.env }),
    );
    expect(result.id).toBe(id);
    expect(result.cwd).toBe(dir);
    expect(result.pid).toBeGreaterThan(0);
    const { entries } = await conn.client.surface.terminal.list({});
    expect(entries.some((e) => e.id === id)).toBe(true);
  });

  it("create runs a passed command instead of a plain shell", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-create-cmd-"));
    const id = "22222222-3333-4444-5555-666666666666";
    // A command (not $SHELL) that prints a marker then stays alive, so the PTY
    // is still listable when we read its screen — proves the `[command…]`
    // positional reaches the host's spawn verbatim.
    await conn.client.surface.terminal.spawn(
      buildCreateInput({
        id,
        cwd: dir,
        env: process.env,
        command: ["sh", "-c", "echo CMDMARK-create; sleep 100"],
      }),
    );
    let screen = "";
    await until(
      () => screen.includes("CMDMARK-create"),
      "command output",
      async () => {
        screen = (await conn.client.surface.terminal.getScreenText({ id }))
          .text;
      },
    );
  });

  it("getScreenText bounds output: --viewport and --tail over the wire", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-snap-bound-"));
    const id = "33333333-4444-5555-6666-777777777777";
    // Print 60 numbered lines into the default 24-row grid, so the top scrolls
    // out of the visible screen — the exact long-buffer case #1607 hit.
    await conn.client.surface.terminal.spawn(
      buildCreateInput({
        id,
        cwd: dir,
        env: process.env,
        command: [
          "sh",
          "-c",
          "for i in $(seq 1 60); do printf 'L%02d\\n' $i; done; sleep 100",
        ],
      }),
    );
    let screen = "";
    await until(
      () => screen.includes("L60"),
      "all lines printed",
      async () => {
        screen = (await conn.client.surface.terminal.getScreenText({ id }))
          .text;
      },
    );

    // Full read keeps the scrolled-off top.
    const full = (await conn.client.surface.terminal.getScreenText({ id }))
      .text;
    expect(full).toContain("L01");
    expect(full).toContain("L60");

    // --viewport: only the visible screen (the daemon's own 24 rows) — drops L01.
    const viewport = (
      await conn.client.surface.terminal.getScreenText({
        id,
        extent: { kind: "viewport" },
      })
    ).text;
    expect(viewport).toContain("L60");
    expect(viewport).not.toContain("L01");

    // --tail 3: exactly the last 3 rendered lines (the bottom of the buffer —
    // L60 plus the blank cursor line, never the scrolled-off top).
    const tail = (
      await conn.client.surface.terminal.getScreenText({
        id,
        extent: { kind: "tail", lines: 3 },
      })
    ).text;
    expect(tail.split("\n")).toHaveLength(3);
    expect(tail).toContain("L60");
    expect(tail).not.toContain("L01");
  });

  it("paints the snapshot, round-trips a keystroke, detaches on ~., and leaves the PTY alive", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-attach-"));
    const { id, pid } = await conn.client.surface.terminal.spawn(
      spawnInput(dir),
    );
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
    const { id } = await conn.client.surface.terminal.spawn(spawnInput(dir));
    const { tty, out, type } = fakeTty();
    const done = runAttach(conn.client, id, { tty });
    await until(() => out().includes("snapshot restored"), "attach notice");
    type("exit 7\r");
    const outcome = (await done) as Extract<AttachOutcome, { kind: "exited" }>;
    expect(outcome.kind).toBe("exited");
    expect(outcome.exitCode).toBe(7);
  });

  it("delivers bytes sent in the SAME burst as ~. before resolving detached", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-attach-"));
    const { id } = await conn.client.surface.terminal.spawn(spawnInput(dir));
    const { tty, out, type } = fakeTty();

    // ssh-style escape ordering, pinned tightly: a slow write must still flush
    // BEFORE runAttach resolves detached. We wrap the client so `terminal.write`
    // is artificially slow and flips `writeLanded` only once the RPC truly
    // completes. If detach returned without draining the wire queue, `done`
    // would resolve while the write is still in flight and `writeLanded` would
    // be false — so this assertion fails loudly on the F2 regression.
    let writeLanded = false;
    const slowClient = clientWithSlowWrite(conn.client, async () => {
      await new Promise((r) => setTimeout(r, 200));
      writeLanded = true;
    });

    const done = runAttach(slowClient, id, { tty });
    await until(() => out().includes("snapshot restored"), "attach notice");

    // The command and the line-start detach land in ONE stdin burst:
    // `echo …\r` is forwarded, then `~.` detaches.
    type("echo PRE-DETACH-$((3 * 5))\r~.");
    expect(await done).toEqual({ kind: "detached" });
    // The forwarded write completed before runAttach handed back `detached`.
    expect(writeLanded).toBe(true);

    // And the PTY survived the detach and ran the pre-detach line.
    const { entries } = await conn.client.surface.terminal.list({});
    expect(entries.some((e) => e.id === id)).toBe(true);
    let screen = "";
    await until(
      () => screen.includes("PRE-DETACH-15"),
      "pre-detach line",
      async () => {
        screen = (await conn.client.surface.terminal.getScreenText({ id }))
          .text;
      },
    );
  });

  it("~? prints the local help without forwarding anything", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-attach-"));
    const { id } = await conn.client.surface.terminal.spawn(spawnInput(dir));
    const { tty, out, type } = fakeTty();
    const done = runAttach(conn.client, id, { tty });
    await until(() => out().includes("snapshot restored"), "attach notice");
    type("~?");
    await until(() => out().includes("kaval-tui escapes"), "help text");
    type("~.");
    expect(await done).toEqual({ kind: "detached" });
    // The help went to the LOCAL tty only — the PTY's screen never saw it.
    const { text } = await conn.client.surface.terminal.getScreenText({
      id,
    });
    expect(text).not.toContain("kaval-tui escapes");
  });
});

describe("send — over the same real unix socket", () => {
  it("writes the planned bytes to the PTY so the shell runs the input", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-send-"));
    const { id } = await conn.client.surface.terminal.spawn(spawnInput(dir));

    // The SAME plan `cmdSend` builds — the literal text plus an explicit
    // `--key Enter` to submit (`keyData: "\r"`), since `send` never adds an Enter
    // on its own. `$((…))` keeps the marker out of the echoed command line, so a
    // screen match proves the shell really ran the sent input (not that the bytes
    // were merely echoed). Drive `terminal.write` per planned chunk, exactly as
    // the dispatch does, so this covers the write round-trip.
    const plan = planSend({
      text: "echo SENDMARK-$((6 * 7))",
      paste: undefined,
      fromStdin: false,
      keyData: "\r", // an explicit `--key Enter`
    });
    expect(plan.writes).toEqual(["echo SENDMARK-$((6 * 7))", "\r"]);
    for (const data of plan.writes) {
      await conn.client.surface.terminal.write({ id, data });
    }

    let screen = "";
    await until(
      () => screen.includes("SENDMARK-42"),
      "sent command output",
      async () => {
        screen = (await conn.client.surface.terminal.getScreenText({ id }))
          .text;
      },
    );
  });
});

describe("runKill — over the same real unix socket", () => {
  it("resolves a short id, kills via the real command body, confirms, and the terminal leaves the list", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-kill-"));
    const { id } = await conn.client.surface.terminal.spawn(spawnInput(dir));

    // Live and listable first.
    const { entries } = await conn.client.surface.terminal.list({});
    expect(entries.some((e) => e.id === id)).toBe(true);

    // `kaval-tui kill <id>` resolves the short id (or any unique prefix) to the
    // full id before killing — the same `resolveTerminalId` step the dispatch
    // runs via `resolveOne`. Resolve from the short form so the resolve is
    // load-bearing, then feed THAT id into `runKill` — the SAME command body
    // `main.ts`'s `kill` branch invokes (not the bare RPC), so this exercises the
    // confirmation line and the kill RPC the shipped command runs.
    const resolved = resolveTerminalId(
      shortId(id),
      entries.map((e) => e.id),
    );
    expect(resolved).toEqual({ kind: "found", id });
    if (resolved.kind !== "found") throw new Error("unreachable");

    // Drive the real command body; capture its stderr confirmation through the
    // injected sink instead of the process's stderr.
    let confirmed = "";
    await runKill(conn, resolved.id, (line) => {
      confirmed += line;
    });
    // The one-line confirmation names the short id, like `attach`'s trailers.
    expect(confirmed).toBe(`— killed ${shortId(id)}\n`);

    // And the daemon really tore the PTY down: it drops out of the inventory.
    let gone = false;
    await until(
      () => gone,
      "the killed terminal to leave the list",
      async () => {
        gone = !(await conn.client.surface.terminal.list({})).entries.some(
          (e) => e.id === id,
        );
      },
    );
  });
});
