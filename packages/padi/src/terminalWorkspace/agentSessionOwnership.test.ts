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
import type { PadiTerminal } from "@kolu/padi-client/surface";
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
import { recomputeUrgency } from "../activity/urgency.ts";

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

/** A uuidv7 whose embedded creation time is `ms` — the only thing Codex records
 *  about when a thread came into being, and what tells a thread this terminal's
 *  harness created from one that was already lying in the directory. */
function uuidV7At(ms: number, tail: string): string {
  const hex = ms.toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-89ab-${tail}`;
}

/** The clock the fixture's threads are placed around. Threads stamped BEFORE a
 *  terminal's harness starts are leftovers from an earlier run; threads stamped
 *  after it are candidates for being that harness's own. */
const NOW = Date.now();
const YESTERDAY = uuidV7At(NOW - 86_400_000, "0123456789ab");
const FRESH = uuidV7At(NOW + 60_000, "0123456789ac");
const FRESH_STRANGER = uuidV7At(NOW + 90_000, "0123456789ad");

const SHELL_PID = 100;

const ONE_ID = "term-one" as TerminalId;
const TWO_ID = "term-two" as TerminalId;

/** The composed ACTIVE record padi's urgency fold reads — it takes only the
 *  `state` discriminant and the terminal's own `agent`, which is exactly the
 *  pair the sensors produce. */
function activeRecord(agent: AgentInfo | undefined): PadiTerminal {
  return { state: "active", agent: agent ?? null } as PadiTerminal;
}

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

/** A rollout JSONL whose tail parses to `awaiting_user` — an open
 *  `request_user_input` call, one of Codex's blocking tools. This is the state
 *  that earns a dock alert. */
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
const { startAgentSensor, freshAgentEngineState } = await import(
  "./sensors.ts"
);
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

function startTerminal(id: TerminalId, agentPid: number): Harness {
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
    freshAgentEngineState(),
    SHELL_PID,
    REPO,
    id,
    signals,
    undefined,
    (o) => emits.push(o),
    log,
    false,
  );
  // A fresh terminal sits at its shell, and kaval pushes a current foreground
  // snapshot on subscribe. Publishing it is what lets kolu WATCH the shell →
  // agent transition, which is the only transition it will date an episode from
  // (see `noteEpisode`): a sensor whose first sample already shows the agent is
  // an ADOPTED terminal and gets no episode clock at all.
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
    const one = startTerminal(ONE_ID, 201);
    const two = startTerminal(TWO_ID, 202);
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

  it("moves onto its OWN thread once it lands, not the leftover it grabbed first", async () => {
    // The ordinary single-terminal case, and the one a claim-and-keep rule gets
    // wrong: you type `codex` in a repo you have used codex in before. Codex
    // writes its thread row only after the first exchange, so at the moment kolu
    // first sees the harness the ONLY candidate in that directory is the
    // PREVIOUS run's thread. A terminal that keeps whatever it grabbed first
    // then shows yesterday's conversation for the whole run — and every later
    // run stays one conversation behind.
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

      // The harness finishes its first exchange and its own thread appears.
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
    // The reporter's second video: a `codex` run OUTSIDE kolu, in a directory
    // kolu has terminals in, writes the newest thread there. No second sensor —
    // so nothing has claimed it, and only stickiness stands between that thread
    // and this terminal's row. (The second-harness case above is carried by
    // exclusivity alone: the newcomer is already held by the time terminal one
    // asks.) The stranger's thread is stamped AFTER the episode, which is what
    // makes this test bite: a thread older than the episode would be refused by
    // the episode anchor without stickiness doing any work at all.
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
      // Its own thread lands, so the terminal is on a session it started.
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

      // A codex kolu does not own writes a NEWER thread in the same directory.
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
    // The issue's other half: "an unread/status alert associated with one
    // terminal adds the alert indicator to all terminal rows in that project".
    // Nothing in the alert path is per-project — `recomputeUrgency` reads each
    // terminal's OWN agent — so the fan-out was never a bug of its own: two
    // terminals sharing one session carry the same `awaiting_user`, and the
    // partition then honestly lists both. This drives the real sensors, folds
    // what they emit through the real partition, and pins that only the blocked
    // terminal is in `awaitingIds`. It goes red the moment sessions are shared
    // again, which is what the client-side unread pin cannot do.
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
      // WHICH terminal ends up on the asking thread is not the claim — with no
      // process id to go on, two harnesses starting at once can pair either way
      // (see `sessionOwnership.ts`). That exactly ONE of them is asking is.
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
      // The other terminal must be nowhere in the list the dock's unread mark
      // and the app badge are both read off.
      expect(urgency.awaitingIds).toEqual(asking);
    } finally {
      one.stop();
      two.stop();
    }
  });
});
