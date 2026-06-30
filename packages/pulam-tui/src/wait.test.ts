/**
 * Integration proof for `wait` over a REAL unix socket — the served
 * `terminalWorkspaceSurface` (a controllable awareness collection + a pushable
 * `activity` stream) dialed by the CLI's own `connectPulam`. Drives
 * `awaitAgentState` directly (NOT `cmdWait`, which calls `process.exit` and
 * would kill the runner): it must block while the agent is in a non-target
 * bucket, resolve `met` the instant it enters a target bucket (including when it
 * is ALREADY there at dial — the mirror replays current values), resolve `gone`
 * when the watched terminal is removed before the state lands (its PTY exited),
 * and resolve `timeout` when the state never lands.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { implement } from "@kolu/surface/peer-server";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import {
  serveOverUnixSocket,
  type UnixSocketListener,
} from "@kolu/surface/unix-socket";
import {
  DEFAULT_VERSION,
  type TerminalSnapshot,
  terminalWorkspaceSurface,
  type TerminalId,
} from "@kolu/terminal-workspace/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectPulam } from "./connect.ts";
import { agentMatchesUntil } from "./render.ts";
import { awaitAgentState } from "./read.ts";

const id = (s: string): TerminalId => s as TerminalId;

/** A schema-VALID ClaudeCodeInfo (the wire validates against the zod schema, so
 *  the cast factory render.test.ts uses won't survive the socket). All the
 *  nullable detail fields are seeded null/empty — only `state` varies per case. */
function agentVal(state: string): TerminalSnapshot["agent"] {
  return {
    kind: "claude-code",
    state,
    sessionId: "sess-1",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  } as TerminalSnapshot["agent"];
}

function snapshot(over: Partial<TerminalSnapshot>): TerminalSnapshot {
  return {
    cwd: "/repo",
    git: null,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ...over,
  } as TerminalSnapshot;
}

/** A single-consumer pushable `activity` source (verbatim from watch.test.ts). */
function makeActivity() {
  let current: TerminalId[] = [];
  let waiters: Array<() => void> = [];
  let ended = false;
  const wake = () => {
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  };
  return {
    set(ids: TerminalId[]) {
      current = ids;
      wake();
    },
    end() {
      ended = true;
      wake();
    },
    async *stream(): AsyncGenerator<TerminalId[]> {
      let last: TerminalId[] | null = null;
      while (!ended) {
        if (last !== current) {
          last = current;
          yield current;
        } else {
          await new Promise<void>((r) => waiters.push(r));
        }
      }
    },
  };
}

function notInTest(name: string): never {
  throw new Error(`${name} not exercised by the wait tests`);
}

const TARGET = new Set(["awaiting", "waiting"]);
const matchTurnEnded = (agent: TerminalSnapshot["agent"]): boolean =>
  agentMatchesUntil(agent, TARGET);

let listener: UnixSocketListener;
let socketPath: string;
let cache: Map<TerminalId, TerminalSnapshot>;
let activity: ReturnType<typeof makeActivity>;
let publishUpsert: (id: TerminalId, v: TerminalSnapshot) => void;
let publishRemove: (id: TerminalId) => void;

beforeEach(async () => {
  cache = new Map();
  activity = makeActivity();
  const fragment = implementSurface(terminalWorkspaceSurface, {
    channel: inMemoryChannelByName(),
    cells: { version: { store: inMemoryStore(DEFAULT_VERSION) } },
    collections: {
      snapshots: {
        readAll: () => cache,
        upsert: (key, value) => {
          cache.set(key, value);
        },
        remove: (key) => {
          cache.delete(key);
        },
      },
    },
    streams: {
      activity: { source: () => activity.stream() },
      subscribeRepoChange: {
        source: async function* (): AsyncGenerator<{ seq: number }> {},
      },
      subscribeFileChange: {
        source: async function* (): AsyncGenerator<{ seq: number }> {},
      },
    },
    procedures: {
      fs: {
        listAll: () => notInTest("fs.listAll"),
        readFile: () => notInTest("fs.readFile"),
        statFileMtimeMs: () => notInTest("fs.statFileMtimeMs"),
        previewRead: () => notInTest("fs.previewRead"),
      },
      scratch: { write: () => notInTest("scratch.write") },
      transcript: { read: () => notInTest("transcript.read") },
      git: {
        getStatus: () => notInTest("git.getStatus"),
        getDiff: () => notInTest("git.getDiff"),
      },
    },
  });
  publishUpsert = (key, value) =>
    fragment.ctx.collections.snapshots.upsert(key, value);
  publishRemove = (key) => fragment.ctx.collections.snapshots.remove(key);

  const router = implement(terminalWorkspaceSurface.contract).router(
    // biome-ignore lint/suspicious/noExplicitAny: the Lazy<Router> spread vs oRPC's Router<any,T> input — same cast the daemon + surface tests use.
    { ...fragment.router } as any,
  );
  socketPath = join(mkdtempSync(join(tmpdir(), "pulam-tui-")), "a.sock");
  listener = await serveOverUnixSocket({
    socketPath,
    // biome-ignore lint/suspicious/noExplicitAny: narrow to serveOverUnixSocket's Router<any,any> param without importing @orpc/server into the viewer.
    router: router as any,
  });
});

afterEach(() => {
  activity.end();
  listener.close();
});

describe("awaitAgentState — block until the agent enters a target bucket", () => {
  it("stays pending while working, then resolves `met` on the awaiting transition", async () => {
    const tid = id("a3f10000-1111-4222-8333-444455556666");
    publishUpsert(tid, snapshot({ agent: agentVal("thinking") })); // working

    const conn = await connectPulam(socketPath);
    try {
      let settled = false;
      const p = awaitAgentState(conn.client, {
        id: tid,
        matches: matchTurnEnded,
      }).then((o) => {
        settled = true;
        return o;
      });
      // The mirror replays the `thinking` value, which is NOT a target bucket, so
      // the wait must stay open. A short real delay proves it didn't resolve early.
      await new Promise((r) => setTimeout(r, 120));
      expect(settled).toBe(false);

      // The agent ends its turn — now it matches.
      publishUpsert(tid, snapshot({ agent: agentVal("awaiting_user") }));
      const outcome = await p;
      expect(outcome.kind).toBe("met");
      if (outcome.kind === "met")
        expect(outcome.agent.state).toBe("awaiting_user");
    } finally {
      conn.dispose();
    }
  });

  it("resolves `met` immediately when the agent is ALREADY in a target bucket", async () => {
    const tid = id("b7c20000-1111-4222-8333-444455556666");
    publishUpsert(tid, snapshot({ agent: agentVal("waiting") })); // already idle

    const conn = await connectPulam(socketPath);
    try {
      const outcome = await awaitAgentState(conn.client, {
        id: tid,
        matches: matchTurnEnded,
        timeoutMs: 4000, // generous cap; the replay should match well before it
      });
      expect(outcome.kind).toBe("met");
      if (outcome.kind === "met") expect(outcome.agent.state).toBe("waiting");
    } finally {
      conn.dispose();
    }
  });

  it("resolves `gone` immediately when the target terminal is removed before the state lands", async () => {
    const tid = id("d1e50000-1111-4222-8333-444455556666");
    publishUpsert(tid, snapshot({ agent: agentVal("thinking") })); // working

    const conn = await connectPulam(socketPath);
    try {
      let settled = false;
      const p = awaitAgentState(conn.client, {
        id: tid,
        matches: matchTurnEnded,
        // A generous cap: a `gone` MUST resolve well before this, proving the
        // removal short-circuits rather than the timeout firing.
        timeoutMs: 5000,
      }).then((o) => {
        settled = true;
        return o;
      });
      // It's working (not a target bucket), so the wait stays open at first.
      await new Promise((r) => setTimeout(r, 120));
      expect(settled).toBe(false);

      // The PTY exits → the daemon drops it from awareness → the wait can never
      // be met, so it resolves `gone` at once rather than hanging to the timeout.
      const t0 = Date.now();
      publishRemove(tid);
      const outcome = await p;
      expect(outcome.kind).toBe("gone");
      expect(Date.now() - t0).toBeLessThan(2000); // not the 5s timeout
    } finally {
      conn.dispose();
    }
  });

  it("ignores removal of a DIFFERENT terminal", async () => {
    const tid = id("e2f60000-1111-4222-8333-444455556666");
    const other = id("f3a70000-1111-4222-8333-444455556666");
    publishUpsert(tid, snapshot({ agent: agentVal("thinking") })); // working
    publishUpsert(other, snapshot({ agent: agentVal("thinking") }));

    const conn = await connectPulam(socketPath);
    try {
      let settled = false;
      const p = awaitAgentState(conn.client, {
        id: tid,
        matches: matchTurnEnded,
      }).then((o) => {
        settled = true;
        return o;
      });
      // Removing a sibling terminal is noise — the wait on `tid` must stay open.
      publishRemove(other);
      await new Promise((r) => setTimeout(r, 120));
      expect(settled).toBe(false);

      // tid ends its own turn — now it matches.
      publishUpsert(tid, snapshot({ agent: agentVal("awaiting_user") }));
      const outcome = await p;
      expect(outcome.kind).toBe("met");
    } finally {
      conn.dispose();
    }
  });

  it("resolves `timeout` when the target state never lands", async () => {
    const tid = id("c9d40000-1111-4222-8333-444455556666");
    publishUpsert(tid, snapshot({ agent: agentVal("thinking") })); // stays working

    const conn = await connectPulam(socketPath);
    try {
      const t0 = Date.now();
      const outcome = await awaitAgentState(conn.client, {
        id: tid,
        matches: matchTurnEnded,
        timeoutMs: 200,
      });
      expect(outcome.kind).toBe("timeout");
      expect(Date.now() - t0).toBeGreaterThanOrEqual(150); // waited ~timeoutMs
    } finally {
      conn.dispose();
    }
  });
});
