/**
 * The write floor — a FIFO queue that runs at most ONE turn at a time.
 *
 * With one door onto the coordinator (chat never touches a worker terminal), the
 * "at most one writer per terminal" machinery collapses to this: thread messages
 * queue and are handled in order, one in flight, ever. A message that arrives
 * while a turn is running waits its turn; nothing interleaves two write-ins into
 * the same terminal. Serialization by conversation, not by locks.
 */

export type InboxJob = () => Promise<void>;

export class Inbox {
  private readonly queue: InboxJob[] = [];
  private running = false;

  /** Optional sink for a last-resort failure: a job is expected to handle its
   *  OWN faults (post a visible reply); if one still throws, the queue must not
   *  wedge — it is logged here and the next job runs (a caught error surfaces,
   *  it does not silently collapse the pump). */
  constructor(private readonly onJobError?: (err: unknown) => void) {}

  /** How many turns are waiting or running — the "coordinator busy" depth a
   *  test pins and an operator could be told. */
  get depth(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  /** Append a turn. Returns immediately; the turn runs when the floor is free.
   *  Kicking the pump is fire-and-forget by design — the webhook already
   *  answered 200 and the turn's own progress is its user-visible feedback. */
  enqueue(job: InboxJob): void {
    this.queue.push(job);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = this.queue.shift();
        if (job === undefined) break;
        try {
          await job();
        } catch (err) {
          if (this.onJobError) this.onJobError(err);
          else throw err;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
