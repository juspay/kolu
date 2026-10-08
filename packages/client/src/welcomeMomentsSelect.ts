/** Selection for the welcome-moments card — pure, plus the one memo its
 *  first-run flag rides ({@link latchKnown}).
 *
 *  Moments in priority order: Choose your coding agents · Pin · From another
 *  device · Run agents · Search · Add another machine · Shortcuts.
 *  Done-predicates collapse into a muted header line; the card renders the
 *  first three still-undone moments. Run-agents, Search, and Shortcuts are
 *  never "done". The first-run agents choice leads, so it is the first row a
 *  new user reads; its done-predicate is `firstRunAgentsDone`
 *  (`@kolu/agent-distro/status`). */

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
  /** `undefined` while it is not known yet — preferences or the profile
   *  listing not arrived, or this machine's status not caught up with a chosen
   *  set (`firstRunAgentsDone`): the moment is then neither a row nor in the
   *  header, so a user who has chosen never sees it flash on a reload. Read
   *  through {@link latchKnown}, so a pick does not unmount the row while this
   *  machine catches up with it. */
  chooseAgentsDone: boolean | undefined;
  pinDone: boolean;
  reachDone: boolean;
  hostsDone: boolean;
}

export interface WelcomeMomentSelection {
  /** Moments that are done — collapsed into the header line, in order. */
  done: readonly WelcomeMomentId[];
  /** First three undone moments to render as full rows. */
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

/** Select which moments collapse into the header and which three rows paint. */
export function selectWelcomeMoments(
  flags: WelcomeMomentFlags,
): WelcomeMomentSelection {
  const done: WelcomeMomentId[] = [];
  const undone: WelcomeMomentId[] = [];
  for (const id of ORDER) {
    if (id === "chooseAgents" && flags.chooseAgentsDone === undefined) continue;
    if (isDone(id, flags)) done.push(id);
    else undone.push(id);
  }
  return { done, rows: undone.slice(0, 3) };
}

/** The last KNOWN reading of `read` — a `true` or `false` stays until the next
 *  `true` or `false`, and `undefined` ("not known yet") changes nothing. A
 *  fresh load starts with nothing known, so the moment stays hidden until it
 *  is (no reload flash); and a pick, which leaves this machine's status behind
 *  the choice for a moment, keeps the row it was made in instead of unmounting
 *  it (and its focus) and mounting it again when a download begins. */
export function latchKnown(
  read: Accessor<boolean | undefined>,
): Accessor<boolean | undefined> {
  return createMemo<boolean | undefined>((last) => read() ?? last);
}
