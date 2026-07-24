/**
 * Which local port a forward lands on.
 *
 * The rule, and the whole of it: **try the target's own port number first**.
 * `pu-dev:4123` should answer on `0.0.0.0:4123`, because a port you can predict
 * is a port you can bookmark, paste into a config, and recognise in a list —
 * and the number is already the one thing you know about the target. Only when
 * that number is unavailable on this machine does the kernel pick.
 *
 * There is no knob. Falling back is not a degraded mode to be opted into or out
 * of: refusing a forward because the matching port happens to be busy would be
 * the worse behaviour, and pinning the number when it is free costs nothing.
 *
 * A local (loopback-relay) target essentially always takes the fallback, and
 * that is correct rather than a bug: the server we relay TO already holds that
 * port number on this machine, so `0.0.0.0:<same>` cannot bind beside it.
 */

/** Which local port an attempt should use: an exact number, or "whatever is
 *  free" — each mechanism knows its own way to ask the kernel for one. */
export type LocalPortChoice = number | "any";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Open a listener on `preferred` if that number is available, else on any free
 *  port. If BOTH attempts fail, the error names both — the second failure is
 *  the one that matters, and the first is the context that explains why we were
 *  on the fallback path at all. */
export async function openPreferringPort<T>(opts: {
  preferred: number;
  open: (port: LocalPortChoice) => Promise<T>;
}): Promise<T> {
  let firstFailure: unknown;
  try {
    return await opts.open(opts.preferred);
  } catch (err) {
    firstFailure = err;
  }
  try {
    return await opts.open("any");
  } catch (err) {
    throw new Error(
      `${messageOf(err)} — and the matching local port ${opts.preferred} was unavailable too: ${messageOf(firstFailure)}`,
      { cause: err },
    );
  }
}
