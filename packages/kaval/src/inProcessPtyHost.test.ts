/**
 * The in-process identity-link path: the contract corpus
 * (`contractCorpus.testlib.ts`) instantiated over `createInProcessPtyHost`'s
 * `directLink` client — the fast path kolu-server's web tier uses — plus the
 * one mechanism that is identity-link-specific and has no socket analogue: the
 * abort-before-kill silence `local.ts` relies on to keep an intentional kill
 * from surfacing as a `terminalExit`.
 *
 * The SAME corpus runs over a real spawned daemon's socket in
 * `socketDaemon.test.ts`, so the two links are pinned to identical behaviour.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runContractCorpus, spawnInput } from "./contractCorpus.testlib.ts";
import {
  createInProcessPtyHost,
  type PtyHostClient,
} from "./inProcessPtyHost.ts";
import { nextFrame } from "./streamFrame.testlib.ts";
import type { Logger } from "@kolu/surface-daemon";

const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeClient(opts?: { dataMaxQueue?: number }): PtyHostClient {
  return createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
    dataMaxQueue: opts?.dataMaxQueue,
  }).client;
}

const makeCwd = (): string => mkdtempSync(join(tmpdir(), "kolu-inproc-"));

// The full contract corpus over the identity link. One host backs the whole
// suite; the corpus reaps its PTYs in afterAll.
runContractCorpus({
  label: "identity link",
  makeHost: async () => ({ client: makeClient(), dispose: () => {} }),
  makeCwd,
});

describe("createInProcessPtyHost — identity-link-specific mechanism", () => {
  it("terminalAttach on an unknown PTY rejects with the structured NOT_FOUND local.ts reads", async () => {
    // The corpus asserts only "rejects" for the stream (the socket link's error
    // code races a transport-close). Here, on the identity link, the precise
    // NOT_FOUND shape is deterministic — and it is the shape kolu-server's
    // `local.ts` re-attach loop reads as "the PTY is gone" — so pin it.
    const client = makeClient();
    const iterate = async (): Promise<void> => {
      for await (const _ of await client.surface.terminalAttach.get({
        id: "00000000-0000-0000-0000-000000000000",
      })) {
        break;
      }
    };
    await expect(iterate()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("inventory yields a snapshot first, then created/exited deltas (snapshot-then-deltas)", async () => {
    // The contract kolu-server's live reconciler reads: the first frame is a
    // snapshot of every live PTY, then membership deltas. Spawn one BEFORE
    // subscribing so it appears in the snapshot; spawn a second AFTER so it
    // arrives as a `created`; kill it for the `exited`.
    const client = makeClient();
    const { id: first } = await client.surface.terminal.spawn(
      spawnInput(makeCwd()),
    );
    const ac = new AbortController();
    const it = (await client.surface.inventory.get({}, { signal: ac.signal }))[
      Symbol.asyncIterator
    ]();

    const snapshot = await nextFrame(it);
    expect(snapshot.kind).toBe("snapshot");
    if (snapshot.kind !== "snapshot") throw new Error("unreachable");
    expect(snapshot.entries.map((e) => e.id)).toContain(first);

    const { id: second } = await client.surface.terminal.spawn(
      spawnInput(makeCwd()),
    );
    // The snapshot already contained `first`, so the next NEW-id frame is the
    // `created` for `second` (a duplicate of `first` can't occur — it was live
    // before we subscribed).
    const created = await nextFrame(it);
    expect(created).toMatchObject({ kind: "created", entry: { id: second } });

    await client.surface.terminal.kill({ id: second });
    const exited = await nextFrame(it);
    expect(exited).toEqual({ kind: "exited", id: second });

    ac.abort();
    await client.surface.terminal.kill({ id: first });
  });

  it("an aborted exit subscription stops without delivering the exit (the kill-silence mechanism)", async () => {
    // The mechanism `local.ts` relies on to keep an intentional kill silent:
    // `teardownSensors` aborts the exit-tap signal BEFORE the kill, so the
    // tap ends via abort rather than yielding an exit code that would become a
    // `terminalExit`. Verify the contract honors that abort.
    const client = makeClient();
    const { id } = await client.surface.terminal.spawn(spawnInput(makeCwd()));
    const ac = new AbortController();
    const it = (await client.surface.exit.get({ id }, { signal: ac.signal }))[
      Symbol.asyncIterator
    ]();
    const next = it.next();
    ac.abort();
    let deliveredExit = false;
    try {
      const r = await next;
      if (!r.done) deliveredExit = true; // yielded despite the abort
    } catch {
      // abort surfaced as a throw — also "stopped without delivering"
    }
    expect(deliveredExit).toBe(false);
    await client.surface.terminal.kill({ id });
  });

  it("commandRun replays the last command to a late subscriber (snapshot-first)", async () => {
    // The bug this fixes (issue #1558): a sensor that subscribes AFTER the
    // OSC 633;E mark — a pulam that attaches lazily, or one that restarts
    // mid-session — never learned the command, so a command-only agent like
    // codex (it runs as `node`) showed as a non-agent `node`. The retention
    // `commandRun` source now replays the last command snapshot-first, exactly
    // as `foreground` already replays the current process.
    const client = makeClient();
    const { id } = await client.surface.terminal.spawn(spawnInput(makeCwd()));

    // Drive a command-run and confirm an EARLY subscriber sees it live, so the
    // host's retention is in place before the late subscriber joins.
    const ac1 = new AbortController();
    const early = (
      await client.surface.commandRun.get({ id }, { signal: ac1.signal })
    )[Symbol.asyncIterator]();
    await client.surface.terminal.write({
      id,
      data: "printf '\\033]633;E;codex\\033\\\\'\n",
    });
    const liveFrame = await nextFrame(early);
    expect(liveFrame.command).toContain("codex");
    // A live mark is flagged `replayed: false`.
    expect(liveFrame.replayed).toBe(false);
    ac1.abort();

    // The repro: a NEW subscriber, joining after the mark, must still receive
    // the command — snapshot-first, on its very first frame. Before the fix it
    // got nothing and this hangs to the nextFrame timeout. The frame is flagged
    // `replayed: true` so the consumer seeds detection WITHOUT re-firing the
    // live-only recent-agent recency bump.
    const ac2 = new AbortController();
    const late = (
      await client.surface.commandRun.get({ id }, { signal: ac2.signal })
    )[Symbol.asyncIterator]();
    const replayFrame = await nextFrame(late);
    expect(replayFrame.command).toContain("codex");
    expect(replayFrame.replayed).toBe(true);

    ac2.abort();
    await client.surface.terminal.kill({ id });
  });

  it("terminalAttach yields a typed `overflow` frame when a slow subscriber is dropped", {
    timeout: 20000,
  }, async () => {
    // The R5 bug: kaval sheds a slow attach subscriber by ENDING its iterator —
    // which, before this fix, was indistinguishable on the wire from a PTY exit,
    // so the consumer (kolu-server's web tier) treated the drop as terminal and
    // froze scrollback instead of re-attaching. The fix surfaces a typed
    // `overflow` control frame as the stream's last frame, so the drop is
    // distinguishable from a graceful end. A 1-deep data queue makes the drop
    // deterministic.
    const client = makeClient({ dataMaxQueue: 1 });
    const { id } = await client.surface.terminal.spawn(spawnInput(makeCwd()));

    // Read the snapshot first — that pull starts the (lazy) source generator,
    // so it subscribes to the data channel before we flood it. Then STOP
    // reading: live PTY output piles into this subscriber's 1-deep queue and
    // trips the slow-subscriber drop while we look away.
    const ac = new AbortController();
    const iter = (
      await client.surface.terminalAttach.get({ id }, { signal: ac.signal })
    )[Symbol.asyncIterator]();
    const snap = await iter.next();
    expect(snap.done).toBe(false);
    if (!snap.done) expect(snap.value.kind).toBe("snapshot");

    // Produce well more than one chunk of output without reading any of it.
    for (let i = 0; i < 8; i++) {
      await client.surface.terminal.write({
        id,
        data: `printf 'OVF-%s\\n' ${i}\n`,
      });
    }
    // Poll the rendered mirror (a separate RPC — it does NOT drain the attach
    // stream) until the last line lands, proving the host produced the output
    // and so the drop has latched before we start reading.
    let text = "";
    for (let i = 0; i < 120; i++) {
      ({ text } = await client.surface.terminal.getScreenText({ id }));
      if (text.includes("OVF-7")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(text).toContain("OVF-7");

    // Drain: the contract must surface a typed `overflow` frame. Before the fix
    // the stream simply ended here (no such frame) — the exact ambiguity the fix
    // removes. Each pull is timeout-guarded so a regression fails loudly rather
    // than hanging.
    const pull = (): Promise<IteratorResult<{ kind: string }>> =>
      Promise.race([
        iter.next(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("overflow frame never arrived")),
            8000,
          ),
        ),
      ]);
    const kinds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await pull();
      if (r.done) break;
      kinds.push(r.value.kind);
      if (r.value.kind === "overflow") break;
    }
    expect(kinds).toContain("overflow");

    ac.abort();
    await client.surface.terminal.kill({ id });
  });
});
