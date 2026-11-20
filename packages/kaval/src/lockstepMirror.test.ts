import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import {
  createOutputCoalesce,
  createScrollLock,
  type DoorTerminal,
} from "@kolu/xterm-kit/write-door";
import { Effect, Fiber, Stream } from "effect";
import { createRoot } from "solid-js";
import { afterEach, expect, it } from "vitest";
import {
  createPtyHost,
  MIN_DATA_BUDGET_CHARS,
  type PtyDataItem,
  type PtyGrid,
  type PtyHost,
  type PtyId,
} from "./ptyHost.ts";

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");

const PANE_RUNS_AHEAD_MS = 300;

const CONVERGE_MS = 8000;

const DIVERGENCE_MS = 3000;

const TEST_TIMEOUT_MS = 40_000;

const shellEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
};

const BURST_TICKS = 12;
const TICK_MS = 50;

const STATUS_ROW = 25;

const REPAINT_LINES = 6;

const COALESCE_MS = 250;

const PAINTER_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "lockstepPainter.cjs",
);

const painterEnv = (floodChars: number): Record<string, string> => ({
  ...shellEnv,
  LOCKSTEP_BURST_TICKS: String(BURST_TICKS),
  LOCKSTEP_TICK_MS: String(TICK_MS),
  LOCKSTEP_STATUS_ROW: String(STATUS_ROW),
  LOCKSTEP_REPAINT_LINES: String(REPAINT_LINES),
  LOCKSTEP_FLOOD_CHARS: String(floodChars),
});

const PAINTER = painterEnv(0);
const FLOOD = painterEnv(MIN_DATA_BUDGET_CHARS * 2);

describeDaemon("a pane's screen is the mirror's screen", () => {
  let live: PtyHost | undefined;
  const teardown: (() => void)[] = [];

  afterEach(() => {
    for (const stop of teardown.splice(0)) stop();
    live?.dispose();
    live = undefined;
  });

  function spawnPainter(env: Record<string, string>): {
    host: PtyHost;
    id: PtyId;
  } {
    const host = createPtyHost({ log: silentLog });
    live = host;
    const { id } = host.spawn({
      shell: process.execPath,
      args: [PAINTER_FIXTURE],
      env,
      cwd: "/tmp",
      cols: 100,
      rows: 30,
    });
    return { host, id };
  }

  const mirrorScreen = (host: PtyHost, id: PtyId): string =>
    trim(host.getScreenText(id, { kind: "viewport" }));

  const paneScreen = (term: HeadlessTerminal): string => {
    const buffer = term.buffer.active;
    const rows: string[] = [];
    for (let y = 0; y < term.rows; y++) {
      rows.push(
        buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? "",
      );
    }
    return trim(rows.join("\n"));
  };

  const trim = (text: string): string =>
    text
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n+$/, "");

  function openPane(
    host: PtyHost,
    id: PtyId,
    opts: { resizeEarly?: boolean } = {},
  ) {
    const term = new Terminal({
      cols: 100,
      rows: 30,
      allowProposedApi: true,
      scrollback: 1000,
    });
    const asBrowser = term as unknown as DoorTerminal;

    let disposeLock = (): void => {};
    const lock = createRoot((dispose) => {
      disposeLock = dispose;
      const created = createScrollLock(
        () => true,
        () => "visible",
      );
      created.attachToTerminal(asBrowser);
      return created;
    });
    const door = createOutputCoalesce(
      () => false,
      {
        write: (data, onParsed) => lock.writeData(asBrowser, data, onParsed),
        resize: (cols, rows) => lock.resizeInOrder(cols, rows),
      },
      { intervalMs: COALESCE_MS },
    );

    const applySnapshot = (snapshot: string, grid: PtyGrid): void => {
      door.clear();
      lock.dropPending();
      term.reset();
      door.resize(grid.cols, grid.rows);
      door.write(snapshot);
    };

    const applyItem = (item: PtyDataItem): void => {
      if (item.kind === "bytes") {
        door.write(item.data);
        return;
      }
      if (opts.resizeEarly) return;
      door.resize(item.grid.cols, item.grid.rows);
    };

    const leg = (resizeTo: PtyGrid | undefined) =>
      Effect.scoped(
        Effect.gen(function* () {
          const att = yield* host.attach(
            id,
            resizeTo ? { resizeTo } : undefined,
          );
          applySnapshot(att.snapshot, att.grid);
          return yield* Stream.runForEach(att.deltas, (item) =>
            Effect.sync(() => applyItem(item)),
          ).pipe(
            Effect.as("ended" as const),
            Effect.catch(() => Effect.succeed("dropped" as const)),
          );
        }),
      );

    const loop = Effect.gen(function* () {
      let first = true;
      for (;;) {
        const outcome = yield* leg(first ? { cols: 100, rows: 30 } : undefined);
        first = false;
        if (outcome === "ended") return;
      }
    });
    const fiber = Effect.runFork(loop);

    const stop = (): void => {
      Effect.runFork(Fiber.interrupt(fiber));
      door.dispose();
      disposeLock();
      term.dispose();
    };
    teardown.push(stop);

    return {
      term,
      screen: () => paneScreen(term),
      resizeBox: (grid: PtyGrid) => {
        if (opts.resizeEarly) door.resize(grid.cols, grid.rows);
      },
      flush: () => door.flush(),
    };
  }

  async function until(check: () => boolean, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (check()) return true;
      if (Date.now() > deadline) return false;
      const tick = Promise.withResolvers<void>();
      setTimeout(() => tick.resolve(), 20);
      await tick.promise;
    }
  }

  const settled = (host: PtyHost, id: PtyId, cols: number, rows: number) =>
    until(
      () =>
        host
          .getScreenText(id, { kind: "viewport" })
          .includes(`IDLE ${cols}x${rows}`),
      CONVERGE_MS,
    );

  async function agree(
    host: PtyHost,
    id: PtyId,
    pane: { screen: () => string; flush: () => void },
    ms = CONVERGE_MS,
  ): Promise<boolean> {
    return until(() => {
      pane.flush();
      return paneAgreesWith(host, id, pane);
    }, ms);
  }

  const paneAgreesWith = (
    host: PtyHost,
    id: PtyId,
    pane: { screen: () => string },
  ): boolean => pane.screen() === mirrorScreen(host, id);

  function diff(
    host: PtyHost,
    id: PtyId,
    pane: { screen: () => string },
  ): string {
    const mine = pane.screen().split("\n");
    const theirs = mirrorScreen(host, id).split("\n");
    const at = mine.findIndex((line, i) => line !== theirs[i]);
    return [
      `the pane and the mirror differ from row ${at < 0 ? mine.length : at}`,
      "pane:",
      ...mine.slice(0, 12).map((l) => `  |${l}`),
      "mirror:",
      ...theirs.slice(0, 12).map((l) => `  |${l}`),
    ].join("\n");
  }

  async function burstUnderway(host: PtyHost, id: PtyId): Promise<void> {
    const before = host.getScreenText(id, { kind: "viewport" });
    host.write(id, "b");
    const started = await until(
      () => host.getScreenText(id, { kind: "viewport" }) !== before,
      CONVERGE_MS,
    );
    expect(started, "the program never answered the burst request").toBe(true);
    const ticks = Promise.withResolvers<void>();
    setTimeout(() => ticks.resolve(), TICK_MS * 2);
    await ticks.promise;
  }

  it(
    "agrees when the window ends UNDER budget — the held bytes are forwarded",
    async () => {
      const { host, id } = spawnPainter(PAINTER);
      const pane = openPane(host, id);
      expect(await settled(host, id, 100, 30)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);

      await burstUnderway(host, id);
      expect(host.resize(id, 70, 20)).toBe(true);
      expect(await settled(host, id, 70, 20)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);
      expect(pane.term.rows).toBe(20);
      expect(pane.term.cols).toBe(70);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "agrees when the window ends OVER budget — dropped, re-attached, re-snapshotted",
    async () => {
      const { host, id } = spawnPainter(FLOOD);
      const pane = openPane(host, id);
      expect(await settled(host, id, 100, 30)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);

      await burstUnderway(host, id);
      expect(host.resize(id, 70, 20)).toBe(true);
      expect(await settled(host, id, 70, 20)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);
      expect(pane.term.rows).toBe(20);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "agrees across a SECOND resize inside an open window",
    async () => {
      const { host, id } = spawnPainter(PAINTER);
      const pane = openPane(host, id);
      expect(await settled(host, id, 100, 30)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);

      await burstUnderway(host, id);
      expect(host.resize(id, 80, 24)).toBe(true);
      expect(host.resize(id, 60, 16)).toBe(true);

      expect(
        await until(() => pane.term.rows === 16 && pane.term.cols === 60, 2000),
        "the pane was not told the second size",
      ).toBe(true);

      expect(await settled(host, id, 60, 16)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "does NOT agree when the pane resizes at its own box — today's behaviour",
    async () => {
      const { host, id } = spawnPainter(PAINTER);
      const pane = openPane(host, id, { resizeEarly: true });
      expect(await settled(host, id, 100, 30)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);

      await burstUnderway(host, id);
      pane.resizeBox({ cols: 70, rows: 20 });
      const gap = Promise.withResolvers<void>();
      setTimeout(() => gap.resolve(), PANE_RUNS_AHEAD_MS);
      await gap.promise;
      expect(host.resize(id, 70, 20)).toBe(true);

      expect(await settled(host, id, 70, 20)).toBe(true);
      expect(
        await agree(host, id, pane, DIVERGENCE_MS),
        "the two screens AGREED — this control must diverge, or the cases above prove nothing",
      ).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
