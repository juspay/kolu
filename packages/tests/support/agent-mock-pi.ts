/** Fixture builder for Pi mock e2e tests.
 *
 *  Real pi writes `<PI_DIR>/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl` — an
 *  append-only JSONL transcript whose tail names the state. These helpers
 *  synthesize the same on-disk artefact so scenarios drive the Pi adapter
 *  without the real CLI: a fresh file per scenario, then honest APPENDS for
 *  each transition (never a rewrite — the append-robust watcher is the
 *  channel under test).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentLifecycleState } from "./agent-lifecycle.ts";

const SESSION_ID = "00000000-0000-7000-8000-000000000000ca7";

/** Encode a cwd to pi's session-directory key. DUPLICATED from kolu-pi's
 *  `sessionDirNameFor` on purpose: the fixture pins the REAL on-disk wire
 *  format — importing the producer would let a wrong rename pass on both
 *  sides silently. Duplication here is the test of the contract. */
function sessionDirName(cwd: string): string {
  return `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`;
}

export interface PiFixture {
  transcriptPath: string;
  sessionId: string;
}

function userEntry(id: string): object {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-08-23T15:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "mock prompt" }] },
  };
}

function assistantEntry(id: string, stopReason: string): object {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-08-23T15:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "mock reply" }],
      model: "mock-model-1",
      usage: {
        input: 1200,
        output: 42,
        cacheRead: 3400,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: 4642,
      },
      stopReason,
    },
  };
}

function toolResultEntry(id: string): object {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-08-23T15:00:02.000Z",
    message: {
      role: "toolResult",
      toolCallId: `bash:${id}`,
      toolName: "bash",
      content: [{ type: "text", text: "ok" }],
      isError: false,
    },
  };
}

/** The entry sequence that STARTS a transcript already in `state`. */
function initialLines(state: AgentLifecycleState): object[] {
  const header = {
    type: "session",
    version: 3,
    id: SESSION_ID,
    timestamp: "2026-08-23T15:00:00.000Z",
    cwd: "/irrelevant",
  };
  switch (state) {
    case "thinking":
      return [header, userEntry("u1")];
    case "tool_use":
      return [header, userEntry("u1"), assistantEntry("a1", "toolUse")];
    case "waiting":
      return [
        header,
        userEntry("u1"),
        assistantEntry("a1", "toolUse"),
        toolResultEntry("r1"),
        assistantEntry("a2", "stop"),
      ];
    case "awaiting_user":
      // Pi has no on-disk awaiting state — the schema's state literals carry
      // no `awaiting_user` at all. A scenario asking for it is authoring
      // fiction; fail the build of the fixture, loudly.
      throw new Error(
        "pi has no awaiting_user state — pi transcripts cannot express it",
      );
  }
}

/** The appended entries moving a LIVE transcript INTO `state` (ids keep
 *  colliding with earlier lines — real pi ids are unique hex, so stagger
 *  ours with a counter). */
function transitionLines(state: AgentLifecycleState, n: number): object[] {
  switch (state) {
    case "thinking":
      return [userEntry(`u${n}`)];
    case "tool_use":
      return [userEntry(`u${n}`), assistantEntry(`a${n}`, "toolUse")];
    case "waiting":
      return [toolResultEntry(`r${n}`), assistantEntry(`a${n}b`, "stop")];
    case "awaiting_user":
      throw new Error("pi has no awaiting_user state");
  }
}

/** Create the session tree under `piDir` with a transcript already in
 *  `state`. Idempotent per cwd: rewrites the tree from scratch — scenarios
 *  start each other's states cleanly. */
export function writePiFixture(opts: {
  piDir: string;
  cwd: string;
  state: AgentLifecycleState;
}): PiFixture {
  const dir = path.join(opts.piDir, "sessions", sessionDirName(opts.cwd));
  fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(
    dir,
    `2026-08-23T15-00-00-000Z_${SESSION_ID}.jsonl`,
  );
  fs.writeFileSync(
    transcriptPath,
    `${initialLines(opts.state)
      .map((l) => JSON.stringify(l))
      .join("\n")}\n`,
  );
  return { transcriptPath, sessionId: SESSION_ID };
}

let transitionCounter = 0;

/** Move the live transcript into a new state by APPENDING entries — the
 *  honest production channel: no rewrite, no mtime-only nudge. */
export function updatePiFixture(
  fixture: PiFixture,
  state: AgentLifecycleState,
): void {
  transitionCounter += 1;
  const lines = transitionLines(state, transitionCounter);
  fs.appendFileSync(
    fixture.transcriptPath,
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
}
