/** Padi-owned session-shape arm of the graduated yesterday-daemon fixture. */

import { readFileSync } from "node:fs";
import { plantYesterdayDaemon } from "@kolu/surface-daemon/upgrade-window.testlib";
import { afterEach, expect, it } from "vitest";
import { padiYesterdayDaemonOptions } from "./yesterdayDaemon.fixture.testlib.ts";

const planted: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  for (const daemon of planted.splice(0)) await daemon.dispose();
});

it("plants a previous-shape padi session through the real conf store", async () => {
  const previousSession = {
    terminals: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        cwd: "/work/old",
        git: null,
      },
    ],
    savedAt: 1_700_000_000_000,
  };
  const daemon = await plantYesterdayDaemon(
    padiYesterdayDaemonOptions({
      session: previousSession,
      withSocket: false,
      gate: { kind: "absent" },
    }),
  );
  planted.push(daemon);

  if (daemon.state.kind !== "planted")
    throw new Error("expected planted state");
  const raw = JSON.parse(readFileSync(daemon.state.confPath, "utf8")) as {
    session: typeof previousSession;
  };
  expect(raw.session.terminals[0]?.cwd).toBe("/work/old");
  expect(raw.session.terminals[0]).not.toHaveProperty("state");
  expect(raw.session.terminals[0]).not.toHaveProperty("location");
});
