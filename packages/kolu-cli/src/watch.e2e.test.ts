/**
 * The SUPERVISION pin — a real idle agent, a real `kolu watch` process, and the
 * two properties the whole feature exists for:
 *
 *   1. **it comes back.** A terminal whose agent has been idle past `--held-for`
 *      is reported, and then reported AGAIN every `--nag`, for as long as it
 *      stays idle. Every alert kolu had before this taps you once; that is how a
 *      terminal sat unnoticed for hours, twice.
 *   2. **a late joiner sees standing neglect.** A watch started AFTER the
 *      terminal went idle leads with a `snapshot` of what is already there,
 *      rather than only what changes next.
 *
 * Nothing here is stubbed on kolu's side: a real padi spawns a real kaval, which
 * spawns a real PTY; the agent state is read by padi's own Grok adapter off real
 * files on disk; and the consumer is the shipped `kolu watch` launcher, over its
 * real stdout, parsed as the NDJSON a script would parse. The one fixture is the
 * AGENT — a bash copy named `grok` plus the session tree Grok Build writes —
 * which is what makes an "idle agent" reproducible without an LLM behind it.
 *
 * The fixture is spelled here rather than imported: the canonical builder
 * (`packages/tests/support/agent-mock-grok.ts`) lives in the browser e2e suite,
 * a private package with no name to import it by. Only the `waiting` arm is
 * needed, which is three files.
 */

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

// One runtime root for this file's legs — the state-root digest is what
// separates daemons, so a leg here can never reach another file's.
const RUNTIME = e2eRuntimeRoot("watch-e2e");
beforeAll(() => RUNTIME.enter());
afterAll(() => RUNTIME.leave());

const daemonEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  daemonEnvIn(RUNTIME.root, extra);

const tmp = (tag: string): string =>
  mkdtempSync(join(tmpdir(), `kolu-watch-e2e-${tag}-`));

// ── The agent fixture ─────────────────────────────────────────────────────

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

/** The session tree Grok Build writes for a turn that ENDED — i.e. an agent
 *  sitting there with nothing to do, which is the whole subject of this test. */
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

// ── The daemons and processes this file spawns ────────────────────────────

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

/** A real padi, up and answering — the harness's spawn plus this file's
 *  bookkeeping, so `afterEach` reaps by exact pid. */
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

// ── The world under test ──────────────────────────────────────────────────

/** Wait until padi's own byte-motion edge SEES this terminal producing output.
 *
 *  The contrast the whole feature rests on, made observable: this is the
 *  `activity` stream — kaval's meaningful-output edge, the currency the old
 *  byte-quiet gate was built on — and it must say YES for a terminal the state
 *  feed reports as idle. Without this assertion the repaint could quietly stop
 *  and every pin below would still pass. */
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

/** A padi with one terminal whose agent is IDLE **and repainting** — the exact
 *  situation an operator needs to be told about, built for real end to end. */
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

    // Run the fake grok so the PTY's foreground basename is `grok`, and have it
    // print its own pid — the adapter matches a session to a terminal BY pid, so
    // this is the load-bearing seam a fixture cannot fake.
    //
    // And then it REPAINTS its prompt about once a second, forever, because
    // that is the terminal this feature exists for: an idle grok redrawing `> `
    // in place is what starved a 1.5 s byte-quiet gate for good (#2177). A
    // fixture that sat in `sleep 99999` was the opposite case and would have
    // passed a regression that let the hold consult bytes again.
    //
    // `read -t 1` and not `sleep 1`: bash times out on its own stdin without
    // forking, so the PTY's foreground stays this shell — whose basename is
    // `grok`, which is what the adapter matches on. A per-second `sleep` child
    // would flap the foreground and break detection.
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

    // …and wait until padi's OWN adapter agrees the agent is idle. Everything
    // after this point is the feature under test rather than the fixture.
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

    // The CONTRAST, asserted rather than assumed: padi's byte-motion edge —
    // the currency the old quiet gate ran on — sees this terminal producing
    // output, at the same moment its adapter reports it idle. Every pin below
    // is about the state feed being blind to exactly this.
    await awaitByteMotion(client, id);
  } finally {
    await link.dispose();
  }
  return { socketPath: p.socketPath };
}

/** Poll until `read` answers. A read that THROWS is a retry — a padi that is
 *  still adopting answers a lot of these — but the last such error rides the
 *  timeout, because "${failure} after 30s" with the real cause swallowed is the
 *  collapse-to-empty this repo treats as a defect: the sentence that would have
 *  named the problem is exactly the one thrown away. */
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
  /** The reminder accounting, present on `nag` lines only. */
  nag?: { index: number; left?: number };
}

/** Run the SHIPPED `kolu watch` launcher and collect its NDJSON lines. */
function runWatch(socketPath: string, flags: string[]) {
  // A watch runs until it is killed, so it is a long-lived fork like the daemon
  // itself — leashed at the call site, where no helper indirection can smuggle
  // it past a bare `vitest`.
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
    /** Wait for at least `n` lines, or fail naming what the watch said. */
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

    // The first report, once the state has held — and then the property no
    // other alert in kolu has: it comes back, and keeps coming back.
    //
    // The FIRST kind is deliberately either one: whether the terminal had
    // already held its second by the time this process connected is a race with
    // padi's adoption, and both answers are correct (`snapshot` = it was
    // already standing, `transition` = it crossed while we watched). What is
    // NOT a race is everything after it.
    const events = await watch.atLeast(3);
    expect(["snapshot", "transition"]).toContain(events[0]?.kind);
    expect(events.slice(1).map((e) => e.kind)).toEqual(["nag", "nag"]);
    expect(new Set(events.map((e) => e.state))).toEqual(new Set(["waiting"]));
    // Every repeat describes the SAME episode, and says how long it has been
    // standing there.
    expect(new Set(events.map((e) => e.since)).size).toBe(1);
    expect((events[2]?.at ?? 0) - (events[2]?.since ?? 0)).toBeGreaterThan(
      (events[1]?.at ?? 0) - (events[1]?.since ?? 0),
    );
    watch.stop();
  });

  it("--nag-count CAPS the nagging — the NDJSON says which reminder each nag is, and the last one is the end", {
    timeout: 180000,
  }, async () => {
    const { socketPath } = await idleAgentWorld();
    const watch = runWatch(socketPath, [
      "--states",
      "waiting",
      "--held-for",
      "1s",
      "--nag",
      "1s",
      "--nag-count",
      "2",
      "--json",
    ]);

    // The first report, then exactly TWO reminders — each stamped with which
    // reminder it is and how many follow (`left: 0` on the last)…
    const events = await watch.atLeast(3);
    expect(["snapshot", "transition"]).toContain(events[0]?.kind);
    expect(events[0]?.nag).toBeUndefined();
    expect(events.slice(1).map((e) => e.kind)).toEqual(["nag", "nag"]);
    expect(events[1]?.nag).toEqual({ index: 1, left: 1 });
    expect(events[2]?.nag).toEqual({ index: 2, left: 0 });

    // …and then QUIET: three full intervals pass with no fourth line. The
    // uncapped pin above proves the interval itself is one second, so four
    // silent seconds is the cap, not a slow daemon.
    await sleep(4000);
    expect(events).toHaveLength(3);
    watch.stop();
  });

  it("a piped stdout to GNU head sees the snapshot without a subsequent write", {
    timeout: 60000,
  }, async () => {
    // The live incident: `kolu watch | head` on a DIRECT pipe(2), not a Node
    // `data` listener. `--nag 1h` keeps the next event far away; head -1 is
    // the slow consumer that exits on the first terminated line — if that
    // line is not in the kernel, this hangs until the 8s deadline.
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
    const line = await readTerminatedLine(head.stdout, 8000);
    expect(line.startsWith("\n")).toBe(false);
    expect(JSON.parse(line).kind).toBe("snapshot");
    watch.kill("SIGINT");
  });

  it("a watch that RECONNECTS leads with a snapshot of what is already standing", {
    timeout: 180000,
  }, async () => {
    const { socketPath } = await idleAgentWorld();
    const first = runWatch(socketPath, ["--states", "waiting", "--json"]);
    await first.atLeast(1);
    first.stop();

    // A SECOND process against the same padi — the terminal has been idle since
    // before this one existed, which is the failure mode a change-only feed
    // has and the reason a reconnecting supervisor used to be told nothing at
    // all. It reuses the world above rather than spawning a second daemon: what
    // is under test is the watch reconnecting, not padi starting.
    const rejoined = runWatch(socketPath, ["--states", "waiting", "--json"]);
    const [led] = await rejoined.atLeast(1);
    expect(led?.kind).toBe("snapshot");
    // …and it says how long the terminal has been standing there, across a
    // window this process was not alive for.
    expect((led?.at ?? 0) - (led?.since ?? 0)).toBeGreaterThan(0);
    rejoined.stop();
  });
});
