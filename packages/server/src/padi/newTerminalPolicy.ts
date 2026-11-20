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

export type NewTerminalPolicyClient = PadiCellClient<
  "newTerminalPolicy",
  NewTerminalPolicy
>;
export type NewTerminalPolicySession = PadiCellPushSession;
export type NewTerminalPolicyPool<S extends NewTerminalPolicySession> =
  PadiCellPushPool<S>;
export type NewTerminalPolicyPusher = PadiCellPusher;

export function installNewTerminalPolicyPusher<
  S extends NewTerminalPolicySession,
>(deps: {
  pool: NewTerminalPolicyPool<S>;
  resolvePolicyNow: () => NewTerminalPolicy;
  log: Logger;
}): NewTerminalPolicyPusher {
  return installPadiCellPusher({
    cell: "newTerminalPolicy",
    pool: deps.pool,
    getValue: deps.resolvePolicyNow,
    equals: newTerminalPolicyEqual,
    log: deps.log,
  });
}
