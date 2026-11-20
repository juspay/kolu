import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { expect, it } from "vitest";
import { Effect } from "effect";
import {
  drainForOverflow,
  runContractCorpus,
  spawnInput,
} from "./contractCorpus.testlib.ts";
import {
  createInProcessPtyHost,
  type PtyHostClient,
} from "./inProcessPtyHost.ts";
import {
  closeStream,
  nextFrame,
  openStream,
  subscribeFrames,
} from "./streamFrame.testlib.ts";
function makeClient(opts?: { dataMaxQueue?: number }): PtyHostClient {
  return createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
    dataMaxQueue: opts?.dataMaxQueue,
    lifetime: { kind: "forever" },
  }).client;
}

const makeCwd = (): string => mkdtempSync(join(tmpdir(), "kolu-inproc-"));

runContractCorpus({
  label: "identity link",
  makeHost: async () => ({ client: makeClient(), dispose: () => {} }),
  makeCwd,
});

describeDaemon(
  "createInProcessPtyHost — identity-link-specific mechanism",
  () => {
    it("terminalAttach on an unknown PTY rejects with the structured PtyNotFound local.ts reads", async () => {
      const client = makeClient();
      const iterate = async (): Promise<void> => {
        const it = openStream(
          client.surface.terminalAttach.get({
            id: "00000000-0000-0000-0000-000000000000",
          }),
        );
        await it.next();
      };
      await expect(iterate()).rejects.toMatchObject({ _tag: "PtyNotFound" });
    });

    it("inventory yields a snapshot first, then created/exited deltas (snapshot-then-deltas)", async () => {
      const client = makeClient();
      const { id: first } = await Effect.runPromise(
        client.surface.terminal.spawn(spawnInput(makeCwd())),
      );
      const it = openStream(client.surface.inventory.get({}));

      const snapshot = await nextFrame(it);
      expect(snapshot.kind).toBe("snapshot");
      if (snapshot.kind !== "snapshot") throw new Error("unreachable");
      expect(snapshot.entries.map((e) => e.id)).toContain(first);

      const { id: second } = await Effect.runPromise(
        client.surface.terminal.spawn(spawnInput(makeCwd())),
      );
      const created = await nextFrame(it);
      expect(created).toMatchObject({ kind: "created", entry: { id: second } });

      await Effect.runPromise(client.surface.terminal.kill({ id: second }));
      const exited = await nextFrame(it);
      expect(exited).toEqual({ kind: "exited", id: second });

      closeStream(it);
      await Effect.runPromise(client.surface.terminal.kill({ id: first }));
    });

    it("a closed exit subscription stops without delivering the exit (the kill-silence mechanism)", async () => {
      const client = makeClient();
      const { id } = await Effect.runPromise(
        client.surface.terminal.spawn(spawnInput(makeCwd())),
      );
      const it = openStream(client.surface.exit.get({ id }));
      const next = it.next();
      closeStream(it);
      const outcome = await next.then(
        (r) => (r.done ? "ended" : "delivered"),
        () => "threw" as const,
      );
      expect(outcome).not.toBe("delivered");
      await Effect.runPromise(client.surface.terminal.kill({ id }));
    });

    it("commandRun replays the last command to a late subscriber (snapshot-first)", async () => {
      const client = makeClient();
      const { id } = await Effect.runPromise(
        client.surface.terminal.spawn(spawnInput(makeCwd())),
      );

      const early = subscribeFrames(client.surface.commandRun.get({ id }));
      await Effect.runPromise(
        client.surface.terminal.write({
          id,
          data: "printf '\\033]633;E;codex\\033\\\\'\n",
        }),
      );
      const liveFrame = await early.next();
      expect(liveFrame).toContain("codex");
      early.close();

      const late = openStream(client.surface.commandRun.get({ id }));
      const replayFrame = await nextFrame(late);
      expect(replayFrame).toContain("codex");

      closeStream(late);
      await Effect.runPromise(client.surface.terminal.kill({ id }));
    });

    it("a command-rooted spawn's commandRun snapshot replays the seed verbatim (#1872)", async () => {
      const client = makeClient();
      const { id } = await Effect.runPromise(
        client.surface.terminal.spawn({
          ...spawnInput(makeCwd()),
          argv: ["/bin/sh", "-c", "sleep 5"],
          commandRooted: true,
        }),
      );
      const seed = openStream(client.surface.commandRun.get({ id }));
      const frame = await nextFrame(seed);
      expect(frame).toBe("/bin/sh -c 'sleep 5'");
      closeStream(seed);
      await Effect.runPromise(client.surface.terminal.kill({ id }));
    });

    it("terminalAttach yields a typed `overflow` frame when a slow subscriber is dropped", {
      timeout: 20000,
    }, async () => {
      const client = makeClient({ dataMaxQueue: 1 });
      const { id } = await Effect.runPromise(
        client.surface.terminal.spawn(spawnInput(makeCwd())),
      );

      const iter = openStream(client.surface.terminalAttach.get({ id }));
      const snap = await iter.next();
      expect(snap.done).toBe(false);
      if (!snap.done) expect(snap.value.kind).toBe("snapshot");

      for (let i = 0; i < 8; i++) {
        await Effect.runPromise(
          client.surface.terminal.write({
            id,
            data: `printf 'OVF-%s\\n' ${i}\n`,
          }),
        );
      }
      let text = "";
      for (let i = 0; i < 120; i++) {
        ({ text } = await Effect.runPromise(
          client.surface.terminal.getScreenText({ id }),
        ));
        if (text.includes("OVF-7")) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(text).toContain("OVF-7");

      const kinds = await drainForOverflow(iter, 20);
      expect(kinds).toContain("overflow");

      closeStream(iter);
      await Effect.runPromise(client.surface.terminal.kill({ id }));
    });
  },
);
