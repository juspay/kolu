import { describeDaemon } from "@kolu/daemon-test-gate";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { PtyHostClient } from "./inProcessPtyHost.ts";
import {
  DEFAULT_SPAWN_SHELL,
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostSpawnInput,
} from "./ptyHostSurface.ts";
import {
  closeStream,
  openStream,
  subscribeFrames,
} from "./streamFrame.testlib.ts";
import { Effect, type Stream } from "effect";

export const CONTRACT_COVERAGE = {
  procedures: [
    "terminal.spawn",
    "terminal.kill",
    "terminal.killAll",
    "terminal.write",
    "terminal.resize",
    "terminal.list",
    "terminal.getScreenState",
    "terminal.getScreenText",
    "terminal.getScreenCells",
    "terminal.getHistory",
    "system.version",
    "system.heartbeat",
    "system.info",
  ],
  streams: [
    "terminalAttach",
    "cwd",
    "title",
    "commandRun",
    "foreground",
    "exit",
    "inventory",
    "activity",
  ],
} as const;

export function spawnInput(cwd: string): PtyHostSpawnInput {
  const path = process.env.PATH;
  if (path === undefined) {
    throw new Error("contract corpus requires PATH");
  }
  return {
    argv: [DEFAULT_SPAWN_SHELL],
    cwd,
    env: {
      HOME: cwd,
      PATH: path,
      TERM: "xterm-256color",
    },
    initFiles: [],
  };
}

export async function drainForOverflow(
  iter: AsyncIterator<{ kind: string }>,
  maxPulls: number,
): Promise<string[]> {
  const kinds: string[] = [];
  for (let i = 0; i < maxPulls; i++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      iter.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("overflow frame never arrived")),
          8000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (r.done) break;
    kinds.push(r.value.kind);
    if (r.value.kind === "overflow") break;
  }
  return kinds;
}

export interface CorpusHost {
  client: PtyHostClient;
  isolated?: () => Promise<{
    client: PtyHostClient;
    dispose: () => Promise<void> | void;
  }>;
  dispose: () => Promise<void> | void;
}

async function firstYield<T>(
  stream: Stream.Stream<T, unknown>,
  ms = 5000,
): Promise<T> {
  const iterator = openStream(stream);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("stream timed out")), ms);
  });
  try {
    const result = await Promise.race([iterator.next(), timeout]);
    if (result.done) throw new Error("stream ended without yielding");
    return result.value;
  } finally {
    if (timer) clearTimeout(timer);
    closeStream(iterator);
  }
}

export function runContractCorpus(opts: {
  label: string;
  makeHost: () => Promise<CorpusHost>;
  makeCwd: () => string;
}): void {
  describeDaemon(`pty-host contract corpus — ${opts.label}`, () => {
    let host: CorpusHost;
    const client = (): PtyHostClient => host.client;

    const withIsolated = async (
      body: (c: PtyHostClient) => Promise<void>,
    ): Promise<void> => {
      if (!host.isolated) return body(client());
      const probe = await host.isolated();
      try {
        await body(probe.client);
      } finally {
        await probe.dispose();
      }
    };

    beforeAll(async () => {
      host = await opts.makeHost();
    });

    const killAllAndWait = async (): Promise<number> => {
      const { killed } = await Effect.runPromise(
        client().surface.terminal.killAll({}),
      );
      const after = await Effect.runPromise(client().surface.terminal.list({}));
      expect(after.entries).toEqual([]);
      return killed;
    };

    afterEach(async () => {
      await killAllAndWait();
    }, 20_000);

    afterAll(async () => {
      try {
        await killAllAndWait();
      } finally {
        await host.dispose();
      }
    });

    it("system.version: a self-compatible handshake with a build identity", async () => {
      const v = await Effect.runPromise(client().surface.system.version({}));
      expect(v.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
      expect(typeof v.pid).toBe("number");
      expect(typeof v.startedAt).toBe("number");
      expect(typeof v.identity?.staleKey).toBe("string");
      expect(typeof v.identity?.navigableCommit).toBe("string");
      expect(v.lifetime).toBeDefined();
      expect(["forever", "idleTimeout", "boundToPid"]).toContain(
        v.lifetime?.kind,
      );
    });

    it("system.heartbeat: returns a timestamp", async () => {
      const { ts } = await Effect.runPromise(
        client().surface.system.heartbeat({}),
      );
      expect(typeof ts).toBe("number");
    });

    it("system.info: host facts a client composes spawn policy against", async () => {
      const info = await Effect.runPromise(client().surface.system.info({}));
      expect(info.shell.length).toBeGreaterThan(0);
      expect(typeof info.home).toBe("string");
      expect(info.platform).toBe(process.platform);
      expect(info.rcDir.startsWith("/")).toBe(true);
    });

    it("terminal.list: empty before any spawn (a fresh host)", async () => {
      const { entries } = await Effect.runPromise(
        client().surface.terminal.list({}),
      );
      expect(Array.isArray(entries)).toBe(true);
    });

    it("terminalAttach on an unknown PTY rejects rather than yielding an empty stream", async () => {
      await withIsolated(async (c) => {
        const drain = async (): Promise<void> => {
          const it = openStream(
            c.surface.terminalAttach.get({
              id: "00000000-0000-0000-0000-000000000000",
            }),
          );
          for (;;) {
            const r = await it.next();
            if (r.done) return;
          }
        };
        await expect(drain()).rejects.toThrow();
      });
    });

    it("getScreenState on an unknown PTY fails with the declared PtyNotFound (not a blank string)", async () => {
      await withIsolated(async (c) => {
        await expect(
          Effect.runPromise(
            c.surface.terminal.getScreenState({
              id: "00000000-0000-0000-0000-000000000000",
            }),
          ),
        ).rejects.toMatchObject({ _tag: "PtyNotFound" });
      });
    });

    it("spawn → list → attach (snapshot-first) → write → getScreenText/getScreenState → resize → kill → exit", {
      timeout: 20000,
    }, async () => {
      const dir = opts.makeCwd();
      const { id, pid, cwd } = await Effect.runPromise(
        client().surface.terminal.spawn(spawnInput(dir)),
      );
      expect(pid).toBeGreaterThan(0);
      expect(cwd).toBe(dir);

      const { entries } = await Effect.runPromise(
        client().surface.terminal.list({}),
      );
      expect(entries.some((e) => e.id === id && e.pid === pid)).toBe(true);

      const attach = client().surface.terminalAttach.get({ id });
      const first = await firstYield(attach);
      expect(first.kind).toBe("snapshot");

      await Effect.runPromise(
        client().surface.terminal.write({
          id,
          data: "printf 'CORPUS-MARK-%s\\n' 7\n",
        }),
      );
      let text = "";
      for (let i = 0; i < 60; i++) {
        ({ text } = await Effect.runPromise(
          client().surface.terminal.getScreenText({ id }),
        ));
        if (text.includes("CORPUS-MARK-7")) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(text).toContain("CORPUS-MARK-7");

      const grid = await Effect.runPromise(
        client().surface.terminal.getScreenCells({
          id,
          extent: { kind: "viewport" },
        }),
      );
      expect(grid.lines.length).toBeGreaterThan(0);
      expect(grid.cols).toBeGreaterThan(0);
      const fromCells = grid.lines
        .map((line) => line.cells.map((c) => c.chars).join(""))
        .join("\n");
      expect(fromCells).toContain("CORPUS-MARK-7");

      const { data } = await Effect.runPromise(
        client().surface.terminal.getScreenState({ id }),
      );
      expect(typeof data).toBe("string");

      const history = await Effect.runPromise(
        client().surface.terminal.getHistory({
          id,
          before: 0,
          max: 100,
        }),
      );
      if (history.kind !== "chunk") throw new Error("expected a chunk reply");
      expect(history.exhausted).toBe(true);
      expect(history.chunk).toBe("");

      const resized = await Effect.runPromise(
        client().surface.terminal.resize({
          id,
          cols: 100,
          rows: 40,
        }),
      );
      expect(resized.ok).toBe(true);

      const exitStream = client().surface.exit.get({ id });
      const exitP = firstYield(exitStream, 8000);
      const killed = await Effect.runPromise(
        client().surface.terminal.kill({ id }),
      );
      expect(killed.ok).toBe(true);
      const exit = await exitP;
      expect(typeof exit.exitCode).toBe("number");
    });

    it("streams: cwd (OSC 7) and commandRun (OSC 633) yield on raw drives", {
      timeout: 20000,
    }, async () => {
      const { id } = await Effect.runPromise(
        client().surface.terminal.spawn(spawnInput(opts.makeCwd())),
      );

      const cwdStream = client().surface.cwd.get({ id });
      const cwdP = firstYield(cwdStream);
      await Effect.runPromise(
        client().surface.terminal.write({
          id,
          data: "printf '\\033]7;file://host/tmp/corpus-cwd\\033\\\\'\n",
        }),
      );
      expect((await cwdP).cwd).toContain("/tmp/corpus-cwd");

      const cmdStream = client().surface.commandRun.get({ id });
      const cmdP = firstYield(cmdStream);
      await Effect.runPromise(
        client().surface.terminal.write({
          id,
          data: "printf '\\033]633;E;corpus-command\\033\\\\'\n",
        }),
      );
      const live = await cmdP;
      expect(live).toContain("corpus-command");

      const lateStream = client().surface.commandRun.get({ id });
      const replay = await firstYield(lateStream);
      expect(replay).toContain("corpus-command");

      await Effect.runPromise(client().surface.terminal.kill({ id }));
    });

    it("streams: title (OSC 2) and foreground reach the title tap + list", {
      timeout: 20000,
    }, async () => {
      const { id } = await Effect.runPromise(
        client().surface.terminal.spawn(spawnInput(opts.makeCwd())),
      );

      const fgStream = client().surface.foreground.get({ id });
      const fg = await firstYield(fgStream);
      expect(typeof fg.process).toBe("string");

      const titleStream = client().surface.title.get({ id });
      const titleP = firstYield(titleStream);
      await Effect.runPromise(
        client().surface.terminal.write({
          id,
          data: "printf '\\033]2;corpus-title\\033\\\\'\n",
        }),
      );
      expect((await titleP).title).toContain("corpus-title");

      await Effect.runPromise(
        client().surface.terminal.write({
          id,
          data: "printf '\\033]2;corpus-title-2\\033\\\\'; sleep 5\n",
        }),
      );
      let entry: { title?: string; foregroundProcess?: string } | undefined;
      for (let i = 0; i < 80; i++) {
        const { entries } = await Effect.runPromise(
          client().surface.terminal.list({}),
        );
        entry = entries.find((e) => e.id === id);
        if (entry?.title === "corpus-title-2") break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(entry?.title).toBe("corpus-title-2");
      expect(typeof entry?.foregroundProcess).toBe("string");

      await Effect.runPromise(client().surface.terminal.kill({ id }));
    });

    it("inventory: a snapshot first, then created/exited as PTYs come and go", {
      timeout: 20000,
    }, async () => {
      await withIsolated(async (c) => {
        const frames = subscribeFrames(c.surface.inventory.get({}));
        try {
          const snapshot = await frames.next();
          expect(snapshot.kind).toBe("snapshot");

          const { id } = await Effect.runPromise(
            c.surface.terminal.spawn(spawnInput(opts.makeCwd())),
          );
          const created = await frames.until(
            (e) => e.kind === "created" && e.entry.id === id,
          );
          expect(created).toMatchObject({ kind: "created", entry: { id } });

          await Effect.runPromise(c.surface.terminal.kill({ id }));
          const exited = await frames.until(
            (e) => e.kind === "exited" && e.id === id,
          );
          expect(exited).toEqual({ kind: "exited", id });
        } finally {
          frames.close();
        }
      });
    });

    it("activity: a meaningful-output write yields a host-global edge for that PTY", {
      timeout: 20000,
    }, async () => {
      await withIsolated(async (c) => {
        const frames = subscribeFrames(c.surface.activity.get({}));
        try {
          const { id } = await Effect.runPromise(
            c.surface.terminal.spawn(spawnInput(opts.makeCwd())),
          );
          await Effect.runPromise(
            c.surface.terminal.write({
              id,
              data: "echo corpus-activity\n",
            }),
          );
          const edge = await frames.until((e) => e.id === id);
          expect(edge).toEqual({ id });
          await Effect.runPromise(c.surface.terminal.kill({ id }));
        } finally {
          frames.close();
        }
      });
    });

    it("a live id stays reserved through kill teardown, then can respawn", async () => {
      const id = "11111111-1111-4111-8111-111111111111";
      const first = await Effect.runPromise(
        client().surface.terminal.spawn({
          ...spawnInput(opts.makeCwd()),
          id,
        }),
      );

      await expect(
        Effect.runPromise(
          client().surface.terminal.spawn({
            ...spawnInput(opts.makeCwd()),
            id,
          }),
        ),
      ).rejects.toThrow();

      await Effect.runPromise(client().surface.terminal.kill({ id }));
      expect(
        (await Effect.runPromise(client().surface.terminal.list({}))).entries,
      ).toEqual([]);

      const second = await Effect.runPromise(
        client().surface.terminal.spawn({
          ...spawnInput(opts.makeCwd()),
          id,
        }),
      );
      expect(second.pid).not.toBe(first.pid);
      expect(
        (await Effect.runPromise(client().surface.terminal.list({}))).entries,
      ).toEqual([expect.objectContaining({ id, pid: second.pid })]);
    });

    it("terminal.killAll reaps every live PTY", {
      timeout: 20000,
    }, async () => {
      await Effect.runPromise(
        client().surface.terminal.spawn(spawnInput(opts.makeCwd())),
      );
      await Effect.runPromise(
        client().surface.terminal.spawn(spawnInput(opts.makeCwd())),
      );
      const killed = await killAllAndWait();
      expect(killed).toBeGreaterThanOrEqual(2);
    });
  });
}
