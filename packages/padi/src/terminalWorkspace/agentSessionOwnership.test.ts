/**
 * juspay/kolu#2057 — TWO HARNESSES IN ONE PROJECT MUST NOT SHARE ONE SESSION.
 *
 * The reported symptom is a Dock symptom: two terminals in the same repository
 * show the SAME title, the SAME subtitle and the SAME status/alert, and a state
 * change in one rewrites the other's row. The Dock's own keying is per-terminal
 * (pinned by `canvas/dock/dockRowIndependence.test.tsx`) — it renders whatever
 * agent metadata padi hands it, so the mirroring is upstream: BOTH terminals are
 * handed the SAME agent session.
 *
 * Codex (and OpenCode) match a session by DIRECTORY — "the most recently updated
 * thread whose `cwd` is this terminal's cwd". Two codex harnesses in one repo
 * have the same cwd, so that rule answers with ONE thread for BOTH of them, and
 * an external `codex` run in that directory (the reporter's second video) becomes
 * the newest thread and takes over both rows at once.
 *
 * These tests drive the REAL `codexAdapter` through the REAL orchestrator
 * (`startAgentSensor`, one instance per terminal, exactly as `startSensors` wires
 * it) against a REAL Codex threads DB, so nothing about the collision is
 * simulated. A session belongs to at most ONE terminal; that is the invariant
 * pinned here, and it is agent-agnostic — the same rule that keeps OpenCode's
 * directory match honest.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inMemoryChannel } from "@kolu/surface/server";
import type {
  AgentInfo,
  TerminalEvent,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import type { ForegroundSample } from "kaval";
import pino from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const log = pino({ level: "silent" });

// --- Fixture (module scope, BEFORE the dynamic imports) ---
//
// `kolu-codex/config` resolves `CODEX_DIR` / `CODEX_DB_PATH` once at module
// load, so the fixture must exist and the env must be set before `kolu-codex`
// is imported. A `beforeAll` runs after module evaluation — too late.

/** The one repository both harnesses run in — the whole point of the issue. */
const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-2057-codex-"));
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-2057-repo-"));
const dbPath = path.join(codexDir, "state_5.sqlite");
process.env.KOLU_CODEX_DIR = codexDir;
process.env.KOLU_CODEX_DB = dbPath;

/** Thread rows. `two` is updated later, so it is the row a `cwd`-keyed match
 *  hands to EVERY terminal in the directory. Real uuidv7 ids, so `startedAt`
 *  decodes rather than reading null. */
const THREAD_ONE = "019db605-0000-7abc-89ab-0123456789ab";
const THREAD_TWO = "019db606-0000-7abc-89ab-0123456789ab";

const SHELL_PID = 100;

/** A rollout JSONL whose tail parses to `waiting` — a finished turn. */
function finishedRollout(turn: string): string {
  return `${[
    JSON.stringify({
      type: "event_msg",
      payload: { type: "task_started", turn_id: turn },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: { type: "task_complete", turn_id: turn },
    }),
  ].join("\n")}\n`;
}

/** A rollout JSONL whose tail parses to `thinking` — a turn in flight. */
function thinkingRollout(turn: string): string {
  return `${JSON.stringify({
    type: "event_msg",
    payload: { type: "task_started", turn_id: turn },
  })}\n`;
}

interface ThreadRow {
  id: string;
  title: string;
  updatedAtMs: number;
  rollout: string;
}

/** (Re)create the `threads` table with exactly `rows` — the columns are the
 *  ones `REQUIRED_THREAD_COLUMNS` names, so `openDb`'s schema gate passes. */
function seedThreads(rows: ThreadRow[]): void {
  const db = new DatabaseSync(dbPath);
  db.exec("DROP TABLE IF EXISTS threads");
  db.exec(`CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    rollout_path TEXT NOT NULL,
    cwd TEXT NOT NULL,
    source TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    updated_at_ms INTEGER NOT NULL,
    title TEXT NOT NULL,
    model TEXT
  )`);
  const insert = db.prepare(
    "INSERT INTO threads (id, rollout_path, cwd, source, archived, updated_at_ms, title, model) VALUES (?, ?, ?, 'cli', 0, ?, ?, 'gpt-5')",
  );
  for (const row of rows) {
    const rolloutPath = path.join(codexDir, `${row.id}.jsonl`);
    fs.writeFileSync(rolloutPath, row.rollout);
    insert.run(row.id, rolloutPath, REPO, row.updatedAtMs, row.title);
  }
  db.close();
}

/** Add one more thread to the existing table — a second harness starting up in
 *  the same repository, or an external `codex` run landing there. */
function addThread(row: ThreadRow): void {
  const db = new DatabaseSync(dbPath);
  const rolloutPath = path.join(codexDir, `${row.id}.jsonl`);
  fs.writeFileSync(rolloutPath, row.rollout);
  db.prepare(
    "INSERT INTO threads (id, rollout_path, cwd, source, archived, updated_at_ms, title, model) VALUES (?, ?, ?, 'cli', 0, ?, ?, 'gpt-5')",
  ).run(row.id, rolloutPath, REPO, row.updatedAtMs, row.title);
  db.close();
}

const THREAD_ONE_ROW: ThreadRow = {
  id: THREAD_ONE,
  title: "Fix the parser",
  updatedAtMs: 1_000,
  rollout: finishedRollout("turn-1"),
};
const THREAD_TWO_ROW: ThreadRow = {
  id: THREAD_TWO,
  title: "Write the docs",
  updatedAtMs: 2_000,
  rollout: thinkingRollout("turn-1"),
};

seedThreads([THREAD_ONE_ROW]);

const { codexAdapter } = await import("kolu-codex");
const { startAgentSensor } = await import("./sensors.ts");
const { resetSessionOwnership } = await import("./sessionOwnership.ts");

afterAll(() => {
  fs.rmSync(codexDir, { recursive: true, force: true });
  fs.rmSync(REPO, { recursive: true, force: true });
});

/** One terminal running `codex` in `REPO`, with its own agent sensor — the
 *  per-terminal wiring `startSensors` does in production. */
interface Harness {
  /** The agent metadata this terminal's row would render, latest last. */
  latest: () => AgentInfo | undefined;
  /** Re-run session resolution — what a title event / WAL rewake triggers. */
  poke: () => Promise<void>;
  stop: () => void;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function startTerminal(id: string, agentPid: number): Harness {
  const emits: TerminalEvent[] = [];
  const signals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<{
      command: string;
      replayed: boolean;
      shellJoin: boolean;
    }>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
  };
  const stop = startAgentSensor(
    codexAdapter,
    { mirror: null, currentAgent: null },
    SHELL_PID,
    REPO,
    id as TerminalId,
    signals,
    undefined,
    (o) => emits.push(o),
    log,
    false,
  );
  let pokes = 0;
  return {
    latest: () => {
      const agents = emits.flatMap((e) =>
        e.kind === "agent" &&
        typeof e.agent === "object" &&
        e.agent.value !== null
          ? [e.agent.value]
          : [],
      );
      return agents.at(-1);
    },
    poke: async () => {
      // A DISTINCT title each time so the title dedup never swallows the
      // reconcile it triggers.
      pokes++;
      signals.title.publish(`codex ${pokes}`);
      signals.foreground.publish({
        process: "/usr/bin/codex",
        foregroundPid: agentPid,
      });
      await flush();
    },
    stop,
  };
}

beforeEach(() => {
  // The ownership books are process-wide, like the adapter activation registry
  // they sit beside — so one test's terminals must not be another's neighbours.
  resetSessionOwnership();
  seedThreads([THREAD_ONE_ROW]);
});

describe("two codex harnesses in ONE project (juspay/kolu#2057)", () => {
  it("gives each terminal its OWN session — never one session mirrored onto both", async () => {
    seedThreads([THREAD_ONE_ROW, THREAD_TWO_ROW]);
    const one = startTerminal("term-one", 201);
    const two = startTerminal("term-two", 202);
    try {
      await one.poke();
      await two.poke();

      const a = one.latest();
      const b = two.latest();
      expect(a, "terminal one detected no codex session").toBeDefined();
      expect(b, "terminal two detected no codex session").toBeDefined();

      // The Dock's row identity, its title line and its subtitle all ride these
      // fields. Two harnesses running different tasks must share none of them.
      expect(a?.sessionId).not.toBe(b?.sessionId);
      expect(a?.summary).not.toBe(b?.summary);
    } finally {
      one.stop();
      two.stop();
    }
  });

  it("leaves the FIRST terminal's row alone when a second harness starts in the same repo", async () => {
    // The reported sequence: one harness has been running a while (its thread is
    // the only one in this repo), then a second harness starts and becomes the
    // most-recently-updated thread in the same directory.
    const one = startTerminal("term-one", 201);
    try {
      await one.poke();
      const before = one.latest();
      expect(
        before?.sessionId,
        "terminal one never matched its own thread",
      ).toBe(THREAD_ONE);
      expect(before?.summary).toBe("Fix the parser");

      addThread(THREAD_TWO_ROW);
      const two = startTerminal("term-two", 202);
      try {
        await two.poke();
        await one.poke();

        // The second harness owns its own thread…
        expect(two.latest()?.sessionId).toBe(THREAD_TWO);
        expect(two.latest()?.summary).toBe("Write the docs");
        // …and the first terminal's title, subtitle and state are untouched.
        expect(one.latest()?.sessionId).toBe(before?.sessionId);
        expect(one.latest()?.summary).toBe(before?.summary);
        expect(one.latest()?.state).toBe(before?.state);
      } finally {
        two.stop();
      }
    } finally {
      one.stop();
    }
  });
});
