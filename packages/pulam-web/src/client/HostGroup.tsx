/**
 * One host's agent rows — the R-pulamweb-3 dashboard leaf.
 *
 * Reads TWO surface members, both already-proven consumers:
 *   - the `awareness` COLLECTION (agent state + git + recency) — `byKey` per
 *     terminal, lifted to a list-level memo so the rows can be bucketed/sorted/
 *     filtered by content;
 *   - the `activity` STREAM (the green live-output dot). It is VALUE-BEARING —
 *     each frame is the full current live set — so it reads through
 *     `.streams.activity.use()` (replace-each-frame), NOT the delta-accumulate
 *     `createSubscription` + reduce path (that is for snapshot-then-delta streams
 *     like drishti's `processesSnapshot`).
 *
 * Rows sort needs-you-first (a blocked agent floats to the top, its glyph
 * breathing) and filter by category (active agents shown by default; idle agents,
 * non-agent terminals, and sleeping shells fold in via App's toggles). The
 * projection (bucket / urgency / sort / labels / colours) is `fleet.ts`.
 *
 * The list `<For>` is keyed by the primitive terminal id and the id ordering is
 * an array-equality memo, so a value-only delta (an agent ticking state) updates
 * one row in place rather than re-rendering the whole host — and a re-sort moves
 * nodes rather than rebuilding them. Each row reads its own awareness value
 * fine-grained off `byKey`.
 *
 * NO git dirty/clean count and NO drill-in — those need `git.getStatus`
 * (R-pulamweb-4), which the awareness `git` info does not carry.
 *
 * Connection / loading / error states, truthfully (unchanged from R-pulamweb-2):
 *   - "connecting…" is the version subscription's REAL `pending()` — true only
 *     until the parent↔browser ws delivers its first frame.
 *   - A subscription FAILURE (version, awareness, or the activity stream) is
 *     surfaced via `onError` and rendered — never collapsed into the empty state.
 */

import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import type { SurfaceConnectionStatus } from "@kolu/surface-app/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import {
  agentShortName,
  agentUrgency,
  DASH,
  fleetStateLabel,
  relativeTime,
} from "@kolu/terminal-workspace/agentProjection";
import { StatePip } from "@kolu/solid-statepip";
import {
  compareFleetEntries,
  DOT_OFF_COLOR,
  type FleetEntry,
  type FleetFilters,
  HOST_COLOR,
  isVisible,
  LIVE_COLOR,
  locationText,
  pipVariantFor,
  terminalCategory,
  URGENCY,
  URGENCY_LABELS,
} from "./fleet.ts";
import { statusForHost, surfaceForHost } from "./wire.ts";

export interface HostGroupProps {
  host: string;
  /** The fleet-wide view filters (App owns them; read here to drop rows). */
  filters: FleetFilters;
  /** The shared 1s clock — drives the relative-age cells. */
  now: () => number;
  /** Report this host's blocked/working counts up for the fleet-wide strip. */
  reportCounts: (host: string, counts: { need: number; work: number }) => void;
}

/** One agent/terminal row, MIRRORING kolu's Dock. The leading pip is the shared
 *  `StatePip` (`@kolu/solid-statepip`) over `pipVariantFor(value)` — the SAME
 *  component + theme palette kolu's Dock renders, so a just-finished `waiting`
 *  agent keeps the lingering `awaiting` dot (theme alert violet) rather than the
 *  idle grey its sort implies — while the SORT, the needs-you row tint, and the
 *  state-cell label colour stay keyed off `urgency`. That order≠colour split is
 *  the Dock's, one fold over from the dock pip. The green dot rides the activity
 *  stream, orthogonal to agent state. Reads its value fine-grained off `value()`
 *  (a per-key subscription) so only this row re-renders on its own delta. */
function AgentRow(props: {
  value: () => AwarenessValue | undefined;
  live: () => boolean;
  now: () => number;
}): JSX.Element {
  return (
    <Show when={props.value()}>
      {(value) => {
        const urgency = () => agentUrgency(value().agent);
        const tone = () => URGENCY[urgency()];
        const name = (): string => {
          const v = value();
          if (v.agent) return agentShortName(v.agent.kind);
          return v.foreground?.name ?? DASH;
        };
        return (
          <li
            class="flex items-center gap-2 border-b border-[#161b22] px-3 py-1.5 text-[13px]"
            style={
              urgency() === "need"
                ? "background:color-mix(in oklch, var(--color-alert) 10%, transparent)"
                : undefined
            }
          >
            <span
              class="inline-block h-1.5 w-1.5 flex-none rounded-full"
              classList={{
                "animate-pulse motion-reduce:animate-none": props.live(),
              }}
              style={`background:${props.live() ? LIVE_COLOR : DOT_OFF_COLOR}`}
              title="moving bytes"
            />
            {/* The shared `StatePip` — the SAME component kolu's Dock renders, so
             *  a given agent state shows the byte-identical pip (shape · colour ·
             *  spin/pulse, all owned by the component) on both surfaces. The
             *  width-reserved cell keeps the name column aligned whether the pip
             *  draws a shape or (for an unknown state) nothing. */}
            <span
              class="flex flex-none items-center justify-center"
              style="width:1.3ch"
            >
              <StatePip variant={pipVariantFor(value())} />
            </span>
            <span
              class="w-[9ch] flex-none overflow-hidden text-ellipsis whitespace-nowrap text-[#c8d0de]"
              title={name()}
            >
              {name()}
            </span>
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[#8b94a6]">
              {locationText(value())}
            </span>
            <span class="flex-none text-[12px]" style={`color:${tone().color}`}>
              {fleetStateLabel(value().agent, URGENCY_LABELS)}
            </span>
            <span class="w-[4ch] flex-none text-right text-[12px] text-[#5b6678]">
              {relativeTime(value().lastActivityAt, props.now())}
            </span>
          </li>
        );
      }}
    </Show>
  );
}

const sameIds = (a: TerminalId[], b: TerminalId[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** The per-host connection indicator — the transport status the half-open
 *  watchdog acts on, surfaced as a persistent status dot (like kolu's header
 *  dot): a solid **green** dot when the link is healthy, an amber pulsing
 *  "connecting…" / "reconnecting…" while it's establishing or recovering, and a
 *  red "disconnected — reload" after a stale-close retired the socket. Always
 *  shows *something* so a connected host reads as positively connected, not
 *  merely "no error". */
function ConnectionIndicator(props: {
  status: () => SurfaceConnectionStatus;
}): JSX.Element {
  return (
    <span class="ml-auto flex flex-none items-center gap-1 text-[12px]">
      <Switch>
        <Match when={props.status() === "live"}>
          <span
            class="inline-block h-1.5 w-1.5 rounded-full bg-[#7ec699]"
            title="connected"
          />
        </Match>
        <Match when={props.status() === "connecting"}>
          {/* Bare dot — the body already shows the first-connect "connecting…". */}
          <span
            class="inline-block h-1.5 w-1.5 rounded-full bg-[#8b94a6] motion-safe:animate-pulse"
            title="connecting"
          />
        </Match>
        <Match when={props.status() === "reconnecting"}>
          <span class="flex items-center gap-1 text-[#e6a23c]">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-[#e6a23c] motion-safe:animate-pulse" />
            reconnecting…
          </span>
        </Match>
        <Match when={props.status() === "down"}>
          <span class="flex items-center gap-1 text-[#ff8d8d]">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-[#ff8d8d]" />
            disconnected — reload
          </span>
        </Match>
      </Switch>
    </span>
  );
}

export function HostGroup(props: HostGroupProps): JSX.Element {
  const app = surfaceForHost(props.host);
  const status = statusForHost(props.host);
  // Surface the FIRST subscription error (version, awareness, or activity) rather
  // than letting it collapse into the empty/connecting state.
  const [error, setError] = createSignal<string | null>(null);
  const onError = (err: Error): void => {
    setError((prev) => prev ?? err.message);
  };
  const awareness = app.collections.awareness.use({ onError });
  const version = app.cells.version.use({ onError });
  // The live byte-moving set. VALUE-BEARING (full set each frame) → the
  // replace-each-frame `.streams.use()` consumer. `() => ({})` spans the whole
  // host (the stream takes no input), so we subscribe once.
  const live = app.streams.activity.use(() => ({}), { onError });
  const liveSet = createMemo(() => new Set<string>(live() ?? []));

  // One terminal's current value, or undefined while its per-key stream is
  // pending. Per-key errors already surface via the collection's `onError`.
  const valueForId = (id: TerminalId): AwarenessValue | undefined => {
    const sub = awareness.byKey(id);
    return sub !== undefined && !sub.pending() ? sub() : undefined;
  };

  // Settled entries (skips pending keys), read for sorting/filtering/counting.
  const entries = createMemo<FleetEntry[]>(() => {
    const out: FleetEntry[] = [];
    for (const id of awareness.keys()) {
      const value = valueForId(id as TerminalId);
      if (value === undefined) continue;
      out.push({ id: id as TerminalId, value });
    }
    return out;
  });

  // Report blocked/working counts up for the fleet-wide "needs you" strip. Counts
  // the WHOLE host before view filters — a blocked agent must alert even when its
  // category is toggled off — and clears on unmount so a closed host stops
  // contributing.
  createEffect(() => {
    let need = 0;
    let work = 0;
    for (const { value } of entries()) {
      const urgency = agentUrgency(value.agent);
      if (urgency === "need") need++;
      else if (urgency === "work") work++;
    }
    props.reportCounts(props.host, { need, work });
  });
  onCleanup(() => props.reportCounts(props.host, { need: 0, work: 0 }));

  // The visible row order: needs-you first, then most-recent, then id; dropped to
  // the enabled categories. Keyed by an array-equality memo so the `<For>` only
  // re-diffs on a genuine reorder/membership change, not on every value tick.
  const visibleIds = createMemo<TerminalId[]>(
    () =>
      entries()
        .filter((e) => isVisible(terminalCategory(e.value), props.filters))
        .sort(compareFleetEntries)
        .map((e) => e.id),
    [],
    { equals: sameIds },
  );
  const hiddenCount = createMemo(() => entries().length - visibleIds().length);

  return (
    <section class="my-3 overflow-hidden rounded-lg border border-[#1b2026] bg-[#0f1216]">
      <header class="flex items-center gap-2 border-b border-[#1b2026] bg-[#141922] px-3 py-2">
        <span style={`color:${HOST_COLOR}`}>▌</span>
        <span class="font-semibold text-[#aeb7c7]">{props.host}</span>
        <span class="text-[12px] text-[#5b6678]">
          · {awareness.keys().length} terminals
        </span>
        <ConnectionIndicator status={status} />
      </header>
      <Show
        when={error() === null}
        fallback={<div class="p-3 text-[#ff8d8d]">{error()}</div>}
      >
        <Show
          when={!version.pending()}
          fallback={<div class="p-3 text-[#6b7480]">connecting…</div>}
        >
          {/* "no terminals" is the TRUE empty host — gated on the KEY set, not on
              `entries()`. `entries()` drops keys whose per-key value stream is
              still pending, so gating on it would paint a host whose keys arrived
              but values haven't settled as empty. Keys-but-no-settled-values is a
              distinct loading state below. */}
          <Show
            when={awareness.keys().length > 0}
            fallback={<div class="p-3 text-[#6b7480]">no terminals</div>}
          >
            <Show
              when={entries().length > 0}
              fallback={
                <div class="p-3 text-[#6b7480]">loading terminal details…</div>
              }
            >
              <Show
                when={visibleIds().length > 0}
                fallback={
                  <div class="p-3 text-[#6b7480]">
                    no active agents · {hiddenCount()} hidden
                  </div>
                }
              >
                <ul class="m-0 list-none p-0">
                  <For each={visibleIds()}>
                    {(id) => (
                      <AgentRow
                        value={() => valueForId(id)}
                        live={() => liveSet().has(id)}
                        now={props.now}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
