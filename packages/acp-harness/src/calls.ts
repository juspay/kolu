/**
 * What has been said about each tool call in this conversation.
 *
 * The protocol tells you a call's DISPLAY title and nothing else. Two things
 * this harness needs are said somewhere else entirely — in whatever corner of a
 * frame this agent's leg reads them out of (`@kolu/acp/engine`'s `Leg`) — and
 * both are needed at a moment when the frame that carried them has gone past:
 *
 *   - **which tool a call is**, programmatically. A permission request carries a
 *     title ("Ready to code?") and never a name, and the name is what stops this
 *     harness approving its own permissions.
 *   - **which agent made it**. A subagent's question reaches padi on the one
 *     feed everything else does, and a form drawn without this is drawn in the
 *     main agent's voice.
 *
 * The adapter answers both the same way, which is why this is ONE module rather
 * than two maps: it announces a call before it asks about it, and a
 * notification and a request travel the same pipe in order — so by the time
 * either question is put, the answer has already been said on a frame.
 *
 * ONE RULE: **a frame refines, never retracts.** A merge is a spread, and an
 * absent field is "nothing has said yet" rather than "nobody will".
 */

import type { Leg, Meta } from "@kolu/acp/engine";

/**
 * What is known about one call.
 *
 * All fields OPTIONAL, and that is the shape carrying the rule rather than a
 * comment reminding somebody of it: `null` would make "nobody said" a value a
 * later frame could assert, and the first frame to say only half of what it
 * knows would take the other half back.
 */
export interface Said {
  /** Compact MCP identity for display; never the frame or its input. */
  readonly mcp?: NonNullable<ReturnType<Leg["mcpCall"]>>;
  /** Which tool it is, programmatically — never the display title. */
  readonly name?: string;
  /** The subagent call it was made INSIDE, by the id it arrived as. */
  readonly parent?: string;
}

/** Nothing said — the answer for most frames a conversation carries. Frozen and
 *  SHARED, because the ordinary tool call says neither of these things and
 *  {@link Calls.heard} runs on every one of them. */
const NOTHING: Said = Object.freeze({});

/** Everything ONE FRAME says about the call it rode in on.
 *
 *  WHAT THE ID SAYS IS NOT READ HERE, and that is the whole reason the leg has
 *  two readers for one question: this is the REMEMBERING, and a name that is in
 *  the key needs none. Read here, an agent that names its tools in the call id
 *  would make every frame of every call news. */
const saidIn = (leg: Leg, meta: Meta): Said => {
  const name = leg.toolNameIn(meta);
  const parent = leg.parentToolUse(meta);
  if (name === null && parent === null) return NOTHING;
  return {
    ...(name === null ? {} : { name }),
    ...(parent === null ? {} : { parent }),
  };
};

export class Calls {
  #said = new Map<string, Said>();
  readonly #leg: Leg;

  constructor(leg: Leg) {
    this.#leg = leg;
  }

  /** A frame went past. A frame that said nothing leaves no entry and allocates
   *  nothing, so a conversation of ordinary calls keeps an empty map. */
  heard(id: string, meta: Meta): void {
    const said = saidIn(this.#leg, meta);
    if (said === NOTHING) return;
    this.#said.set(id, { ...this.#said.get(id), ...said });
  }

  /** Keep only the recognised server/tool identity, never input bodies or
   *  frames. */
  recognized(id: string, mcp: ReturnType<Leg["mcpCall"]>): void {
    if (mcp === null) return;
    this.#said.set(id, { ...this.#said.get(id), mcp });
  }

  /**
   * Everything said about one call so far — a LOOKUP and nothing else. A
   * question that arrives with words of its own about its call (a permission
   * request does) hands them to {@link heard} first, because they are another
   * frame about that call rather than a second kind of source.
   *
   * WHAT THE ID ITSELF SAYS is answered here rather than remembered, for the
   * agent whose wire puts the tool's name in the call id. What a FRAME said
   * still wins: an agent that says the name in its own words has said something
   * the id does not know.
   */
  about(id: string | null): Said {
    if (id === null) return NOTHING;
    const said = this.#said.get(id);
    if (said?.name !== undefined) return said;
    const named = this.#leg.toolNameOf(id);
    if (named === null) return said ?? NOTHING;
    return said === undefined ? { name: named } : { ...said, name: named };
  }

  /** The conversation is over. A call id is only ever looked up inside the
   *  session that minted it, so keeping these would be every call the process
   *  had ever seen, held for the life of a daemon meant to run for weeks. */
  forget(): void {
    this.#said.clear();
  }
}
