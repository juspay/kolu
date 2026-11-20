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
