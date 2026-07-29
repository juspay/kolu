/** Kolu-owned hook bodies for the framework yesterday-daemon fixture. */

import { assertDaemonSpawnAllowed } from "@kolu/daemon-test-gate";
import type { YesterdayDaemonOpts } from "@kolu/surface-daemon/upgrade-window.testlib";
import { KAVAL_GATE_FILE, PTY_HOST_SOCK_FILE } from "kaval";
import { openPadiStateStores } from "../session/stateStore.ts";

type AppFixtureOptions = Omit<
  YesterdayDaemonOpts,
  "gateFile" | "socketFile" | "assertSpawnAllowed" | "plantState"
>;

/** Add padi/kaval filenames, spawn policy, and the real conf writer. */
export function padiYesterdayDaemonOptions(
  opts: AppFixtureOptions = {},
): YesterdayDaemonOpts {
  return {
    ...opts,
    gateFile: KAVAL_GATE_FILE,
    socketFile: PTY_HOST_SOCK_FILE,
    assertSpawnAllowed: assertDaemonSpawnAllowed,
    plantState: ({ stateRoot, session, conf }) => {
      const stores = openPadiStateStores(stateRoot);
      if (conf !== undefined) {
        for (const [key, value] of Object.entries(conf)) {
          stores.conf.set(key as "session", value as never);
        }
        return;
      }
      stores.conf.set("session", session as never);
      stores.conf.set("importedLegacyConfig", true);
    },
  };
}
