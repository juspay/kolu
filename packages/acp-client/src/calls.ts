/**
 * What has been said about each tool call in this conversation.
 *
 * The protocol tells you a call's DISPLAY title and nothing else. Two things
 * this panel needs are said somewhere else entirely — in whatever corner of a
 * frame this agent's leg reads them out of (`@kolu/acp/engine`'s `Leg`) — and both
 * are needed at a moment when the frame that carried them has already gone
 * past:
 *
 *   - **which tool a call is**, programmatically. A permission request carries
 *     a title ("Ready to code?") and never a name, and the name is what stops
 *     this panel approving its own permissions.
 *   - **which agent made it**. A subagent's question reaches olai on the one
 *     feed everything else does, and a form drawn without this is drawn in the
 *     main agent's voice.
 *
 * The adapter answers both the same way and it is the reason this is ONE
 * module rather than two maps: it announces the call before it asks about it
 * (`ensureToolCallEmitted`), and a notification and a request travel the same
 * pipe in order — so by the time either question is put, the answer has
 * already been said on a frame. One frame answers both, so one thing
 * remembers both. It is true of the other agent too, for its own reason: an
 * opencode permission request names the call it is about by the same id the
 * announcement carried, and the announcement is where the tool's NAME was said
 * — the id itself is an opaque hash (`olai-plugin-opencode`'s `leg.ts`), so
 * the frame already heard is the only thing that can answer.
 *
 * ONE RULE: **a frame refines, never retracts.** The facts arrive across
 * frames and each carries what it knows — a subagent's terminal output arrives
 * with only the parent, a plan exit's with only the name, and a completion
 * with neither. A row that read a completion's silence as "no agent now" would
 * step out of its lane at the moment the call finished, which is the moment
 * somebody looks. So a merge is a spread, and an absent field is "nothing has
 * said yet" rather than "nobody will".
 *
 * A QUESTION WITH WORDS OF ITS OWN is not a second rule. A permission request
 * carries the adapter's stamp on the tool call it is about, in the shape every
 * frame carries it — so it is FOLDED IN like one, and reading it is the
 * ordinary lookup. Precedence falls out (the last frame in wins, and the
 * request is the last) rather than being a second thing a caller has to
 * apply in the right order; and what the request said stays known, for the
 * next question about the same call.
 *
 * MCP display identity is remembered here too, under the same session key and
 * lifetime. Only the recognized server/tool pair survives; input bodies and
 * adapter frames stay with their event, never with this registry.
 *
 * Its own module for the reason {@link ./questions.ts} is: this is a small
 * state machine about a conversation rather than a fact about the protocol,
 * and the failure it prevents — a request answered from a stale frame, an
 * attribution taken back off a call — is one nobody can reach without starting
 * a subprocess and talking it into a fan-out. A rule worth being sure of is
 * one worth asserting over values.
 *
 * It knows nothing about ACP. What a frame MEANS is the LEG's
 * (`@kolu/acp/engine`'s `Leg`) — handed in at construction, because which agent
 * this conversation is with is decided per conversation now — and what to do
 * with the answer is the caller's; this owns only the remembering.
 */

import type { Leg, Meta } from "@kolu/acp/engine";

/**
 * What is known about one call.
 *
 * All fields OPTIONAL, and that is the shape carrying the rule rather than a
 * comment reminding somebody of it: absent means "nothing has said yet", which
 * is what makes a spread the whole of the merge. `null` would make "nobody
 * said" a value a later frame could assert, and the first frame to say only
 * half of what it knows would take the other half back.
 */
export interface Said {
  /** Compact MCP identity for display — every call this frame made, never the
   *  frame or its input. Several, because one Code Mode `execute` can be
   *  several of olai's calls. */
  readonly mcp?: ReturnType<Leg["mcpCall"]>;
  /** Which tool it is, programmatically — never the display title. */
  readonly name?: string;
  /** The `Agent` call it was made INSIDE, by the id it arrived as, when a
   *  subagent made it. */
  readonly parent?: string;
}

/** Nothing said, which is what a frame with no adapter corner in it and a call
 *  nobody has mentioned both come to. Frozen and SHARED, because it is the
 *  answer for most frames a conversation carries: the ordinary tool call says
 *  neither of these things, and {@link heard} runs on every one of them. */
const NOTHING: Said = Object.freeze({});

/** Everything ONE FRAME says about the call it rode in on. The two readings in
 *  one value, so a frame and a request contribute the same shape and the merges
 *  below are one operation rather than a field-by-field `??` per caller — and
 *  {@link NOTHING} rather than a fresh empty when it says neither, so a frame
 *  nothing is read from costs nothing to read.
 *
 *  WHAT THE ID SAYS IS NOT READ HERE, and that is the whole reason the leg has
 *  two readers for one question (`@kolu/acp/engine`'s `Leg`): this is the
 *  remembering, and a name that is in the key needs none. Read here, an agent
 *  that names its tools in the call id would make every frame of every call
 *  news — a slice, two objects and a map write apiece, on the one path that
 *  runs on every frame of every conversation — to store an answer
 *  {@link Calls.about} can read off its own argument. */
const saidIn = (leg: Leg, meta: Meta, frame?: unknown): Said => {
  const name = leg.toolNameIn(meta, frame);
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

  /** A frame went past. What it said about its call is folded in; a frame that
   *  said nothing leaves no entry and allocates nothing, so a conversation of
   *  ordinary calls keeps an empty map — which is nearly every conversation,
   *  and this runs on every frame of all of them.
   *
   *  `frame` is the payload the `_meta` came off, for the wire that puts the
   *  programmatic name on the FRAME rather than in a corner or in the id.
   *  Carried verbatim; which field on it is the name — and whether it may be
   *  believed — is the leg's answer, not this registry's. */
  heard(id: string, meta: Meta, frame?: unknown, session?: string): void {
    const said = saidIn(this.#leg, meta, frame);
    if (said === NOTHING) return;
    const key = this.#key(id, session);
    this.#said.set(key, { ...this.#said.get(key), ...said });
  }

  /** Keep only the recognized server/tool identities, never input bodies or
   * frames. The same session-qualified owner holds these beside name and
   * ancestry. An EMPTY list is a frame that recognised nothing and is not
   * remembered: a frame refines, never retracts, so a later frame that
   * recognises what an earlier one could not still wins. */
  recognized(
    id: string,
    mcp: ReturnType<Leg["mcpCall"]>,
    session?: string,
  ): void {
    if (mcp.length === 0) return;
    const key = this.#key(id, session);
    this.#said.set(key, { ...this.#said.get(key), mcp });
  }

  /**
   * Everything said about one call so far.
   *
   * A LOOKUP and nothing else. A question that arrives with words of its own
   * about its call — which a permission request does — hands them to
   * {@link heard} first, because they are another frame about that call and
   * not a second kind of source; so there is one rule here rather than a
   * precedence a caller could get backwards, and what a request said is
   * remembered for the next question about the same call instead of being
   * thrown away.
   *
   * The call may be `null`: a form elicitation may be scoped to a REQUEST
   * rather than to a session, and one an MCP server sends may name no call.
   * That is answered rather than refused — a question that named nothing is an
   * ordinary question the main agent asked.
   *
   * WHAT THE ID ITSELF SAYS is answered here rather than remembered, for the
   * agent whose wire puts the tool's name in the call id. It is the same
   * answer either way and it is asked far less often — a permission request,
   * a form — where {@link heard} runs on every frame. What a FRAME said still
   * wins: an agent that says the name in its own words has said something the
   * id does not know.
   */
  about(id: string | null, session?: string): Said {
    if (id === null) return NOTHING;
    const said = this.#said.get(this.#key(id, session));
    if (said?.name !== undefined) return said;
    const named = this.#leg.toolNameOf(id);
    if (named === null) return said ?? NOTHING;
    return said === undefined ? { name: named } : { ...said, name: named };
  }

  /** The call's wire ID remains intact for Leg.toolNameOf; only remembered
   * facts are qualified by session when the leg uses native child sessions. */
  #key(id: string, session?: string): string {
    return this.#leg.nativeActivity && session !== undefined
      ? JSON.stringify([session, id])
      : id;
  }

  /** The conversation is over. A call id is only ever looked up inside the
   *  session that minted it, so keeping these would be every call the process
   *  had ever seen, held for the life of a server meant to run for weeks. */
  forget(): void {
    this.#said.clear();
  }
}
