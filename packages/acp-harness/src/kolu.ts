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

import { fleetTerminalRef, splitFleetTerminalRef } from "kolu-mcp/fleetRef";
import type { ConductorKoluCall } from "./rows.ts";

/** The tools the loop IS, by the names the `kolu` MCP face registers them
 *  under. The three ways of WAITING collapse to one reading, because they draw
 *  the same card: who, what state, how long, and the screen tail folded
 *  underneath. */
const READINGS: Readonly<Record<string, ConductorKoluCall["kind"]>> = {
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

/** WHO a call is about, as the FLEET spells it: a terminal is `host/id` now,
 *  one conversation covering every host.
 *
 *  The host key of a remote can itself contain a `/`, so a ref is split at the
 *  LAST one — by the fleet's own splitter ({@link splitFleetTerminalRef}),
 *  which is the single place in the tree that knows the grammar.
 *
 *  The NON-THROWING half of that grammar, deliberately: a tool call's args are
 *  whatever the model wrote, and an adapter sends them before the model has
 *  finished writing them, so a half-written ref must read as an absent host
 *  rather than throw inside a protocol callback (this module's standing rule).
 *
 *  `lifecycle_create` is the one call that names its host in its OWN `host`
 *  field — it has no terminal yet to carry one — and learns the terminal from
 *  its answer, which is already a ref. */
const whoOf = (
  input: unknown,
  answer: unknown,
): { host: string | null; terminalId: string | null } => {
  const ref =
    stringAt(input, "id", "terminalId") ?? stringAt(answer, "id", "terminalId");
  const split = ref === null ? null : splitFleetTerminalRef(ref);
  if (split === null) return { host: stringAt(input, "host"), terminalId: ref };
  return { host: split.host, terminalId: split.id };
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
): ConductorKoluCall | null => {
  const kind = READINGS[tool];
  if (kind === undefined) return null;
  // The ref is on the INPUT for every call that acts on an existing terminal
  // and on the ANSWER for the one that makes a new one, so both are read and
  // the input wins — a `create` has none to contradict. `whoOf` splits it into
  // the pair a card draws: which host, which terminal.
  const { host, terminalId } = whoOf(input, answer);
  const name = stringAt(input, "name");
  switch (kind) {
    case "create":
      return {
        kind,
        terminalId,
        host,
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
        host,
        name,
        text: stringAt(input, "text"),
        key: stringAt(input, "key"),
      };
    case "kill":
      return { kind, terminalId, host, name };
    case "screen":
      return {
        kind,
        terminalId,
        host,
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
        host,
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
  before: ConductorKoluCall | null,
  next: ConductorKoluCall | null,
): ConductorKoluCall | null => {
  if (before === null) return next;
  if (next === null) return before;
  if (before.kind !== next.kind) return next;
  const merged: Record<string, unknown> = { ...before };
  for (const [key, value] of Object.entries(next)) {
    if (value !== null) merged[key] = value;
  }
  return merged as unknown as ConductorKoluCall;
};

/**
 * THE FLEET, in first-touch order — as REFS, `host/id`.
 *
 * Membership and nothing else: every terminal this conversation has CREATED or
 * SENT INPUT TO, on whichever host it lives. Live state for each is read from
 * that host's `terminals` collection, never remembered here, because a mirror
 * is a second source of truth that goes stale the moment somebody resizes a
 * tile.
 *
 * Reading and waiting do NOT join it, which is the line this draws: a
 * `watch_next` over the whole fleet names every terminal on every host, and an
 * conductor that once looked at somebody else's terminal has not taken it
 * over.
 */
export class Fleet {
  #order: Array<string>;

  /**
   * A RESUMED conversation starts with the fleet its caller remembered. The
   * frames that would otherwise re-establish membership are the replay, and
   * the replay is history the caller already holds — so a fleet that could
   * only accrue would come back empty and be persisted empty.
   *
   * De-duplicated on the way in because first-touch order with no repeats is
   * what every reader of {@link ids} is handed, and a record written by an
   * older shape must not be able to put the same tile on screen twice.
   */
  constructor(remembered: ReadonlyArray<string> = []) {
    this.#order = [...new Set(remembered)];
  }

  /** Whether this call put a new terminal in. Answered so the caller can
   *  publish state only when something actually moved.
   *
   *  BOTH HALVES OR NOTHING: a member is a ref, and a call whose args were
   *  still half-written (no host, or no terminal) names nothing anybody could
   *  open. It is dropped rather than remembered as a bare id the fleet grammar
   *  has no row for — the refining frame that completes the call puts it in. */
  touch(call: ConductorKoluCall): boolean {
    if (call.kind !== "create" && call.kind !== "sendInput") return false;
    if (call.host === null || call.terminalId === null) return false;
    const ref = fleetTerminalRef(call.host, call.terminalId);
    if (this.#order.includes(ref)) return false;
    this.#order.push(ref);
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
