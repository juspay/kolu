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
 * breathing) and filter by category. By default the board shows EVERY agent
 * (active *and* idle — see `DEFAULT_FLEET_FILTERS`); the two agentless
 * categories, non-agent terminals and sleeping shells, fold in via App's
 * toggles. The projection (bucket / urgency / sort / labels / colours) is
 * `fleet.ts`.
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
 * Connection / loading / error states, truthfully:
 *   - The body is gated on the host being EFFECTIVELY connected — the
 *     `effectiveHealth` fold over BOTH the `connection` cell's mirror state AND
 *     the browser↔backend transport (`status`). Off-`connected` renders the
 *     honest `ConnectionView` (connecting / provisioning / reconnecting / failed)
 *     instead of a healthy-looking empty fleet; the header dot reads the same
 *     fold, so they always agree.
 *   - A subscription FAILURE (any awareness per-key sub, the activity stream, or
 *     the connection cell) is surfaced from the subscription's OWN reactive,
 *     self-clearing `error()` — never collapsed into the empty state, and never
 *     LATCHED: a transient blip (a backend restart on laptop sleep/wake makes a
 *     live subscription 500 with a masked "Internal server error") clears the
 *     instant the stream re-delivers, so the host self-heals instead of freezing
 *     on a stale error over a fleet that has already reconnected.
 */

import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import {
  type ConnectionInfo,
  DEFAULT_CONNECTION,
} from "@kolu/surface-nix-host/connection";
import {
  createEffect,
  createMemo,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import {
  agentShortName,
  agentUrgency,
  DASH,
  fleetStateLabel,
  relativeTime,
} from "@kolu/terminal-workspace/agentProjection";
import { StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import {
  compareFleetEntries,
  type FleetEntry,
  fleetAlert,
  type FleetFilters,
  HOST_COLOR,
  isVisible,
  locationText,
  pipVariantFor,
  terminalCategory,
  URGENCY,
  URGENCY_LABELS,
} from "./fleet.ts";
import { ConnectionView, HostHealthIndicator } from "./ConnectionView.tsx";
import { effectiveHealth } from "./connectionHealth.ts";
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
 *  the Dock's, one fold over from the dock pip. The indicator folds in two more
 *  axes the Dock's does (R-activity-merge): the green live RING off the activity
 *  stream and the amber "needs attention" corner BADGE off the shared `alertClass`
 *  fold (live notify-class membership, not the Dock's per-row unread). Reads its
 *  value fine-grained off `value()` (a per-key subscription) so only this row
 *  re-renders on its own delta. */
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
            {/* One merged status indicator — the SAME component kolu's Dock
             *  renders, folding three axes into one glyph: the agent-state CORE
             *  (`pipVariantFor`), the green live RING (this terminal moving
             *  bytes, off the `activity` stream — the old standalone dot, now
             *  the indicator's edge), and the amber corner BADGE (the per-row
             *  alert pulam-web gains via the shared `alertClass` fold). The badge
             *  announces "needs attention" here, not the Dock's "unread alert":
             *  pulam-web tracks live notify-class membership, not per-row read
             *  state, so it can't honestly claim an unread it never clears. So the
             *  (state, live, alert) triple reads byte-identically here and in
             *  the Dock; its fixed size keeps the name column aligned. */}
            <StatePip
              variant={pipVariantFor(value())}
              live={props.live()}
              alert={fleetAlert(value())}
              alertLabel="needs attention"
              class={DOCK_ROW_PIP_BOX}
            />
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

export function HostGroup(props: HostGroupProps): JSX.Element {
  const app = surfaceForHost(props.host);
  const status = statusForHost(props.host);
  const awareness = app.collections.awareness.use();
  // The backend↔remote mirror's health — what gates "show the terminal list".
  // Distinct from `status` (the browser↔backend ws): a dead mirror with a
  // healthy ws is exactly the "green dot + no terminals" lie this fixes. Seeded
  // `DEFAULT_CONNECTION` (`connecting`) until the first frame, so a host never
  // reads as an empty fleet before its link is actually up.
  const connection = app.cells.connection.use();
  const connInfo = (): ConnectionInfo =>
    connection.value() ?? DEFAULT_CONNECTION;
  // The EFFECTIVE host health — the single fold over BOTH the transport ws
  // (`status`) and the mirror cell (`connInfo`). The header dot and the body
  // gate below read this same answer, so a transport-down host (whose mirror
  // cell goes stale at its last `connected`) can't paint a stale fleet while
  // the header honestly says it's down. A memo (not a bare accessor): the gate,
  // the strip, and the dot each read it and `effectiveHealth` allocates fresh,
  // so memoize for one run + one stable identity per change (like `entries`).
  const health = createMemo(() => effectiveHealth(status(), connInfo()));
  // "Is this host EFFECTIVELY connected?" — the one predicate the body gate, the
  // terminal count, and the fleet-wide tally all read. Decided once here off the
  // resolved `health`, not re-asserted as a bare `=== "connected"` at each site.
  const connected = createMemo(() => health().state === "connected");
  // The live byte-moving set. VALUE-BEARING (full set each frame) → the
  // replace-each-frame `.streams.use()` consumer. `() => ({})` spans the whole
  // host (the stream takes no input), so we subscribe once.
  const live = app.streams.activity.use(() => ({}));
  const liveSet = createMemo(() => new Set<string>(live() ?? []));

  // The FIRST currently-active subscription error, or null — read straight off
  // each subscription's OWN reactive `error()` (the connection cell, the activity
  // stream, the awareness KEYS stream, and every awareness per-key sub), NOT
  // latched from a one-shot `onError`. `createSubscription` clears `error()` on
  // the next frame, so this SELF-HEALS: a transient blip (a backend restart on
  // laptop sleep/wake makes a live subscription 500 with a masked "Internal
  // server error") clears the instant the stream re-delivers — instead of
  // latching a stale error over a fleet that has since reconnected. A PERSISTENT
  // error still shows and still wins over the body (never collapsing into a
  // healthy-looking empty host); only a resolved one disappears. This is #1564's
  // lie in another costume: the dashboard must not keep claiming a failure that
  // is already over.
  //
  // `keysError` is the awareness KEYS stream's own error — load-bearing: a failing
  // keys stream collapses `awareness.keys()` to `[]` (the bound `sub() ?? []`
  // fallback), so without reading it a keys-stream 500 would read as a connected,
  // empty fleet ("no terminals") with no visible error — the exact stale/empty lie
  // this PR exists to kill. Checked FIRST so a dead keys stream wins over a stale
  // per-key sub.
  const subscriptionError = createMemo<string | null>(() => {
    const keysErr = awareness.keysError();
    if (keysErr) return keysErr.message;
    for (const id of awareness.keys()) {
      const err = awareness.byKey(id)?.error();
      if (err) return err.message;
    }
    return connection.error()?.message ?? live.error()?.message ?? null;
  });

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
  //
  // Gated on the SAME `effectiveHealth` the body is: when the host is not
  // effectively connected, report zero. Off-`connected` we hide the rows as
  // disconnected, but the awareness store keeps its LAST values — during a
  // browser↔backend transport loss it can't receive a reset frame — so counting
  // `entries()` would let the global alert strip keep tallying stale agents from a
  // host the user is told is down. Zeroing here keeps the strip honest with the rows.
  createEffect(() => {
    if (!connected()) {
      props.reportCounts(props.host, { need: 0, work: 0 });
      return;
    }
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
        {/* The terminal count rides the SAME `effectiveHealth` gate as the body
            and the fleet-wide counts: when the host isn't effectively connected
            the rows are hidden and the awareness key set is stale (no reset frame
            crosses a dead transport), so showing "N terminals" beside a "down"
            dot would lie. Drop it until the host is genuinely connected. */}
        <Show when={connected()}>
          <span class="text-[12px] text-[#5b6678]">
            · {awareness.keys().length} terminals
          </span>
        </Show>
        <HostHealthIndicator health={health} />
      </header>
      <Show
        when={subscriptionError() === null}
        fallback={<div class="p-3 text-[#ff8d8d]">{subscriptionError()}</div>}
      >
        {/* Gate the terminal list on the EFFECTIVE health — the `effectiveHealth`
            fold over BOTH the mirror cell AND the browser↔backend ws, NOT the
            mirror alone. Off-`connected` (a `copying`/`connecting`/`reconnecting`/
            `failed` mirror, OR a `down`/`reconnecting` transport that makes the
            mirror cell stale) renders the honest ConnectionView instead of a
            healthy-looking empty fleet. Only an effectively-`connected` host
            reaches the awareness body below, where "no terminals" is finally
            truthful — and the header dot reads the SAME fold, so they agree. */}
        <Show
          when={connected()}
          fallback={
            <ConnectionView
              health={health()}
              info={connInfo()}
              host={props.host}
            />
          }
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
