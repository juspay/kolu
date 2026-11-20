/** Plain-string identity for a terminal — what shows up in toasts and OS
 *  notifications. PR info, when resolved, rides as a description sub-line. */

import { activePr, type TerminalMetadata } from "@kolu/padi-client/surface";
import { prLabel } from "anyforge/schemas";
import type { TerminalDisplayInfo } from "./terminalDisplay";

export type TerminalSubject = { title: string; description?: string };

export function terminalSubject(
  info: TerminalDisplayInfo | undefined,
  meta: TerminalMetadata | undefined,
  fallback: string,
): TerminalSubject {
  if (!info) return { title: fallback };
  const { key } = info;
  const title = meta?.git
    ? `${key.group}/${key.label}${key.suffix ?? ""}`
    : key.label;
  const pr = meta ? activePr(meta) : null;
  if (pr) return { title, description: prLabel(pr) };
  return { title };
}
