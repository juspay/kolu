import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, When } from "@cucumber/cucumber";
import { Effect, Exit, Scope } from "effect";
import { type Connection, connectPtyHost } from "kaval-tui/src/connect.ts";
import { buildCreateInput } from "kaval-tui/src/create.ts";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";
import { writeOpenCodeFixture } from "../support/agent-mock-opencode.ts";
import { kavalSocketPath } from "../support/hooks.ts";
import { clearMockDatabase } from "../support/mock-fs.ts";
import type { KoluWorld } from "../support/world.ts";
import { buildTranscript, SESSION_ID } from "./claude_code_steps.ts";

When(
  "{int} ms elapse past the command-run reconcile window",
  async function (this: KoluWorld, ms: number) {
    await new Promise((r) => setTimeout(r, ms));
  },
);

const fakeBin = (envVar: string): string => {
  const bin = process.env[envVar];
  if (!bin) throw new Error(`${envVar} must be set (see hooks.ts)`);
  return bin;
};

const AGENT_LOOP = (title?: string) =>
  `${title ? `printf '\\033]0;${title}\\007'; ` : ""}` +
  "while true; do printf '.'; read -rt 1 _ || true; done";

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
    } catch (error) {
      console.warn(
        `spawn_detection cleanup: killing terminal ${spawnedId} failed`,
        error,
      );
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

When(
  "a command-rooted opencode agent is running as an npm shim with session state {string}",
  async function (this: KoluWorld, state: string) {
    const dbPath = process.env.KOLU_OPENCODE_DB;
    if (!dbPath) throw new Error("KOLU_OPENCODE_DB must be set");
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "spawn2-opencode-"));

    writeOpenCodeFixture({ dbPath, cwd, state: state as AgentLifecycleState });
    artifacts.push(() => {
      clearMockDatabase(dbPath);
      fs.rmSync(cwd, { recursive: true, force: true });
    });

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
