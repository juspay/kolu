/** Collect the sockets the link dials, so a test can inspect the dialled URL
 *  and open/close each socket by hand. Shared by the `/solid` seam tests that
 *  drive the REAL `connectSurface` with only the WebSocket faked. */
import { expect } from "vitest";
import { FakeWebSocket } from "../fakeSocket.testlib";

export function dialRecorder() {
  const dialled: FakeWebSocket[] = [];
  return {
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
