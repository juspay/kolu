import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PadiTerminal } from "@kolu/padi-client/surface";
import { inMemoryChannel } from "@kolu/surface/server";
import type {
  AgentInfo,
  TerminalEvent,
  TerminalGrid,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import type { ForegroundSample } from "kaval";
import pino from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { recomputeUrgency } from "../activity/urgency.ts";

const log = pino({ level: "silent" });

// `kolu-codex/config` resolves `CODEX_DIR` / `CODEX_DB_PATH` once at module
// load, so the fixture must exist and the env must be set before `kolu-codex`
// is imported. A `beforeAll` runs after module evaluation — too late.

const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-2057-codex-"));
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-2057-repo-"));
const dbPath = path.join(codexDir, "state_5.sqlite");
process.env.KOLU_CODEX_DIR = codexDir;
process.env.KOLU_CODEX_DB = dbPath;

const THREAD_ONE = "019db605-0000-7abc-89ab-0123456789ab";
const THREAD_TWO = "019db606-0000-7abc-89ab-0123456789ab";

function uuidV7At(ms: number, tail: string): string {
  const hex = ms.toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-89ab-${tail}`;
}

const NOW = Date.now();
const YESTERDAY = uuidV7At(NOW - 86_400_000, "0123456789ab");
const FRESH = uuidV7At(NOW + 60_000, "0123456789ac");
const FRESH_STRANGER = uuidV7At(NOW + 90_000, "0123456789ad");

const SHELL_PID = 100;

const ONE_ID = "term-one" as TerminalId;
const TWO_ID = "term-two" as TerminalId;

function activeRecord(agent: AgentInfo | undefined): PadiTerminal {
  return { state: "active", agent: agent ?? null } as PadiTerminal;
}

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

function thinkingRollout(turn: string): string {
  return `${JSON.stringify({
    type: "event_msg",
    payload: { type: "task_started", turn_id: turn },
  })}\n`;
}

function askingRollout(): string {
  return `${[
    JSON.stringify({
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-1" },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: "call-A",
        name: "request_user_input",
      },
    }),
  ].join("\n")}\n`;
}

interface ThreadRow {
  id: string;
  title: string;
  updatedAtMs: number;
  rollout: string;
}

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

const { AGENT_PLUGINS } = await import("kolu-agents");
const codexAdapter = AGENT_PLUGINS.codex.adapter;
const { startAgentSensor, freshAgentEngineState } = await import(
  "./sensors.ts"
);
const { resetSessionOwnership } = await import("./sessionOwnership.ts");

afterAll(() => {
  fs.rmSync(codexDir, { recursive: true, force: true });
  fs.rmSync(REPO, { recursive: true, force: true });
});

interface Harness {
  latest: () => AgentInfo | undefined;
  poke: () => Promise<void>;
  stop: () => void;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function startTerminal(id: TerminalId, agentPid: number): Harness {
  const emits: TerminalEvent[] = [];
  const signals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<string>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
    grid: inMemoryChannel<TerminalGrid>(),
    screenSettled: inMemoryChannel<void>(),
    submitted: inMemoryChannel<void>(),
  };
  const stop = startAgentSensor(
    codexAdapter,
    freshAgentEngineState(),
    SHELL_PID,
    REPO,
    id,
    signals,
    undefined,
    (o) => emits.push(o),
    log,
    false,
    () => {},
  );
  signals.foreground.publish({
    process: "/bin/bash",
    foregroundPid: SHELL_PID,
  });
  let pokes = 0;
  return {
    latest: () => {
      const agents = emits.flatMap((e) =>
        e.kind === "agent" &&
        typeof e.agent === "object" &&
        e.agent.value !== null
          ? [e.agent.value.info]
          : [],
      );
      return agents.at(-1);
    },
    poke: async () => {
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
  resetSessionOwnership();
  seedThreads([THREAD_ONE_ROW]);
});

describe("two codex harnesses in ONE project (juspay/kolu#2057)", () => {
  it("gives each terminal its OWN session — never one session mirrored onto both", async () => {
    seedThreads([THREAD_ONE_ROW, THREAD_TWO_ROW]);
    const one = startTerminal(ONE_ID, 201);
    const two = startTerminal(TWO_ID, 202);
    try {
      await one.poke();
      await two.poke();

      const a = one.latest();
      const b = two.latest();
      expect(a, "terminal one detected no codex session").toBeDefined();
      expect(b, "terminal two detected no codex session").toBeDefined();

      expect(a?.sessionId).not.toBe(b?.sessionId);
      expect(a?.summary).not.toBe(b?.summary);
    } finally {
      one.stop();
      two.stop();
    }
  });

  it("leaves the FIRST terminal's row alone when a second harness starts in the same repo", async () => {
    const one = startTerminal(ONE_ID, 201);
    try {
      await one.poke();
      const before = one.latest();
      expect(
        before?.sessionId,
        "terminal one never matched its own thread",
      ).toBe(THREAD_ONE);
      expect(before?.summary).toBe("Fix the parser");

      addThread(THREAD_TWO_ROW);
      const two = startTerminal(TWO_ID, 202);
      try {
        await two.poke();
        await one.poke();

        expect(two.latest()?.sessionId).toBe(THREAD_TWO);
        expect(two.latest()?.summary).toBe("Write the docs");
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

  it("moves onto its OWN thread once it lands, not the leftover it grabbed first", async () => {
    seedThreads([
      {
        id: YESTERDAY,
        title: "Yesterday's task",
        updatedAtMs: 1_000,
        rollout: finishedRollout("turn-1"),
      },
    ]);
    const one = startTerminal(ONE_ID, 201);
    try {
      await one.poke();
      expect(
        one.latest()?.sessionId,
        "nothing else is on offer yet, so the leftover is taken provisionally",
      ).toBe(YESTERDAY);

      addThread({
        id: FRESH,
        title: "Today's task",
        updatedAtMs: 5_000,
        rollout: thinkingRollout("turn-1"),
      });
      await one.poke();

      expect(one.latest()?.sessionId).toBe(FRESH);
      expect(one.latest()?.summary).toBe("Today's task");
    } finally {
      one.stop();
    }
  });

  it("ignores a codex kolu does not own that appears in the same directory", async () => {
    seedThreads([
      {
        id: YESTERDAY,
        title: "Yesterday's task",
        updatedAtMs: 1_000,
        rollout: finishedRollout("turn-1"),
      },
    ]);
    const one = startTerminal(ONE_ID, 201);
    try {
      await one.poke();
      addThread({
        id: FRESH,
        title: "My own task",
        updatedAtMs: 5_000,
        rollout: thinkingRollout("turn-1"),
      });
      await one.poke();
      const before = one.latest();
      expect(
        before?.sessionId,
        "terminal one never reached its own thread",
      ).toBe(FRESH);

      addThread({
        id: FRESH_STRANGER,
        title: "Somebody else's task",
        updatedAtMs: 9_000,
        rollout: thinkingRollout("turn-1"),
      });
      await one.poke();

      expect(one.latest()?.sessionId).toBe(FRESH);
      expect(one.latest()?.summary).toBe("My own task");
      expect(one.latest()?.state).toBe(before?.state);
    } finally {
      one.stop();
    }
  });

  it("raises the alert on ONLY the terminal whose harness is blocked", async () => {
    seedThreads([
      THREAD_ONE_ROW,
      { ...THREAD_TWO_ROW, rollout: askingRollout() },
    ]);
    const one = startTerminal(ONE_ID, 201);
    const two = startTerminal(TWO_ID, 202);
    try {
      await one.poke();
      await two.poke();

      const rows: [TerminalId, AgentInfo | undefined][] = [
        [ONE_ID, one.latest()],
        [TWO_ID, two.latest()],
      ];
      const asking = rows
        .filter(([, agent]) => agent?.state === "awaiting_user")
        .map(([id]) => id);
      expect(asking, "exactly one harness is blocked on the user").toHaveLength(
        1,
      );

      const urgency = recomputeUrgency(
        new Map(rows.map(([id, agent]) => [id, activeRecord(agent)])),
        () => false,
      );
      expect(urgency.awaitingIds).toEqual(asking);
    } finally {
      one.stop();
      two.stop();
    }
  });
});
