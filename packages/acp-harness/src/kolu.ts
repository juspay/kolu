/**
 * THE KOLU READING of a tool call — what turns a generic JSON card into one
 * that says *fix-parser · ~/code/kolu · claude* with an "open tile" that opens
 * one.
 *
 * MINTED ONLY FOR A CALL WE POSITIVELY NAME, which is the rule this file exists
 * to keep. A reading is attached when the call was recognised as belonging to
 * the `kolu` MCP server WE handed this session AND its tool is one of the
 * seven below; everything else gets no reading and the generic card, which is
 * the direction this is safe to fail in. A card that claimed to be about
 * terminal `7f3e` because a tool name happened to contain `create` would put
 * an "open tile" button on somebody else's terminal.
 *
 * EVERY FIELD IS NULLABLE and every read is defensive, because an adapter is
 * free to send a call's input before the model has finished writing it (the
 * `rawInput: {}` frame) and to send no structured answer at all. A field this
 * end could not read is `null`, which the card draws as absent — never a
 * guess, and never an exception inside a protocol callback.
 *
 * A READING ENCODES, WHATEVER THE AGENT WROTE. Every row this file contributes
 * to is persisted and served through the contract's row schema, which CHECKS
 * two of these fields: `terminalId` is a UUID and `elapsedMs` a safe integer.
 * A value that fails either is not a bad card — it is a transcript that no
 * longer encodes, on every open and after every restart, which is how a
 * `watch_next` subscription NAME read as a terminal id took the Conductor
 * down. So no reader below can set the subject itself (see {@link Reading});
 * only {@link subjectOf} can, and it applies the wire's own check.
 */

import { isTerminalId } from "@kolu/terminal-vocab/terminalId";
import { fleetTerminalRef, splitFleetTerminalRef } from "kolu-mcp/fleetRef";
import type { ConductorKoluCall } from "./rows.ts";

type Kind = ConductorKoluCall["kind"];

/** WHICH TERMINAL a card is about — both halves of its identity, set together
 *  or not at all, which is what the contract states and the card relies on:
 *  it opens a tile only with both. */
type Subject = Pick<ConductorKoluCall, "terminalId" | "host">;

/** What one tool's reader may say: every field of its arm EXCEPT the subject,
 *  which it may not even spell — `?: never` rather than a bare `Omit`, because
 *  an omitted key is only an EXCESS property, and TypeScript does not check
 *  excess properties on an arrow's returned literal here. Distributive, so
 *  each kind keeps its own fields. */
type Said<K extends Kind> = K extends Kind
  ? Omit<Extract<ConductorKoluCall, { kind: K }>, "kind" | keyof Subject> & {
      readonly [Field in keyof Subject]?: never;
    }
  : never;

/**
 * HOW ONE TOOL IS READ — and the type that keeps every reader behind the gate.
 *
 * A reader says WHERE its tool's subject is (`ref`, the fleet reference
 * `host/id` as the call spelled it) and what else its card draws (`said`). It
 * cannot say the subject itself: {@link Said} types `terminalId` and `host`
 * as `never`, so the only way a string reaches those two fields is through
 * {@link subjectOf}. A future tool cannot forget the check by writing the
 * field directly; the compiler refuses the field.
 *
 * WHERE THE SUBJECT IS differs per tool, and assuming it is the call's `id`
 * is the mistake this shape exists to make impossible to repeat: a
 * `watch_next` call's `id` is its SUBSCRIPTION's name.
 */
interface Reading<K extends Kind> {
  readonly kind: K;
  readonly ref: (input: unknown, answer: unknown) => string | null;
  readonly said: (input: unknown, answer: unknown) => Said<K>;
}

type AnyReading = { [K in Kind]: Reading<K> }[Kind];

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

/** A whole number of milliseconds, or `null`. SAFE integers only, because
 *  that is what the wire's `Schema.Int` accepts: `1e300` is finite and rounds
 *  to itself, and a reading carrying it would not encode. */
const numberAt = (value: unknown, key: string): number | null => {
  if (typeof value !== "object" || value === null) return null;
  if (!(key in value)) return null;
  const found = (value as Record<string, unknown>)[key];
  if (typeof found !== "number") return null;
  const whole = Math.round(found);
  return Number.isSafeInteger(whole) ? whole : null;
};

const objectAt = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null) return null;
  return key in value ? (value as Record<string, unknown>)[key] : null;
};

const NO_SUBJECT: Subject = { terminalId: null, host: null };

/** THE GATE: a fleet reference becomes a card's subject only if its id half
 *  IS a terminal id — {@link isTerminalId}, the very check the row schema
 *  applies to `terminalId` when the row is encoded, so this and the encoder
 *  cannot disagree. Anything else is no subject at all, never half of one.
 *
 *  The ref is split by the fleet's own grammar ({@link splitFleetTerminalRef})
 *  — at the LAST `/`, because a remote's host key may itself contain one — and
 *  by its NON-THROWING half, because a tool call's args are whatever the model
 *  wrote and a half-written ref must read as nothing rather than throw inside
 *  a protocol callback. A bare id with no host is no subject either: the fleet
 *  face this session is handed spells every terminal `host/id`, and a card
 *  that knew the id but not the host would have nowhere to open it. */
const subjectOf = (ref: string | null): Subject => {
  if (ref === null) return NO_SUBJECT;
  const split = splitFleetTerminalRef(ref);
  if (split === null || !isTerminalId(split.id)) return NO_SUBJECT;
  return { terminalId: split.id, host: split.host };
};

/** The terminal a call that names ONE in its `id` is about — on the input,
 *  and echoed on the answer by the calls whose answer carries it, which is
 *  the only half the settling frame has. */
const idOfCall = (input: unknown, answer: unknown): string | null =>
  stringAt(input, "id") ?? stringAt(answer, "id");

/** `{id, result, met?, elapsedMs?}` — the envelope every waiting call answers
 *  in. `met` carries the condition that landed; a timeout, `gone` or `closed`
 *  answers without one, and `result` is then the state worth showing. The
 *  screen tail is NOT the envelope's: two of the three waits can carry one in
 *  `met`, and a `watch_next` drain never does, so each reader says its own. */
const waited = (
  answer: unknown,
  landed: string | null,
): Omit<Said<"settle">, "screenTail"> => ({
  // No waiting call names a terminal: the name a card draws is the
  // terminal's, and these carry only its ref.
  name: null,
  state: landed ?? stringAt(answer, "result"),
  elapsedMs:
    numberAt(objectAt(answer, "met"), "elapsedMs") ??
    numberAt(answer, "elapsedMs"),
});

/** The ONE terminal a drained `watch_next` batch is about, and its latest
 *  event — or `null` when there is no such terminal: a batch that timed out
 *  carries no events, and one whose events name several terminals is news
 *  about the fleet, which no single "open tile" can honestly answer. The
 *  events' `id`s are fleet refs; the subscription name in the envelope's own
 *  `id` is not a terminal and is never read as one. */
const soleWatched = (
  answer: unknown,
): { ref: string; latest: unknown } | null => {
  const events = objectAt(objectAt(answer, "met"), "events");
  if (!Array.isArray(events) || events.length === 0) return null;
  const refs = new Set(events.map((event) => stringAt(event, "id")));
  const [ref] = refs;
  if (refs.size !== 1 || ref === undefined || ref === null) return null;
  return { ref, latest: events[events.length - 1] };
};

/** The tools the loop IS, by the names the `kolu` MCP face registers them
 *  under, each read off the fields that tool really carries. The three ways
 *  of WAITING collapse to one kind, because they draw the same card: who,
 *  what state, how long, and the screen tail folded underneath — but each
 *  says where ITS subject and state are. */
const READINGS: Readonly<Record<string, AnyReading>> = {
  lifecycle_create: {
    kind: "create",
    // It has no terminal until it answers. The input names the HOST to create
    // on and, in `placement.parentId`, a DIFFERENT terminal; the answer's `id`
    // is the new one's ref.
    ref: (_input, answer) => stringAt(answer, "id"),
    said: (input, answer) => ({
      // The canvas label the agent gave it, else the branch it was cut on.
      name: stringAt(input, "intent", "worktree"),
      // Where it opened: the directory asked for, or the worktree made for it.
      cwd:
        stringAt(input, "cwd") ??
        stringAt(objectAt(answer, "worktree"), "path"),
      // The command typed at its first prompt (`run`) — `claude`, typically.
      agent: stringAt(input, "run") ?? stringAt(answer, "ran"),
    }),
  },
  lifecycle_sendInput: {
    kind: "sendInput",
    ref: idOfCall,
    // Exactly one of the two, as the tool itself requires: text is typed and
    // a key is a chord, and a call carrying both is one the face refuses.
    said: (input) => ({
      name: null,
      text: stringAt(input, "text"),
      key: stringAt(input, "key"),
    }),
  },
  lifecycle_kill: {
    kind: "kill",
    ref: idOfCall,
    said: () => ({ name: null }),
  },
  screen_text: {
    kind: "screen",
    ref: idOfCall,
    said: (_input, answer) => ({
      name: null,
      snapshot: typeof answer === "string" ? answer : stringAt(answer, "text"),
    }),
  },
  wait_outputSettled: {
    kind: "settle",
    ref: idOfCall,
    // `met: {fired: "idle", elapsedMs, screen?}`.
    said: (_input, answer) => {
      const met = objectAt(answer, "met");
      return {
        ...waited(answer, stringAt(met, "fired")),
        screenTail: stringAt(met, "screen"),
      };
    },
  },
  wait_agentState: {
    kind: "settle",
    ref: idOfCall,
    // `met: {agent, elapsedMs, screen?}` — `agent` is the whole AgentInfo, and
    // the state worth showing is the one it was caught in.
    said: (_input, answer) => {
      const met = objectAt(answer, "met");
      return {
        ...waited(answer, stringAt(objectAt(met, "agent"), "state")),
        screenTail: stringAt(met, "screen"),
      };
    },
  },
  watch_next: {
    kind: "settle",
    // NOT the call's `id`: that is the subscription's name, on the input as
    // `name` and echoed in the answer's `id` slot.
    ref: (_input, answer) => soleWatched(answer)?.ref ?? null,
    // The latest event's word when the batch is about one terminal — a state
    // report's bucket (`waiting`) or a settle edge's kind (`finished`) — and
    // otherwise the envelope's own `result` (`timeout`, `met`). No screen:
    // a drain carries none.
    said: (_input, answer) => {
      const sole = soleWatched(answer);
      return {
        ...waited(
          answer,
          sole === null ? null : stringAt(sole.latest, "state", "kind"),
        ),
        screenTail: null,
      };
    },
  },
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
  const reading = READINGS[tool];
  if (reading === undefined) return null;
  // The one place a reading's arm is assembled, and the cast it needs: TS
  // cannot follow `reading.kind` and `reading.said`'s return as the SAME `K`
  // through the union, but `Reading<K>` binds them, and `Said<K>` plus the
  // subject plus `kind` is that arm field for field. The subject is spread
  // LAST, so even a reader cast past `Said` cannot outvote the gate.
  return {
    kind: reading.kind,
    ...reading.said(input, answer),
    ...subjectOf(reading.ref(input, answer)),
  } as ConductorKoluCall;
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
