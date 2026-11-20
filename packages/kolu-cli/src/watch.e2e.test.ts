import { type ChildProcess, execSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { padiClientOver, scopePadiSurface } from "@kolu/padi-client/dial";
import { padiDaemonGroup } from "@kolu/padi-client/surface";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Effect, Stream } from "effect";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import {
  daemonEnv as daemonEnvIn,
  e2eRuntimeRoot,
  KOLU_MAIN,
  type Padi,
  readTerminatedLine,
  reapPadi,
  sleep,
  spawnPadi,
  TSX_LOADER,
  waitForPadi,
} from "./e2eDaemon.testlib.ts";

const RUNTIME = e2eRuntimeRoot("watch-e2e");
beforeAll(() => RUNTIME.enter());
afterAll(() => RUNTIME.leave());

const daemonEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  daemonEnvIn(RUNTIME.root, extra);

const tmp = (tag: string): string =>
  mkdtempSync(join(tmpdir(), `kolu-watch-e2e-${tag}-`));

const SESSION_ID = "00000000-0000-7000-8000-000000000001";

/** A binary named `grok` that is really bash — the foreground basename is what
 *  padi's adapter matches on, and bash copies cleanly under a new argv[0] (the
 *  coreutils multi-call binaries do not). */
function fakeGrokBin(): string {
  const dir = tmp("bin");
  const target = join(dir, "grok");
  copyFileSync(
    execSync("command -v bash", { encoding: "utf8" }).trim(),
    target,
  );
  chmodSync(target, 0o755);
  return target;
}

function writeIdleGrokSession(opts: {
  grokDir: string;
  cwd: string;
  pid: number;
}): void {
  const sessionDir = join(
    opts.grokDir,
    "sessions",
    encodeURIComponent(opts.cwd),
    SESSION_ID,
  );
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, "events.jsonl"),
    `${[
      {
        ts: "2026-07-09T15:00:00.000Z",
        type: "turn_started",
        session_id: SESSION_ID,
        turn_number: 0,
        model_id: "grok-4.5",
      },
      {
        ts: "2026-07-09T15:00:01.000Z",
        type: "phase_changed",
        phase: "streaming_text",
      },
      {
        ts: "2026-07-09T15:00:02.000Z",
        type: "turn_ended",
        outcome: "completed",
      },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n")}\n`,
  );
  writeFileSync(
    join(sessionDir, "summary.json"),
    JSON.stringify({
      info: { id: SESSION_ID, cwd: opts.cwd },
      current_model_id: "grok-4.5",
      generated_title: "idle worker",
      created_at: "2026-07-09T15:00:00.000Z",
      updated_at: "2026-07-09T15:00:02.000Z",
    }),
  );
  writeFileSync(
    join(opts.grokDir, "active_sessions.json"),
    JSON.stringify([
      {
        session_id: SESSION_ID,
        pid: opts.pid,
        cwd: opts.cwd,
        opened_at: "2026-07-09T15:00:00.000Z",
      },
    ]),
  );
}

const spawned: Padi[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const c of children.splice(0)) {
    if (c.exitCode === null) c.kill("SIGKILL");
  }
  for (const p of spawned.splice(0)) {
    if (p.child.exitCode === null) await reapPadi(p);
  }
}, 30000);

async function startPadi(grokDir: string): Promise<Padi> {
  const p = spawnPadi({
    runtimeRoot: RUNTIME.root,
    stateRoot: tmp("sr"),
    env: { KOLU_GROK_DIR: grokDir },
  });
  spawned.push(p);
  await waitForPadi(p.socketPath);
  return p;
}

async function awaitByteMotion(
  client: {
    surface: {
      activity: {
        get: (
          i: Record<string, never>,
        ) => Stream.Stream<readonly string[], unknown>;
      };
    };
  },
  id: string,
  ms = 30000,
): Promise<void> {
  const frames = Stream.toAsyncIterable(client.surface.activity.get({}))[
    Symbol.asyncIterator
  ]();
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const settled = await Promise.race([
        frames.next(),
        sleep(Math.max(0, deadline - Date.now())).then(
          () => "timeout" as const,
        ),
      ]);
      if (settled === "timeout") break;
      if (settled.done === true) break;
      if (settled.value.includes(id)) return;
    }
  } finally {
    await frames.return?.();
  }
  throw new Error(
    `padi never saw bytes moving on ${id} in ${ms}ms — the fake grok has stopped repainting, so this suite is no longer testing the case it claims to`,
  );
}

async function idleAgentWorld(): Promise<{ socketPath: string }> {
  const grokDir = tmp("grok");
  const cwd = tmp("cwd");
  const bin = fakeGrokBin();
  const p = await startPadi(grokDir);

  const link = await unixSocketLink({
    group: padiDaemonGroup,
    socketPath: p.socketPath,
  });
  try {
    const client = scopePadiSurface(padiClientOver(link.dispatch));
    const created = await Effect.runPromise(
      client.surface.lifecycle.create({
        placement: { kind: "toplevel" },
        cwd,
      }),
    );
    const id = created.id;

    await Effect.runPromise(
      client.surface.lifecycle.sendInput({
        id,
        data: `${bin} -c 'echo GROK_PID=$$; while :; do printf "\\r> "; read -t 1 _; done'\r`,
      }),
    );
    const pid = await poll(async () => {
      const screen = await Effect.runPromise(
        client.surface.screen.text({ id }),
      );
      const m = /GROK_PID=(\d+)/.exec(screen);
      return m?.[1] === undefined ? undefined : Number.parseInt(m[1], 10);
    }, "the fake grok never printed its pid");

    writeIdleGrokSession({ grokDir, cwd, pid });

    await poll(async () => {
      const record = await Effect.runPromise(
        firstFrameOrThrow(
          client.surface.terminals.get({ key: id }),
          `terminal ${id} left the collection`,
        ),
      );
      const agent = record?.state === "active" ? record.agent : null;
      return agent?.state === "waiting" ? true : undefined;
    }, "padi never saw the agent go idle");

    await awaitByteMotion(client, id);
  } finally {
    await link.dispose();
  }
  return { socketPath: p.socketPath };
}

async function poll<T>(
  read: () => Promise<T | undefined>,
  failure: string,
  ms = 30000,
): Promise<T> {
  const deadline = Date.now() + ms;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== undefined) return value;
    } catch (err) {
      last = err;
    }
    await sleep(250);
  }
  throw new Error(
    `${failure} (after ${ms}ms)${last === undefined ? "" : `; last read failed: ${String(last)}`}`,
  );
}

interface WatchEvent {
  kind: string;
  id: string;
  state: string;
  since: number;
  at: number;
  nag?: { index: number; left?: number };
}

function runWatch(socketPath: string, flags: string[]) {
  assertDaemonSpawnAllowed("a real `kolu watch` process");
  const child = spawn(
    process.execPath,
    [
      "--import",
      TSX_LOADER,
      KOLU_MAIN,
      "watch",
      "--socket",
      socketPath,
      ...flags,
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: daemonEnv() },
  );
  children.push(child);
  const events: WatchEvent[] = [];
  let buffered = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") events.push(JSON.parse(line) as WatchEvent);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return {
    events,
    async atLeast(n: number, ms = 30000): Promise<WatchEvent[]> {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (events.length >= n) return events;
        await sleep(100);
      }
      throw new Error(
        `kolu watch produced ${events.length}/${n} lines in ${ms}ms; stderr: ${stderr}`,
      );
    },
    stop: () => child.kill("SIGINT"),
  };
}

describeDaemon("kolu watch — supervision, end to end", () => {
  it("an idle terminal is reported once it has HELD, then again on every --nag", {
    timeout: 180000,
  }, async () => {
    const { socketPath } = await idleAgentWorld();
    const watch = runWatch(socketPath, [
      "--states",
      "waiting",
      "--held-for",
      "1s",
      "--nag",
      "2s",
      "--json",
    ]);

    const events = await watch.atLeast(3);
    expect(["snapshot", "transition"]).toContain(events[0]?.kind);
    expect(events.slice(1).map((e) => e.kind)).toEqual(["nag", "nag"]);
    expect(new Set(events.map((e) => e.state))).toEqual(new Set(["waiting"]));
    expect(new Set(events.map((e) => e.since)).size).toBe(1);
    expect((events[2]?.at ?? 0) - (events[2]?.since ?? 0)).toBeGreaterThan(
      (events[1]?.at ?? 0) - (events[1]?.since ?? 0),
    );
    watch.stop();
  });

  it("--nag 1s/2 CAPS the nagging — the NDJSON says which reminder each nag is, and the last one is the end", {
    timeout: 180000,
  }, async () => {
    const { socketPath } = await idleAgentWorld();
    const watch = runWatch(socketPath, [
      "--states",
      "waiting",
      "--held-for",
      "1s",
      "--nag",
      "1s/2",
      "--json",
    ]);

    const events = await watch.atLeast(3);
    expect(["snapshot", "transition"]).toContain(events[0]?.kind);
    expect(events[0]?.nag).toBeUndefined();
    expect(events.slice(1).map((e) => e.kind)).toEqual(["nag", "nag"]);
    expect(events[1]?.nag).toEqual({ index: 1, left: 1 });
    expect(events[2]?.nag).toEqual({ index: 2, left: 0 });

    await sleep(4000);
    expect(events).toHaveLength(3);
    watch.stop();
  });

  it("a piped stdout to GNU head sees the snapshot without a subsequent write", {
    timeout: 60000,
  }, async () => {
    const { socketPath } = await idleAgentWorld();
    assertDaemonSpawnAllowed("a real `kolu watch | head -1` pipeline");
    const watch = spawn(
      process.execPath,
      [
        "--import",
        TSX_LOADER,
        KOLU_MAIN,
        "watch",
        "--socket",
        socketPath,
        "--states",
        "waiting",
        "--json",
        "--nag",
        "1h",
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: daemonEnv() },
    );
    children.push(watch);
    if (watch.stdout === null) {
      throw new Error("kolu watch spawned without a stdout pipe");
    }
    const head = spawn("head", ["-1"], {
      stdio: [watch.stdout, "pipe", "pipe"],
    });
    children.push(head);
    if (head.stdout === null) {
      throw new Error("head spawned without a stdout pipe");
    }
    const read = await readTerminatedLine(head.stdout, 8000);
    if (read.kind === "partial") {
      throw new Error(
        `kolu watch | head -1 produced an unterminated line: ${JSON.stringify(read.bytes)}`,
      );
    }
    if (read.kind === "timeout") {
      throw new Error("kolu watch | head -1 produced no bytes in 8000ms");
    }
    expect(read.line.startsWith("\n")).toBe(false);
    expect(JSON.parse(read.line).kind).toBe("snapshot");
    watch.kill("SIGINT");
  });

  it("a watch that RECONNECTS leads with a snapshot of what is already standing", {
    timeout: 180000,
  }, async () => {
    const { socketPath } = await idleAgentWorld();
    const first = runWatch(socketPath, ["--states", "waiting", "--json"]);
    await first.atLeast(1);
    first.stop();

    const rejoined = runWatch(socketPath, ["--states", "waiting", "--json"]);
    const [led] = await rejoined.atLeast(1);
    expect(led?.kind).toBe("snapshot");
    expect((led?.at ?? 0) - (led?.since ?? 0)).toBeGreaterThan(0);
    rejoined.stop();
  });
});
