import {
  type DaemonStatus,
  encodeHostLocation,
  LOCAL_LOCATION,
} from "@kolu/padi-client/surface";
import type { HostKey } from "kolu-common/hostKey";
import { createMemo } from "solid-js";
import { channelLive, toKavalPresence } from "../kaval/daemonPresentation";
import {
  daemonTransportLive,
  reprojectDaemonStatus,
} from "../kaval/useDaemonStatus";
import { padiMap } from "../wire";
import { type KavalChain, kavalChainOf } from "./hostChipTone";

export function useHostKaval(host: HostKey): {
  live: () => boolean;
  daemon: () => DaemonStatus | undefined;
} {
  const entryConnected = (): boolean =>
    padiMap.entry(host).state().kind === "connected";
  const live = (): boolean =>
    channelLive(daemonTransportLive(), entryConnected());
  const daemonKey = encodeHostLocation(LOCAL_LOCATION);
  const daemonSub = padiMap.entry(host).collections.daemonStatus.use({
    keys: () => [daemonKey],
  });
  const daemon = createMemo((): DaemonStatus | undefined =>
    reprojectDaemonStatus(host, daemonSub.byKey(daemonKey)?.()),
  );
  return { live, daemon };
}

export function useHostKavalChain(host: HostKey): () => KavalChain {
  const kaval = useHostKaval(host);
  return createMemo(() =>
    kavalChainOf(toKavalPresence(kaval.daemon(), kaval.live())),
  );
}
