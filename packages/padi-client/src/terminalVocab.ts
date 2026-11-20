import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import type { PadiTerminal } from "./surface.ts";

/** The LIVE agent of a composed record, or `null` — only the `active` arm
 *  carries a running agent (`sleeping`/`parked` are dormant, their PTY
 *  released). */
export function activeAgent(v: PadiTerminal): AgentInfo | null {
  return v.state === "active" ? v.agent : null;
}

export {
  isWaitState,
  WAIT_STATES,
  type WaitState,
} from "@kolu/terminal-vocab/agentProjection";

/** The line a client reports when padi's link dropped mid-operation and nothing
 *  upstream said anything more specific. */
export const PADI_LINK_CLOSED =
  "the padi link closed — the daemon stopped or the connection dropped. Is kolu still running? (its padi serves the terminals)";
