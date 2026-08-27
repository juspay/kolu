/** The three facts a row reads off ONE terminal record — taken from one read,
 *  returned together.
 *
 *  `agentState`, the status words, and the pull request are three independent
 *  derivations over the same `TerminalMetadata`, and every row surface needs all
 *  three. Spelled separately at a call site they are three chances to pair one
 *  terminal's words with another terminal's PR — the same class of mistake the
 *  needs-you strip's `{tile, blocked}` pair exists to prevent, one altitude
 *  down. Fused here, a row's facts come from one record by construction.
 *
 *  It is deliberately NOT the whole prop bag. The rest of the bag is either the
 *  consuming app's ambient state (which tile is active, what renders markdown,
 *  what the clock says) or its own display identity (the annotation line and its
 *  ink, which depend on a collision-aware key this package cannot compute). Those
 *  hoist to the call site by design; these three do not have to. */

import {
  activeArm,
  activePr,
  type TerminalMetadata,
} from "@kolu/padi-client/vocab";
import type { PrInfo } from "anyforge/schemas";
import { type RowSubline, rowSubline } from "./rowSubline.ts";

export type DockRowFacts = {
  /** `data-agent-state` — verbatim, or `undefined` for no live agent. */
  agentState: string | undefined;
  /** The status words on line 2, and whether they are an agent's. */
  subline: RowSubline;
  /** The row's pull request, or `null`. */
  pr: PrInfo | null;
};

export function dockRowFacts(meta: TerminalMetadata): DockRowFacts {
  return {
    agentState: activeArm(meta)?.agent?.state,
    subline: rowSubline(meta),
    pr: activePr(meta),
  };
}
