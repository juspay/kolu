import { Effect } from "effect";
import type { PwaIdentity } from "kolu-common/contract";
import { createSignal } from "solid-js";
import { createSharedRoot } from "./createSharedRoot";
import { hostTitle } from "./host/hostTitle";
import { runOwnedAction } from "./runAction";
import { activeHost, client } from "./wire";

export const useServerIdentity = createSharedRoot(() => {
  const [identity, setIdentity] = createSignal<PwaIdentity>();
  runOwnedAction(
    "read server info",
    client.server.info().pipe(
      Effect.tap((info) => Effect.sync(() => setIdentity(info.identity))),
      Effect.catch((err) =>
        Effect.sync(() => {
          console.warn("Server info fetch failed:", err);
        }),
      ),
    ),
  );

  return {
    appTitle: () => hostTitle(activeHost()),
    hostname: () => identity()?.hostname,
    themeColor: () => identity()?.themeColor,
  } as const;
});
