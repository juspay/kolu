/** Collect the sockets the link dials, so a test can inspect the dialled URL
 *  and open/close each socket by hand. Shared by the `/solid` seam tests that
 *  drive the REAL `connectSurface` with only the WebSocket faked. */
import { expect } from "vitest";
import { FakeWebSocket } from "../fakeSocket.testlib";

export function dialRecorder() {
  const dialled: FakeWebSocket[] = [];
  return {
    /** Every socket the link has dialled, in order. Read it to assert about the
     *  WHOLE set — "none was left open" after a failed connect, say, which is
     *  honest even when the set is empty (the dial runs on the protocol's own
     *  fiber, so a seam that throws and unwinds in one microtask can close the
     *  link's scope before `connect` is ever called). Use {@link nth} instead
     *  when a test needs to wait for a specific socket to exist. */
    dialled,
    connect: (url: string) => {
      const ws = new FakeWebSocket(url);
      dialled.push(ws);
      return ws as unknown as WebSocket;
    },
    /** The dial runs in the protocol's own fiber. */
    nth: async (n: number): Promise<FakeWebSocket> => {
      await expect
        .poll(() => dialled.length, { timeout: 3_000 })
        .toBeGreaterThanOrEqual(n);
      const ws = dialled[n - 1];
      if (ws === undefined) throw new Error(`no socket #${n}`);
      return ws;
    },
  };
}
