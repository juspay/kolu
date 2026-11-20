import { type Accessor, createMemo } from "solid-js";

export type WelcomeMomentId =
  | "chooseAgents"
  | "pin"
  | "reach"
  | "agents"
  | "search"
  | "host"
  | "shortcuts";

export interface WelcomeMomentFlags {
  chooseAgentsDone: boolean | undefined;
  chooseAgentsDismissed: boolean;
  pinDone: boolean;
  reachDone: boolean;
  hostsDone: boolean;
}

export interface WelcomeMomentSelection {
  done: readonly WelcomeMomentId[];
  rows: readonly WelcomeMomentId[];
}

const ORDER: readonly WelcomeMomentId[] = [
  "chooseAgents",
  "pin",
  "reach",
  "agents",
  "search",
  "host",
  "shortcuts",
];

function isDone(id: WelcomeMomentId, flags: WelcomeMomentFlags): boolean {
  switch (id) {
    case "chooseAgents":
      return flags.chooseAgentsDone === true;
    case "pin":
      return flags.pinDone;
    case "reach":
      return flags.reachDone;
    case "host":
      return flags.hostsDone;
    case "agents":
    case "search":
    case "shortcuts":
      return false;
  }
}

export function selectWelcomeMoments(
  flags: WelcomeMomentFlags,
): WelcomeMomentSelection {
  const done: WelcomeMomentId[] = [];
  const undone: WelcomeMomentId[] = [];
  for (const id of ORDER) {
    if (
      id === "chooseAgents" &&
      (flags.chooseAgentsDone === undefined || flags.chooseAgentsDismissed)
    )
      continue;
    if (isDone(id, flags)) done.push(id);
    else undone.push(id);
  }
  return { done, rows: undone.slice(0, 3) };
}

export function latchKnown(
  read: Accessor<boolean | undefined>,
): Accessor<boolean | undefined> {
  return createMemo<boolean | undefined>((last) => read() ?? last);
}
