/**
 * WHO THIS ENGINE IS, AND WHAT A MACHINE WITHOUT IT IS TOLD — spelled once,
 * spent once.
 *
 * {@link ./index.ts}'s probe hands this value back as the `NotHere` arm of its
 * answer, so a host that has not got this engine still publishes a row with the
 * sentence attached: the orchestrator's install face draws it, and the person
 * reading it finds out WHY rather than finding nothing.
 *
 * A MODULE OF ITS OWN rather than lines inside the registration, because the
 * sentence is a fact about the product and the registration is a fact about a
 * process: a test that wants to assert what a person reads must not have to
 * construct a `Where` to get at it.
 *
 * IT IS A WHOLE SENTENCE and nothing composes around it. **The harness displays
 * a sentence and never composes one** — the same rule `NotHere.why` is declared
 * under, and the reason there is no template here with a noun dropped into it:
 * what an engine is and how you get it are facts only its own package knows.
 */

import type { NotHere } from "@kolu/acp/engine";

/** WHAT A PERSON READS — in the picker, and in the header beside the model.
 *  This package's, because "Claude Code" is a name rather than the word
 *  `claude` with a capital letter, and a table in the harness mapping one to
 *  the other is exactly the thing an integration package exists to delete. */
export const NAME = "Claude Code";

/**
 * ...AND WHAT A MACHINE THAT HAS NONE IS TOLD.
 *
 * IT SAYS THE CAUSE rather than the ordinary case, and the difference matters
 * because of WHEN it is read. This engine does ship with kolu — the pinned
 * adapter is baked into padi's wrapper on every documented way of starting a
 * host — so the only way anybody reaches this sentence is a padi started round
 * all of them. A row that said "comes with kolu" would be telling a person the
 * thing that is true everywhere except where they are standing, which is the
 * shape of an error message that reads as correct and helps nobody.
 *
 * `where` is null: installing anything does not restore a wrapper padi was
 * started without. The adapter is kolu's to provide, not the user's to
 * download.
 */
export const INSTALL: NotHere = {
  name: NAME,
  where: null,
  why: "not found — this host's padi was started without the wrapper that carries the pinned adapter",
};
