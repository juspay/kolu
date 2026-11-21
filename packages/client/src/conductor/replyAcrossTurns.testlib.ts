/** A REPLY STILL BEING WRITTEN WHEN THE NEXT MESSAGE IS SENT (#2420) — the
 *  rows the harness really writes for it, as kolu's rows.
 *
 *  COPIED from `packages/acp-harness/src/harness.test.ts`, "every row says
 *  which message it answers, and a message sent behind a running turn does
 *  not cut its reply", which pins the same list (id, kind, text, `turn`) off
 *  a really spawned agent. Message A is about one work and message B about
 *  another, the way kolu's Conductor sends a message that names a work. B is
 *  written while A's reply is still going, so `seq` puts B BEFORE the rest of
 *  A's reply; only `turn` says which message each row answers. */

import type { ConductorRow } from "kolu-common/conductor";
import type { WorkId } from "kolu-work";

export const WORK_OF_A: WorkId = "branch:local/%2Fr/a";
export const WORK_OF_B: WorkId = "branch:local/%2Fr/b";

export const at = (minute: number): string =>
  new Date(Date.UTC(2026, 10, 21, 9, minute)).toISOString();

const head = (id: string, seq: number, turn?: string) => ({
  id,
  seq,
  since: at(seq),
  ...(turn === undefined ? {} : { turn }),
});

const message = (
  id: string,
  seq: number,
  text: string,
  work: WorkId,
  queued: boolean,
): ConductorRow => ({
  ...head(id, seq),
  kind: "user",
  text,
  attachments: [],
  mentions: [{ kind: "work", work, title: work }],
  ...(queued ? { queued: true as const } : {}),
});

const said = (
  id: string,
  seq: number,
  text: string,
  turn: string,
  streaming = false,
): ConductorRow => ({
  ...head(id, seq, turn),
  kind: "agent",
  text,
  ...(streaming ? { streaming: true as const } : {}),
});

const CALL: ConductorRow = {
  ...head("tool:call-of-A", 4, "user:1"),
  kind: "tool",
  text: "a call the first turn made",
  status: "completed",
};

/** B has been sent, and A's reply has gone on above it: B is still `queued`. */
export const WHILE_B_WAITS: readonly ConductorRow[] = [
  message("user:1", 1, "talkingSlow", WORK_OF_A, false),
  said("agent:2", 2, "A-reply-part-1 A-reply-part-2", "user:1"),
  message("user:3", 3, "hello", WORK_OF_B, true),
  CALL,
  said("agent:4", 5, "A-reply-part-3", "user:1", true),
];

/** ... the moment B is sent, before A has written anything more. */
export const B_JUST_SENT: readonly ConductorRow[] = [
  message("user:1", 1, "talkingSlow", WORK_OF_A, false),
  said("agent:2", 2, "A-reply-part-1 ", "user:1", true),
  message("user:3", 3, "hello", WORK_OF_B, true),
];

/** Both turns over. */
export const AT_THE_END: readonly ConductorRow[] = [
  message("user:1", 1, "talkingSlow", WORK_OF_A, false),
  said("agent:2", 2, "A-reply-part-1 A-reply-part-2", "user:1"),
  message("user:3", 3, "hello", WORK_OF_B, false),
  CALL,
  said("agent:4", 5, "A-reply-part-3", "user:1"),
  said("agent:5", 6, "hello back", "user:3"),
];
