/**
 * Orchestrator tests — `startFleet` / `snapshotFleet` against fake in-process
 * pulam clients (no socket, no ssh). The fake's `keys` stream yields a snapshot
 * then stays open, so a host reads as live `connected` until the test closes it;
 * that lets us assert the (host, terminalId) keying, the status transitions, and
 * that one dead dial degrades to a per-host `unreachable` rather than sinking
 * the board.
 */

import {
  TERMINAL_WORKSPACE_CONTRACT_VERSION,
  type AwarenessValue,
  type GitStatusOutput,
  type TerminalId,
} from "@kolu/terminal-workspace/surface";
import { describe, expect, it } from "vitest";
import type { ArivuClient, Connection } from "./connect.ts";
import {
  type FleetSink,
  RepoWatchSet,
  snapshotFleet,
  startFleet,
} from "./fleet.ts";
import type { FleetHost } from "./hosts.ts";
import type { FleetHostStatus } from "./fleetTypes.ts";

const id = (s: string): TerminalId => s as TerminalId;
function val(over: Partial<AwarenessValue>): AwarenessValue {
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
const agentVal = (state: string): AwarenessValue["agent"] =>
  ({ kind: "claude-code", state }) as AwarenessValue["agent"];

async function* once<T>(v: T): AsyncGenerator<T> {
  yield v;
}

const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

interface Fake {
  conn: Connection;
  /** Simulate the link dropping (the keys stream ends) without a deliberate dispose. */
  dropLink: () => void;
}

/** A fake pulam connection whose `awareness.keys` yields one snapshot then stays
 *  open (so the host reads as live) until `dropLink()` / `dispose()` ends it. The
 *  client always exposes EVERY `terminalWorkspaceSurface` entry — exactly like the real
 *  oRPC router client `connectArivu`/`connectArivuViaHost` build, so a supplied
 *  sink never hits `mirrorRemoteSurface`'s client/surface-mismatch guard for a
 *  primitive a real client would still have. */
function fakeConn(opts: {
  version?: string;
  terminals: Record<string, AwarenessValue>;
  /** The `activity` stream's single frame — the set of terminals "live" right
   *  now. Omitted ⇒ the activity stream opens, yields nothing, and stays open
   *  (the real shape: the entry always exists; an empty host just never lights). */
  activity?: string[];
  /** The status `git.getStatus` returns for any repo (the watcher's re-query).
   *  Omitted ⇒ a clean default. */
  gitStatus?: GitStatusOutput;
}): Fake {
  let endKeys!: () => void;
  const open = new Promise<void>((res) => {
    endKeys = res;
  });
  const client = {
    surface: {
      version: {
        get: async () =>
          once({
            contractVersion:
              opts.version ?? TERMINAL_WORKSPACE_CONTRACT_VERSION,
          }),
      },
      awareness: {
        keys: async () =>
          (async function* () {
            yield Object.keys(opts.terminals) as TerminalId[];
            await open;
          })(),
        get: async ({ key }: { key: TerminalId }) =>
          once(opts.terminals[key] as AwarenessValue),
      },
      // Always present (the real client always exposes it). Yields the live set
      // once when given, then stays open like a real stream until the link drops;
      // when omitted it opens and simply never lights a terminal.
      activity: {
        get: async () =>
          (async function* () {
            if (opts.activity) yield opts.activity as TerminalId[];
            await open;
          })(),
      },
      // The git-status watcher arm: a `{seq:0}` snapshot pulse, then stays open
      // until the link drops. `getStatus` returns the configured status. Streams
      // are reached through `.get` on the client, procedures called directly.
      subscribeRepoChange: {
        get: async () =>
          (async function* () {
            yield { seq: 0 };
            await open;
          })(),
      },
      git: {
        getStatus: async () => opts.gitStatus ?? makeStatus(),
      },
    },
  };
  return {
    conn: {
      client: client as unknown as Connection["client"],
      dispose: () => endKeys(),
    },
    dropLink: () => endKeys(),
  };
}

/** A fake whose dial SUCCEEDS but whose post-connect `version.get` rejects —
 *  models a link that came up then dropped before the first probe roundtripped.
 *  The orchestrator must turn this into a per-host `unreachable`, not let the
 *  rejection escape `runHost` (a stranded `connecting` + unhandled rejection) or
 *  sink `snapshotFleet`'s `Promise.all`. */
function fakeConnVersionRejects(): Connection {
  const client = {
    surface: {
      version: {
        get: async () => {
          throw new Error("link dropped mid-probe");
        },
      },
      awareness: {
        keys: async () =>
          (async function* () {
            yield [] as TerminalId[];
          })(),
        get: async () => once(undefined as unknown as AwarenessValue),
      },
    },
  };
  return {
    client: client as unknown as Connection["client"],
    dispose: () => {},
  };
}

/** A fake whose dial SUCCEEDS but whose `version.get` stream ends EMPTY (no
 *  snapshot frame). A `version` cell always opens with a snapshot, so an empty
 *  stream is a protocol/link failure — the orchestrator must surface it as this
 *  host's `unreachable`, never collapse it to a silently `connected`/`ok` state. */
function fakeConnVersionEmpty(): Connection {
  const client = {
    surface: {
      version: {
        get: async () =>
          // No yield: the stream ends without ever emitting a snapshot.
          (async function* (): AsyncGenerator<{
            contractVersion: string;
          }> {})(),
      },
      awareness: {
        keys: async () =>
          (async function* () {
            yield [] as TerminalId[];
          })(),
        get: async () => once(undefined as unknown as AwarenessValue),
      },
    },
  };
  return {
    client: client as unknown as Connection["client"],
    dispose: () => {},
  };
}

function recordingSink(): {
  sink: FleetSink;
  statuses: Array<[string, FleetHostStatus]>;
  upserts: Array<[string, string, AwarenessValue]>;
  removes: Array<[string, string]>;
  lives: Array<[string, string[]]>;
  gitSets: Array<[string, string, GitStatusOutput]>;
  gitClears: Array<[string, string]>;
  clears: string[];
} {
  const statuses: Array<[string, FleetHostStatus]> = [];
  const upserts: Array<[string, string, AwarenessValue]> = [];
  const removes: Array<[string, string]> = [];
  const lives: Array<[string, string[]]> = [];
  const gitSets: Array<[string, string, GitStatusOutput]> = [];
  const gitClears: Array<[string, string]> = [];
  const clears: string[] = [];
  return {
    statuses,
    upserts,
    removes,
    lives,
    gitSets,
    gitClears,
    clears,
    sink: {
      setStatus: (l, s) => statuses.push([l, s]),
      upsert: (l, i, v) => upserts.push([l, i, v]),
      remove: (l, i) => removes.push([l, i]),
      setLive: (l, live) => lives.push([l, live]),
      setGitStatus: (l, repo, s) => gitSets.push([l, repo, s]),
      clearGitStatus: (l, repo) => gitClears.push([l, repo]),
      clearHost: (l) => clears.push(l),
    },
  };
}

/** A `GitStatusOutput` for tests — a local-mode status with no changed files and
 *  the branch/working-tree headers present (override any local-arm field). */
type LocalStatus = Extract<GitStatusOutput, { mode: "local" }>;
function makeStatus(over: Partial<LocalStatus> = {}): GitStatusOutput {
  return {
    mode: "local",
    files: [],
    branch: { name: "main", upstream: null, ahead: 0, behind: 0 },
    workingTree: { staged: 0, modified: 0, untracked: 0 },
    ...over,
  };
}

/** Minimal `GitInfo` for an awareness value — only `repoRoot` is load-bearing
 *  (the key the watcher subscribes on). */
function gitInfo(repoRoot: string): AwarenessValue["git"] {
  return {
    repoRoot,
    repoName: "repo",
    worktreePath: repoRoot,
    branch: "main",
    isWorktree: false,
    mainRepoRoot: repoRoot,
    remoteUrl: null,
  };
}

/** A pushable async iterable — `{seq:0}` snapshot at subscribe, then a fresh
 *  pulse per `push()`, ending on `end()` (or the abort signal). Models the
 *  surface's `subscribeRepoChange` watcher stream for the RepoWatchSet unit
 *  test. */
function pushable(signal?: AbortSignal): {
  iterable: AsyncIterable<{ seq: number }>;
  push: () => void;
  ended: () => boolean;
} {
  const queue: Array<{ seq: number }> = [{ seq: 0 }];
  let wake: (() => void) | null = null;
  let ended = false;
  const end = () => {
    ended = true;
    wake?.();
    wake = null;
  };
  signal?.addEventListener("abort", end, { once: true });
  let seq = 1;
  return {
    push: () => {
      queue.push({ seq: seq++ });
      wake?.();
      wake = null;
    },
    ended: () => ended,
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (queue.length) {
            const v = queue.shift();
            if (v) yield v;
          }
          if (ended) return;
          await new Promise<void>((r) => {
            wake = r;
          });
        }
      },
    },
  };
}

/** A fake client exposing just the two surface members RepoWatchSet uses:
 *  `subscribeRepoChange` (a pushable stream per subscription) and `git.getStatus`
 *  (the current status, re-read each call). Records subscription count + the
 *  per-repo pulse controllers so a test can drive a change. */
function fakeGitClient(): {
  client: ArivuClient;
  pulse: (repoPath: string) => void;
  setStatus: (s: GitStatusOutput) => void;
  subscribeCount: () => number;
} {
  const streams = new Map<string, ReturnType<typeof pushable>>();
  let subscribeCount = 0;
  let status = makeStatus();
  const client = {
    surface: {
      subscribeRepoChange: {
        get: async (
          { repoPath }: { repoPath: string },
          opts?: { signal?: AbortSignal },
        ) => {
          subscribeCount++;
          const p = pushable(opts?.signal);
          streams.set(repoPath, p);
          return p.iterable;
        },
      },
      git: {
        getStatus: async () => status,
      },
    },
  } as unknown as ArivuClient;
  return {
    client,
    pulse: (repoPath) => streams.get(repoPath)?.push(),
    setStatus: (s) => {
      status = s;
    },
    subscribeCount: () => subscribeCount,
  };
}

const hostsOf = (...labels: string[]): FleetHost[] =>
  labels.map((label) => ({ label, ssh: `nix@${label}` }));

describe("startFleet", () => {
  it("mirrors each host live, keyed by (host, terminalId) — same id stays distinct", async () => {
    const a = fakeConn({
      terminals: { [id("same")]: val({ agent: agentVal("thinking") }) },
    });
    const b = fakeConn({
      terminals: { [id("same")]: val({ agent: agentVal("awaiting_user") }) },
    });
    const { sink, statuses, upserts } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("a", "b"),
      connect: async (h) => (h.label === "a" ? a.conn : b.conn),
      sink,
      log: () => {},
    });
    await delay(20);

    expect(statuses).toContainEqual(["a", { kind: "connected" }]);
    expect(statuses).toContainEqual(["b", { kind: "connected" }]);
    // Identical terminal id under two hosts: both mirrored, never collided.
    expect(
      upserts
        .filter(([, i]) => i === "same")
        .map(([l]) => l)
        .sort(),
    ).toEqual(["a", "b"]);
    handle.dispose();
  });

  it("mirrors the activity stream into the sink's live set (the green dot)", async () => {
    const a = fakeConn({
      terminals: {
        [id("loud")]: val({ agent: agentVal("thinking") }),
        [id("quiet")]: val({ agent: agentVal("thinking") }),
      },
      activity: ["loud"], // only `loud` is moving bytes right now
    });
    const { sink, lives } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("a"),
      connect: async () => a.conn,
      sink,
      log: () => {},
    });
    await delay(20);
    // The activity frame reached the sink, host-labelled, with only the live id.
    expect(lives).toContainEqual(["a", ["loud"]]);
    handle.dispose();
  });

  it("surfaces a dead dial as unreachable while the other host keeps mirroring", async () => {
    const good = fakeConn({
      terminals: { [id("t")]: val({ agent: agentVal("thinking") }) },
    });
    const { sink, statuses, upserts } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("dead", "good"),
      connect: async (h) => {
        if (h.label === "dead") throw new Error("ECONNREFUSED");
        return good.conn;
      },
      sink,
      log: () => {},
    });
    await delay(20);

    expect(statuses).toContainEqual([
      "dead",
      { kind: "unreachable", reason: "ECONNREFUSED" },
    ]);
    expect(statuses).toContainEqual(["good", { kind: "connected" }]);
    expect(upserts).toContainEqual(["good", "t", expect.anything()]);
    handle.dispose();
  });

  it("flags a contract-version mismatch as skew", async () => {
    const skewed = fakeConn({ version: "9.9", terminals: {} });
    const { sink, statuses } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("x"),
      connect: async () => skewed.conn,
      sink,
      log: () => {},
    });
    await delay(20);

    expect(statuses).toContainEqual([
      "x",
      {
        kind: "skew",
        localVersion: TERMINAL_WORKSPACE_CONTRACT_VERSION,
        hostVersion: "9.9",
      },
    ]);
    handle.dispose();
  });

  it("isolates a post-dial probe failure as unreachable, never sinking the fleet", async () => {
    // The dial succeeds but the version probe rejects. The bad host must surface
    // as `unreachable` (not stranded at `connecting` with an escaped rejection),
    // and the good host keeps mirroring.
    const good = fakeConn({
      terminals: { [id("t")]: val({ agent: agentVal("thinking") }) },
    });
    const { sink, statuses, upserts } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("bad", "good"),
      connect: async (h) =>
        h.label === "bad" ? fakeConnVersionRejects() : good.conn,
      sink,
      log: () => {},
    });
    await delay(20);

    expect(statuses).toContainEqual([
      "bad",
      { kind: "unreachable", reason: "link dropped mid-probe" },
    ]);
    expect(statuses).toContainEqual(["good", { kind: "connected" }]);
    expect(upserts).toContainEqual(["good", "t", expect.anything()]);
    handle.dispose();
  });

  it("treats an empty version stream as unreachable, never a silent connected", async () => {
    // The dial succeeds but the version cell yields no snapshot frame. A version
    // cell always opens with a snapshot, so an empty stream is a protocol/link
    // failure — it must surface as `unreachable`, not collapse to `connected`.
    const { sink, statuses } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("empty"),
      connect: async () => fakeConnVersionEmpty(),
      sink,
      log: () => {},
    });
    await delay(20);

    expect(statuses).not.toContainEqual(["empty", { kind: "connected" }]);
    const last = statuses.filter(([l]) => l === "empty").at(-1);
    expect(last?.[1].kind).toBe("unreachable");
    expect(last?.[1].kind === "unreachable" && last[1].reason).toContain(
      "no snapshot frame",
    );
    handle.dispose();
  });

  it("flips a host to unreachable when its link drops after connecting", async () => {
    const f = fakeConn({ terminals: {} });
    const { sink, statuses } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("x"),
      connect: async () => f.conn,
      sink,
      log: () => {},
    });
    await delay(20);
    expect(statuses).toContainEqual(["x", { kind: "connected" }]);

    f.dropLink(); // the box went away
    await delay(20);
    expect(statuses).toContainEqual([
      "x",
      { kind: "unreachable", reason: "connection closed" },
    ]);
    handle.dispose();
  });

  it("clears a host's stale rows + live set when its link drops, not just the status", async () => {
    // A connected host with a live, awaiting-you terminal. When the link drops
    // the orchestrator must CLEAR the mirrored data (so the board stops counting,
    // animating, and alerting on it), not merely flip the header — a dead box
    // must not keep showing the rows it had before it died.
    const f = fakeConn({
      terminals: { [id("blocked")]: val({ agent: agentVal("awaiting_user") }) },
      activity: ["blocked"],
    });
    const { sink, statuses, clears } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("x"),
      connect: async () => f.conn,
      sink,
      log: () => {},
    });
    await delay(20);
    expect(statuses).toContainEqual(["x", { kind: "connected" }]);

    f.dropLink(); // the box went away
    await delay(20);
    // The host's data was cleared, and only THEN flipped to unreachable.
    expect(clears).toContain("x");
    expect(statuses).toContainEqual([
      "x",
      { kind: "unreachable", reason: "connection closed" },
    ]);
    handle.dispose();
  });

  it("watches a terminal's repo and pushes its live git status to the sink (R4.7)", async () => {
    const repo = "/repo/kolu";
    const f = fakeConn({
      terminals: { [id("t")]: val({ git: gitInfo(repo) }) },
      gitStatus: makeStatus({
        workingTree: { staged: 1, modified: 2, untracked: 3 },
      }),
    });
    const { sink, gitSets } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("a"),
      connect: async () => f.conn,
      sink,
      log: () => {},
    });
    await delay(30);
    // awareness upsert → repoRoot → subscribeRepoChange {seq:0} → getStatus →
    // setGitStatus, host-labelled and keyed by repo root.
    const hit = gitSets.find(([l, r]) => l === "a" && r === repo);
    expect(hit).toBeDefined();
    const status = hit?.[2];
    expect(status?.mode).toBe("local");
    if (status?.mode !== "local") throw new Error("expected local-mode status");
    expect(status.workingTree).toEqual({
      staged: 1,
      modified: 2,
      untracked: 3,
    });
    handle.dispose();
  });
});

describe("RepoWatchSet", () => {
  const watchSet = (client: ArivuClient, sink: FleetSink): RepoWatchSet =>
    new RepoWatchSet({ client, label: "h", sink, log: () => {} });

  it("subscribes once per repo and pushes the snapshot-pulse's re-query", async () => {
    const fake = fakeGitClient();
    const { sink, gitSets } = recordingSink();
    const w = watchSet(fake.client, sink);
    w.retain("/r");
    await delay(20);
    // The {seq:0} snapshot pulse drove one getStatus → one setGitStatus.
    expect(gitSets.filter(([, r]) => r === "/r")).toHaveLength(1);
    expect(fake.subscribeCount()).toBe(1);
    w.dispose();
  });

  it("re-queries getStatus on every later pulse", async () => {
    const fake = fakeGitClient();
    const { sink, gitSets } = recordingSink();
    const w = watchSet(fake.client, sink);
    w.retain("/r");
    await delay(20);
    fake.setStatus(
      makeStatus({
        files: [{ path: "x", status: "?" }],
        workingTree: { staged: 0, modified: 0, untracked: 1 },
      }),
    );
    fake.pulse("/r"); // a repo change
    await delay(20);
    const sets = gitSets.filter(([, r]) => r === "/r");
    expect(sets.length).toBeGreaterThanOrEqual(2); // snapshot + the pulse
    const last = sets.at(-1)?.[2];
    expect(last?.mode).toBe("local");
    if (last?.mode !== "local") throw new Error("expected local-mode status");
    expect(last.workingTree.untracked).toBe(1);
    w.dispose();
  });

  it("ref-counts a repo: two terminals share one subscription, the last to leave clears it", async () => {
    const fake = fakeGitClient();
    const { sink, gitClears } = recordingSink();
    const w = watchSet(fake.client, sink);
    w.retain("/r"); // first terminal in the repo
    w.retain("/r"); // a second terminal in the same repo
    await delay(20);
    expect(fake.subscribeCount()).toBe(1); // one subscription, not two
    w.release("/r"); // one terminal left — repo still referenced
    expect(gitClears).toHaveLength(0); // so its status is NOT cleared
    w.release("/r"); // the last terminal left
    expect(gitClears).toContainEqual(["h", "/r"]); // now the status is dropped
    w.dispose();
  });

  it("dispose aborts every watch without throwing (the host link dropped)", async () => {
    const fake = fakeGitClient();
    const { sink } = recordingSink();
    const w = watchSet(fake.client, sink);
    w.retain("/a");
    w.retain("/b");
    await delay(20);
    expect(fake.subscribeCount()).toBe(2);
    // The abort ends both subscriptions cleanly — a leaked loop would keep the
    // process from settling.
    expect(() => w.dispose()).not.toThrow();
  });
});

describe("snapshotFleet", () => {
  it("dumps each host's terminals, and a dead host as an unreachable snapshot", async () => {
    const a = fakeConn({ terminals: { [id("t1")]: val({ cwd: "/x" }) } });
    const snaps = await snapshotFleet(hostsOf("a", "dead"), async (h) => {
      if (h.label === "dead") throw new Error("boom");
      return a.conn;
    });
    expect(snaps).toHaveLength(2);
    const ok = snaps.find((s) => s.label === "a");
    expect(ok?.kind).toBe("ok");
    expect(ok?.kind === "ok" && ok.entries[0]?.[0]).toBe("t1");
    expect(snaps.find((s) => s.label === "dead")).toEqual({
      label: "dead",
      kind: "unreachable",
      reason: "boom",
    });
  });

  it("turns a post-dial probe failure into an unreachable snapshot, not a sunk Promise.all", async () => {
    // One host's `version.get` rejects after a good dial; the rest of `--json`
    // must still dump, with the bad host shown as unreachable.
    const a = fakeConn({ terminals: { [id("t1")]: val({ cwd: "/x" }) } });
    const snaps = await snapshotFleet(hostsOf("a", "bad"), async (h) =>
      h.label === "bad" ? fakeConnVersionRejects() : a.conn,
    );
    expect(snaps).toHaveLength(2);
    expect(snaps.find((s) => s.label === "a")?.kind).toBe("ok");
    expect(snaps.find((s) => s.label === "bad")).toEqual({
      label: "bad",
      kind: "unreachable",
      reason: "link dropped mid-probe",
    });
  });

  it("turns an empty version stream into an unreachable snapshot, not a silent ok", async () => {
    // The dial succeeds but `version.get` ends empty (no snapshot frame). The
    // `--json` snapshot must report this host as unreachable, never dump it as a
    // compatible-looking `ok` that hides the broken link.
    const a = fakeConn({ terminals: { [id("t1")]: val({ cwd: "/x" }) } });
    const snaps = await snapshotFleet(hostsOf("a", "empty"), async (h) =>
      h.label === "empty" ? fakeConnVersionEmpty() : a.conn,
    );
    expect(snaps).toHaveLength(2);
    expect(snaps.find((s) => s.label === "a")?.kind).toBe("ok");
    const empty = snaps.find((s) => s.label === "empty");
    expect(empty?.kind).toBe("unreachable");
    expect(empty?.kind === "unreachable" && empty.reason).toContain(
      "no snapshot frame",
    );
  });

  it("flags a contract-skewed host as skew, keeping its rows visible", async () => {
    const skewed = fakeConn({
      version: "9.9",
      terminals: { [id("t1")]: val({ cwd: "/x" }) },
    });
    const [snap] = await snapshotFleet(hostsOf("old"), async () => skewed.conn);
    // The skew signal is carried AND the host's entries are kept — a skewed box
    // is visible WITH its rows, not dumped as if fully compatible.
    expect(snap?.kind).toBe("skew");
    expect(snap?.kind === "skew" && snap.localVersion).toBe(
      TERMINAL_WORKSPACE_CONTRACT_VERSION,
    );
    expect(snap?.kind === "skew" && snap.hostVersion).toBe("9.9");
    expect(snap?.kind === "skew" && snap.entries[0]?.[0]).toBe("t1");
  });
});
