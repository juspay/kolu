/**
 * Integration proof for `status` and `watch` over a REAL unix socket — the
 * served `terminalWorkspaceSurface` (a controllable awareness collection + a
 * pushable `activity` stream) dialed by the CLI's own `connectPulam`, never a
 * `directLink` (the in-process path that would mask a wire bug). `status`
 * reads a one-shot snapshot; `watch` mirrors the collection live and must see
 * an upsert, a removal, and the `activity` live-dot flag propagate over the
 * socket.
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
  type AwarenessValue,
  DEFAULT_VERSION,
  TERMINAL_WORKSPACE_CONTRACT_VERSION,
  terminalWorkspaceSurface,
  type TerminalId,
} from "@kolu/terminal-workspace/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Connection, connectPulam } from "./connect.ts";
import { assertCompatible, snapshotAwareness, watchAwareness } from "./read.ts";

const id = (s: string): TerminalId => s as TerminalId;

function awareness(over: Partial<AwarenessValue>): AwarenessValue {
  return {
    cwd: "/repo",
    git: null,
    lastActivityAt: 0,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ...over,
  } as AwarenessValue;
}

/** A single-consumer pushable `activity` source: yields the current live set as
 *  a snapshot, then a fresh frame each time `set()` changes it. */
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

/** Poll `fn` until it returns truthy or the deadline lapses. */
async function waitFor(fn: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitFor: condition not met before deadline");
}

function notInTest(name: string): never {
  throw new Error(`${name} not exercised by the status/watch tests`);
}

let listener: UnixSocketListener;
let socketPath: string;
let cache: Map<TerminalId, AwarenessValue>;
let activity: ReturnType<typeof makeActivity>;
let publishUpsert: (id: TerminalId, v: AwarenessValue) => void;
let publishRemove: (id: TerminalId) => void;

beforeEach(async () => {
  cache = new Map();
  activity = makeActivity();
  const fragment = implementSurface(terminalWorkspaceSurface, {
    channel: inMemoryChannelByName(),
    cells: { version: { store: inMemoryStore(DEFAULT_VERSION) } },
    collections: {
      awareness: {
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
      },
      git: {
        getStatus: () => notInTest("git.getStatus"),
        getDiff: () => notInTest("git.getDiff"),
      },
    },
  });
  // Publishing handle — writes the cache (the dep above) AND notifies subscribers.
  publishUpsert = (key, value) =>
    fragment.ctx.collections.awareness.upsert(key, value);
  publishRemove = (key) => fragment.ctx.collections.awareness.remove(key);

  const router = implement(terminalWorkspaceSurface.contract).router(
    // biome-ignore lint/suspicious/noExplicitAny: the Lazy<Router> spread vs oRPC's Router<any,T> input — same cast the daemon + surface tests use; runtime shape is valid.
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

describe("status — one-shot snapshot over a real socket", () => {
  it("reads the seeded awareness collection and asserts a compatible contract", async () => {
    publishUpsert(
      id("a3f1aaaa-1111-4222-8333-444455556666"),
      awareness({ cwd: "/code/kolu" }),
    );
    const conn = await connectPulam(socketPath);
    try {
      await expect(assertCompatible(conn.client)).resolves.toBe(
        TERMINAL_WORKSPACE_CONTRACT_VERSION,
      );
      const rows = await snapshotAwareness(conn.client);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.[0]).toBe("a3f1aaaa-1111-4222-8333-444455556666");
      expect(rows[0]?.[1].cwd).toBe("/code/kolu");
    } finally {
      conn.dispose();
    }
  });
});

describe("watch — live over a real socket", () => {
  let conn: Connection;
  let abort: AbortController;
  let done: Promise<void>;
  let upserts: Array<{ id: TerminalId; value: AwarenessValue; live: boolean }>;
  let removes: TerminalId[];

  beforeEach(async () => {
    abort = new AbortController();
    upserts = [];
    removes = [];
    conn = await connectPulam(socketPath);
    done = watchAwareness(
      conn,
      {
        onUpsert: (id, value, live) => upserts.push({ id, value, live }),
        onRemove: (id) => removes.push(id),
      },
      abort.signal,
    );
  });

  afterEach(async () => {
    abort.abort();
    await done.catch(() => {});
    conn.dispose();
  });

  it("streams an upsert as it lands, then a removal", async () => {
    const tid = id("b7c20000-1111-4222-8333-444455556666");
    publishUpsert(tid, awareness({ cwd: "/code/drishti" }));
    await waitFor(() => upserts.some((e) => e.id === tid));
    expect(upserts.find((e) => e.id === tid)?.value.cwd).toBe("/code/drishti");

    publishRemove(tid);
    await waitFor(() => removes.includes(tid));
  });

  it("annotates the live dot once the activity frame propagates", async () => {
    const tid = id("c9d40000-1111-4222-8333-444455556666");
    activity.set([tid]); // this terminal is moving bytes
    // Re-publish until an upsert event sees live=true — i.e. the activity frame
    // has reached the client's live set over the socket (deterministic-eventually,
    // no fixed sleep).
    await waitFor(() => {
      publishUpsert(tid, awareness({ cwd: "/code/kolu" }));
      return upserts.some((e) => e.id === tid && e.live);
    });
  });
});
