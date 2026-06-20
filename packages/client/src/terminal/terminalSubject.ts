/** Plain-string identity for a terminal — what shows up in toasts and OS
 *  notifications when the agent finishes or the process exits. Prefers
 *  repo/branch (or shortened cwd) over positional "Terminal N" so the
 *  alert text actually tells the user which terminal needs attention.
 *  PR info, when resolved, rides as a description sub-line. */

import { prLabel, prValue } from "anyforge/schemas";
import { activeArm } from "kolu-common/surface";
import type { TerminalDisplayInfo } from "./terminalDisplay";

export type TerminalSubject = { title: string; description?: string };

export function terminalSubject(
  info: TerminalDisplayInfo | undefined,
  fallback: string,
): TerminalSubject {
  if (!info) return { title: fallback };
  const { key, meta } = info;
  const title = meta.git
    ? `${key.group}/${key.label}${key.suffix ?? ""}`
    : key.label;
  const arm = activeArm(meta);
  const pr = arm && prValue(arm.pr);
  if (pr) return { title, description: prLabel(pr) };
  return { title };
}
