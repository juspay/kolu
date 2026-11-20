import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { Effect } from "effect";
import { afterEach, expect, it } from "vitest";
import {
  createPtyHost,
  type PtyDataItem,
  type PtyGrid,
  type PtyHost,
  type PtyId,
} from "./ptyHost.ts";
import { type FrameStream, subscribeFrames } from "./streamFrame.testlib.ts";

const shellEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
};

const SILENT = ["-c", "while :; do sleep 0.05; done"];

const TRAP_READY = "TRAPREADY";

const REPRINT_AFTER_A_PAUSE = [
  "-c",
  `trap 'printf FIRSTBYTES; sleep 0.35; head -c 200000 /dev/zero | tr "\\0" R; printf REPRINTDONE' WINCH; printf ${TRAP_READY}; while :; do sleep 0.05; done`,
];

const SMALL_REPAINT_AFTER_A_PAUSE = [
  "-c",
  `trap 'sleep 0.35; printf SMALLREPAINT' WINCH; printf ${TRAP_READY}; while :; do sleep 0.05; done`,
];

const STEADY_TRICKLE = ["-c", "while :; do printf .; sleep 0.05; done"];

const COUNTER = [
  "-c",
  "seq 1 9000 | while IFS= read -r i; do printf '[%s]\\n' \"$i\"; done; printf 'COUNTDONE\\n'; sleep 10",
];

function counterValues(text: string): number[] {
  return [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

async function drain(
  frames: FrameStream<PtyDataItem>,
  ms: number,
): Promise<{
  text: string;
  resizes: PtyGrid[];
  order: string[];
  drop: { _tag?: string } | undefined;
}> {
  let text = "";
  const resizes: PtyGrid[] = [];
  const order: string[] = [];
  for (;;) {
    try {
      const item = await frames.next(ms);
      if (item.kind === "bytes") {
        text += item.data;
        order.push(`bytes:${item.data}`);
        continue;
      }
      resizes.push(item.grid);
      order.push(`resized:${item.grid.cols}x${item.grid.rows}`);
    } catch (err) {
      const tagged = err as { _tag?: string };
      if (tagged._tag === undefined)
        return { text, resizes, order, drop: undefined };
      return { text, resizes, order, drop: tagged };
    }
  }
}

describeDaemon("PtyHost resize window", () => {
  let live: PtyHost | undefined;

  afterEach(() => {
    live?.dispose();
    live = undefined;
  });

  function spawn(args: readonly string[]): { host: PtyHost; id: PtyId } {
    const host = createPtyHost({ log: silentLog });
    live = host;
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [...args],
      env: shellEnv,
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    });
    return { host, id };
  }

  async function waitForScreen(
    host: PtyHost,
    id: PtyId,
    marker: string,
  ): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!host.getScreenText(id).includes(marker)) {
      if (Date.now() > deadline) {
        throw new Error(`pty ${id} never printed ${marker}`);
      }
      const tick = Promise.withResolvers<void>();
      setTimeout(() => tick.resolve(), 5);
      await tick.promise;
    }
  }

  async function timeAttach(host: PtyHost, id: PtyId): Promise<number> {
    const started = Date.now();
    await Effect.runPromise(Effect.scoped(host.attach(id)));
    return Date.now() - started;
  }

  it("spares a viewer the agent's reprint, even though the agent pauses first", async () => {
    const { host, id } = spawn(REPRINT_AFTER_A_PAUSE);
    await waitForScreen(host, id, TRAP_READY);
    const { text, drop } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          host.resize(id, 100, 30);
          return yield* Effect.promise(() => drain(frames, 6000));
        }),
      ),
    );
    expect(text).not.toContain("FIRSTBYTES");
    expect(text).not.toContain("REPRINTDONE");
    expect(text).toBe("");
    expect(drop).toMatchObject({ _tag: "SubscriberInvalidated" });
    const { snapshot } = await Effect.runPromise(
      Effect.scoped(host.attach(id)),
    );
    expect(snapshot).toContain("REPRINTDONE");
  });

  it("keeps a plain shell's viewers whole: the small repaint is delivered, not re-sent", async () => {
    const { host, id } = spawn(SMALL_REPAINT_AFTER_A_PAUSE);
    await waitForScreen(host, id, TRAP_READY);
    const started = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          const t0 = Date.now();
          host.resize(id, 100, 30);
          let text = "";
          while (!text.includes("SMALLREPAINT")) {
            const item = yield* Effect.promise(() => frames.next(4000));
            if (item.kind === "bytes") text += item.data;
          }
          frames.close();
          return t0;
        }),
      ),
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
  });

  it("does not close on silence before the window's own span", async () => {
    const { host, id } = spawn(SILENT);
    await timeAttach(host, id);
    host.resize(id, 100, 30);
    const parked = await timeAttach(host, id);
    expect(parked).toBeGreaterThanOrEqual(450);
    expect(parked).toBeLessThan(1500);
  });

  it("a spinner is not a burst: steady output does not hold the window open", async () => {
    const { host, id } = spawn(STEADY_TRICKLE);
    const started = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          const t0 = Date.now();
          host.resize(id, 100, 30);
          yield* Effect.promise(() =>
            frames.until((item) => item.kind === "bytes", 5000),
          );
          frames.close();
          return t0;
        }),
      ),
    );
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(450);
    expect(waited).toBeLessThan(1200);
  });

  it("delivers each byte exactly once across a resizing attach", async () => {
    const { host, id } = spawn(COUNTER);
    await waitForScreen(host, id, "[1]");
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const attached = yield* host.attach(id, {
            resizeTo: { cols: 100, rows: 30 },
          });
          const frames = subscribeFrames(attached.deltas);
          let delta = "";
          while (!delta.includes("COUNTDONE")) {
            const item = yield* Effect.promise(() => frames.next(8000));
            if (item.kind === "bytes") delta += item.data;
          }
          frames.close();
          return { snapshot: attached.snapshot, delta };
        }),
      ),
    );
    expect(seen.snapshot).not.toContain("COUNTDONE");
    const snapshot = counterValues(seen.snapshot);
    const deltas = counterValues(seen.delta);
    expect(snapshot.length).toBeGreaterThan(0);
    expect(deltas.length).toBeGreaterThan(0);
    const lastInSnapshot = snapshot[snapshot.length - 1] as number;
    expect(deltas[0] as number).toBeGreaterThan(lastInSnapshot);
    expect((deltas[0] as number) - lastInSnapshot).toBeLessThanOrEqual(2);
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBe((deltas[i - 1] as number) + 1);
    }
    expect(deltas[deltas.length - 1]).toBe(9000);
  });

  it("does not delay the attach that opens the window", async () => {
    const { host, id } = spawn(SILENT);
    await timeAttach(host, id);
    const started = Date.now();
    await Effect.runPromise(
      Effect.scoped(host.attach(id, { resizeTo: { cols: 100, rows: 30 } })),
    );
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("leaves viewers alone when the resize is a no-op", async () => {
    const { host, id } = spawn(SILENT);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas, grid } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          expect(host.resize(id, grid.cols, grid.rows)).toBe(true);
          const { text, drop } = yield* Effect.promise(() =>
            drain(frames, 250),
          );
          expect(text).toBe("");
          expect(drop).toBeUndefined();
          frames.close();
        }),
      ),
    );
    expect(await timeAttach(host, id)).toBeLessThan(250);
  });

  it("releases a parked attach when the PTY exits mid-window", async () => {
    const { host, id } = spawn(SILENT);
    await timeAttach(host, id);
    host.resize(id, 100, 30);
    const parked = Effect.runPromise(Effect.scoped(host.attach(id)));
    const turn = Promise.withResolvers<void>();
    setImmediate(() => turn.resolve());
    await turn.promise;
    const started = Date.now();
    host.kill(id, "SIGKILL");
    await expect(parked).rejects.toMatchObject({ _tag: "PtyNotFound" });
    expect(Date.now() - started).toBeLessThan(450);
  });
});
