import { activeArm, type TerminalMetadata } from "@kolu/padi-client/vocab";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";

export const stateLabels: Record<AgentInfo["state"], string> = {
  thinking: "Thinking",
  tool_use: "Running tools",
  waiting: "Waiting for input",
  awaiting_user: "Awaiting input",
  running_background: "Running in background",
  starting: "Starting",
  fresh: "Ready",
  prompted: "Working",
};

export type RowSubline = {
  /** The words. `""` means "nothing to say" — render the invisible placeholder. */
  text: string;
  /** Are these an AGENT's words (rather than a foreground process title)? */
  fromAgent: boolean;
};

export function rowSubline(meta: TerminalMetadata): RowSubline {
  const arm = activeArm(meta);
  if (!arm) return { text: "", fromAgent: false };
  if (arm.agent) {
    return {
      text: arm.agent.summary ?? stateLabels[arm.agent.state],
      fromAgent: true,
    };
  }
  return {
    text: arm.foreground?.title ?? arm.foreground?.name ?? "",
    fromAgent: false,
  };
}
