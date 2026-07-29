/** Kolu-owned hook bodies for the framework yesterday-daemon fixture. */

import { assertDaemonSpawnAllowed } from "@kolu/daemon-test-gate";
import type { YesterdayDaemonOpts } from "@kolu/surface-daemon/upgrade-window.testlib";
import { KAVAL_GATE_FILE, PTY_HOST_SOCK_FILE } from "kaval";
import { match } from "ts-pattern";
import { openPadiStateStores } from "../session/stateStore.ts";

type WithoutFrameworkHooks<T> = T extends unknown
  ? Omit<T, "gateFile" | "socketFile" | "assertSpawnAllowed" | "plantState">
  : never;
type AppFixtureOptions = WithoutFrameworkHooks<YesterdayDaemonOpts>;

/** Add padi/kaval filenames, spawn policy, and the real conf writer. */
export function padiYesterdayDaemonOptions(
  opts: AppFixtureOptions = {},
): YesterdayDaemonOpts {
  return {
    ...opts,
    gateFile: KAVAL_GATE_FILE,
    socketFile: PTY_HOST_SOCK_FILE,
    assertSpawnAllowed: assertDaemonSpawnAllowed,
    plantState: ({ stateRoot, state }) => {
      const stores = openPadiStateStores(stateRoot);
      match(state)
        .with({ kind: "conf" }, ({ conf }) => {
          for (const [key, value] of Object.entries(conf)) {
            stores.conf.set(key as "session", value as never);
          }
        })
        .with({ kind: "session" }, ({ session }) => {
          stores.conf.set("session", session as never);
          stores.conf.set("importedLegacyConfig", true);
        })
        .exhaustive();
    },
  };
}
