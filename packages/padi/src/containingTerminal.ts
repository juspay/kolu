/**
 * Which kolu terminal is this process running inside?
 *
 * The self-knowledge half of the spawn stamp: every kolu PTY is started with
 * `$KAVAL_TERMINAL_ID` set to its own terminal id (the name itself lives in
 * `kolu-pty`, beside the spawn-env policy that writes it), so anything running
 * inside one can name itself without being configured and without a stale
 * value to keep in sync.
 *
 * A module of its own, and not filed under a watch: `--ignore-self` is only the
 * first caller. "Which terminal am I in?" is also the question behind a
 * `create --parent "$KAVAL_TERMINAL_ID"` that stops shelling out, a `kill` that
 * refuses suicide, and a status line — none of which should have to reach into
 * a module about supervision knobs to ask it.
 *
 * It answers with a SUM, not a `TerminalId | undefined`: "not inside a kolu
 * terminal", "stamped with something that is not a terminal id", and — once a
 * roster is in hand — "stamped with an id this padi has never heard of" are
 * different facts a caller must be able to say different things about, and
 * collapsing them is how a garbled stamp becomes a silent guess.
 */

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

/** The stamp resolved against a FLEET: the three arms above plus the fourth
 *  fact of the same kind — a stamp naming a terminal this padi has never heard
 *  of. `stray` is what {@link confirmInFleet} adds, and it is a FACT, never a
 *  sentence: each face says it in its own grammar. */
export type FleetTerminal =
  | ContainingTerminal
  | { readonly kind: "stray"; readonly id: TerminalId };

/** Is the stamped terminal one THIS padi owns?
 *
 *  The membership test lives beside the other three arms because it is the same
 *  KIND of fact — what the stamp turned out to name — and because both faces
 *  that ask it (`kolu watch --ignore-self`, `watch_open`'s `ignoreSelf`) carried
 *  their own `readTerminalKeys` + `.includes`, and had already drifted on WHEN
 *  they asked it. One arm, answered before either face builds a scope, so one
 *  logical request gets the same refusal from either.
 *
 *  The ROSTER, not the transport's shape: `endpoint.kind === "host"` was a proxy
 *  for this that missed a `--socket` aimed at a different padi on the same
 *  machine, and missed a stamp re-keyed by a daemon restart. */
export function confirmInFleet(
  found: ContainingTerminal,
  live: readonly TerminalId[],
): FleetTerminal {
  if (found.kind !== "ok" || live.includes(found.id)) return found;
  return { kind: "stray", id: found.id };
}
