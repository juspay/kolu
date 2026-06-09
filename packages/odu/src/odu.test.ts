/**
 * Falsifiability suite for the lane runner, over the real stdio framing —
 * a loopback stream pair, exactly the transport ssh carries in production.
 * Adapted from the mini-ci example's suite, extended for odu's deltas:
 * idle-until-configure, the builtin `_ci-setup` node, configure rejection.
 */

import { tmpdir } from "node:os";
import { stdioLink } from "@kolu/surface/links/stdio";
import { createLoopbackPair } from "@kolu/surface/loopback";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { afterEach, describe, expect, it } from "vitest";
import { applyLogFrame, renderTable, summarize } from "./cli/render";
import type { TaskSpec } from "./common/spec";
import type {
  laneSurface,
  NodesSnapshot,
  PipelineState,
} from "./common/surface";
import { createLaneRunner, SETUP_NODE_ID } from "./runner/runner";

type Client = ReturnType<typeof stdioLink<typeof laneSurface.contract>>;

interface Harness {
  client: Client;
  states: NodesSnapshot[];
  configure: (
    tasks: TaskSpec[],
    workspace?: string,
  ) => Promise<{
    ok: boolean;
    error: string | null;
  }>;
  dispose: () => void;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function harness(): Harness {
  const runner = createLaneRunner();
  const pair = createLoopbackPair();
  void serveOverStdio({ router: runner.router, transport: pair.server });
  const client = stdioLink<typeof laneSurface.contract>({
    read: pair.client.read,
    write: pair.client.write,
  });

  const states: NodesSnapshot[] = [];
  void (async () => {
    try {
      for await (const state of await client.surface.nodes.get({})) {
        states.push(state);
      }
    } catch {
      // teardown races are unremarkable
    }
  })();

  const dispose = (): void => {
    // Client goes away first (runner sees EOF and disposes), then the
    // client's inbound closes so live iterators end — mini-ci's ordering.
    pair.client.write.end();
    runner.dispose();
    pair.client.read.destroy();
  };
  cleanups.push(dispose);

  return {
    client,
    states,
    configure: (tasks, workspace = tmpdir()) =>
      client.surface.run.configure({
        name: "test",
        origin: null,
        sha: null,
        workspace,
        tasks,
      }),
    dispose,
  };
}

async function until(
  predicate: () => boolean,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // A throwing predicate is "not yet" — e.g. `last(h)` before the first frame.
  const ready = (): boolean => {
    try {
      return predicate();
    } catch {
      return false;
    }
  };
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("until: timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const last = (h: Harness): NodesSnapshot => {
  const state = h.states.at(-1);
  if (state === undefined) throw new Error("no state yet");
  return state;
};

const chain: TaskSpec[] = [
  { id: "build", command: "echo building", needs: [] },
  { id: "test", command: "echo testing", needs: ["build"] },
];

describe("odu lane runner over stdio (loopback)", () => {
  it("spawns idle, then configure seeds _ci-setup + tasks and runs to green", async () => {
    const h = harness();
    const ack = await h.configure(chain);
    expect(ack).toEqual({ ok: true, error: null });

    await until(() => summarize(last(h)).done && last(h).order.length === 3);
    const final = last(h);
    expect(final.order).toEqual([SETUP_NODE_ID, "build", "test"]);
    for (const id of final.order) {
      expect(final.nodes[id]?.status).toBe("ok");
    }

    // Race-free topo invariant across every captured frame: a node is only
    // ever running/ok after each of its needs is ok.
    for (const state of h.states) {
      for (const id of state.order) {
        const node = state.nodes[id];
        if (node === undefined) continue;
        if (node.status === "running" || node.status === "ok") {
          for (const dep of node.needs) {
            expect(state.nodes[dep]?.status).toBe("ok");
          }
        }
      }
    }
  });

  it("rejects a second configure (one run per lane process)", async () => {
    const h = harness();
    expect((await h.configure(chain)).ok).toBe(true);
    const again = await h.configure(chain);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already configured/);
  });

  it("fails _ci-setup on a missing workspace and skip-cascades every task", async () => {
    const h = harness();
    const ack = await h.configure(chain, "/nonexistent/odu-workspace");
    expect(ack.ok).toBe(true); // ack-fast: the failure surfaces as the node
    await until(() => summarize(last(h)).done);
    const final = last(h);
    expect(final.nodes[SETUP_NODE_ID]?.status).toBe("failed");
    expect(final.nodes.build?.status).toBe("skipped");
    expect(final.nodes.test?.status).toBe("skipped");
    expect(summarize(final).failedOverall).toBe(true);
  });

  it("gives a late subscriber the full snapshot as its first frame", async () => {
    const h = harness();
    await h.configure(chain);
    await until(() => summarize(last(h)).done && last(h).order.length === 3);

    let first: NodesSnapshot | undefined;
    for await (const state of await h.client.surface.nodes.get({})) {
      first = state;
      break;
    }
    expect(first?.nodes.test?.status).toBe("ok");
  });

  it("replays a node's log to a late subscriber as a snapshot frame", async () => {
    const h = harness();
    await h.configure([
      { id: "mark", command: "echo MARK-ODU-LOG", needs: [] },
    ]);
    await until(() => last(h).nodes.mark?.status === "ok");

    for await (const frame of await h.client.surface.nodeLog.get({
      id: "mark",
    })) {
      expect(frame.kind).toBe("snapshot");
      expect(frame.text).toContain("MARK-ODU-LOG");
      break;
    }
  });

  it("reruns a node and its transitive dependents", async () => {
    const h = harness();
    await h.configure(chain);
    await until(() => summarize(last(h)).done && last(h).order.length === 3);

    const before = h.states.length;
    const result = await h.client.surface.node.rerun({ id: "build" });
    expect(result.ok).toBe(true);
    await until(() => h.states.length > before && summarize(last(h)).done);
    const reran = h.states
      .slice(before)
      .some((s) => s.nodes.test?.status === "pending");
    expect(reran).toBe(true);
    expect(last(h).nodes.build?.status).toBe("ok");
    expect(last(h).nodes.test?.status).toBe("ok");
  });

  it("skips dependents of a failed node — no false greens", async () => {
    const h = harness();
    await h.configure([
      { id: "build", command: "exit 3", needs: [] },
      { id: "test", command: "echo never", needs: ["build"] },
    ]);
    await until(() => summarize(last(h)).done);
    const final = last(h);
    expect(final.nodes.build?.status).toBe("failed");
    expect(final.nodes.build?.exitCode).toBe(3);
    expect(final.nodes.test?.status).toBe("skipped");
    expect(summarize(final).failedOverall).toBe(true);
  });

  it("rejects rerun of an unknown node", async () => {
    const h = harness();
    await h.configure(chain);
    const result = await h.client.surface.node.rerun({ id: "nope" });
    expect(result.ok).toBe(false);
  });
});

describe("render helpers", () => {
  const state: PipelineState = {
    name: "p",
    order: ["a", "b", "c"],
    nodes: {
      a: mkNode("a", "ok", 9_000),
      b: mkNode("b", "errored", 61_000),
      c: mkNode("c", "skipped", null),
    },
  };

  function mkNode(
    id: string,
    status: PipelineState["nodes"][string]["status"],
    durationMs: number | null,
  ): PipelineState["nodes"][string] {
    return {
      id,
      name: id,
      command: `echo ${id}`,
      needs: [],
      status,
      exitCode: null,
      startedAt: null,
      durationMs,
    };
  }

  it("summarize counts errored toward failedOverall", () => {
    const summary = summarize(state);
    expect(summary.done).toBe(true);
    expect(summary.errored).toBe(1);
    expect(summary.failedOverall).toBe(true);
  });

  it("renders Go durations and glyphs in the table", () => {
    const table = renderTable(state, "b");
    expect(table).toContain("✔ a");
    expect(table).toContain("› ⚠ b");
    expect(table).toContain("(1m1s)");
  });

  it("applyLogFrame resets on snapshot, appends on delta", () => {
    let buffer = applyLogFrame("", { kind: "append", text: "one" });
    buffer = applyLogFrame(buffer, { kind: "append", text: " two" });
    expect(buffer).toBe("one two");
    buffer = applyLogFrame(buffer, { kind: "snapshot", text: "fresh" });
    expect(buffer).toBe("fresh");
  });
});
