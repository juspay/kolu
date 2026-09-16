/** The four facts a row reads off ONE terminal record — taken from one read,
 *  returned together.
 *
 *  The agent record (its state and its model), the status words, and the pull
 *  request are three derivations over the same `TerminalMetadata`, and every
 *  two-line row surface needs all four properties. Spelled separately at a call
 *  site they are four chances to pair one terminal's words with another
 *  terminal's PR — the same class of mistake the needs-you strip's
 *  `{tile, blocked}` pair exists to prevent, one altitude down. Fused here, a
 *  row's facts come from one record by construction.
 *
 *  The model rides here rather than being read again at the call site for the
 *  reason above, and because it is the same read: `activeArm` is resolved once
 *  for `agentState` and the agent's model is a field of the value in hand.
 *  `null` on the wire (the session has never named one) normalises to
 *  `undefined` — one absence, not two.
 *
 *  It is deliberately NOT the whole prop bag. The rest of the bag is either the
 *  consuming app's ambient state (which tile is active, what renders markdown,
 *  what the clock says) or its own display identity (the annotation line and its
 *  ink, which depend on a collision-aware key this package cannot compute). Those
 *  hoist to the call site by design; these four do not have to. */

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
  /** The model the live agent's SESSION is running, or `undefined` for no live
   *  agent / a session that has not named one. A session fact — see the producer
   *  note above. */
  model: string | undefined;
  /** The status words on line 2, and whether they are an agent's. */
  subline: RowSubline;
  /** The row's pull request, or `null`. */
  pr: PrInfo | null;
};

export function dockRowFacts(meta: TerminalMetadata): DockRowFacts {
  const arm = activeArm(meta);
  return {
    agentState: arm?.agent?.state,
    model: arm?.agent?.model ?? undefined,
    subline: rowSubline(meta),
    pr: activePr(meta),
  };
}
