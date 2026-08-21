/**
 * The wire's three supervision knobs, decoded into what the engine compares
 * against — ONCE, for both faces.
 *
 * `kolu watch --states/--held-for/--nag` and an MCP `watch.open` that names the
 * same three are the same subscription; the only thing that differs is which
 * schema carried them. So the defaults live here rather than at each face: a
 * caller that named no states means {@link WATCH_DEFAULT_STATES} on BOTH faces,
 * and there is no second place for one of them to drift.
 *
 * It also owns the one decision that reads as a mode but is not one: whether a
 * caller asked for the agent-state watch at all. The answer is the PRESENCE of
 * any knob — no flag, nothing to contradict the knobs, and nothing to forget to
 * set when a fourth knob is added.
 */

import type { WaitState } from "../terminalVocab.ts";
import { WATCH_DEFAULT_STATES, WATCH_FILTER_KEYS } from "../surface.ts";
import type { PadiWatchStatesInput } from "../surface.ts";
import { isTerminalId, type TerminalId } from "@kolu/terminal-vocab/schema";
import type { StateWatchFilter, StateWatchSpec } from "./stateWatch.ts";
import { type WatchScope, watchScopeOf } from "./watchScope.ts";

/** The env a process inside a kolu PTY reads to name itself. Stamped at spawn
 *  as `KAVAL_TERMINAL_ID` — the self-knowledge twin of `KAVAL_SOCKET` — so
 *  `--ignore-self` has nothing to configure and cannot go stale. */
export const CONTAINING_TERMINAL_ENV = "KAVAL_TERMINAL_ID";

/** The three knobs as either face's schema decodes them. Structural, so both
 *  wire inputs satisfy it without an adapter object per call — and unexported,
 *  because that structural fit is exactly why no caller ever needs to name it. */
interface WatchKnobs {
  readonly states?: readonly WaitState[];
  readonly heldForMs?: number;
  readonly nagMs?: number;
}

/** Decode the knobs, defaults applied. */
function filterFrom(knobs: WatchKnobs): StateWatchFilter {
  return {
    states: new Set(knobs.states ?? WATCH_DEFAULT_STATES),
    // A hold of zero is "report it the instant it enters", which is what a
    // caller who named only `--nag` asked for.
    heldForMs: knobs.heldForMs ?? 0,
    // Absent means report ONCE. Spread-or-omit rather than an explicit
    // `undefined`, so "nag not" is spelled by the key being missing everywhere
    // it travels.
    ...(knobs.nagMs === undefined ? {} : { nagMs: knobs.nagMs }),
  };
}

/** Did the caller name any supervision knob? The ONE definition of "this is an
 *  agent-state watch", asked by both faces and by the daemon rather than each
 *  re-listing the knobs — and asked over {@link WATCH_FILTER_KEYS}, which is the
 *  wire declaration itself, so a fourth knob is admitted here the moment it is
 *  declared instead of quietly failing to count. */
export function namesWatchKnobs(knobs: WatchKnobs): boolean {
  return WATCH_FILTER_KEYS.some((key) => knobs[key] !== undefined);
}

/** The filter a standing subscription was opened with, or `undefined` when the
 *  caller named none of the three — which is what keeps a plain `watch.open` on
 *  the settle detector it has always used. */
export function watchFilterOf(knobs: WatchKnobs): StateWatchFilter | undefined {
  return namesWatchKnobs(knobs) ? filterFrom(knobs) : undefined;
}

/** A filter plus the {@link WatchScope} it is applied at — the ONE place a
 *  filter becomes a spec, so a standing subscription and the live stream cannot
 *  disagree about what an unscoped watch means. PURE: the never-match refusal
 *  lives in {@link watchScopeOf}, the only thing that can make the scope this
 *  takes, so there is nothing left here to reject. */
export function specOf(
  filter: StateWatchFilter,
  scope: WatchScope,
): StateWatchSpec {
  return { ...filter, scope };
}

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

/** The sentence a face raises when `ignoreSelf` was asked and this process
 *  cannot name its containing terminal. CLI and MCP share the env and the way
 *  out; they differ only in how the flag is spelled. */
export function ignoreSelfUnresolvable(face: "cli" | "mcp"): string {
  return face === "cli"
    ? `--ignore-self: this process is not running inside a kolu terminal (${CONTAINING_TERMINAL_ENV} is unset). Run watch from inside a kolu-owned PTY, or pass --ignore <id>.`
    : `ignoreSelf: this MCP server is not running inside a kolu terminal (${CONTAINING_TERMINAL_ENV} is unset). The transport cannot identify the caller — pass ignoreIds with the terminal to mute, rather than guessing.`;
}

/** The sentence for `--ignore-self` aimed at ANOTHER machine's fleet. The
 *  stamp names a terminal this padi owns; a remote padi has never heard of it,
 *  so muting it there is a guaranteed no-op that would report success. Refused
 *  for the same reason an unresolvable stamp is: the flag is knowably not
 *  answerable, and a mute that silently mutes nobody is worse than a refusal. */
export function ignoreSelfNotThisFleet(host: string): string {
  return `--ignore-self names a terminal on THIS machine, but --host ${host} watches another padi's fleet — that mute could never match. Pass --ignore <id> naming a terminal on ${host}.`;
}
export function ignoreSelfInvalid(raw: string, face: "cli" | "mcp"): string {
  const stamp = `${CONTAINING_TERMINAL_ENV}=${JSON.stringify(raw)} is not a terminal id`;
  return face === "cli" ? `--ignore-self: ${stamp}.` : `ignoreSelf: ${stamp}.`;
}

/** The full spec behind one `watchStates` subscription, or the refusal that says
 *  the scope it asked for can never match. Unlike a standing subscription there
 *  is nothing to CHOOSE here: opening the stream at all IS the ask, so the
 *  defaults always apply. */
export function watchSpecOf(
  input: PadiWatchStatesInput,
):
  | { readonly kind: "ok"; readonly value: StateWatchSpec }
  | { readonly kind: "error"; readonly message: string } {
  const scope = watchScopeOf({
    ...(input.id === undefined ? {} : { ids: [input.id] }),
    ...(input.ignoreIds === undefined ? {} : { mute: input.ignoreIds }),
  });
  if (scope.kind === "error") return scope;
  return { kind: "ok", value: specOf(filterFrom(input), scope.value) };
}
