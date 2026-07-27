/** The ONE per-host attention mirror, and the per-terminal reader over it.
 *
 *  Two things arrive from padi and together answer "what is happening in this
 *  terminal": the `urgency` cell's class lists (padi's `attentionClass`
 *  partition, computed once, on the host) and the `activity` stream's live set.
 *  This module opens BOTH — one root per host, over the FULL member set,
 *  because a background host is exactly the one whose terminals you can't
 *  otherwise see — and writes each frame into that host's record in the shared
 *  marks store. Every surface then reads ONE value per terminal through
 *  `attentionOf`, and the attention engine (`useAttention`) consumes the same
 *  store rather than subscribing again.
 *
 *  ONE root, deliberately. The urgency mirror and the activity mirror used to
 *  be two `mapArray` fan-outs in two modules over the same `hostKeys()`
 *  membership, both building a `padiMap.entry`, both writing the same record,
 *  and both calling `writeHostMarks(encHost, undefined)` on cleanup — a
 *  coherence rule ("either may do the delete") held by two matching comments
 *  instead of by the structure, with the record's completeness depending on two
 *  disposal orders being equivalent. One host, one root, one deleter.
 *
 *  It replaces two near-identical mirrors: the old `useTerminalActivity` (its
 *  own flat live map) and `useFinishedQuiet` (a SECOND per-host subscription to
 *  the very `urgency` cell this root already holds). One subscription per host
 *  per member, one store, one reader.
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

import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { AttentionClass, TerminalId } from "kolu-common/surface";
import { createEffect, createMemo, mapArray, onCleanup } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { hostKeys, interpretClientError, padiMap } from "../wire";
import type { TerminalAttention } from "./attentionFacts";
import {
  terminalAttention,
  terminalClass,
  writeHostMarks,
} from "./attentionMarks";

export const useAttentionFacts = createSharedRoot(() => {
  // One eager root per host, holding BOTH of that host's attention members.
  // Keyed on the ENCODED host string (a stable primitive) so `mapArray` retains
  // one owner per host, disposed on membership exit.
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (encHost) => {
      const host = decodeHostKey(encHost);
      const entry = padiMap.entry(host);
      // Bare `.use()` — the `urgency` cell declares its own `onError` policy
      // (`hostToast`, host-prefixed) on the spec, so per SR11 the use-site
      // carries NO policy; the declared interpreter surfaces a per-host cell
      // failure.
      const { value: urgency, sub } = entry.cells.urgency.use();
      // Unlike a cell/collection, a `StreamSpec` has no `client` field to declare
      // a policy on (see `define.ts`) — so, unlike the SR11 bare `.use()` cells get
      // for free, a stream's use-site MUST supply `onError` itself or a terminal
      // subscription failure silently freezes this host's live set with no
      // surface (the package's own canonical example, `consume-solid.ts`, does
      // the same). Routed through the shared `interpretClientError`
      // (`hostToast`) for the same per-host-toast shape the declared-policy
      // members get. Each frame is the full current live set for THIS host.
      const activity = entry.streams.activity.use(() => ({}), {
        onError: (err) =>
          interpretClientError({ kind: "hostToast", label: "activity" }, err, {
            key: host,
          }),
      });
      // Live only when the link is up AND the urgency sub is neither errored nor
      // ended — urgency is no `liveWhen` gate, so a stale value must read STALE
      // (dim, uncounted), never lie live.
      const live = createMemo(
        () =>
          entry.state().kind === "connected" &&
          !sub.error() &&
          !(sub.complete?.() ?? false),
      );

      // The class lists — the ONE wire→frame translation in the app, which is
      // also where the wire's positional `awaitingIds` name becomes the class
      // name every reader speaks. The `[...]` copies are the same sticky-live
      // fence the live set needs below: `.use()` hands back a `reconcile` proxy
      // that mutates in place across ticks.
      createEffect(() => {
        const v = urgency();
        // No frame yet — the mirror stays SILENT about this host rather than
        // publishing an empty one. "Nothing is happening here" and "this host
        // has not spoken" are different facts, and the attention engine needs
        // the first REAL frame as its baseline: a chime for an agent that was
        // already finished when the app bound is a discovery, not a transition.
        if (v === undefined) return;
        writeHostMarks(encHost, {
          reported: true,
          byClass: {
            asking: [...v.awaitingIds],
            working: [...v.workingIds],
            linger: [...v.lingerIds],
            finished: [...v.finishedIds],
          },
        });
      });
      // Separate from the frame write so a link flap (live changes, the frame
      // doesn't) still repaints the badge without minting a fresh frame that
      // would invalidate every pip memo for nothing.
      createEffect(() => writeHostMarks(encHost, { live: live() }));
      // Gate on `activity.pending()`, not `activity() === undefined` — the
      // latter also reads true for a subscription that errored out with no frame
      // ever received (`subscription-use-pending`: conflating loading with
      // no-data would apply an empty frame before we even know whether the
      // stream is healthy). Once past pending, an undefined value can only mean
      // a terminally-errored subscription (already toasted above) — falling back
      // to `[]` there is an honest "we lost this host's live facts", not a
      // hidden default.
      createEffect(() => {
        if (activity.pending()) return;
        writeHostMarks(encHost, { liveIds: [...(activity() ?? [])] });
      });
      // Host left the pool — drop its whole record. The ONE deleter.
      onCleanup(() => writeHostMarks(encHost, undefined));
      return null;
    },
  );
  // Instantiate the roots (mapArray is lazy until read).
  createEffect(() => void roots());

  return {
    /** The ONE way to obtain a terminal's attention facts — keyed by the host
     *  the terminal is on, which is the key the mirror itself is keyed by.
     *  Deliberately the module's ONLY export: every ingredient it offered
     *  beside the value (`isLive`, `isFinished`) was a route back to the loose
     *  booleans shape a call site could assemble wrongly. */
    /** A terminal's class WITHOUT its live flag — the dock's rank/paint read.
     *  Kept separate so the row order does not re-sort on every byte tick. */
    classOf: (encHost: string, id: TerminalId): AttentionClass =>
      terminalClass(encHost, id),
    attentionOf: (encHost: string, id: TerminalId): TerminalAttention =>
      terminalAttention(encHost, id),
  };
});
