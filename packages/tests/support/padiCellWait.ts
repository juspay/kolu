/**
 * Block until one of padi's cells, read on padi ITSELF through the re-serve,
 * satisfies `accept` — for a fact kolu-server PUSHES into a memory-only padi
 * cell (the new-terminal policy, the Agents setting), where the preference write
 * and the value padi's spawn reads are separated by a hop. A read that never
 * converges is a broken push, not a slow one: it fails loudly with the last
 * thing padi said.
 */

import { isPadiWarmingUp, padiFirstFrame } from "./rpcWire.ts";

const READ_TIMEOUT = 1_000;
const POLL_INTERVAL = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForPadiCell(opts: {
  /** `<cell>/get`, e.g. `"agentDistroStatus/get"`. */
  memberVerb: string;
  accept: (value: unknown) => boolean;
  /** What is awaited, for the failure message. */
  what: string;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  let last = "no attempt completed";
  while (Date.now() < deadline) {
    let payload: unknown;
    try {
      // A cell `get` is a SUBSCRIPTION; take its opening snapshot and unsubscribe.
      // A re-served cell withholds even that frame until the authority's fold
      // primes the mirror, so the read timeout doubles as the wait for padi to
      // have spoken at all.
      payload = await padiFirstFrame(opts.memberVerb, undefined, {
        timeoutMs: READ_TIMEOUT,
      });
    } catch (err) {
      // The upstream-link gap is the one failure worth re-reading within the cap.
      // Any other failure is a real route/contract fault and surfaces now.
      if (!isPadiWarmingUp(err)) throw err;
      last = err instanceof Error ? err.message : String(err);
      await sleep(POLL_INTERVAL);
      continue;
    }
    // No re-validation: the wire DECODED this frame against the cell's schema.
    if (opts.accept(payload)) return;
    last = `padi reads ${JSON.stringify(payload)}`;
    await sleep(POLL_INTERVAL);
  }
  throw new Error(
    `padi never came to read ${opts.what} within ${opts.timeoutMs}ms (last read: ${last})`,
  );
}
