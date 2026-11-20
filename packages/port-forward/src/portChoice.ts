import { messageOf } from "./diagnostic.ts";
import { canBindLocally, pickFreePort } from "./freePort.ts";

export class PortUnavailableError extends Error {
  constructor(
    readonly port: number,
    detail: string,
  ) {
    super(`port-forward: local port ${port} is unavailable — ${detail}`);
    this.name = "PortUnavailableError";
  }
}

export async function openPreferringPort<T>(opts: {
  preferred: number;
  open: (port: number) => Promise<T>;
}): Promise<T> {
  let taken: PortUnavailableError;
  if (await canBindLocally(opts.preferred)) {
    try {
      return await opts.open(opts.preferred);
    } catch (err) {
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
    const message = messageOf(err);
    throw new Error(`${message} — after falling back from ${taken.message}`, {
      cause: err,
    });
  }
}
