import { activeArm } from "@kolu/padi-client/surface";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import {
  type AgentStateTone,
  formatTaskProgress,
  stateLabels,
  stateTones,
  taskProgressTitle,
} from "../ui/agentDisplay";

/** The dot's paint, per agent tone — the same families the dock pip and the
 *  Inspector's status card use: rust working, violet needs-you, violet at half
 *  strength for an agent that has finished its turn, and the muted `fg-3` both
 *  for an agent that is only PRESENT (`starting` / `fresh`) and for a terminal
 *  with no agent at all. The two share a dot deliberately: neither is anything
 *  happening, and the WORDS beside it are what tell them apart. */
export const STATUS_DOT: Record<AgentStateTone | "none", string> = {
  busy: "bg-busy animate-pulse motion-reduce:animate-none",
  alert: "bg-alert",
  "alert-linger": "bg-alert/50",
  quiet: "bg-fg-3",
  none: "bg-fg-3",
};

/** The status line's words: what the terminal is, how far through its task
 *  list the agent in it says it is, and what it says it is doing (when it
 *  says anything). */
export interface TerminalStatus {
  readonly tone: keyof typeof STATUS_DOT;
  readonly state: string;
  /** HOW MANY OF ITS OWN TASKS ARE DONE — `7/12` and the sentence that says
   *  what the fraction counts — for an agent that reports a task list, and
   *  `null` for one that does not (most states, and every agent that keeps no
   *  list). The fraction is the formatter the tile's meta line and the
   *  Inspector's card already print, so the Conductor does not spell progress
   *  a second way.
   *
   *  It costs no reading of its own: it is on the record this line is already
   *  holding, which is what makes it drawable on the transcript's agent lines
   *  and on every watched row, in both placements, without a subscription per
   *  row. */
  readonly progress: { readonly text: string; readonly title: string } | null;
  readonly doing: string | null;
}

/** The terminal's live arm, when it has one — the ONE read of the standing
 *  both the words and the Look button derive from. Only an ACTIVE terminal
 *  has a screen: a sleeping one is in the roster but `screen.text` cannot
 *  read it, so "asleep" is a status with nothing behind it — like "terminal
 *  gone". */
export function liveArm(standing: FleetTerminalStanding) {
  return standing.kind === "here" ? activeArm(standing.meta) : undefined;
}

/** The status line's words for a terminal, read off the one standing reading. */
export function terminalStatus(
  standing: FleetTerminalStanding,
): TerminalStatus {
  switch (standing.kind) {
    case "gone":
      return {
        tone: "none",
        state: "terminal gone",
        progress: null,
        doing: null,
      };
    case "loading":
      return {
        tone: "none",
        state: "finding the terminal…",
        progress: null,
        doing: null,
      };
    case "unreachable":
      return {
        tone: "none",
        state: "its host is not connected",
        progress: null,
        doing: null,
      };
    case "here": {
      const arm = liveArm(standing);
      if (arm === undefined)
        return {
          tone: "none",
          state: "asleep",
          progress: null,
          doing: null,
        };
      const agent = arm.agent;
      if (agent !== null) {
        const tasks = agent.taskProgress;
        return {
          tone: stateTones[agent.state],
          state: stateLabels[agent.state] ?? agent.state,
          progress:
            tasks === null
              ? null
              : {
                  text: formatTaskProgress(tasks),
                  title: taskProgressTitle(tasks),
                },
          doing: agent.summary,
        };
      }
      const front = arm.foreground;
      if (front === null || front.shell)
        return {
          tone: "none",
          state: "no agent",
          progress: null,
          doing: "at the shell",
        };
      return {
        tone: "none",
        state: "no agent",
        progress: null,
        doing: `running ${front.name}`,
      };
    }
  }
}
