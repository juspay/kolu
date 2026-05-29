/**
 * Agent-boundary tests (#951 R4b). The agent owns pty-host + the provider
 * DAG and emits everything kolu-server consumes as a single stream. These
 * exercise the contract that stream carries, against real node-pty
 * children:
 *
 *   - a server-persisted field change (cwd via OSC 7) emits a
 *     `{ kind: "metadataPersisted" }` event carrying the new value;
 *   - a natural PTY exit emits `{ kind: "exit" }` with the real code;
 *   - an intentional `kill` emits NO `exit` (the kill RPC drives its own
 *     client cleanup) — the regression guard for the pre-R4b behavior.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type Agent, type AgentMetadataEvent, createAgent } from "./agent.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A minimal env that lets `/bin/sh` find `sleep` etc. */
const shellEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
};

async function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Let the `consume` async IIFE reach its first `for await` before any
 *  spawn publishes — otherwise the first event races the subscribe. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("createAgent", () => {
  let agent: Agent;
  let events: AgentMetadataEvent[];
  let stop: (() => void) | undefined;

  async function start(): Promise<void> {
    agent = createAgent({ log: silentLog });
    events = [];
    stop = agent.metadata.consume({
      onEvent: (ev) => events.push(ev),
      onError: () => {},
    });
    await settle();
  }

  afterEach(() => {
    stop?.();
    agent?.dispose();
  });

  it("emits a persisted metadata event with the new cwd on OSC 7", async () => {
    await start();
    const { id } = agent.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "printf '\\033]7;file://localhost/tmp/agent-osc7\\033\\\\'; sleep 0.5",
      ],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() =>
      events.some(
        (e) =>
          e.kind === "metadataPersisted" && e.fields.cwd === "/tmp/agent-osc7",
      ),
    );
    const ev = events.find(
      (e) =>
        e.kind === "metadataPersisted" && e.fields.cwd === "/tmp/agent-osc7",
    );
    expect(ev).toMatchObject({ kind: "metadataPersisted", id });
  });

  it("seeds the recency clock from restoredActivityAt", async () => {
    await start();
    // On session restore the saved lastActivityAt must survive into the
    // agent's own record, not reset to 0 — otherwise re-detecting a resumed
    // agent bumps recency to "now" and the restored ordering is lost.
    const { meta } = agent.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 0.3"],
      env: shellEnv,
      cwd: "/tmp",
      restoredActivityAt: 4242,
    });
    expect(meta.lastActivityAt).toBe(4242);
  });

  it("emits an exit event with the real code on a natural exit", async () => {
    await start();
    const { id } = agent.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 7"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => events.some((e) => e.kind === "exit"));
    expect(events.find((e) => e.kind === "exit")).toEqual({
      kind: "exit",
      id,
      exitCode: 7,
    });
  });

  it("does NOT emit an exit event when the terminal is killed", async () => {
    await start();
    const { id } = agent.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    // Let the child come up, then kill it and give the (suppressed) exit a
    // generous window to NOT fire.
    await new Promise((resolve) => setTimeout(resolve, 100));
    agent.kill(id);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(events.some((e) => e.kind === "exit")).toBe(false);
  });
});
