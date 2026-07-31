import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { gatePid, isHolderLive } from "./pidGate.ts";
import {
  plantYesterdayDaemon,
  type YesterdayDaemonOpts,
} from "./upgradeWindow.testlib.ts";
import { match } from "ts-pattern";

const planted: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  for (const daemon of planted.splice(0)) await daemon.dispose();
});

function fixtureOptions(
  opts: Partial<YesterdayDaemonOpts> = {},
): YesterdayDaemonOpts {
  return {
    gateFile: "daemon.pid",
    socketFile: "daemon.sock",
    assertSpawnAllowed: assertDaemonSpawnAllowed,
    plantState: ({ confPath, state }) =>
      writeFileSync(
        confPath,
        JSON.stringify(
          match(state)
            .with({ kind: "conf" }, ({ conf }) => conf)
            .with({ kind: "session" }, ({ session }) => ({ session }))
            .exhaustive(),
        ),
      ),
    ...opts,
  };
}

describeDaemon("yesterday-daemon fixture", () => {
  it("plants a live child, current gate, private dir, and accepting socket", async () => {
    const daemon = await plantYesterdayDaemon(fixtureOptions());
    planted.push(daemon);
    expect(daemon.process.kind).toBe("live");
    if (daemon.process.kind !== "live")
      throw new Error("expected live process");
    expect(isHolderLive(daemon.process.pid)).toBe(true);
    expect(gatePid(daemon.gatePath)).toBe(daemon.process.pid);
    expect(readFileSync(daemon.gatePath, "utf8").trim()).toBe(
      String(daemon.process.pid),
    );
    expect(lstatSync(daemon.dir).mode & 0o077).toBe(0);
    expect(existsSync(daemon.socketPath)).toBe(true);
  });

  it("plants a foreign gate without claiming a parsable pid", async () => {
    const daemon = await plantYesterdayDaemon(
      fixtureOptions({
        gate: { kind: "foreign", content: '{"format":2,"pid":999}\n' },
        withSocket: false,
      }),
    );
    planted.push(daemon);
    expect(daemon.process.kind).toBe("live");
    if (daemon.process.kind !== "live")
      throw new Error("expected live process");
    expect(gatePid(daemon.gatePath)).toBeUndefined();
    expect(isHolderLive(daemon.process.pid)).toBe(true);
  });

  it("dispose reaps the child and removes the rendezvous", async () => {
    const daemon = await plantYesterdayDaemon(fixtureOptions());
    if (daemon.process.kind !== "live")
      throw new Error("expected live process");
    const { pid } = daemon.process;
    await daemon.dispose();
    expect(isHolderLive(pid)).toBe(false);
    expect(existsSync(daemon.dir)).toBe(false);
  });
});
