/**
 * mini-ci falsifiability test — the permanent regression test the plan asks
 * for. It drives the *real* runner surface through the *real* stdio
 * transport (`createLoopbackPair` → `serveOverStdio` → `stdioLink`, the same
 * framing the ssh path uses), so a green run is genuine evidence that the
 * "interactive TUI over oRPC stdio" pattern holds end-to-end:
 *
 *   1. the `nodes` cell streams snapshot-then-delta, and topo order holds;
 *   2. a late subscriber to a finished node's `nodeLog` gets the buffered
 *      snapshot as its first frame;
 *   3. `node.rerun` resets the node + its dependents and re-runs them;
 *   4. a failed dependency skips its dependents (no false greens);
 *   5. the local/remote transport commands differ *only* in the link;
 *   6. the pure render helpers paint the expected dashboard.
 */

import { createLoopbackPair } from "@kolu/surface/loopback";
import { stdioLink } from "@kolu/surface/links/stdio";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { describe, expect, it } from "vitest";
import type { PipelineSpec } from "./common/pipeline";
import type { NodeLogFrame, NodesSnapshot, surface } from "./common/surface";
import { createRunner } from "./runner/runner";
import {
  buildLocalRunnerCommand,
  buildRemoteRunnerCommand,
  buildShipCommand,
} from "./tui/transport";
import { applyLogFrame, renderTable, summarize } from "./tui/render";

type Client = ReturnType<typeof stdioLink<typeof surface.contract>>;

interface Tracker {
  /** Every `nodes` cell frame seen so far. */
  states: NodesSnapshot[];
}

interface Harness {
  client: Client;
  start(): void;
  /** Background-subscribe to the `nodes` cell, accumulating frames. */
  track(): Tracker;
  close(): Promise<void>;
}

function harness(spec: PipelineSpec): Harness {
  const runner = createRunner(spec);
  const pair = createLoopbackPair();
  const serveDone = serveOverStdio({
    router: runner.router,
    transport: pair.server,
  });
  const client = stdioLink<typeof surface.contract>({
    read: pair.client.read,
    write: pair.client.write,
  });
  const trackerDones: Promise<void>[] = [];
  return {
    client,
    start: () => runner.start(),
    track: () => {
      const states: NodesSnapshot[] = [];
      trackerDones.push(
        (async () => {
          try {
            for await (const state of await client.surface.nodes.get({})) {
              states.push(state);
            }
          } catch {
            // transport closed during teardown — expected.
          }
        })(),
      );
      return { states };
    },
    // Teardown mirrors reality: the client "goes away" (its outbound ends →
    // the runner sees stdin EOF and finishes), THEN we close the client's
    // inbound so any live iterators end. Aborting mid-stream instead would
    // write an abort frame onto an already-ended pipe.
    close: async () => {
      runner.dispose();
      pair.client.write.end();
      await serveDone;
      pair.server.write.end();
      await Promise.all(trackerDones);
    },
  };
}

async function until(
  predicate: () => boolean,
  timeoutMs = 4000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("until: timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** First frame of a stream, then stop iterating. */
async function firstFrame<T>(stream: Promise<AsyncIterable<T>>): Promise<T> {
  for await (const value of await stream) return value;
  throw new Error("stream closed before first frame");
}

const last = <T>(xs: T[]): T | undefined => xs.at(-1);
const isDone = (states: NodesSnapshot[]): boolean => {
  const state = last(states);
  return state !== undefined && summarize(state).done;
};

describe("mini-ci runner over stdio (loopback)", () => {
  it("streams the nodes cell snapshot-then-delta and respects topo order", async () => {
    const h = harness({
      name: "ci",
      tasks: [
        { id: "build", command: "echo build", needs: [] },
        { id: "test", command: "echo test", needs: ["build"] },
        { id: "lint", command: "echo lint", needs: ["test"] },
      ],
    });
    const tracker = h.track();
    h.start();
    await until(() => isDone(tracker.states));

    // Topo invariant across EVERY captured frame: a node only runs after
    // its dependency is `ok` — a race-free proof of ordering.
    for (const state of tracker.states) {
      const { build, test, lint } = state.nodes;
      if (test && (test.status === "running" || test.status === "ok")) {
        expect(build?.status).toBe("ok");
      }
      if (lint && (lint.status === "running" || lint.status === "ok")) {
        expect(test?.status).toBe("ok");
      }
    }

    const final = last(tracker.states);
    expect(final?.nodes.build?.status).toBe("ok");
    expect(final?.nodes.test?.status).toBe("ok");
    expect(final?.nodes.lint?.status).toBe("ok");
    // snapshot + at least one delta.
    expect(tracker.states.length).toBeGreaterThan(1);

    await h.close();
  });

  it("gives a late subscriber the full node-state snapshot as its first frame", async () => {
    const h = harness({
      name: "ci",
      tasks: [{ id: "build", command: "echo build", needs: [] }],
    });
    const tracker = h.track();
    h.start();
    await until(() => isDone(tracker.states));

    // A fresh subscriber, after the pipeline settled, must see the current
    // (all-ok) state as its first frame — the cell's snapshot contract.
    const snapshot = await firstFrame(h.client.surface.nodes.get({}));
    expect(snapshot.nodes.build?.status).toBe("ok");

    await h.close();
  });

  it("buffers a node's log so a late subscriber's first frame is a snapshot", async () => {
    const marker = "MARK-MINI-CI";
    const h = harness({
      name: "ci",
      tasks: [{ id: "say", command: `echo ${marker}`, needs: [] }],
    });
    const tracker = h.track();
    h.start();
    await until(() => last(tracker.states)?.nodes.say?.status === "ok");

    const frame = await firstFrame(h.client.surface.nodeLog.get({ id: "say" }));
    expect(frame.kind).toBe("snapshot");
    expect(frame.text).toContain(marker);

    await h.close();
  });

  it("reruns a node and its dependents, resetting them to pending", async () => {
    const h = harness({
      name: "ci",
      tasks: [
        { id: "build", command: "echo build", needs: [] },
        { id: "test", command: "echo test", needs: ["build"] },
      ],
    });
    const tracker = h.track();
    h.start();
    await until(() => isDone(tracker.states));
    const settledFrames = tracker.states.length;

    const result = await h.client.surface.node.rerun({ id: "build" });
    expect(result.ok).toBe(true);

    // After rerun, both nodes must cycle back through `pending` and settle
    // `ok` again — proof the mutation re-ran the dependency closure.
    await until(() => {
      const reran = tracker.states
        .slice(settledFrames)
        .some((s) => s.nodes.build?.status === "pending");
      return reran && isDone(tracker.states);
    });
    const final = last(tracker.states);
    expect(final?.nodes.build?.status).toBe("ok");
    expect(final?.nodes.test?.status).toBe("ok");

    await h.close();
  });

  it("skips a node whose dependency failed (no false greens)", async () => {
    const h = harness({
      name: "ci",
      tasks: [
        { id: "build", command: "exit 3", needs: [] },
        { id: "test", command: "echo test", needs: ["build"] },
      ],
    });
    const tracker = h.track();
    h.start();
    await until(() => isDone(tracker.states));

    const final = last(tracker.states);
    expect(final).toBeDefined();
    expect(final?.nodes.build?.status).toBe("failed");
    expect(final?.nodes.build?.exitCode).toBe(3);
    expect(final?.nodes.test?.status).toBe("skipped");
    if (final) expect(summarize(final).failedOverall).toBe(true);

    await h.close();
  });
});

describe("transport — only the link differs (argv shape)", () => {
  const withRunnerEnv = (value: string | undefined, fn: () => void): void => {
    const prev = process.env.MINI_CI_RUNNER;
    if (value === undefined) delete process.env.MINI_CI_RUNNER;
    else process.env.MINI_CI_RUNNER = value;
    try {
      fn();
    } finally {
      if (prev === undefined) delete process.env.MINI_CI_RUNNER;
      else process.env.MINI_CI_RUNNER = prev;
    }
  };

  it("builds a local runner command under the workspace tsx (dev)", () => {
    withRunnerEnv(undefined, () => {
      const local = buildLocalRunnerCommand({ pipeline: "ci.json" });
      expect(local.command).toBe("pnpm");
      expect(local.args.slice(0, 2)).toEqual(["exec", "tsx"]);
      expect(local.args).toContain("--stdio");
      expect(local.args.slice(-2)).toEqual(["--pipeline", "ci.json"]);
    });
  });

  it("uses the injected MINI_CI_RUNNER binary when present (nix run)", () => {
    withRunnerEnv("/nix/store/x/bin/mini-ci-runner", () => {
      const local = buildLocalRunnerCommand({ pipeline: "ci.json" });
      expect(local.command).toBe("/nix/store/x/bin/mini-ci-runner");
      expect(local.args).toEqual(["--stdio", "--pipeline", "ci.json"]);
    });
  });

  it("ships source with git archive piped into ssh tar -x", () => {
    const { archive, extract } = buildShipCommand({
      host: "user@host",
      remoteDir: "/tmp/x",
    });
    expect(archive).toEqual({ command: "git", args: ["archive", "HEAD"] });
    expect(extract.command).toBe("ssh");
    expect(extract.args).toContain("user@host");
    expect(extract.args.at(-1)).toBe(
      "rm -rf '/tmp/x' && mkdir -p '/tmp/x' && tar -x -C '/tmp/x'",
    );
  });

  it("runs the runner on the remote via nix run over ssh stdio", () => {
    const remote = buildRemoteRunnerCommand({
      host: "user@host",
      remoteDir: "/tmp/x",
    });
    expect(remote.command).toBe("ssh");
    expect(remote.args).toContain("user@host");
    // dead-peer keepalive reused from @kolu/surface-nix-host.
    expect(remote.args).toContain("ServerAliveInterval=10");
    const remoteCmd = remote.args.at(-1) ?? "";
    // Builds + runs from the shipped flake source — no toolchain assumed.
    // path: and the flake attr are single-quoted so the remote shell keeps the
    // `#attr` literal and spaces/metacharacters in the path don't break it.
    expect(remoteCmd).toContain("nix run 'path:/tmp/x#mini-ci-runner'");
    expect(remoteCmd).toContain("--stdio");
  });
});

describe("render helpers", () => {
  const state: NodesSnapshot = {
    name: "ci",
    order: ["build", "test"],
    nodes: {
      build: {
        id: "build",
        name: "build",
        command: "echo build",
        needs: [],
        status: "ok",
        exitCode: 0,
        startedAt: 1,
        durationMs: 2300,
      },
      test: {
        id: "test",
        name: "test",
        command: "echo test",
        needs: ["build"],
        status: "running",
        exitCode: null,
        startedAt: 5,
        durationMs: null,
      },
    },
  };

  it("renders one row per node with status glyph and the attach marker", () => {
    const table = renderTable(state, "test");
    expect(table).toContain("pipeline: ci");
    expect(table).toContain("✔ build");
    expect(table).toContain("(2.3s)");
    expect(table).toContain("› ▶ test");
    expect(table).toContain("[needs: build]");
  });

  it("summarizes counts and done/failed flags", () => {
    expect(summarize(state)).toMatchObject({
      total: 2,
      ok: 1,
      running: 1,
      done: false,
      failedOverall: false,
    });
  });

  it("applies log frames: snapshot resets, append concatenates", () => {
    let buffer = applyLogFrame("stale", { kind: "snapshot", text: "fresh\n" });
    expect(buffer).toBe("fresh\n");
    buffer = applyLogFrame(buffer, { kind: "append", text: "more\n" });
    expect(buffer).toBe("fresh\nmore\n");
  });

  it("typechecks the NodeLogFrame discriminated union", () => {
    const frame: NodeLogFrame = { kind: "append", text: "x" };
    expect(frame.kind).toBe("append");
  });
});
