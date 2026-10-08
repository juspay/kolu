/**
 * Push the RESOLVED new-terminal theme policy into every bound padi.
 *
 * padi decides a new terminal's theme (inherit the active one, or shuffle against its
 * own peers) so that EVERY face gets the user's preference — the browser, the CLI, and
 * the MCP agent alike (#2045). But padi knows nothing about preferences: the policy is
 * derived here, from kolu-server's `preferences` + `viewerMode` cells
 * (`currentNewTerminalPolicy` in `../surface.ts`), and pushed into padi's
 * `newTerminalPolicy` cell as a resolved fact. The push mechanism — connect edge,
 * reconnect re-prime, per-link dedup, loud-but-contained failure — is
 * `./padiCellPusher.ts`, shared with the Agents setting.
 */

import type { Logger } from "@kolu/log";
import {
  type NewTerminalPolicy,
  newTerminalPolicyEqual,
} from "kolu-common/surface";
import {
  installPadiCellPusher,
  type PadiCellClient,
  type PadiCellPusher,
  type PadiCellPushPool,
  type PadiCellPushSession,
} from "./padiCellPusher.ts";

/** The client slice a policy push calls — padi's `newTerminalPolicy.set`. */
export type NewTerminalPolicyClient = PadiCellClient<
  "newTerminalPolicy",
  NewTerminalPolicy
>;
export type NewTerminalPolicySession = PadiCellPushSession;
export type NewTerminalPolicyPool<S extends NewTerminalPolicySession> =
  PadiCellPushPool<S>;
export type NewTerminalPolicyPusher = PadiCellPusher;

/** Install the policy pusher over the warm padi pool. See `./padiCellPusher.ts`. */
export function installNewTerminalPolicyPusher<
  S extends NewTerminalPolicySession,
>(deps: {
  pool: NewTerminalPolicyPool<S>;
  /** The resolved policy, re-read on EVERY push so a member that connects late gets
   *  today's answer rather than the one that held when this was installed. */
  getPolicy: () => NewTerminalPolicy;
  log: Logger;
}): NewTerminalPolicyPusher {
  return installPadiCellPusher({
    cell: "newTerminalPolicy",
    pool: deps.pool,
    getValue: deps.getPolicy,
    equals: newTerminalPolicyEqual,
    log: deps.log,
  });
}
