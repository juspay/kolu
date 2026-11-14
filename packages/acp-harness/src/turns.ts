/**
 * The turns in flight, IN THE ORDER THEY WENT OUT, and the four questions
 * anybody asks about them.
 *
 * There is more than one whenever somebody types while the conductor is
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
 * idle); and drop all of them, for a shutdown.
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
 * An OBJECT rather than the key alone because identity is what leaving is by:
 * two sends of the same words are two turns, and a key would make the second
 * one's ending close the first one's row.
 */
export interface Turn {
  readonly key: string;
  /**
   * Somebody asked THIS turn to stop.
   *
   * It outlives the turn on purpose, because the thing that needs it is a
   * STEER still on the wire: a message aimed at a turn a person then cancelled
   * comes back "nothing to steer", which is indistinguishable from the turn
   * having simply ended — unless the ticket it was aimed at remembers being
   * stopped. Without it the two answers are one, and the words a person sent
   * INTO a turn would start a fresh one they had just pressed a button to end.
   */
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

  /**
   * Every turn running, MARKED stopped — all of them rather than the newest,
   * because `session/cancel` is the CONVERSATION's and what a person pressed
   * is about everything they have in flight.
   *
   * The marks are what a steer that answered *nothing to steer* is read
   * against: a turn that ended on its own makes those words an ordinary
   * prompt, and a turn somebody stopped makes them a refusal.
   */
  stopping(): void {
    for (const ticket of this.#live) ticket.stopped = true;
  }

  /** ... and it has ended. Answers whether it was the LAST one, which is what
   *  decides whether it may say where the conversation stands. `false` for a
   *  ticket that had already left, so a belt-and-braces second call cannot
   *  report a second ending. */
  leave(ticket: Turn): boolean {
    if (!this.#live.delete(ticket)) return false;
    return this.#live.size === 0;
  }

  /** The conversation is over: every ticket dropped, the set left empty. */
  drain(): void {
    this.#live.clear();
  }
}
