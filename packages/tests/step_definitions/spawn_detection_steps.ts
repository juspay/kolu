/**
 * Command-rooted agent detection (#1872) — step definitions.
 *
 * Reproduces the field regression: a terminal whose ROOT process IS the agent
 * (`kaval-tui create -- <agent> …`, no shell wrapping it) never surfaces agent
 * activity in the Dock. These steps dial the SAME kaval daemon the server
 * adopts from (`kavalSocketPath()`) and spawn a genuinely command-rooted PTY —
 * `argv[0]` is the agent, there is no shell — exactly the path the field
 * command hit. The out-of-band PTY is announced via kaval's inventory feed and
 * adopted as a tile.
 *
 * TWO scenarios, deliberately:
 *
 *  - **claude (pid path) — a GREEN regression guard.** Reproduce-first showed a
 *    command-rooted `claude` with a live session IS detected today: claude's
 *    `resolveSession` keys on `foregroundPid` + the on-disk session file, and
 *    for a command-rooted PTY the agent's pid IS the foreground pid. So the
 *    field's invisible claudes were Bug B (env leak → no session file), fixed by
 *    PR1 — not the two locks. This scenario pins that the pid path keeps working.
 *
 *  - **opencode via an npm shim (hint path) — the RED reproduction.** An agent
 *    whose kernel `comm` ≠ its name (an `opencode`-named binary that execs a
 *    `node`-named one) can only be matched via the seeded command hint. With no
 *    shell there is no OSC 633;E mark, and kaval discards the spawn argv
 *    (lock 1), and the shellIdle gate would null the hint anyway (lock 2). RED
 *    today; green once both locks open.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, When } from "@cucumber/cucumber";
import { connectPtyHost, type Connection } from "kaval-tui/src/connect.ts";
import { Effect, Exit, Scope } from "effect";
import { buildCreateInput } from "kaval-tui/src/create.ts";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";
import { writeOpenCodeFixture } from "../support/agent-mock-opencode.ts";
import { kavalSocketPath } from "../support/hooks.ts";
import { clearMockDatabase } from "../support/mock-fs.ts";
import type { KoluWorld } from "../support/world.ts";
import { buildTranscript, SESSION_ID } from "./claude_code_steps.ts";

const fakeBin = (envVar: string): string => {
  const bin = process.env[envVar];
  if (!bin) throw new Error(`${envVar} must be set (see hooks.ts)`);
  return bin;
};

// A shell-less loop that emits a byte each second (so kaval's OUTPUT-driven
// foreground sampler captures the root pid — a command-rooted PTY sends no
// OSC 633;E / OSC 2 to trigger a sample otherwise) and stays alive on a `read`
// timeout using only bash builtins (the clean spawn PATH has no coreutils
// `sleep`). `$1`, when present, is an OSC-0 title emitted once up front.
const AGENT_LOOP = (title?: string) =>
  `${title ? `printf '\\033]0;${title}\\007'; ` : ""}` +
  "while true; do printf '.'; read -rt 1 _ || true; done";

// A single command-rooted PTY per scenario; the dial is kept only to kill the
// PTY in the After hook (the daemon owns it and outlives the dial). The dial is
// a SCOPED effect, so the scenario holds the scope and closes it in cleanup —
// Cucumber's world is the non-Effect scaffold here, so the scope is explicit
// rather than a `Effect.scoped` block.
let conn: Connection | null = null;
let connScope: Scope.Closeable | null = null;
let spawnedId: string | null = null;
const artifacts: Array<() => void> = [];

async function spawnCommandRooted(
  command: string[],
  cwd: string,
): Promise<{ id: string; pid: number }> {
  connScope = Scope.makeUnsafe();
  conn = await Effect.runPromise(
    Scope.provide(connectPtyHost(kavalSocketPath()), connScope),
  );
  const input = buildCreateInput({
    id: randomUUID(),
    cwd,
    env: process.env,
    command,
    kavalSocket: kavalSocketPath(),
  });
  const result = await Effect.runPromise(
    conn.client.surface.terminal.spawn(input),
  );
  spawnedId = result.id;
  return result;
}

async function cleanup() {
  if (conn && spawnedId) {
    try {
      await Effect.runPromise(
        conn.client.surface.terminal.kill({ id: spawnedId }),
      );
    } catch {
      // The PTY may already be gone — nothing to reap.
    }
  }
  if (connScope !== null) {
    await Effect.runPromise(Scope.close(connScope, Exit.void));
    connScope = null;
  }
  conn = null;
  spawnedId = null;
  for (const undo of artifacts.splice(0)) undo();
}

After(cleanup);

// ── claude, pid path — the GREEN regression guard ──────────────────────
When(
  "a command-rooted claude agent is running with session state {string}",
  async function (this: KoluWorld, state: string) {
    const sessionsDir = process.env.KOLU_CLAUDE_SESSIONS_DIR;
    const projectsDir = process.env.KOLU_CLAUDE_PROJECTS_DIR;
    if (!sessionsDir || !projectsDir) {
      throw new Error(
        "KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR must be set",
      );
    }
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "spawn2-claude-"));
    const { pid } = await spawnCommandRooted(
      [fakeBin("KOLU_FAKE_CLAUDE_BIN"), "-c", AGENT_LOOP()],
      cwd,
    );

    // Claude session artifacts keyed on the ROOT pid (for a command-rooted PTY
    // the agent IS the root). Data-then-trigger: transcript first, session last.
    const projectDir = path.join(projectsDir, cwd.replace(/[/.]/g, "-"));
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, `${SESSION_ID}.jsonl`),
      buildTranscript(state as Parameters<typeof buildTranscript>[0]),
    );
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionFile = path.join(sessionsDir, `${pid}.json`);
    fs.writeFileSync(
      sessionFile,
      JSON.stringify({
        pid,
        sessionId: SESSION_ID,
        cwd,
        startedAt: Date.now(),
      }),
    );
    artifacts.push(() => {
      fs.rmSync(sessionFile, { force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    });
  },
);

// ── opencode via an npm shim, hint path — the RED reproduction ─────────
When(
  "a command-rooted opencode agent is running as an npm shim with session state {string}",
  async function (this: KoluWorld, state: string) {
    const dbPath = process.env.KOLU_OPENCODE_DB;
    if (!dbPath) throw new Error("KOLU_OPENCODE_DB must be set");
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "spawn2-opencode-"));

    // The opencode session, resolvable by its directory. Detection still needs
    // matchesAgent(state, "opencode") to pass FIRST — and the shim's comm is
    // "node", so that hinges entirely on the seeded command hint.
    writeOpenCodeFixture({ dbPath, cwd, state: state as AgentLifecycleState });
    artifacts.push(() => {
      clearMockDatabase(dbPath);
      fs.rmSync(cwd, { recursive: true, force: true });
    });

    // The npm shim: an `opencode`-named binary (so the spawn argv — and thus the
    // seeded hint — parses as opencode) that execs a `node`-named binary, so the
    // live process `comm` is "node", not "opencode". Passing the loop as a
    // script FILE keeps the exec free of nested shell quoting.
    const loop = path.join(cwd, ".agent-loop");
    fs.writeFileSync(loop, AGENT_LOOP("opencode"));
    await spawnCommandRooted(
      [
        fakeBin("KOLU_FAKE_OPENCODE_BIN"),
        "-c",
        `exec ${fakeBin("KOLU_FAKE_NODE_BIN")} ${loop}`,
      ],
      cwd,
    );
  },
);
