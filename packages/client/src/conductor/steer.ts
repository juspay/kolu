/** ALT+ENTER — the words go INTO the turn that is running.
 *
 *  Three ways to say something to a working agent: queue it (it waits until
 *  the whole turn is over), steer it (the agent hears it now and adjusts), or
 *  stop the turn. Enter has always queued, and a queued sentence is a sentence
 *  that arrives after the thing it was about is finished. Alt+Enter steers.
 *
 *  TWO RULES, both of which exist so a message is never lost:
 *
 *   - Steering is OFFERED only when the cell says so: `steers` is the agent's
 *     leg having advertised steering AND this conversation never having queued
 *     a message behind a running turn (olai's `queuedHere` latch, whose reason
 *     is a pinned adapter defect — a steer into a session that has ever queued
 *     never settles its turn). A turn must also actually be running: there is
 *     nothing to steer an idle agent into.
 *   - Alt+Enter OFF the offer is a PLAIN SEND, never a dead key. A person who
 *     learned the chord must not discover that it silently does nothing on the
 *     conversation where steering is not on, and must certainly not lose the
 *     words they typed. The flag is the only difference between the two.
 *
 *  The decision is a function rather than an `if` in the keydown handler
 *  because it is the whole of the behaviour: which of the two sends happened
 *  is otherwise invisible until a turn ends differently than expected. */

import type { ConductorState } from "kolu-common/conductor";
import type { Keybind } from "../input/keyboard";

/** The chord itself, as a keybind — so the hint beside Send prints through
 *  `formatKeybind` like every other shortcut in the app (`Alt+Enter` off
 *  macOS, `⌥Enter` on it). Written out rather than spelled into the hint:
 *  the hint used to carry the Mac glyphs literally, so a Linux reader was
 *  told to press `⌥⏎` while the chip beside it said `Super+K`. */
export const STEER_KEYBIND: Keybind = { key: "Enter", alt: true };

/** Is steering ON OFFER right now — the state the hint beside Send draws.
 *  Both halves: the conversation steers, and there is a turn in flight to
 *  steer into. `asking` is a turn stopped on a form, which is a turn: the
 *  words can still reach it. */
export function steerOnOffer(
  state: Pick<ConductorState, "steers" | "phase">,
): boolean {
  return (
    state.steers && (state.phase === "working" || state.phase === "asking")
  );
}

/** What Alt does to a send. `true` only when the chord was held AND the offer
 *  stands; everything else is the ordinary prompt Enter sends. */
export function sendsAsSteer(alt: boolean, offered: boolean): boolean {
  return alt && offered;
}
