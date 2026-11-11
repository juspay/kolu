/**
 * The turns in flight, IN THE ORDER THEY WENT OUT, and the four questions
 * anybody asks about them.
 *
 * There is more than one whenever somebody types while the orchestrator is
 * working, which is the ordinary way to send a mid-turn message: the words go
 * out as a plain `session/prompt`, the agent holds them behind the turn it is
 * working on, and until it gets to them there are two turns this process owns
 * and neither has finished.
 *
 * A SET rather than a slot, and each reader below is the same question asked of
 * it: is the conversation busy (the phase chip); which one is the agent ON (the
 * oldest, since prompts are taken in order — what tells a *queued* row from one
 * being worked on); has the LAST one ended (only then may a turn say where the
 * conversation stands, or a turn ending under a sibling marks a working panel
 * idle); and take all of them, for a shutdown.
 *
 * ITS OWN MODULE because every rule here is otherwise reachable only by
 * starting a subprocess and typing into a running turn.
 */

/**
 * One turn in flight, as a TICKET.
 *
 * `key` is the transcript key of the `user` row this turn is the delivery of —
 * held here because the SET is what knows the order, and "which row is the
 * agent on now" has exactly one honest answer: the oldest ticket still running.
 *
 * `stopped` outlives the turn on purpose: a cancel that raced the prompt onto
 * the wire has to be told apart from a turn that merely ended, or a person's
 * words start a fresh turn they just pressed a button to end.
 */
export interface Turn {
  readonly key: string;
  stopped: boolean;
}

export class Turns {
  #live = new Set<Turn>();

  get busy(): boolean {
    return this.#live.size > 0;
  }

  /**
   * The OLDEST turn still running, or `null` — the one the agent is working on
   * now, with everything else behind it.
   *
   * A `Set` iterates in insertion order and insertion order is the order these
   * prompts went on the wire; an agent that holds a mid-turn prompt runs them
   * in the order it received them. A flag per ticket would be a second copy of
   * that order, kept in step by whoever remembered to.
   */
  get head(): Turn | null {
    return this.#live.values().next().value ?? null;
  }

  open(key: string): Turn {
    const ticket: Turn = { key, stopped: false };
    this.#live.add(ticket);
    return ticket;
  }

  /** ... and it has ended. Answers whether it was the LAST one, which is what
   *  decides whether it may say where the conversation stands. `false` for a
   *  ticket that had already left, so a belt-and-braces second call cannot
   *  report a second ending. */
  leave(ticket: Turn): boolean {
    if (!this.#live.delete(ticket)) return false;
    return this.#live.size === 0;
  }

  /** Every turn running, MARKED stopped — all of them rather than the newest,
   *  because `session/cancel` is the conversation's and what a person pressed
   *  is about everything they have in flight. */
  stopping(): ReadonlyArray<Turn> {
    const asked = [...this.#live];
    for (const ticket of asked) ticket.stopped = true;
    return asked;
  }

  /** The conversation is over: every ticket taken, the set left empty. */
  drain(): ReadonlyArray<Turn> {
    const taken = [...this.#live];
    this.#live.clear();
    return taken;
  }
}
