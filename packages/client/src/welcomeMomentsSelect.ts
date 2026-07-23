/** Pure selection for the welcome-moments card.
 *
 *  Moments in priority order: Pin · Reach · Run agents · Search everything ·
 *  Add a host · Shortcuts. Done-predicates collapse into a muted header line;
 *  the card renders the first three still-undone moments. Run-agents, Search,
 *  and Shortcuts are never "done". */

export type WelcomeMomentId =
  | "pin"
  | "reach"
  | "agents"
  | "search"
  | "host"
  | "shortcuts";

export interface WelcomeMomentFlags {
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
  "pin",
  "reach",
  "agents",
  "search",
  "host",
  "shortcuts",
];

function isDone(id: WelcomeMomentId, flags: WelcomeMomentFlags): boolean {
  switch (id) {
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
    if (isDone(id, flags)) done.push(id);
    else undone.push(id);
  }
  return { done, rows: undone.slice(0, 3) };
}
