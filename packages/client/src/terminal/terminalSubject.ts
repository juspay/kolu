/** Plain-string identity for a terminal — what shows up in toasts and OS
 *  notifications when the agent finishes or the process exits. Prefers
 *  repo + the intent-first annotation label (or shortened cwd) over positional
 *  "Terminal N" so the alert text actually tells the user which terminal needs
 *  attention.
 *  PR info, when resolved, rides as a description sub-line. */

import { activePr } from "@kolu/padi/surface";
import { prLabel } from "anyforge/schemas";
import type { TerminalDisplayInfo } from "./terminalDisplay";

export type TerminalSubject = { title: string; description?: string };

export function terminalSubject(
  info: TerminalDisplayInfo | undefined,
  fallback: string,
): TerminalSubject {
  if (!info) return { title: fallback };
  const { meta, presentation } = info;
  const withGroup = meta.git || !!meta.intent;
  const title = withGroup
    ? `${presentation.group}/${presentation.label}${presentation.suffix ?? ""}`
    : `${presentation.label}${presentation.suffix ?? ""}`;
  const pr = activePr(meta);
  if (pr) return { title, description: prLabel(pr) };
  return { title };
}
