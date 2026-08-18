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
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  padiSocketPath,
  padiClientOver,
  resolvePadiStateRoot,
  scopePadiSurface,
} from "@kolu/padi/dial";
import { padiKavalSocketPath } from "@kolu/padi/stateRoot";
import { padiDaemonGroup } from "@kolu/padi/surface";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { Effect } from "effect";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const PADI_BIN = resolve(SRC, "../../padi/src/daemonBoot/bin.ts");
const KOLU_MAIN = resolve(SRC, "main.ts");
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), "kolu-watch-e2e-rt-"));
const priorXdg = process.env.XDG_RUNTIME_DIR;
beforeAll(() => {
  process.env.XDG_RUNTIME_DIR = RUNTIME_ROOT;
});
afterAll(() => {
  process.env.XDG_RUNTIME_DIR = priorXdg;
});

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

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

// ── The daemon ────────────────────────────────────────────────────────────

interface Padi {
  child: ChildProcess;
  exited: Promise<number | null>;
  stateRoot: string;
  socketPath: string;
}

const spawned: Padi[] = [];
const children: ChildProcess[] = [];

/** EXPLICIT env — this test process runs inside a kolu terminal whose
 *  `$PADI_SOCKET` names the user's REAL daemon, and an inherited value would
 *  point a leg at it. */
function daemonEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
    KOLU_KAVAL_SPAWN: "detached",
    KOLU_DAEMON_BIND_PID: String(process.pid),
    ...extra,
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_BIN;
  delete env.KOLU_KAVAL_SOCKET;
  delete env.KOLU_STATE_DIR;
  if (extra.PADI_SOCKET === undefined) delete env.PADI_SOCKET;
  return env;
}

function spawnPadi(stateRoot: string, grokDir: string): Padi {
  assertDaemonSpawnAllowed("a real padi daemon (node --import loader bin.ts)");
  const child = spawn(
    process.execPath,
    [
      "--import",
      TSX_LOADER,
      PADI_BIN,
      "--state-root",
      stateRoot,
      "--allow-nix-shell-with-env-whitelist",
      "default",
    ],
    {
      stdio: ["ignore", "ignore", "ignore"],
      env: daemonEnv({ KOLU_GROK_DIR: grokDir }),
    },
  );
  const exited = new Promise<number | null>((res) =>
    child.on("exit", (code) => res(code)),
  );
  const padi: Padi = {
    child,
    exited,
    stateRoot,
    socketPath: padiSocketPath(resolvePadiStateRoot(stateRoot)),
  };
  spawned.push(padi);
  return padi;
}

type PadiLink = Awaited<ReturnType<typeof unixSocketLink>>;

async function waitForPadi(socketPath: string, ms = 20000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    let link: PadiLink | undefined;
    try {
      link = await unixSocketLink({ group: padiDaemonGroup, socketPath });
      await Effect.runPromise(
        padiClientOver(link.dispatch).control.surface.core.hello(),
      );
      return;
    } catch {
      await sleep(150);
    } finally {
      await link?.dispose();
    }
  }
  throw new Error(`padi socket never came up: ${socketPath}`);
}

function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(
      execSync(`cat ${JSON.stringify(gatePath)}`, { encoding: "utf8" }).trim(),
      10,
    );
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Reap a padi AND the detached kaval it spawned — EXACT pids only. */
async function reap(p: Padi): Promise<void> {
  p.child.kill("SIGTERM");
  await p.exited;
  const kavalSocket = padiKavalSocketPath(resolvePadiStateRoot(p.stateRoot));
  const kavalPid = gatePid(join(dirname(kavalSocket), "kaval.pid"));
  if (kavalPid !== undefined) {
    try {
      process.kill(kavalPid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

afterEach(async () => {
  for (const c of children.splice(0)) {
    if (c.exitCode === null) c.kill("SIGKILL");
  }
  for (const p of spawned.splice(0)) {
    if (p.child.exitCode === null) await reap(p);
  }
}, 30000);

// ── The world under test ──────────────────────────────────────────────────

/** A padi with one terminal whose agent is IDLE — the situation an operator
 *  needs to be told about, built for real end to end. */
async function idleAgentWorld(): Promise<{ socketPath: string }> {
  const grokDir = tmp("grok");
  const cwd = tmp("cwd");
  const bin = fakeGrokBin();
  const p = spawnPadi(tmp("sr"), grokDir);
  await waitForPadi(p.socketPath);

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
    await Effect.runPromise(
      client.surface.lifecycle.sendInput({
        id,
        data: `${bin} -c 'echo GROK_PID=$$; sleep 99999'\r`,
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
  while (Date.now() < deadline) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) return value;
    await sleep(250);
  }
  throw new Error(`${failure} (after ${ms}ms)`);
}

interface WatchEvent {
  kind: string;
  id: string;
  state: string;
  since: number;
  at: number;
}

/** Run the SHIPPED `kolu watch` launcher and collect its NDJSON lines. */
function runWatch(socketPath: string, flags: string[]) {
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

    // The transition, once the state has held — and then the property no
    // other alert in kolu has: it comes back, and keeps coming back.
    const events = await watch.atLeast(3);
    expect(events[0]?.kind).toBe("snapshot");
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

  it("a watch that joins LATE leads with a snapshot of what is already standing", {
    timeout: 180000,
  }, async () => {
    const { socketPath } = await idleAgentWorld();
    // The terminal went idle before this watch existed — the failure mode a
    // change-only feed has, and the reason a reconnecting supervisor used to
    // be told nothing at all.
    const watch = runWatch(socketPath, [
      "--states",
      "waiting",
      "--nag",
      "2s",
      "--json",
    ]);
    const [first] = await watch.atLeast(1);
    expect(first?.kind).toBe("snapshot");
    watch.stop();
  });
});
