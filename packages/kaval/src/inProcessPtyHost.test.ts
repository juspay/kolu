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

function makeClient(): PtyHostClient {
  return createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
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
});
