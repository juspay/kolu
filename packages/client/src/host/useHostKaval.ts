/**
 * The ONE per-host reader for a host's kaval — "how do I read a given host's
 * daemon status from `padiMap`", asked once.
 *
 * It lived inside `HostDaemonChips.tsx` while the diagnostics popover was the
 * only surface that asked. juspay/kolu#2101 N4 gave it a second and much louder
 * consumer — the host DOT, which until then painted a padi-only fact — so the
 * reader moved out here rather than being spelled a second time. No new wire
 * field was needed for that: every padi already serves its own kaval's status on
 * `daemonStatus` under the LOCAL location key, identically for a local and a
 * remote host (each padi's own "local" kaval, not the browser's host key).
 */

import {
  type DaemonStatus,
  encodeHostLocation,
  LOCAL_LOCATION,
} from "@kolu/padi-client/surface";
import type { HostKey } from "kolu-common/hostKey";
import { type Accessor, createMemo } from "solid-js";
import { channelLive, toKavalPresence } from "../kaval/daemonPresentation";
import {
  daemonTransportLive,
  reprojectDaemonStatus,
} from "../kaval/useDaemonStatus";
import { padiMap } from "../wire";
import { type KavalChain, kavalChainOf } from "./hostChipTone";

/** Read one host's kaval liveness + daemon status. The host comes as an
 *  ACCESSOR: a chip reads it from its props, where a direct read at a
 *  component's top would both be the untracked read Solid refuses and pin
 *  this reader to whichever host the chip was first drawn for. `daemon`
 *  reprojects `startedAt` onto the browser clock via `clock.toLocal`
 *  UNIFORMLY (the static mark used to skip this — that silent divergence is
 *  gone now that both marks read through this single reader). */
export function useHostKaval(host: Accessor<HostKey>): {
  live: () => boolean;
  daemon: () => DaemonStatus | undefined;
} {
  const entryConnected = (): boolean =>
    padiMap.entry(host()).state().kind === "connected";
  const live = (): boolean =>
    channelLive(daemonTransportLive(), entryConnected());
  // Each remote/local padi serves its kaval under the LOCAL location key
  // (that host's own "local" kaval — not the browser's host key).
  const daemonKey = encodeHostLocation(LOCAL_LOCATION);
  // `useEntry` over the host this reader is OF, as the Right panel's section
  // reads its subject's: the chip's host is the subscription's key, so a chip
  // moved to another host re-keys the readout and lets the old one go.
  const daemonSub = padiMap.useEntry(host).collections.daemonStatus.use({
    keys: () => [daemonKey],
  });
  // Memoized: a host's KavalSubChip reads `daemon()` ~8× per render pass
  // (mark dot, version, state, uptime ×2, memory, update) — each an unmemoized
  // call would redo the `byKey` lookup AND mint a fresh `{...status}` spread.
  // One reprojection per `daemonStatus` change, shared by every consumer
  // (`dev/skills/kolu-client/SKILL.md`: memo a multi-consumer derivation). Runs for every mounted
  // host chip (active and inactive), so it sits on the per-host-status path.
  // Reprojection body is the shared `reprojectDaemonStatus` (useDaemonStatus.ts)
  // — the local-daemon memo there reprojects through the SAME function.
  const daemon = createMemo((): DaemonStatus | undefined =>
    reprojectDaemonStatus(host(), daemonSub.byKey(daemonKey)?.()),
  );
  return { live, daemon };
}

/** One host's kaval verdict in the shape the host-dot fold consumes — the
 *  reader above joined to the {@link kavalChainOf} projection, so a chip site
 *  spells the composition once and cannot pick a different one. */
export function useHostKavalChain(host: Accessor<HostKey>): () => KavalChain {
  const kaval = useHostKaval(host);
  return createMemo(
    () => kavalChainOf(toKavalPresence(kaval.daemon(), kaval.live())),
    { name: "hostKavalChain" },
  );
}
