/** Plain-string identity for a terminal — what shows up in toasts and OS
 *  notifications when the agent finishes or the process exits. Prefers
 *  repo/branch (or shortened cwd) over positional "Terminal N" so the
 *  alert text actually tells the user which terminal needs attention.
 *  PR info, when resolved, rides as a description sub-line. */

import { activePr, type TerminalMetadata } from "@kolu/padi-client/surface";
import { prLabel } from "anyforge/schemas";
import type { TerminalDisplayInfo } from "./terminalDisplay";

export type TerminalSubject = { title: string; description?: string };

export function terminalSubject(
  info: TerminalDisplayInfo | undefined,
  meta: TerminalMetadata | undefined,
  fallback: string,
): TerminalSubject {
  // Best-effort NOTIFICATION label (toast title / OS notification), not a canvas
  // render — so the two co-arriving reads gate asymmetrically ON PURPOSE. `info`
  // (the identity key) is the floor: no key, no meaningful label, so fall back.
  // `meta` only ENRICHES (git-qualified group/label + a PR sub-line); it can be
  // legitimately absent while the terminal tears down as its exit toast fires, and
  // a bare `key.label` is a correct notification then — degrading a label is not the
  // swallowed-error the fail-fast rule forbids. The canvas consumers (TerminalMeta,
  // buildWorkspaceEntries) require BOTH because a half-rendered tile is NOT correct.
  if (!info) return { title: fallback };
  const { key } = info;
  const title = meta?.git
    ? `${key.group}/${key.label}${key.suffix ?? ""}`
    : key.label;
  const pr = meta ? activePr(meta) : null;
  if (pr) return { title, description: prLabel(pr) };
  return { title };
}
