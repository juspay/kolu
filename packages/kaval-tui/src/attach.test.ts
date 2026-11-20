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
import { describeDaemon } from "@kolu/daemon-test-gate";
import { Effect, Exit, Scope } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";
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

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as InProcessPtyHostDeps["log"];

const KAVAL_SOCK = "/tmp/kaval-test/pty-host.sock";

const spawnInput = (cwd: string): PtyHostSpawnInput =>
  buildCreateInput({
    id: newPtyId(),
    cwd,
    env: process.env,
    kavalSocket: KAVAL_SOCK,
  });

interface FakeTty {
  tty: AttachTty;
  out(): string;
  type(s: string): void;
}

function fakeTty(): FakeTty {
  const input = new PassThrough();
  let out = "";
  return {
    tty: {
      input,
      write: (d) =>
        Effect.sync(() => {
          out += d;
        }),
      size: () => ({ cols: 80, rows: 24 }),
      onResize: () => () => {},
      setRawMode: () => {},
    },
    out: () => out,
    type: (s) => input.write(Buffer.from(s, "utf8")),
  };
}

function clientWithSlowWrite(
  client: PtyTuiClient,
  hook: Effect.Effect<void>,
): PtyTuiClient {
  const terminal = new Proxy(client.surface.terminal, {
    get(target, prop, receiver) {
      if (prop === "write") {
        return (input: { id: string; data: string }) =>
          Effect.flatMap(hook, () => target.write(input));
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
let connScope: Scope.Closeable;
let killAll: () => Promise<unknown>;

beforeAll(async () => {
  const { served, client } = createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
    lifetime: { kind: "forever" },
  });
  killAll = () => Effect.runPromise(client.surface.terminal.killAll({}));
  const socketPath = join(
    mkdtempSync(join(tmpdir(), "kolu-pty-sock-")),
    "pty-host.sock",
  );
  listener = await servePtyHostOverUnixSocket({
    socketPath,
    served,
    log: silentLog,
  });
  connScope = Scope.makeUnsafe();
  conn = await Effect.runPromise(
    Scope.provide(connectPtyHost(socketPath), connScope),
  );
});

afterAll(async () => {
  await killAll();
  await Effect.runPromise(Scope.close(connScope, Exit.void));
  await listener.close();
});

describeDaemon("runAttach — over a real unix socket", () => {
  it("returns not-found for an id no PTY has (before any screen takeover)", async () => {
    const { tty, out } = fakeTty();
    const outcome = await Effect.runPromise(
      runAttach(conn.client, "00000000-0000-0000-0000-000000000000", { tty }),
    );
    expect(outcome).toEqual({ kind: "not-found" });
    expect(out()).toBe("");
  });

  it("create's composed input spawns a PTY that echoes the minted id and is listable", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-create-"));
    const id = "11111111-2222-3333-4444-555555555555";
    const result = await Effect.runPromise(
      conn.client.surface.terminal.spawn(
        buildCreateInput({
          id,
          cwd: dir,
          env: process.env,
          kavalSocket: KAVAL_SOCK,
        }),
      ),
    );
    expect(result.id).toBe(id);
    expect(result.cwd).toBe(dir);
    expect(result.pid).toBeGreaterThan(0);
    const { entries } = await Effect.runPromise(
      conn.client.surface.terminal.list({}),
    );
    expect(entries.some((e) => e.id === id)).toBe(true);
  });

  it("create runs a passed command instead of a plain shell", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-create-cmd-"));
    const id = "22222222-3333-4444-5555-666666666666";
    await Effect.runPromise(
      conn.client.surface.terminal.spawn(
        buildCreateInput({
          id,
          cwd: dir,
          env: process.env,
          command: ["sh", "-c", "echo CMDMARK-create; sleep 100"],
          kavalSocket: KAVAL_SOCK,
        }),
      ),
    );
    let screen = "";
    await until(
      () => screen.includes("CMDMARK-create"),
      "command output",
      async () => {
        screen = (
          await Effect.runPromise(
            conn.client.surface.terminal.getScreenText({ id }),
          )
        ).text;
      },
    );
  });

  it("the spawned PTY's child sees KAVAL_TERMINAL_ID = its own id", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-termid-"));
    const id = "44444444-5555-6666-7777-888888888888";
    await Effect.runPromise(
      conn.client.surface.terminal.spawn(
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
      ),
    );
    let screen = "";
    await until(
      () => screen.includes(`TERMID=[${id}]`),
      "KAVAL_TERMINAL_ID echoed by the child",
      async () => {
        screen = (
          await Effect.runPromise(
            conn.client.surface.terminal.getScreenText({ id }),
          )
        ).text;
      },
    );
  });

  it("getScreenText bounds output: --viewport and --tail over the wire", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-snap-bound-"));
    const id = "33333333-4444-5555-6666-777777777777";
    await Effect.runPromise(
      conn.client.surface.terminal.spawn(
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
      ),
    );
    let screen = "";
    await until(
      () => screen.includes("L60"),
      "all lines printed",
      async () => {
        screen = (
          await Effect.runPromise(
            conn.client.surface.terminal.getScreenText({ id }),
          )
        ).text;
      },
    );

    const full = (
      await Effect.runPromise(
        conn.client.surface.terminal.getScreenText({ id }),
      )
    ).text;
    expect(full).toContain("L01");
    expect(full).toContain("L60");

    const viewport = (
      await Effect.runPromise(
        conn.client.surface.terminal.getScreenText({
          id,
          extent: { kind: "viewport" },
        }),
      )
    ).text;
    expect(viewport).toContain("L60");
    expect(viewport).not.toContain("L01");

    const tail = (
      await Effect.runPromise(
        conn.client.surface.terminal.getScreenText({
          id,
          extent: { kind: "tail", lines: 3 },
        }),
      )
    ).text;
    expect(tail.split("\n")).toHaveLength(3);
    expect(tail).toContain("L60");
    expect(tail).not.toContain("L01");
  });

  it("paints the snapshot, round-trips a keystroke, detaches on ~., and leaves the PTY alive", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-attach-"));
    const { id, pid } = await Effect.runPromise(
      conn.client.surface.terminal.spawn(spawnInput(dir)),
    );
    const { tty, out, type } = fakeTty();
    const done = Effect.runPromise(runAttach(conn.client, id, { tty }));

    await until(() => out().includes("snapshot restored"), "attach notice");
    expect(out()).toContain(`PTY pid ${pid}`);

    type("echo MARK-$((6 * 7))\r");
    await until(() => out().includes("MARK-42"), "echo round-trip");

    type("\r~.");
    const outcome = await done;
    expect(outcome).toEqual({ kind: "detached" });
    const { entries } = await Effect.runPromise(
      conn.client.surface.terminal.list({}),
    );
    expect(entries.some((e) => e.id === id)).toBe(true);
  });

  it("reports the real exit code when the PTY's child exits", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-attach-"));
    const { id } = await Effect.runPromise(
      conn.client.surface.terminal.spawn(spawnInput(dir)),
    );
    const { tty, out, type } = fakeTty();
    const done = Effect.runPromise(runAttach(conn.client, id, { tty }));
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
    const { id } = await Effect.runPromise(
      conn.client.surface.terminal.spawn(spawnInput(dir)),
    );
    const { tty, out, type } = fakeTty();

    let writeLanded = false;
    const slowClient = clientWithSlowWrite(
      conn.client,
      Effect.flatMap(Effect.sleep(200), () =>
        Effect.sync(() => {
          writeLanded = true;
        }),
      ),
    );

    const done = Effect.runPromise(runAttach(slowClient, id, { tty }));
    await until(() => out().includes("snapshot restored"), "attach notice");

    type("echo PRE-DETACH-$((3 * 5))\r~.");
    expect(await done).toEqual({ kind: "detached" });
    expect(writeLanded).toBe(true);

    const { entries } = await Effect.runPromise(
      conn.client.surface.terminal.list({}),
    );
    expect(entries.some((e) => e.id === id)).toBe(true);
    let screen = "";
    await until(
      () => screen.includes("PRE-DETACH-15"),
      "pre-detach line",
      async () => {
        screen = (
          await Effect.runPromise(
            conn.client.surface.terminal.getScreenText({ id }),
          )
        ).text;
      },
    );
  });

  it("~? prints the local help without forwarding anything", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-attach-"));
    const { id } = await Effect.runPromise(
      conn.client.surface.terminal.spawn(spawnInput(dir)),
    );
    const { tty, out, type } = fakeTty();
    const done = Effect.runPromise(runAttach(conn.client, id, { tty }));
    await until(() => out().includes("snapshot restored"), "attach notice");
    type("~?");
    await until(() => out().includes("kaval-tui escapes"), "help text");
    type("~.");
    expect(await done).toEqual({ kind: "detached" });
    const { text } = await Effect.runPromise(
      conn.client.surface.terminal.getScreenText({
        id,
      }),
    );
    expect(text).not.toContain("kaval-tui escapes");
  });
});

describeDaemon("send — over the same real unix socket", () => {
  it("writes the planned bytes to the PTY so the shell runs the input", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-send-"));
    const { id } = await Effect.runPromise(
      conn.client.surface.terminal.spawn(spawnInput(dir)),
    );

    const textPlan = planSend({
      kind: "text",
      text: "echo SENDMARK-$((6 * 7))",
      paste: undefined,
      fromStream: false,
    });
    const enterPlan = planSend({ kind: "keys", keyData: "\r" });
    expect(textPlan.write).toBe("echo SENDMARK-$((6 * 7))");
    expect(enterPlan.write).toBe("\r");
    const writeToPty = (data: string) =>
      Effect.asVoid(conn.client.surface.terminal.write({ id, data }));
    await Effect.runPromise(executeSendPlan(textPlan, writeToPty, shortId(id)));
    await Effect.runPromise(
      executeSendPlan(enterPlan, writeToPty, shortId(id)),
    );

    let screen = "";
    await until(
      () => screen.includes("SENDMARK-42"),
      "sent command output",
      async () => {
        screen = (
          await Effect.runPromise(
            conn.client.surface.terminal.getScreenText({ id }),
          )
        ).text;
      },
    );
  });
});

describeDaemon(
  "send — canonical two-command submit against a real paste-debounce TUI",
  () => {
    const FIXTURE = fileURLToPath(
      new URL("./paste-debounce-tui.fixture.mjs", import.meta.url),
    );
    const DEBOUNCE_MS = 120;
    const IDLE_MS = 400;

    async function spawnFixture(
      extraEnv: Record<string, string> = {},
    ): Promise<string> {
      const dir = mkdtempSync(join(tmpdir(), "kolu-submit-"));
      const { id } = await Effect.runPromise(
        conn.client.surface.terminal.spawn(
          buildCreateInput({
            id: newPtyId(),
            cwd: dir,
            env: process.env,
            extraEnv: {
              FIXTURE_DEBOUNCE_MS: String(DEBOUNCE_MS),
              FIXTURE_PASTE_START: BRACKETED_PASTE_START,
              FIXTURE_PASTE_END: BRACKETED_PASTE_END,
              ...extraEnv,
            },
            command: ["node", FIXTURE],
            kavalSocket: KAVAL_SOCK,
          }),
        ),
      );
      await untilScreen(id, (s) => s.includes("READY"), "fixture READY");
      return id;
    }

    async function screenOf(id: string): Promise<string> {
      const { text } = await Effect.runPromise(
        conn.client.surface.terminal.getScreenText({
          id,
          extent: { kind: "full" },
        }),
      );
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

    const runPlan = (id: string, plan: SendPlan): Promise<void> =>
      Effect.runPromise(
        executeSendPlan(
          plan,
          (data) =>
            Effect.promise(async () => {
              await Effect.runPromise(
                conn.client.surface.terminal.write({ id, data }),
              );
            }),
          shortId(id),
        ),
      );

    const sendText = (id: string, text: string, fromStream = false) =>
      runPlan(
        id,
        planSend({ kind: "text", text, paste: undefined, fromStream }),
      );

    const sendEnter = (id: string) =>
      runPlan(id, planSend({ kind: "keys", keyData: "\r" }));

    it("CONTROL: a same-breath paste+Enter is DROPPED — the exact combination the CLI now forbids", {
      timeout: 30_000,
    }, async () => {
      const id = await spawnFixture();
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
      expect(screen).not.toContain("SUBMITTED");
    });

    it("(a) idle agent: paste → observe settle → separate Enter → the turn STARTS", {
      timeout: 30_000,
    }, async () => {
      const id = await spawnFixture();
      await sendText(id, "explain the architecture of this repo");
      await delay(IDLE_MS);
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
      const id = await spawnFixture({ FIXTURE_BUSY_TICKS: "200" });
      await sendText(id, "first prompt");
      await delay(IDLE_MS);
      await sendEnter(id);
      const midTurn = await untilScreen(
        id,
        (s) => s.includes("SUBMITTED#1"),
        "first turn to start",
      );
      expect(midTurn).not.toContain("DONE T1");
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
      // This fixture models the paste-DEBOUNCE only. Claude Code's large-paste
      // COLLAPSE (a big paste folded into a "[Pasted text +N lines]" placeholder
      // that then won't submit on Enter) survives the canonical flow and is
      // tracked open as issue #1702.
      const big = `${"X".repeat(4000)}ENDMARK-c0ffee`;
      await sendText(id, big, true);
      await delay(IDLE_MS);
      await sendEnter(id);
      await untilScreen(
        id,
        (s) =>
          s.includes(`SUBMITTED#1 len=${big.length} tail=${big.slice(-8)}`),
        "the full multi-KB paste to submit intact",
      );
    });
  },
);

describeDaemon("runKill — over the same real unix socket", () => {
  it("resolves a short id, kills via the real command body, confirms, and the terminal leaves the list", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-kill-"));
    const { id } = await Effect.runPromise(
      conn.client.surface.terminal.spawn(spawnInput(dir)),
    );

    const { entries } = await Effect.runPromise(
      conn.client.surface.terminal.list({}),
    );
    expect(entries.some((e) => e.id === id)).toBe(true);

    const resolved = resolveTerminalId(
      shortId(id),
      entries.map((e) => e.id),
    );
    expect(resolved).toEqual({ kind: "found", id });
    if (resolved.kind !== "found") throw new Error("unreachable");

    let confirmed = "";
    await Effect.runPromise(
      runKill(conn, resolved.id, (line) => {
        confirmed += line;
      }),
    );
    expect(confirmed).toBe(`— killed ${shortId(id)}\n`);

    let gone = false;
    await until(
      () => gone,
      "the killed terminal to leave the list",
      async () => {
        gone = !(
          await Effect.runPromise(conn.client.surface.terminal.list({}))
        ).entries.some((e) => e.id === id);
      },
    );
  });
});
