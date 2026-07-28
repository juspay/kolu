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
import {
  FRAME_CLASSES,
  hostActiveIds,
  type TerminalAttention,
} from "./attentionFacts";
import {
  forgetHostIndex,
  hostFrame,
  registerHostIndex,
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
      // --- The read-side indexes over this host's frame ---
      //
      // Every reader below asks a per-terminal question of a frame whose folds
      // are O(frame): `frameClassOf` rescans four class lists per id (three
      // readers × every dock row, per urgency frame) and `hostActiveIds` rebuilds
      // a Map + two Sets per call (~10 calls per host per byte tick). Indexed
      // here rather than at the read sites because THIS is the one scope with a
      // reactive owner and a disposal path for the host — the module-level
      // readers in `attentionMarks` reach them through the registry below.
      //
      // The two frame legs are lifted into their own memos FIRST, and this is
      // the load-bearing part of the whole arrangement. `writeHostMarks` merges
      // `{...prev, ...value}`, so a `liveIds`-only write leaves `byClass`
      // REFERENTIALLY IDENTICAL; a memo returning that reference therefore does
      // not notify, and everything derived from it — the class index, and so the
      // dock's O(n log n) rank+group pass — sits still through kaval's ~1 s byte
      // tick. Reading `.byClass` off the frame inside the class index directly
      // would put the whole record's store node in that memo's dependency set
      // and give the byte tick a path back into the row order.
      const byClass = createMemo(() => hostFrame(encHost).byClass);
      const liveIds = createMemo(() => hostFrame(encHost).liveIds);
      // Class index — `byClass` ONLY. Kept SEPARATE from `liveIndex` below (and
      // from `activeCount`) because a terminal's CLASS is what the dock ranks
      // and paints on, at the agent-transition cadence; merging the two into one
      // "attention index" memo would re-sort every dock row on every byte tick,
      // which is the exact defect the split exists to prevent.
      const classIndex = createMemo(() => {
        const map = new Map<TerminalId, AttentionClass>();
        for (const klass of FRAME_CLASSES)
          for (const id of byClass()[klass]) map.set(id, klass);
        return map;
      });
      // Live index — `liveIds` ONLY, for the same reason mirrored: a reader that
      // wants motion must not be invalidated by an agent transition it does not
      // paint.
      const liveIndex = createMemo(() => new Set(liveIds()));
      // The host tab's count legitimately depends on BOTH legs — and stays its
      // OWN memo for that reason, so its two-sided dependency cannot leak into
      // the class-only path above. It folds through the pure `hostActiveIds`
      // rather than restating the membership rule: this is an index over that
      // answer, not a second definition of it.
      const activeCount = createMemo(
        () => hostActiveIds({ byClass: byClass(), liveIds: liveIds() }).length,
      );
      registerHostIndex(encHost, {
        classOf: (id) => classIndex().get(id) ?? "idle",
        isLive: (id) => liveIndex().has(id),
        activeCount,
      });
      // Host left the pool — drop its whole record, and the index whose memos
      // are disposed with this owner. The ONE deleter.
      onCleanup(() => {
        forgetHostIndex(encHost);
        writeHostMarks(encHost, undefined);
      });
      return null;
    },
  );
  // Instantiate the roots (mapArray is lazy until read).
  createEffect(() => void roots());

  return {
    /** A terminal's class WITHOUT its live flag — the dock's rank/paint read.
     *  Kept separate so the row order does not re-sort on every byte tick. */
    classOf: (encHost: string, id: TerminalId): AttentionClass =>
      terminalClass(encHost, id),
    /** The ONE way to obtain a terminal's attention facts — keyed by the host
     *  the terminal is on, which is the key the mirror itself is keyed by. It
     *  hands back the whole value and nothing beside it: every ingredient this
     *  once offered separately (`isLive`, `isFinished`) was a route back to the
     *  loose-booleans shape a call site could assemble wrongly. */
    attentionOf: (encHost: string, id: TerminalId): TerminalAttention =>
      terminalAttention(encHost, id),
  };
});
