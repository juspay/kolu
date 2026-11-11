/**
 * THE KOLU READING of a tool call — what turns a generic JSON card into one
 * that says *fix-parser · ~/code/kolu · claude* with an "open tile" that opens
 * one.
 *
 * MINTED ONLY FOR A CALL WE POSITIVELY NAME, which is the rule this file exists
 * to keep. A reading is attached when the call was recognised as belonging to
 * the `kolu` MCP server WE handed this session AND its tool is one of the five
 * below; everything else gets no reading and the generic card, which is the
 * direction this is safe to fail in. A card that claimed to be about terminal
 * `7f3e` because a tool name happened to contain `create` would put an "open
 * tile" button on somebody else's terminal.
 *
 * EVERY FIELD IS NULLABLE and every read is defensive, because an adapter is
 * free to send a call's input before the model has finished writing it (the
 * `rawInput: {}` frame) and to send no structured answer at all. A field this
 * end could not read is `null`, which the card draws as absent — never a
 * guess, and never an exception inside a protocol callback.
 */

import type { OrchestratorKoluCall } from "./rows.ts";

/** The tools the loop IS, by the names the `kolu` MCP face registers them
 *  under. The three ways of WAITING collapse to one reading, because they draw
 *  the same card: who, what state, how long, and the screen tail folded
 *  underneath. */
const READINGS: Readonly<Record<string, OrchestratorKoluCall["kind"]>> = {
  lifecycle_create: "create",
  lifecycle_sendInput: "sendInput",
  lifecycle_kill: "kill",
  wait_outputSettled: "settle",
  wait_agentState: "settle",
  watch_next: "settle",
  screen_text: "screen",
};

const stringAt = (
  value: unknown,
  ...keys: ReadonlyArray<string>
): string | null => {
  if (typeof value !== "object" || value === null) return null;
  for (const key of keys) {
    if (!(key in value)) continue;
    const found = (value as Record<string, unknown>)[key];
    if (typeof found === "string" && found !== "") return found;
  }
  return null;
};

const numberAt = (value: unknown, key: string): number | null => {
  if (typeof value !== "object" || value === null) return null;
  if (!(key in value)) return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "number" && Number.isFinite(found)
    ? Math.round(found)
    : null;
};

const objectAt = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null) return null;
  return key in value ? (value as Record<string, unknown>)[key] : null;
};

/**
 * One kolu call, read out of its input and its structured answer.
 *
 * `tool` is the PROGRAMMATIC name, already stripped of whatever prefix this
 * agent spells an MCP server's tools with — the caller does that, because which
 * prefix an agent uses is its leg's answer and not this file's.
 *
 * The answer is read where it says something the input does not: a `create`
 * learns the terminal's id only from what came back, and a `settle` learns the
 * state it stopped in and how long that took. A call still in flight has no
 * answer at all, which is why every one of those fields is nullable rather than
 * the whole reading being withheld until the call completes — the card is drawn
 * while the agent waits, which is exactly when somebody is looking at it.
 */
export const koluCallOf = (
  tool: string,
  input: unknown,
  answer: unknown,
): OrchestratorKoluCall | null => {
  const kind = READINGS[tool];
  if (kind === undefined) return null;
  // The id is on the INPUT for every call that acts on an existing terminal and
  // on the ANSWER for the one that makes a new one, so both are read and the
  // input wins — a `create` has none to contradict.
  const terminalId =
    stringAt(input, "id", "terminalId") ?? stringAt(answer, "id", "terminalId");
  const name = stringAt(input, "name");
  switch (kind) {
    case "create":
      return {
        kind,
        terminalId,
        name,
        cwd: stringAt(input, "cwd", "directory"),
        agent: stringAt(input, "agent"),
      };
    case "sendInput":
      // Exactly one of the two, as the tool itself requires: text is typed and
      // a key is a chord, and a call carrying both is one the face refuses.
      return {
        kind,
        terminalId,
        name,
        text: stringAt(input, "text"),
        key: stringAt(input, "key"),
      };
    case "kill":
      return { kind, terminalId, name };
    case "screen":
      return {
        kind,
        terminalId,
        name,
        snapshot:
          typeof answer === "string" ? answer : stringAt(answer, "text"),
      };
    case "settle": {
      // `{result, met: {agent|fired, elapsedMs, screen}}` — the shape all three
      // waiting calls answer in. A timeout answers the same envelope without a
      // `met`, and its own `elapsedMs`, so both are read.
      const met = objectAt(answer, "met");
      return {
        kind,
        terminalId,
        name,
        state: stringAt(met, "agent", "fired") ?? stringAt(answer, "result"),
        elapsedMs: numberAt(met, "elapsedMs") ?? numberAt(answer, "elapsedMs"),
        screenTail: stringAt(met, "screen"),
      };
    }
  }
};

/**
 * TWO READINGS OF ONE CALL, folded — because a frame refines and never
 * retracts.
 *
 * The adapter does not send a call's input and its answer on the same frame:
 * the arming `tool_call` carries `rawInput` and no result, and the settling
 * `tool_call_update` carries `rawOutput` and no input. So each frame's reading
 * knows half of what the card needs, and a card drawn from the LAST frame
 * alone would say nothing at all about a `lifecycle_create` — no name, no
 * directory, and no terminal to open — which is exactly what a real round
 * against the pinned adapter produced before this existed.
 *
 * Field-wise, keeping whichever reading HAS something: `null` is "no frame has
 * said yet", so a later frame's silence cannot take an earlier frame's word
 * back. A reading of a different KIND replaces rather than merges — the two
 * are not about the same thing, and the only way to see one is a call id
 * reused for a different tool, where the newer frame is the truth.
 */
export const refineKoluCall = (
  before: OrchestratorKoluCall | null,
  next: OrchestratorKoluCall | null,
): OrchestratorKoluCall | null => {
  if (before === null) return next;
  if (next === null) return before;
  if (before.kind !== next.kind) return next;
  const merged: Record<string, unknown> = { ...before };
  for (const [key, value] of Object.entries(next)) {
    if (value !== null) merged[key] = value;
  }
  return merged as unknown as OrchestratorKoluCall;
};

/**
 * THE FLEET, in first-touch order.
 *
 * Membership and nothing else: every terminal this conversation has CREATED or
 * SENT INPUT TO. Live state for each is read from padi's `terminals`
 * collection, never remembered here, because a mirror is a second source of
 * truth that goes stale the moment somebody resizes a tile.
 *
 * Reading and waiting do NOT join it, which is the line this draws: a `watch_next`
 * over the whole fleet names every terminal on the host, and an orchestrator
 * that once looked at somebody else's terminal has not taken it over.
 */
export class Fleet {
  #order: Array<string> = [];

  /** Whether this call put a new terminal in. Answered so the caller can
   *  publish state only when something actually moved. */
  touch(call: OrchestratorKoluCall): boolean {
    if (call.kind !== "create" && call.kind !== "sendInput") return false;
    const id = call.terminalId;
    if (id === null || this.#order.includes(id)) return false;
    this.#order.push(id);
    return true;
  }

  ids(): ReadonlyArray<string> {
    return this.#order;
  }

  /** The conversation was replaced. The terminals live on — padi owns them —
   *  but THIS conversation has touched none of them. */
  clear(): void {
    this.#order = [];
  }
}
