/** The per-terminal attention reader — and the owner of the byte-motion half of
 *  the facts it reads.
 *
 *  Two things arrive from padi and together answer "what is happening in this
 *  terminal": the `urgency` cell's four class lists (mirrored per host by
 *  `useAttention`) and the `activity` stream's live set (mirrored here). This
 *  module opens the second subscription — one per host, over the FULL member
 *  set, because a background host is exactly the one whose terminals you can't
 *  otherwise see — and writes each frame into the same per-host record
 *  `useAttention` writes to. Every surface then reads ONE value per terminal
 *  through `attentionOf`.
 *
 *  It replaces two near-identical mirrors: the old `useTerminalActivity` (its
 *  own flat live map) and `useFinishedQuiet` (a SECOND per-host subscription to
 *  the very `urgency` cell `useAttention` was already subscribed to). One
 *  subscription per host per member, one store, one reader.
 *
 *  On the live set itself: it is NOT `lastActivityAt`, which bumps only on agent
 *  semantic-key transitions and is an hours-scale staleness clock — a plain
 *  `npm run build`, a `tail -f`, or any non-agent shell churning output would
 *  never light it up. Activity is owned by KAVAL (the one process that sees
 *  every PTY byte AND every resize), which emits a host-global, resize-EXCLUDED
 *  meaningful-output edge; padi folds that into a live SET over its short idle
 *  window (`TERMINAL_IDLE_AFTER_MS`) and this module mirrors it. No client-side
 *  byte tap, and no resize-suppress hack: kaval already excluded the
 *  reveal/resize repaint at the source, so switching to an idle terminal no
 *  longer flashes its dot — and the dot works for BACKGROUND (non-attached)
 *  terminals too, since the fact comes off the wire rather than the tile's own
 *  attach sink. */

import type { TerminalMetadata } from "@kolu/padi/surface";
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, mapArray, onCleanup } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { hostKeys, interpretClientError, padiMap } from "../wire";
import type { TerminalAttention } from "./attentionFacts";
import {
  terminalAttention,
  terminalIsFinished,
  terminalIsLive,
  writeHostMarks,
} from "./attentionMarks";

export const useAttentionFacts = createSharedRoot(() => {
  // One eager subscription per host to its `activity` live-set stream. Keyed on
  // the ENCODED host string (a stable primitive) so `mapArray` retains one owner
  // per host, disposed on membership exit — the same fan-out shape, over the same
  // membership list, as `useAttention`'s urgency roots.
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (encHost) => {
      const host = decodeHostKey(encHost);
      const entry = padiMap.entry(host);
      // Unlike a cell/collection, a `StreamSpec` has no `client` field to declare
      // a policy on (see `define.ts`) — so, unlike the SR11 bare `.use()` cells get
      // for free (`useAttention`'s `urgency`), a stream's use-site MUST supply
      // `onError` itself or a terminal subscription failure silently freezes this
      // host's live set with no surface (the package's own canonical example,
      // `consume-solid.ts`, does the same). Routed through the shared
      // `interpretClientError` (`hostToast`) for the same per-host-toast shape the
      // declared-policy members get. Each frame is the full current live set for
      // THIS host.
      const sub = entry.streams.activity.use(() => ({}), {
        onError: (err) =>
          interpretClientError({ kind: "hostToast", label: "activity" }, err, {
            key: host,
          }),
      });
      // Gate on `sub.pending()`, not `sub() === undefined` — the latter also reads
      // true for a subscription that errored out with no frame ever received
      // (`subscription-use-pending`: conflating loading with no-data would apply an
      // empty frame before we even know whether the stream is healthy). Once past
      // pending, an undefined `sub()` can only mean a terminally-errored
      // subscription (already toasted above) — falling back to `[]` there is an
      // honest "we lost this host's live facts", not a hidden default.
      //
      // The `[...]` COPY is load-bearing (the sticky-live fence): the wire hands
      // `.use()` a Solid `reconcile` proxy that mutates in place across ticks, so
      // storing that value directly would let a later live→empty reconcile mutate
      // the stored frame underfoot — every once-live id would stick lit forever.
      createEffect(() => {
        if (sub.pending()) return;
        writeHostMarks(encHost, { liveIds: [...(sub() ?? [])] });
      });
      // Host left the pool — drop its whole record. Idempotent with
      // `useAttention`'s identical cleanup: both roots fan out over the same
      // `hostKeys()`, so they dispose together and either may do the delete.
      onCleanup(() => writeHostMarks(encHost, undefined));
      return null;
    },
  );
  // Instantiate the roots (mapArray is lazy until read).
  createEffect(() => void roots());

  return {
    /** Reactive — true while this terminal's output is actively streaming. */
    isLive: (id: TerminalId): boolean => terminalIsLive(id),
    /** Reactive — true once this terminal's turn has gone effectively quiet. */
    isFinished: (id: TerminalId): boolean => terminalIsFinished(id),
    /** The ONE way to obtain a terminal's attention facts. */
    attentionOf: (meta: TerminalMetadata, id: TerminalId): TerminalAttention =>
      terminalAttention(meta, id),
  };
});
