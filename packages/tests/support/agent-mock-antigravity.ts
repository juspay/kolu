/** Fixture builder for Antigravity CLI mock e2e tests.
 *
 *  Real `agy` keeps, under its app data directory:
 *    presence/<id>.lock — held OPEN by the `agy` process that has the
 *      conversation (the identity kolu reads from `/proc/<pid>/fd`)
 *    brain/<id>/.system_generated/logs/transcript.jsonl — appended, one JSON
 *      object a line, the last line naming the state
 *  These helpers synthesize the transcript; the fake `agy` process itself
 *  creates and holds the lock, as the real one does. Transitions are honest
 *  APPENDS — the append-robust watcher is the channel under test. Content is
 *  invented, in the shapes `agy` 1.5.19 writes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentLifecycleState } from "./agent-lifecycle.ts";

const CONVERSATION_ID = "00000000-0000-4000-8000-0000000000a9";

export interface AntigravityFixture {
  conversationId: string;
  lockPath: string;
  transcriptPath: string;
}

/** The on-disk layout, DUPLICATED from kolu-antigravity's `config.ts` on
 *  purpose: the fixture pins the real wire format — importing the producer
 *  would let a wrong path pass on both sides silently. */
export function antigravityFixturePaths(dir: string): AntigravityFixture {
  return {
    conversationId: CONVERSATION_ID,
    lockPath: path.join(dir, "presence", `${CONVERSATION_ID}.lock`),
    transcriptPath: path.join(
      dir,
      "brain",
      CONVERSATION_ID,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    ),
  };
}

let step = 0;

function line(fields: object): object {
  step += 1;
  return {
    step_index: step,
    status: "DONE",
    created_at: "2026-01-01T09:00:00Z",
    ...fields,
  };
}

const user = (): object =>
  line({
    source: "USER_EXPLICIT",
    type: "USER_INPUT",
    content: "<USER_REQUEST>\nmock prompt\n</USER_REQUEST>",
  });

const answer = (toolCall: boolean): object =>
  line({
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    model: "mock-model",
    input_tokens: 1200,
    cache_read_tokens: 3400,
    output_tokens: 42,
    ...(toolCall
      ? {
          tool_calls: [
            { name: "run_command", args: { CommandLine: '"echo mock"' } },
          ],
        }
      : { content: "mock reply" }),
  });

const toolResult = (): object =>
  line({ source: "MODEL", type: "GENERIC", content: "mock" });

/** The lines moving a transcript INTO `state`. */
function linesInto(state: AgentLifecycleState): object[] {
  switch (state) {
    case "thinking":
      return [user()];
    case "tool_use":
      return [answer(true)];
    case "waiting":
      return [toolResult(), answer(false)];
    case "awaiting_user":
      // Only the screen shows it — `agy`'s permission menu, while the
      // tool-calling answer is the transcript's last line.
      throw new Error(
        "antigravity has no awaiting_user line — only its screen shows it",
      );
  }
}

function append(file: string, lines: object[]): void {
  fs.appendFileSync(
    file,
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
}

/** Write a fresh transcript already in `state`. The lock is the fake process's
 *  to create. */
export function writeAntigravityTranscript(
  dir: string,
  state: AgentLifecycleState,
): AntigravityFixture {
  const fixture = antigravityFixturePaths(dir);
  fs.mkdirSync(path.dirname(fixture.transcriptPath), { recursive: true });
  fs.mkdirSync(path.dirname(fixture.lockPath), { recursive: true });
  fs.writeFileSync(fixture.transcriptPath, "");
  step = 0;
  const lines =
    state === "thinking"
      ? linesInto("thinking")
      : state === "tool_use"
        ? [user(), ...linesInto("tool_use")]
        : [user(), answer(true), ...linesInto(state)];
  append(fixture.transcriptPath, lines);
  return fixture;
}

/** Move the live transcript into a new state by APPENDING lines. */
export function updateAntigravityTranscript(
  fixture: AntigravityFixture,
  state: AgentLifecycleState,
): void {
  append(fixture.transcriptPath, linesInto(state));
}
