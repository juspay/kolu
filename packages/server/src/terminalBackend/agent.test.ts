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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Agent, AgentMetadataEvent } from "./agent.ts";

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
  // The agent's provider DAG (claude-code, codex, opencode) resolves its
  // watch dirs from KOLU_* env vars at *module import time* (top-level
  // consts in each integration's config). Point them at throwaway temp dirs
  // and import `agent.ts` only after they're set, so the test never installs
  // watchers on the developer's real ~/.claude / ~/.codex / opencode state.
  // Mirrors the e2e harness's per-worker isolation in
  // `packages/tests/support/hooks.ts`. (#1029)
  let createAgent: typeof import("./agent.ts").createAgent;
  let tmpRoot: string;
  // A real, existing cwd for the OSC 7 test — a non-existent target (the old
  // hardcoded /tmp/agent-osc7) makes the git cwd-watcher log a noisy
  // "failed to watch dir" / "resolveGitInfo failed".
  let osc7Cwd: string;

  let agent: Agent;
  let events: AgentMetadataEvent[];
  let stop: (() => void) | undefined;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-agent-test-"));
    const sub = (name: string) => {
      const dir = path.join(tmpRoot, name);
      fs.mkdirSync(dir);
      return dir;
    };
    process.env.KOLU_CLAUDE_SESSIONS_DIR = sub("claude-sessions");
    process.env.KOLU_CLAUDE_PROJECTS_DIR = sub("claude-projects");
    process.env.KOLU_CODEX_DIR = sub("codex");
    process.env.KOLU_OPENCODE_DB = path.join(sub("opencode"), "opencode.db");
    osc7Cwd = sub("osc7-cwd");

    // Env must be set before the provider modules are first imported; a
    // static import of `agent.ts` would hoist above these assignments.
    vi.resetModules();
    ({ createAgent } = await import("./agent.ts"));
  });

  afterAll(() => {
    delete process.env.KOLU_CLAUDE_SESSIONS_DIR;
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    delete process.env.KOLU_CODEX_DIR;
    delete process.env.KOLU_OPENCODE_DB;
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

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
        `printf '\\033]7;file://localhost${osc7Cwd}\\033\\\\'; sleep 0.5`,
      ],
      env: shellEnv,
      cwd: "/tmp",
    });
    let event: AgentMetadataEvent | undefined;
    await waitFor(() => {
      event = events.find(
        (e) => e.kind === "metadataPersisted" && e.fields.cwd === osc7Cwd,
      );
      return event !== undefined;
    });
    expect(event).toMatchObject({ kind: "metadataPersisted", id });
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

  it("dispose() tears down quietly — no exit events for live terminals", async () => {
    await start();
    agent.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    agent.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    agent.dispose();
    // dispose is shutdown, not "every terminal exited" — no exit events.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(events.some((e) => e.kind === "exit")).toBe(false);
  });
});
