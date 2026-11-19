/**
 * The turns in flight, IN THE ORDER THEY WENT OUT, and the questions anybody
 * asks about them.
 *
 * There is more than one whenever somebody types while the agent is working: the
 * words go out as a plain prompt, the agent holds them behind the turn it is
 * working on, and until it gets to them there are two turns this process owns
 * and neither has finished.
 *
 * A SET rather than a slot, and each reader below is the same question asked of
 * it:
 *
 *   - **is the conversation busy** — the composer's `thinking`, and the guard
 *     that refuses to switch conversations out from under a running turn;
 *   - **which one is the agent ON** — the oldest, since prompts are taken in
 *     order. It is what an interruption is aimed at, and what tells a waiting
 *     row from one being worked on ({@link Turn.key});
 *   - **am I the last one out** — which is what decides whether a turn that
 *     ended may say where the conversation stands. A turn that ends while
 *     another is still going has nothing true left to say about it, and saying
 *     it anyway marks a thinking panel idle;
 *   - **stop all of them** — a person pressing cancel means the things they
 *     have in flight, not the newest of them;
 *   - **take all of them** — a shutdown, which owns every fiber it started.
 *
 * A SLOT answered the first two by comparing identities and the last two by
 * holding the newest, which is right for one turn and quietly wrong for two: a
 * cancel aimed at the newest left the other running, a shutdown left its fiber
 * behind, and a conversation could be swapped out from under a turn nothing was
 * pointing at.
 *
 * ITS OWN MODULE, and that is what makes any of the above assertable. Every rule
 * here is otherwise reachable only by starting a subprocess, holding a turn open
 * and typing into it — so the rules live where a test can call them.
 *
 * It knows nothing about what a turn IS: `payload` is the caller's, handed in at
 * {@link Turns.open} and handed back (kolu needs none; olai keeps the fiber here
 * so a cancel has something to interrupt), and what ending one costs is the
 * caller's too.
 */

/**
 * One turn in flight, as a TICKET rather than as a handle.
 *
 * It exists because the handle does not, yet: the ticket is written down before
 * the work is started, so there is no window in which a turn is running and
 * nothing says so. What the caller keeps in `payload` is filled in a moment
 * later (olai's fiber, for the callers that have to interrupt it); a caller with
 * nothing to keep leaves it `undefined`.
 */
export interface Turn<Payload = undefined> {
  /** The CALLER's own handle on this turn — olai's fiber, a cancel's target.
   *  `null` until the caller has one, and `undefined` for a caller that never
   *  keeps any. */
  payload: Payload | null;
  /**
   * WHOSE message started it — the transcript key of the `user` row this turn is
   * the delivery of.
   *
   * It is here because the SET is what knows the order. A message sent while a
   * turn is running is waiting behind it at the agent, and the row says so
   * (`queued`) — so something has to answer "which row is the agent on now", and
   * the only honest answer is "the oldest turn still running", which is a fact
   * about this collection and nothing else.
   */
  readonly key: string;
  /**
   * Somebody asked THIS turn to stop.
   *
   * It outlives the turn on purpose, because the thing that needs it is a steer
   * still on the wire: a message aimed at a turn a person then cancelled comes
   * back "nothing to steer", which is indistinguishable from the turn having
   * simply ended — unless the ticket it was aimed at remembers being stopped.
   * Without that, the two are the same answer and the message starts a fresh
   * turn the person just pressed a button to end.
   */
  stopped: boolean;
}

export class Turns<Payload = undefined> {
  #live = new Set<Turn<Payload>>();

  /** Whether anything is running. */
  get busy(): boolean {
    return this.#live.size > 0;
  }

  /** How many, for a caller that wants to say it. */
  get size(): number {
    return this.#live.size;
  }

  /**
   * The OLDEST turn still running, or `null` — the one the agent is working on
   * now, with everything else behind it.
   *
   * A `Set` iterates in insertion order, and insertion order is the order these
   * prompts went on the wire: an agent that holds a mid-turn prompt runs them in
   * the order it received them, so the oldest ticket is the one being worked on.
   *
   * It is deliberately a read of the set rather than a flag on each ticket — a
   * flag would be a second copy of the order, kept in step by whoever remembered
   * to.
   */
  get head(): Turn<Payload> | null {
    return this.#live.values().next().value ?? null;
  }

  /** A turn is starting, for the message on `key`. The ticket is the caller's to
   *  fill a payload into. */
  open(key: string): Turn<Payload> {
    const ticket: Turn<Payload> = { payload: null, key, stopped: false };
    this.#live.add(ticket);
    return ticket;
  }

  /** ... and it has ended. Answers whether it was the LAST one — which is what
   *  decides whether it may say where the conversation stands. Answers `false`
   *  for a ticket that had already left, so the belt-and-braces call every
   *  caller makes on its way out cannot report a second ending. */
  leave(ticket: Turn<Payload>): boolean {
    if (!this.#live.delete(ticket)) return false;
    return this.#live.size === 0;
  }

  /** Whether this ticket is still running — asked by a cancel that has waited
   *  its grace and wants to know whether anything came of it. */
  has(ticket: Turn<Payload>): boolean {
    return this.#live.has(ticket);
  }

  /**
   * Every turn running, MARKED stopped — and answered, so a caller can ask
   * later what became of the ones it was about.
   *
   * All of them rather than the newest: `session/cancel` is the conversation's
   * rather than one turn's, and what a person pressed is about everything they
   * have in flight.
   */
  stopping(): ReadonlyArray<Turn<Payload>> {
    const asked = [...this.#live];
    for (const ticket of asked) ticket.stopped = true;
    return asked;
  }

  /** The conversation is over: every ticket taken, and the set left empty. The
   *  caller interrupts what it is handed — one left running past a shutdown is
   *  one nothing will ever report on. */
  drain(): ReadonlyArray<Turn<Payload>> {
    const taken = [...this.#live];
    this.#live.clear();
    return taken;
  }
}
