import { isTerminalId } from "@kolu/terminal-vocab/terminalId";
import { fleetTerminalRef, splitFleetTerminalRef } from "kolu-mcp/fleetRef";
import type { ConductorKoluCall } from "kolu-common/conductor";

type Kind = ConductorKoluCall["kind"];

type Subject = Pick<ConductorKoluCall, "terminalId" | "host">;

type Said<K extends Kind> = K extends Kind
  ? Omit<Extract<ConductorKoluCall, { kind: K }>, "kind" | keyof Subject> & {
      readonly [Field in keyof Subject]?: never;
    }
  : never;

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

const subjectOf = (ref: string | null): Subject => {
  if (ref === null) return NO_SUBJECT;
  const split = splitFleetTerminalRef(ref);
  if (split === null || !isTerminalId(split.id)) return NO_SUBJECT;
  return { terminalId: split.id, host: split.host };
};

const idOfCall = (input: unknown, answer: unknown): string | null =>
  stringAt(input, "id") ?? stringAt(answer, "id");

const waited = (
  answer: unknown,
  landed: string | null,
): Omit<Said<"settle">, "screenTail"> => ({
  name: null,
  state: landed ?? stringAt(answer, "result"),
  elapsedMs:
    numberAt(objectAt(answer, "met"), "elapsedMs") ??
    numberAt(answer, "elapsedMs"),
});

const READINGS: Readonly<Record<string, AnyReading>> = {
  lifecycle_create: {
    kind: "create",

    ref: (_input, answer) => stringAt(answer, "id"),
    said: (input, answer) => ({
      name: stringAt(input, "intent", "worktree"),

      cwd:
        stringAt(input, "cwd") ??
        stringAt(objectAt(answer, "worktree"), "path"),

      agent: stringAt(input, "run") ?? stringAt(answer, "ran"),
    }),
  },
  lifecycle_sendInput: {
    kind: "sendInput",
    ref: idOfCall,

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

    said: (_input, answer) => {
      const met = objectAt(answer, "met");
      return {
        ...waited(answer, stringAt(met, "fired")),
        screenTail: stringAt(met, "screen"),
      };
    },
  },
  agent_say: {
    kind: "say",
    ref: idOfCall,

    said: (input) => ({ name: null, text: stringAt(input, "text") }),
  },

  work_adopt: {
    kind: "watch",
    ref: idOfCall,
    said: () => ({ name: null, watching: true }),
  },
  work_leave: {
    kind: "watch",
    ref: idOfCall,
    said: () => ({ name: null, watching: false }),
  },
};

export const koluCallOf = (
  tool: string,
  input: unknown,
  answer: unknown,
): ConductorKoluCall | null => {
  const reading = READINGS[tool];
  if (reading === undefined) return null;
  return {
    kind: reading.kind,
    ...reading.said(input, answer),
    ...subjectOf(reading.ref(input, answer)),
  } as ConductorKoluCall;
};

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

export class Fleet {
  #order: Array<string>;

  constructor(remembered: ReadonlyArray<string> = []) {
    this.#order = [...new Set(remembered)];
  }

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

  clear(): void {
    this.#order = [];
  }
}
