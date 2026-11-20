import { isPadiWarmingUp, padiFirstFrameThenClose } from "./rpcWire.ts";

const READ_TIMEOUT = 1_000;
const POLL_INTERVAL = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForPadiCell(opts: {
  memberVerb: string;
  accept: (value: unknown) => boolean;
  what: string;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  let last = "no attempt completed";
  while (Date.now() < deadline) {
    let payload: unknown;
    try {
      payload = await padiFirstFrameThenClose(opts.memberVerb, undefined, {
        timeoutMs: READ_TIMEOUT,
      });
    } catch (err) {
      if (!isPadiWarmingUp(err)) throw err;
      last = err instanceof Error ? err.message : String(err);
      await sleep(POLL_INTERVAL);
      continue;
    }
    if (opts.accept(payload)) return;
    last = `padi reads ${JSON.stringify(payload)}`;
    await sleep(POLL_INTERVAL);
  }
  throw new Error(
    `padi never came to read ${opts.what} within ${opts.timeoutMs}ms (last read: ${last})`,
  );
}
