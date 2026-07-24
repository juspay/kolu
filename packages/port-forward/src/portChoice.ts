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
 * What the fallback is NOT is a retry-on-anything. Only a failure that says
 * "this port is unavailable" earns a second attempt; a refused host, a bad key,
 * a missing ssh — anything about the connection rather than the number —
 * propagates immediately, with its own message, because retrying it on a
 * different port would fail identically while telling the user the wrong story.
 */

import { canBindLocally, pickFreePort } from "./freePort.ts";

/** Thrown by an attempt that failed *because of the port it was given*. This is
 *  the only failure the preference retries; everything else is a real error
 *  about the forward itself and travels straight to the caller. */
export class PortUnavailableError extends Error {
  constructor(
    readonly port: number,
    detail: string,
  ) {
    super(`port-forward: local port ${port} is unavailable — ${detail}`);
    this.name = "PortUnavailableError";
  }
}

/** Open a listener on `preferred` if that number is available, else on any free
 *  port. The whole decision lives here: the caller is handed a CONCRETE port
 *  number and never has to translate a sentinel or ask the kernel anything.
 *
 *  Only `PortUnavailableError` from the first attempt leads to the second. If
 *  the fallback then fails too, its error is what the caller sees — with the
 *  port failure named as the context that explains why we were on the fallback
 *  path at all. */
export async function openPreferringPort<T>(opts: {
  preferred: number;
  open: (port: number) => Promise<T>;
}): Promise<T> {
  let taken: PortUnavailableError;
  if (await canBindLocally(opts.preferred)) {
    try {
      return await opts.open(opts.preferred);
    } catch (err) {
      // Anything that is not about the port is about the forward: surface it as
      // it is, on the first attempt, rather than retrying and relabelling.
      if (!(err instanceof PortUnavailableError)) throw err;
      taken = err;
    }
  } else {
    // Something local already answers on this number. ssh would listen beside
    // it (SO_REUSEADDR) and the number would then mean two different servers
    // depending on the address dialled — take a free port instead. See
    // `canBindLocally`.
    taken = new PortUnavailableError(
      opts.preferred,
      "something local is already listening on it",
    );
  }
  try {
    return await opts.open(await pickFreePort());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message} — after falling back from ${taken.message}`, {
      cause: err,
    });
  }
}
