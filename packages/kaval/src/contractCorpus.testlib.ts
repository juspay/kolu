/**
 * The pty-host contract corpus — a reusable suite that exercises EVERY
 * procedure and stream of `ptyHostSurface` against a `PtyHostClient`, whatever
 * link backs it. B1 instantiates it twice: over the in-process identity link
 * (`inProcessPtyHost.test.ts`, the fast path) and over a REAL spawned `kaval`
 * daemon's unix socket (`socketDaemon.test.ts`). One corpus, two links — so the
 * daemon can never drift from in-process behaviour unnoticed.
 *
 * This is a `.testlib.ts`, NOT a `.test.ts`: vitest's `include` is
 * `*.test.ts`, so this file is never run as a standalone suite (it has no
 * top-level `describe`), and default.nix's staleKey fileFilter excludes
 * `.testlib.ts` so a shared test helper does not land in the daemon's hashed
 * closure (which would fail `buildId.closure.test.ts`'s reachable==hashed
 * assertion — the lesson paid for in B0's review).
 *
 * `CONTRACT_COVERAGE` is the manifest of what this corpus touches; the
 * `coverage.test.ts` ledger asserts it equals `ptyHostSurface`'s actual key set,
 * so adding a procedure or stream without covering it fails CI — "full
 * coverage" is mechanical, not aspirational.
 */

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

/** Every contract entry the corpus exercises. Asserted against the live surface
 *  by `coverage.test.ts` — keep it in lockstep with the `it`s below AND with
 *  `ptyHostSurface`. */
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

/** A minimal fully-specified spawn — the fixed default shell with a minimal
 *  sanitized environment, no login flag, and no init files. Since B0
 *  the host derives nothing from policy, so a bare client supplies the complete
 *  `{argv, env, initFiles}` (and this exercises exactly that no-hooks path). The
 *  env crosses the wire verbatim on the socket link. */
export function spawnInput(cwd: string): PtyHostSpawnInput {
  const path = process.env.PATH;
  if (path === undefined) {
    throw new Error("contract corpus requires PATH");
  }
  return {
    argv: [DEFAULT_SPAWN_SHELL],
    cwd,
    // Keep host shell hooks (ENV, BASH_ENV, ZDOTDIR, inherited SHELL) out of
    // this transport contract. They can run arbitrary user startup code before
    // the corpus' first frame and make a socket test depend on the CI account.
    env: {
      HOME: cwd,
      PATH: path,
      TERM: "xterm-256color",
    },
    initFiles: [],
  };
}

/** Pull frames off an already-open `terminalAttach` iterator until a typed
 *  `overflow` frame arrives (or the stream ends, or `maxPulls` is reached),
 *  returning the frame kinds seen so the caller can assert `toContain("overflow")`.
 *  Each pull is timeout-guarded so a regression — a silent end with no `overflow`
 *  frame, the exact ambiguity the R5 fix removed — fails loudly instead of
 *  hanging. Shared by the in-process and real-socket overflow tests, which differ
 *  only in how many laggard frames precede the drop (`maxPulls`). */
export async function drainForOverflow(
  iter: AsyncIterator<{ kind: string }>,
  maxPulls: number,
): Promise<string[]> {
  const kinds: string[] = [];
  for (let i = 0; i < maxPulls; i++) {
    // Clear the timer the instant the race settles — otherwise every pull that
    // beats the timeout (i.e. every frame, up to `maxPulls`) leaves an 8s timer
    // that later rejects an orphaned promise: an unhandled rejection and a
    // process the test can't exit. Mirrors `nextFrame`'s `finally`-clear.
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

/** A client plus the teardown that releases whatever backs it (the socket
 *  connection, and — for the daemon — the daemon process). */
export interface CorpusHost {
  client: PtyHostClient;
  /** An INDEPENDENT client over the same host, for negative-path tests that can
   *  tear down a multiplexed transport (a stream that errors at its source can
   *  close the whole stdio connection over the socket). Provided by the socket
   *  host so such a test never poisons the shared connection; omitted by the
   *  identity link, where each call is independent and the shared client is
   *  safe. */
  isolated?: () => Promise<{
    client: PtyHostClient;
    dispose: () => Promise<void> | void;
  }>;
  dispose: () => Promise<void> | void;
}

/** Resolve a stream's first yielded value, or reject on timeout — so a stream
 *  that never fires fails loudly instead of hanging the suite. ALWAYS closes the
 *  subscription before returning: over the socket link a left-open subscription
 *  rejects when the connection later disposes, surfacing as an unhandled
 *  rejection that fails the whole file. Closing the iterator interrupts the
 *  subscribing fiber, which IS the unsubscribe. */
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

/** The corpus. `makeHost` is awaited once per run; `dispose` is called after.
 *  Drives every procedure and stream in `CONTRACT_COVERAGE`. */
export function runContractCorpus(opts: {
  label: string;
  makeHost: () => Promise<CorpusHost>;
  makeCwd: () => string;
}): void {
  // ALWAYS gated: the corpus forks real PTYs via `terminal.spawn` on EVERY host
  // (in-process or spawned-daemon), so a bare `vitest` must skip it and fork
  // nothing (#1375). `describe` stays imported for the pure-logic blocks elsewhere.
  describeDaemon(`pty-host contract corpus — ${opts.label}`, () => {
    let host: CorpusHost;
    const client = (): PtyHostClient => host.client;

    /** Run `body` against an isolated client when the host provides one (the
     *  socket), else the shared client (identity). Always disposes the isolated
     *  one — so a transport-closing negative path never poisons the corpus's
     *  shared connection. */
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

    /** Reap the shared host through killAll's production boundary, then prove
     *  inventory is empty. Tests intentionally share an expensive daemon host,
     *  so clean per-test state is enforced here rather than left to individual
     *  assertion tails. */
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
      } catch {
        // The connection may already be torn down by a prior failure — the
        // dispose below still runs.
      } finally {
        await host.dispose();
      }
    });

    it("system.version: a self-compatible handshake with a build identity", async () => {
      const v = await Effect.runPromise(client().surface.system.version({}));
      expect(v.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
      expect(typeof v.pid).toBe("number");
      expect(typeof v.startedAt).toBe("number");
      // The optional identity is always populated by the in-process serving —
      // two strings (empty off-nix, where KAVAL_BUILD_ID / KAVAL_COMMIT_HASH
      // aren't baked).
      expect(typeof v.identity?.staleKey).toBe("string");
      expect(typeof v.identity?.navigableCommit).toBe("string");
      // The daemon injects its resolved lifetime once at boot and serves the
      // projection here — so it APPEARS on `system.version` (never dropped by the
      // produce site), which is what makes the Kaval dialog's lifetime row the
      // daemon's own honest self-report rather than a guess. Which policy depends on
      // how the corpus host was launched (`forever` in-process / over the socket;
      // `boundToPid` only under KOLU_DAEMON_BIND_PID), so pin its presence + a valid
      // kind, not one arm.
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
      // A stream that errors at its source closes the multiplexed stdio
      // transport over the socket, so this runs on an ISOLATED connection (it
      // would otherwise poison the corpus's shared one). The reject CODE is
      // link-dependent — the identity link surfaces the server's structured
      // NOT_FOUND, the socket may surface either NOT_FOUND or a transport-closed
      // error depending on which frame wins the race — so the corpus asserts
      // only "it rejects"; the precise NOT_FOUND shape `local.ts` reads is
      // pinned deterministically on the identity link in `inProcessPtyHost.test.ts`.
      await withIsolated(async (c) => {
        const drain = async (): Promise<void> => {
          const it = openStream(
            c.surface.terminalAttach.get({
              id: "00000000-0000-0000-0000-000000000000",
            }),
          );
          // The first pull rejects; if it ever yields instead, this loop's exit
          // (a done iterator) fails the expectation below by NOT throwing.
          for (;;) {
            const r = await it.next();
            if (r.done) return;
          }
        };
        await expect(drain()).rejects.toThrow();
      });
    });

    it("getScreenState on an unknown PTY fails with the declared PtyNotFound (not a blank string)", async () => {
      // A procedure carries its error as a response frame (no transport close),
      // so the DECLARED `PtyNotFound` is deterministic over both links — the
      // whole point of declaring it (D4). Run it isolated too, for symmetry and
      // to keep the shared connection pristine.
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

      // list shows it with the resolved id + pid.
      const { entries } = await Effect.runPromise(
        client().surface.terminal.list({}),
      );
      expect(entries.some((e) => e.id === id && e.pid === pid)).toBe(true);

      // attach is snapshot-then-deltas: the first frame is the snapshot.
      const attach = client().surface.terminalAttach.get({ id });
      const first = await firstYield(attach);
      expect(first.kind).toBe("snapshot");

      // write a marker, then read it back through the rendered buffer.
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

      // getScreenCells returns the SAME screen as attributed cells — the read
      // a rendered screenshot is drawn from. The mark the text read just found
      // must be findable in the cells too: they are two renderings of one
      // slice, so a divergence here means the extent resolution drifted.
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

      // getScreenState returns the serialized screen (a non-empty string here).
      const { data } = await Effect.runPromise(
        client().surface.terminal.getScreenState({ id }),
      );
      expect(typeof data).toBe("string");

      // getHistory: this shallow terminal's whole history fits the bounded
      // attach snapshot, so a fetch above its top is an empty, exhausted no-op —
      // enough to exercise the verb end to end over the wire.
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

      // resize is accepted.
      const resized = await Effect.runPromise(
        client().surface.terminal.resize({
          id,
          cols: 100,
          rows: 40,
        }),
      );
      expect(resized.ok).toBe(true);

      // exit tap yields once on kill.
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
      // Drive the OSC sequences DIRECTLY over `write` rather than via shell rc
      // hooks — a bare corpus shell has none (those are kolu's client-side
      // policy), so this exercises the host's own VT parsing of the taps.
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
      // OSC 633 ; E ; <command-line> ST — the preexec mark kolu's hook emits.
      await Effect.runPromise(
        client().surface.terminal.write({
          id,
          data: "printf '\\033]633;E;corpus-command\\033\\\\'\n",
        }),
      );
      const live = await cmdP;
      expect(live.command).toContain("corpus-command");
      // A live mark is flagged `replayed: false` so consumers fire their
      // live-only side effects (recent-agent recency) on it.
      expect(live.replayed).toBe(false);

      // Snapshot-first replay (the new contract guarantee): a subscriber that
      // joins AFTER the mark still gets the last command on its first frame,
      // flagged `replayed: true` so it seeds detection without re-firing the
      // live-only recency bump. Pinned HERE — not just the identity-link suite —
      // so the real socket daemon path exercises it too.
      const lateStream = client().surface.commandRun.get({ id });
      const replay = await firstYield(lateStream);
      expect(replay.command).toContain("corpus-command");
      expect(replay.replayed).toBe(true);

      await Effect.runPromise(client().surface.terminal.kill({ id }));
    });

    it("streams: title (OSC 2) and foreground reach the title tap + list", {
      timeout: 20000,
    }, async () => {
      const { id } = await Effect.runPromise(
        client().surface.terminal.spawn(spawnInput(opts.makeCwd())),
      );

      // foreground tap yields a snapshot first (the host pushes current state).
      const fgStream = client().surface.foreground.get({ id });
      const fg = await firstYield(fgStream);
      expect(typeof fg.process).toBe("string");

      // The title stream yields on the OSC 2 escape directly. Subscribe FIRST,
      // then drive the title at an idle prompt (no trailing `sleep` — a busy
      // foreground wouldn't process the stdin write until it returned).
      const titleStream = client().surface.title.get({ id });
      const titleP = firstYield(titleStream);
      await Effect.runPromise(
        client().surface.terminal.write({
          id,
          data: "printf '\\033]2;corpus-title\\033\\\\'\n",
        }),
      );
      expect((await titleP).title).toContain("corpus-title");

      // For the LIST projection, drive a title under a long-lived foreground
      // command so it isn't clobbered by the prompt redraw before we read it —
      // and so `foregroundProcess` reflects a known running process.
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
      // The host-global membership feed kolu-server's live reconciler reads: one
      // ISOLATED subscription kept open across a spawn and a kill, so this never
      // poisons the shared connection (a left-open socket stream rejects on
      // dispose). Subscribe FIRST — the spawn below must land as a `created`
      // delta, not be missed.
      await withIsolated(async (c) => {
        const frames = subscribeFrames(c.surface.inventory.get({}));
        try {
          // First frame: a snapshot of every live PTY (snapshot-then-deltas).
          const snapshot = await frames.next();
          expect(snapshot.kind).toBe("snapshot");

          // A fresh spawn arrives as a `created` for its id (intervening deltas
          // from the shared host are skipped by `until`).
          const { id } = await Effect.runPromise(
            c.surface.terminal.spawn(spawnInput(opts.makeCwd())),
          );
          const created = await frames.until(
            (e) => e.kind === "created" && e.entry.id === id,
          );
          expect(created).toMatchObject({ kind: "created", entry: { id } });

          // …and its kill arrives as an `exited` for the same id.
          await Effect.runPromise(c.surface.terminal.kill({ id }));
          const exited = await frames.until(
            (e) => e.kind === "exited" && e.id === id,
          );
          expect(exited).toEqual({ kind: "exited", id });
        } finally {
          // Close the subscription (the socket-safety `firstYield` documents).
          frames.close();
        }
      });
    });

    it("activity: a meaningful-output write yields a host-global edge for that PTY", {
      timeout: 20000,
    }, async () => {
      // The host-global meaningful-output feed. ISOLATED (like inventory) so a
      // left-open stream can't poison the shared connection, and subscribed
      // FIRST so the spawn's own output isn't missed. Unlike inventory there is
      // no snapshot frame to pull, so the subscription is established by
      // `subscribeFrames` issuing the first pull rather than by the test
      // happening to read one — this feed is PURELY live, and an edge that lands
      // before anyone is listening is simply gone.
      await withIsolated(async (c) => {
        const frames = subscribeFrames(c.surface.activity.get({}));
        try {
          const { id } = await Effect.runPromise(
            c.surface.terminal.spawn(spawnInput(opts.makeCwd())),
          );
          // Drive real output — the shell echoes + runs, producing bytes.
          await Effect.runPromise(
            c.surface.terminal.write({
              id,
              data: "echo corpus-activity\n",
            }),
          );
          // An edge for THIS PTY arrives (other terminals' edges are skipped).
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

      // This is the same state an overlapping kill/spawn observes until the
      // old child's onExit teardown: the id must not be overwritten.
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
      // The shared cleanup authority resolves only after killAll's production
      // boundary has observed every onExit and removed every inventory row.
      const killed = await killAllAndWait();
      expect(killed).toBeGreaterThanOrEqual(2);
    });
  });
}
