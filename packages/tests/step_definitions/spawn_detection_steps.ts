/**
 * Command-rooted agent detection (#1872) — step definitions.
 *
 * Reproduces the field regression: a terminal whose ROOT process IS the agent
 * (`kaval-tui create -- claude …`, no shell wrapping it) never surfaces agent
 * activity in the Dock. Three coordinator agents launched this way ran for
 * hours invisible.
 *
 * Unlike the claude mock (`claude_code_steps.ts`), which types into a shell
 * terminal and keys a session file on the SHELL's pid, this dials the SAME
 * kaval daemon the server adopts from (`kavalSocketPath()`) and spawns a
 * genuinely command-rooted PTY: `argv[0]` is the fake `claude` binary, there is
 * no shell, and the claude session file is keyed on the ROOT process pid the
 * spawn RPC returns. The out-of-band PTY is announced to the server via kaval's
 * inventory feed and adopted as a tile — the exact path the field command hit.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, When } from "@cucumber/cucumber";
import { connectPtyHost, type Connection } from "kaval-tui/src/connect.ts";
import { buildCreateInput } from "kaval-tui/src/create.ts";
import { kavalSocketPath } from "../support/hooks.ts";
import type { KoluWorld } from "../support/world.ts";
import { buildTranscript, SESSION_ID } from "./claude_code_steps.ts";

/** A bash copy renamed `claude` (comm="claude"), run as the PTY's argv[0] with
 *  no shell — the harness stamps its absolute path here (`hooks.ts`). */
const fakeClaudeBin = () => {
  const bin = process.env.KOLU_FAKE_CLAUDE_BIN;
  if (!bin) throw new Error("KOLU_FAKE_CLAUDE_BIN must be set (see hooks.ts)");
  return bin;
};

// A single command-rooted PTY per scenario. The spawn client is kept only so we
// can kill the PTY in the After hook (the daemon owns it and outlives the
// dial); the session artifacts are unlinked alongside it.
let conn: Connection | null = null;
let spawnedId: string | null = null;
let sessionFile: string | null = null;
let projectDir: string | null = null;

async function cleanup() {
  if (conn && spawnedId) {
    try {
      await conn.client.surface.terminal.kill({ id: spawnedId });
    } catch {
      // The PTY may already be gone (test killed it) — nothing to reap.
    }
  }
  conn?.dispose();
  conn = null;
  spawnedId = null;
  if (sessionFile && fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
  sessionFile = null;
  if (projectDir && fs.existsSync(projectDir))
    fs.rmSync(projectDir, { recursive: true, force: true });
  projectDir = null;
}

After(cleanup);

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

    // A real cwd for the PTY (the fake agent spawns here) — unique per scenario.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "spawn2-"));

    // Dial the worker's kaval daemon and spawn a command-rooted PTY: argv[0] is
    // the fake claude, no shell. The fake agent loops printing a mark so kaval's
    // OUTPUT-driven foreground sampler captures its pid (a shell-less PTY emits
    // no OSC 633;E / OSC 2 to trigger a sample otherwise) and stays alive on a
    // `read` timeout using only bash builtins (no coreutils on the clean PATH).
    conn = await connectPtyHost(kavalSocketPath());
    const id = randomUUID();
    const input = buildCreateInput({
      id,
      cwd,
      env: process.env,
      command: [
        fakeClaudeBin(),
        "-c",
        "while true; do printf '.'; read -rt 1 _ || true; done",
      ],
      kavalSocket: kavalSocketPath(),
    });
    const result = await conn.client.surface.terminal.spawn(input);
    spawnedId = result.id;

    // The claude session artifacts, keyed on the ROOT process pid the spawn
    // returned (for a command-rooted PTY the agent IS the root, so its pid is
    // the terminal's foreground pid). Data-then-trigger, mirroring the claude
    // mock: transcript first, session file last.
    const encodedCwd = cwd.replace(/[/.]/g, "-");
    projectDir = path.join(projectsDir, encodedCwd);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, `${SESSION_ID}.jsonl`),
      buildTranscript(state as Parameters<typeof buildTranscript>[0]),
    );
    fs.mkdirSync(sessionsDir, { recursive: true });
    sessionFile = path.join(sessionsDir, `${result.pid}.json`);
    fs.writeFileSync(
      sessionFile,
      JSON.stringify({
        pid: result.pid,
        sessionId: SESSION_ID,
        cwd,
        startedAt: Date.now(),
      }),
    );
  },
);
