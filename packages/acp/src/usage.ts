/**
 * The protocol's usage report, read as data.
 *
 * `usage_update` is ACP's own — it sits in the `SessionUpdate` union beside
 * `tool_call` and `config_option_update`, and any agent may send one — so it is
 * read HERE rather than in one of the ENGINE PLUGINS' legs
 * (`packages/plugins/<engine>/src/leg.ts`), which are the files for values only
 * one agent means
 * anything by. The boundary is not which payload a reader touches but who has
 * to have sent it.
 *
 * What it carries is two numbers ({@link Usage}) and, on the turn's last frame,
 * a cost this does not read. What this file adds is the one judgement between
 * the payload and the panel: WHETHER THERE IS ANYTHING TO SAY.
 *
 * PURE, and tested as such — the {@link ./diffs.ts} pattern, for the same
 * reason: a reading of somebody else's payload is a function over a value, not
 * a branch reachable only by talking a subprocess into sending one.
 */

import type { Usage } from "./wire.ts";

/**
 * The usage a report states, or `null` for one that states none.
 *
 * The refusals are all the same shape and all the same reason — a fraction is
 * only worth drawing when both halves of it are real:
 *
 *   - a `size` that is not POSITIVE is not a window. The adapter guards its own
 *     writes with `> 0` for the same reason (it has met third-party backends
 *     answering `0` and `NaN`), and a header reading `22k/0` would be inviting
 *     a person to do arithmetic on nonsense;
 *   - a non-integer, infinite or absent number on either side is somebody
 *     else's payload not saying what it claims to say;
 *   - a NEGATIVE `used` is the same, and `0` is not: a conversation that has
 *     spent nothing is a fact, and it is the fact every session opens on.
 *
 * `used` is deliberately NOT clamped to `size`. A report where it exceeds the
 * window is the agent telling us something surprising about the conversation,
 * and the surprise is the point — folding it down to a tidy 100% would hide
 * exactly the state a person most needs to see.
 */
export const usageIn = (update: unknown): Usage | null => {
  const report = update as {
    readonly used?: unknown;
    readonly size?: unknown;
  } | null;
  const used = report?.used;
  const size = report?.size;
  if (!Number.isSafeInteger(used) || !Number.isSafeInteger(size)) return null;
  if ((used as number) < 0 || (size as number) <= 0) return null;
  return { used: used as number, size: size as number };
};
