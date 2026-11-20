import { CONTAINING_TERMINAL_ENV } from "kolu-pty";
import { isTerminalId, type TerminalId } from "@kolu/terminal-vocab/schema";

export { CONTAINING_TERMINAL_ENV };

/** What `$KAVAL_TERMINAL_ID` names, if anything. `none` is "not inside a kolu
 *  terminal"; `invalid` is a stamp that is not a terminal id, refused rather
 *  than guessed at. */
export type ContainingTerminal =
  | { readonly kind: "none" }
  | { readonly kind: "ok"; readonly id: TerminalId }
  | { readonly kind: "invalid"; readonly raw: string };

export function containingTerminalId(
  env: { readonly [key: string]: string | undefined } = process.env,
): ContainingTerminal {
  const raw = env[CONTAINING_TERMINAL_ENV];
  if (raw === undefined || raw === "") return { kind: "none" };
  return isTerminalId(raw) ? { kind: "ok", id: raw } : { kind: "invalid", raw };
}

/** The stamp resolved against a FLEET: the three arms above plus a stamp naming
 *  a terminal this padi does not own. `stray` is a FACT, never a sentence —
 *  each face says it in its own grammar. */
export type FleetTerminal =
  | ContainingTerminal
  | { readonly kind: "stray"; readonly id: TerminalId };

/** Is the stamped terminal one THIS padi owns? Answered from the ROSTER, so a
 *  `--socket` aimed at another padi on the same machine, or a stamp re-keyed by
 *  a daemon restart, reads as `stray`. */
export function confirmInFleet(
  found: ContainingTerminal,
  live: readonly TerminalId[],
): FleetTerminal {
  if (found.kind !== "ok" || live.includes(found.id)) return found;
  return { kind: "stray", id: found.id };
}
