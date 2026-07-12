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
import { fileURLToPath } from "node:url";
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
} from "@kolu/terminal-protocol";
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
import { planSend, type SendPlan } from "./send.ts";
import { executeSendPlan } from "./sendExec.ts";
import { delay } from "./wait.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as InProcessPtyHostDeps["log"];

/** Placeholder for the dialed socket `create` stamps as KAVAL_SOCKET — irrelevant
 *  to these tests (they exercise the spawn round-trip, not env inheritance). */
const KAVAL_SOCK = "/tmp/kaval-test/pty-host.sock";

/** A minimal fully-specified spawn — a plain `$SHELL` run with no login flag, no
 *  rc files (the host derives nothing from policy since B0). Delegates to the
 *  production composer so the test shape can't drift from what `create` sends. */
const spawnInput = (cwd: string): PtyHostSpawnInput =>
  buildCreateInput({
    id: newPtyId(),
    cwd,
    env: process.env,
    kavalSocket: KAVAL_SOCK,
  });

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
    lifetime: { kind: "forever" },
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
      buildCreateInput({
        id,
        cwd: dir,
        env: process.env,
        kavalSocket: KAVAL_SOCK,
      }),
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
        kavalSocket: KAVAL_SOCK,
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

  it("the spawned PTY's child sees KAVAL_TERMINAL_ID = its own id", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-termid-"));
    const id = "44444444-5555-6666-7777-888888888888";
    // Echo the env var the child ACTUALLY received — end-to-end proof that
    // KAVAL_TERMINAL_ID rides composer → wire → real PTY → shell, not merely that
    // the composer stamped it. The `$KAVAL_TERMINAL_ID` is expanded by the spawned
    // `sh`, so a match means the child's environment carried it. `env: process.env`
    // may itself carry an OUTER id (this test can run inside a kolu terminal) — a
    // match on THIS id also proves the stamp overwrote the inherited one.
    await conn.client.surface.terminal.spawn(
      buildCreateInput({
        id,
        cwd: dir,
        env: process.env,
        kavalSocket: KAVAL_SOCK,
        command: [
          "sh",
          "-c",
          'printf "TERMID=[%s]\\n" "$KAVAL_TERMINAL_ID"; sleep 100',
        ],
      }),
    );
    let screen = "";
    await until(
      () => screen.includes(`TERMID=[${id}]`),
      "KAVAL_TERMINAL_ID echoed by the child",
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
        kavalSocket: KAVAL_SOCK,
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

    // The canonical two-command shape `cmdSend` drives: the literal text as one
    // send, then an explicit `--key Enter` as its OWN send — `send` never adds an
    // Enter on its own, and text+key in one command is forbidden. A plain shell
    // has no paste debounce, so back-to-back sends run it. `$((…))` keeps the
    // marker out of the echoed command line, so a screen match proves the shell
    // really ran the input (not that the bytes were merely echoed). Both go
    // through the shipped executor, covering the write round-trip.
    const textPlan = planSend({
      kind: "text",
      text: "echo SENDMARK-$((6 * 7))",
      paste: undefined,
      fromStream: false,
    });
    const enterPlan = planSend({ kind: "keys", keyData: "\r" }); // a standalone `--key Enter`
    expect(textPlan.write).toBe("echo SENDMARK-$((6 * 7))");
    expect(enterPlan.write).toBe("\r");
    await executeSendPlan(
      textPlan,
      (data) => conn.client.surface.terminal.write({ id, data }).then(() => {}),
      shortId(id),
    );
    await executeSendPlan(
      enterPlan,
      (data) => conn.client.surface.terminal.write({ id, data }).then(() => {}),
      shortId(id),
    );

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

describe("send — canonical two-command submit against a real paste-debounce TUI", () => {
  // A real PTY running the scripted TUI that reproduces Claude Code's #1 failure
  // mode: an Enter within FIXTURE_DEBOUNCE_MS of a bracketed paste is DROPPED, a
  // later one submits. There is NO grace baked into `send` — the caller submits
  // as a SEPARATE command AFTER observing the TUI settle (`wait --until idle`).
  // The fixture's debounce is deliberately short; the observed-settle wait below
  // clears it with a wide margin, while a same-breath Enter falls inside it.
  const FIXTURE = fileURLToPath(
    new URL("./paste-debounce-tui.fixture.mjs", import.meta.url),
  );
  const DEBOUNCE_MS = 120;
  // Stands in for the caller's `kaval-tui wait <id> --until idle:<ms>` — the
  // OBSERVE step. `kaval` can't know when the TUI settled, but the caller can:
  // after the paste the fixture emits nothing, so an idle window this wide is a
  // real "no output for IDLE_MS" signal, and (being > DEBOUNCE_MS) it guarantees
  // the follow-up Enter lands PAST the debounce. Only baking a sleep into `send`
  // itself is forbidden — the caller waiting is the whole model.
  const IDLE_MS = 400;

  /** Spawn the fixture in a real PTY and wait until it's listening. `extraEnv`
   *  lets a test tune the fixture — e.g. hold the busy burst open (FIXTURE_BUSY_TICKS)
   *  so the "mid-turn" case is deterministic rather than racing a ~500ms window. */
  async function spawnFixture(
    extraEnv: Record<string, string> = {},
  ): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "kolu-submit-"));
    const { id } = await conn.client.surface.terminal.spawn(
      buildCreateInput({
        id: newPtyId(),
        cwd: dir,
        env: {
          ...process.env,
          FIXTURE_DEBOUNCE_MS: String(DEBOUNCE_MS),
          // The fixture recognizes the SAME bracketed-paste markers `planSend`
          // wraps text with — pass the protocol constants so it can't drift.
          FIXTURE_PASTE_START: BRACKETED_PASTE_START,
          FIXTURE_PASTE_END: BRACKETED_PASTE_END,
          ...extraEnv,
        },
        command: ["node", FIXTURE],
        kavalSocket: KAVAL_SOCK,
      }),
    );
    await untilScreen(id, (s) => s.includes("READY"), "fixture READY");
    return id;
  }

  /** The FULL scrollback (not the viewport) so a marker can't scroll away behind
   *  the fixture's busy-stream output. */
  async function screenOf(id: string): Promise<string> {
    const { text } = await conn.client.surface.terminal.getScreenText({
      id,
      extent: { kind: "full" },
    });
    return text;
  }

  async function untilScreen(
    id: string,
    ok: (screen: string) => boolean,
    what: string,
  ): Promise<string> {
    let screen = "";
    await until(
      () => ok(screen),
      what,
      async () => {
        screen = await screenOf(id);
      },
    );
    return screen;
  }

  /** Drive a send byte-plan against the PTY through the SHIPPED executor —
   *  `executeSendPlan` (the same function `cmdSend` runs), over this suite's
   *  socket write — so the acceptance test validates the real sequencing. */
  const runPlan = (id: string, plan: SendPlan): Promise<void> =>
    executeSendPlan(
      plan,
      async (data) => {
        await conn.client.surface.terminal.write({ id, data });
      },
      shortId(id),
    );

  /** Send just the text (a bracketed paste, no Enter) — step 1 of the flow. */
  const sendText = (id: string, text: string, fromStream = false) =>
    runPlan(id, planSend({ kind: "text", text, paste: undefined, fromStream }));

  /** Submit as its OWN command — step 3, after the observed settle. */
  const sendEnter = (id: string) =>
    runPlan(id, planSend({ kind: "keys", keyData: "\r" }));

  it("CONTROL: a same-breath paste+Enter is DROPPED — the exact combination the CLI now forbids", {
    timeout: 30_000,
  }, async () => {
    const id = await spawnFixture();
    // The raw bytes of `send <id> "text" --key Enter` — paste then Enter written
    // back-to-back, no gap. The Enter races into the debounce and is dropped,
    // leaving the prompt staged. `resolveSendInput` makes this UNSPELLABLE at the
    // CLI (text + --key is a hard error), and `planSend` now makes it unspellable
    // at the plan boundary too — so we compose the two writes the old combined
    // plan emitted (the bracketed paste, then the Enter) to reproduce the
    // forbidden same-breath byte sequence at the wire and prove WHY it's dropped.
    const pastePlan = planSend({
      kind: "text",
      text: "start the turn",
      paste: true,
      fromStream: false,
    });
    const enterPlan = planSend({ kind: "keys", keyData: "\r" });
    await runPlan(id, pastePlan);
    await runPlan(id, enterPlan);
    const screen = await untilScreen(
      id,
      (s) => s.includes("DROPPED"),
      "the same-breath Enter to be dropped",
    );
    // The whole point: the turn did NOT start — the prompt sat staged, unsent.
    expect(screen).not.toContain("SUBMITTED");
  });

  it("(a) idle agent: paste → observe settle → separate Enter → the turn STARTS", {
    timeout: 30_000,
  }, async () => {
    const id = await spawnFixture();
    // 1. the text (paste, no Enter).
    await sendText(id, "explain the architecture of this repo");
    // 2. observe the TUI settle (the `wait --until idle` step).
    await delay(IDLE_MS);
    // 3. submit as its own command — now past the debounce, so it lands.
    await sendEnter(id);
    await untilScreen(
      id,
      (s) => s.includes("SUBMITTED#1"),
      "the prompt to submit (turn started)",
    );
  });

  it("(b) BUSY agent (mid-turn, streaming): the two-command submit still lands, never lost", {
    timeout: 30_000,
  }, async () => {
    // Hold the first turn's busy burst open (200 × 25ms ≈ 5s) so it is STILL
    // streaming when the second prompt lands — otherwise a slow CI loop could let
    // the first turn print DONE T1 first, and the test would no longer prove the
    // mid-turn case it claims. The assertion below pins that determinism.
    const id = await spawnFixture({ FIXTURE_BUSY_TICKS: "200" });
    await sendText(id, "first prompt");
    await delay(IDLE_MS);
    await sendEnter(id);
    // Wait until the first turn is UNDERWAY (the fixture is streaming busy output).
    const midTurn = await untilScreen(
      id,
      (s) => s.includes("SUBMITTED#1"),
      "first turn to start",
    );
    // The first turn must still be mid-stream — DONE T1 not yet printed — so the
    // second submit genuinely lands at a BUSY agent, not a quiesced one.
    expect(midTurn).not.toContain("DONE T1");
    // Second prompt while it's mid-stream. For a busy agent the settle signal is
    // the paste's own debounce clearing (output isn't idle — the agent is
    // streaming), so wait past DEBOUNCE_MS, then submit as its own command.
    await sendText(id, "second prompt while busy");
    await delay(IDLE_MS);
    await sendEnter(id);
    await untilScreen(
      id,
      (s) => s.includes("SUBMITTED#2"),
      "the second (busy) prompt to submit",
    );
  });

  it("(c) a multi-KB paste + two-command submit submits INTACT past the DEBOUNCE", {
    timeout: 30_000,
  }, async () => {
    const id = await spawnFixture();
    // ~4KB, arriving in several socket chunks — the fixture reassembles the paste
    // across chunk boundaries; a unique tail proves nothing was truncated. NOTE:
    // this fixture models the paste-DEBOUNCE (an Enter too soon is dropped), which
    // the two-command flow beats. It does NOT model Claude Code's large-paste
    // COLLAPSE (folding a big paste into a "[Pasted text +N lines]" placeholder
    // that then won't submit on Enter) — that is Bug A, which survives the
    // canonical flow against a real claude and is tracked open (issue #1702).
    const big = `${"X".repeat(4000)}ENDMARK-c0ffee`;
    await sendText(id, big, /* fromStream */ true); // a stream payload auto-pastes
    await delay(IDLE_MS);
    await sendEnter(id);
    await untilScreen(
      id,
      (s) => s.includes(`SUBMITTED#1 len=${big.length} tail=${big.slice(-8)}`),
      "the full multi-KB paste to submit intact",
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
