/** Live-output activity tracker — the sub-second "is this terminal moving
 *  bytes *right now*" signal behind the dock/title live dots.
 *
 *  This is deliberately NOT `lastActivityAt`: that field bumps only on agent
 *  semantic-key transitions (see `staleness.ts`) and is an hours-scale
 *  staleness clock, so a plain `npm run build`, a `tail -f`, or any non-agent
 *  shell churning output would never light it up. The honest source for raw
 *  output motion is the PTY byte stream — but the client no longer counts those
 *  bytes itself. Activity is owned by KAVAL (the one process that sees every PTY
 *  byte AND every resize): it emits a host-global, resize-EXCLUDED
 *  meaningful-output edge, padi folds that edge into a live SET (its short idle
 *  window), and this module just MIRRORS that set per host off
 *  `padiSurface.streams.activity`. No client-side byte tap, and no resize
 *  suppress hack: kaval already excluded the reveal/resize repaint at the
 *  source, so switching to an idle terminal no longer flashes its dot — and the
 *  dot now works for BACKGROUND (non-attached) terminals too, since the fact
 *  comes off the wire rather than the tile's own attach sink.
 *
 *  A terminal reads as "live" from the moment kaval reports output until padi's
 *  idle window (`TERMINAL_IDLE_AFTER_MS`) passes with no further edge. The flag
 *  is an explicit per-terminal boolean (a `createStore` key) rather than a
 *  `now - lastOutputAt` comparison so reactivity needs no global ticking clock:
 *  each host's `activity` frame is the full current live set, and we reconcile
 *  the flat store to the union across hosts. */

import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, mapArray, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createSharedRoot } from "../createSharedRoot";
import { hostKeys, padiMap } from "../wire";

/** Diff one host's previous live-id frame against the next. Pure so the
 *  sticky-live fence (live → empty must remove) is unit-testable without the
 *  wire. Callers MUST pass plain arrays — never a Solid store proxy from
 *  `reconcile` — or `prev` mutates underfoot and removals never apply. */
export function activityFrameDiff(
  prev: readonly TerminalId[],
  frame: readonly TerminalId[],
): { adds: TerminalId[]; removes: TerminalId[] } {
  const next = new Set(frame);
  const prevSet = new Set(prev);
  const adds: TerminalId[] = [];
  const removes: TerminalId[] = [];
  for (const id of frame) if (!prevSet.has(id)) adds.push(id);
  for (const id of prev) if (!next.has(id)) removes.push(id);
  return { adds, removes };
}

export const useTerminalActivity = createSharedRoot(() => {
  // createStore for per-terminal fine-grained reactivity: setting one
  // terminal's flag wakes only the dots reading that terminal, not every row.
  const [live, setLive] = createStore<Record<TerminalId, boolean>>({});

  // One eager subscription per host to its `activity` live-set stream. Keyed on
  // the ENCODED host string (a stable primitive) so `mapArray` retains one owner
  // per host, disposed on membership exit — mirroring `useAttention`'s per-host
  // urgency roots. A background host is exactly the one whose dots we still want
  // lit, so the FULL member set is subscribed, not just the active host.
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (encHost) => {
      const entry = padiMap.entry(decodeHostKey(encHost));
      // Bare `.use()` — a bound stream's `.use()` already applies the framework's
      // standard reconnect/health behavior (STREAM_RETRY) by default, and a
      // `StreamSpec` carries no client error policy to configure (only cells and
      // collections take one), so the use-site needs no error options. Each frame
      // is the full current live set for THIS host.
      const sub = entry.streams.activity.use(() => ({}));
      // This host's previous live set as a PLAIN array (never the store proxy
      // `sub()` returns — writeWrappedValue reconciles into that proxy in place,
      // so storing it as `prev` would mutate underfoot and leave every once-live
      // id stuck true).
      let prev: TerminalId[] = [];
      createEffect(() => {
        // Snapshot to a plain array before set-diff (see comment on `prev`).
        const frame = [...(sub() ?? [])];
        const { adds, removes } = activityFrameDiff(prev, frame);
        if (adds.length > 0 || removes.length > 0) {
          setLive(
            produce((s) => {
              for (const id of adds) s[id] = true;
              for (const id of removes) delete s[id];
            }),
          );
        }
        prev = frame;
      });
      onCleanup(() => {
        // Host left the pool — drop all of its live flags so no dead key lingers.
        setLive(
          produce((s) => {
            for (const id of prev) delete s[id];
          }),
        );
        prev = [];
      });
      return null;
    },
  );
  // Instantiate the roots (mapArray is lazy until read).
  createEffect(() => void roots());

  /** Reactive — true while this terminal's output is actively streaming. */
  function isLive(id: TerminalId): boolean {
    return live[id] ?? false;
  }

  return { isLive };
});
