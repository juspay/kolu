/**
 * The pulam-web agent dashboard shell — every agent across every host, sorted by
 * what needs you.
 *
 * Fetches the static host set from `/api/hosts`, renders one `<HostGroup>` per
 * host (each opening its own ws and consuming that host's awareness + activity),
 * and owns the cross-host concerns the per-host leaves can't: the view filters
 * (which categories show), the shared 1s clock (relative-age cells), and the
 * fleet-wide blocked/working aggregate that drives the breathing "needs you"
 * strip + the footer counts. Filters flow DOWN to each host; each host reports
 * its counts UP through one explicit callback (the least-invasive way to a
 * fleet-wide view without lifting R-pulamweb-2's per-host connection/error
 * handling into the shell).
 */

import { createMemo, createResource, For, type JSX, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { type PipVariant, StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import { DEFAULT_FLEET_FILTERS, type FleetFilters, URGENCY } from "./fleet.ts";
import { HostGroup } from "./HostGroup.tsx";
import { rememberServerProcessId } from "./wire.ts";

/** Fetch the parent's static host set + this server's `processId`, and remember
 *  the `processId` for the stale-tab `?pid=` echo BEFORE returning (so it's set
 *  before any `<HostGroup>` opens a socket — see `wire.ts`). Fails LOUD on a
 *  non-2xx or a malformed body (no fallback to an empty list — a broken host API
 *  is a real error the user must see, not a silently-empty fleet). */
async function fetchHosts(): Promise<string[]> {
  const res = await fetch("/api/hosts");
  if (!res.ok) {
    throw new Error(`GET /api/hosts failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { hosts?: unknown; processId?: unknown };
  if (
    !Array.isArray(body.hosts) ||
    body.hosts.some((h) => typeof h !== "string")
  ) {
    throw new Error(
      "GET /api/hosts: malformed body (expected { hosts: string[] })",
    );
  }
  if (typeof body.processId !== "string" || body.processId.length === 0) {
    throw new Error(
      "GET /api/hosts: malformed body (expected a non-empty processId)",
    );
  }
  // Seed the stale-tab echo before any host socket opens. The render order
  // (this resource resolves → `<HostGroup>` renders → `surfaceForHost`) makes
  // this strictly-before-first-connect.
  rememberServerProcessId(body.processId);
  return body.hosts as string[];
}

/** One legend entry — the REAL `StatePip` beside its meaning, so the legend can
 *  never drift from what the rows actually draw (it renders the same component
 *  over the same `(variant, live, alert)` axes). */
function LegendItem(props: {
  variant: PipVariant;
  live?: boolean;
  alert?: boolean;
  alertLabel?: string;
  label: string;
}): JSX.Element {
  return (
    <span class="inline-flex items-center gap-1.5">
      {/* The same `DOCK_ROW_PIP_BOX` the fleet rows reserve, so the legend pip
       *  is pixel-for-pixel what a row draws — and the same `alertLabel`, so its
       *  a11y wording matches the rows too. */}
      <StatePip
        variant={props.variant}
        live={props.live}
        alert={props.alert}
        alertLabel={props.alertLabel}
        class={DOCK_ROW_PIP_BOX}
      />
      <span>{props.label}</span>
    </span>
  );
}

/** The indicator legend — what each row's status indicator means, drawn from the
 *  shared `StatePip` so it stays honest. Three axes: the agent-state CORE (shape),
 *  the green live RING (moving bytes), and the amber alert corner BADGE (unread).
 *  The live/alert rows use a plain idle core so each outer axis reads in isolation. */
function Legend(): JSX.Element {
  return (
    <section class="mt-3 border-t border-[#1c2231] pt-2 text-[12px] text-[#8b94a6]">
      <div class="mb-1.5 font-semibold text-[#aeb7c7]">Legend</div>
      <div class="mb-1 text-[11px] uppercase tracking-[0.1em] text-[#5b6678]">
        agent state
      </div>
      <div class="mb-2 flex flex-wrap gap-x-4 gap-y-1.5">
        <LegendItem variant="working" label="working" />
        <LegendItem variant="awaiting" label="needs you" />
        <LegendItem variant="idle" label="idle" />
        <LegendItem variant="sleeping" label="sleeping" />
      </div>
      <div class="mb-1 text-[11px] uppercase tracking-[0.1em] text-[#5b6678]">
        activity &amp; alerts
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1.5">
        <LegendItem
          variant="idle"
          live
          label="live — moving bytes (green ring)"
        />
        <LegendItem
          variant="idle"
          alert
          alertLabel="needs attention"
          label="needs attention — a notification fired (amber badge)"
        />
      </div>
    </section>
  );
}

/** One filter toggle in the footer — `+ label` off, `✓ label` on. */
function FilterChip(props: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      class="rounded px-1 py-0.5"
      classList={{
        "font-semibold text-[#c8d0de]": props.active,
        "text-[#475569]": !props.active,
      }}
    >
      {props.active ? "✓ " : "+ "}
      {props.label}
    </button>
  );
}

export function App(): JSX.Element {
  const [hosts] = createResource(fetchHosts);

  // View filters — `active` agents always show; idle agents show by default too
  // (the full agent board), with non-agent/sleeping shells opt-in. See
  // DEFAULT_FLEET_FILTERS.
  const [filters, setFilters] = createStore<FleetFilters>({
    ...DEFAULT_FLEET_FILTERS,
  });
  const toggle = (key: keyof FleetFilters): void => setFilters(key, (v) => !v);

  // Per-host blocked/working counts → the fleet-wide aggregate. Each host reports
  // its own slice; the totals sum across the (static) host roster.
  const [counts, setCounts] = createStore<
    Record<string, { need: number; work: number }>
  >({});
  const reportCounts = (
    host: string,
    c: { need: number; work: number },
  ): void => setCounts(host, c);
  const needTotal = createMemo(() =>
    (hosts() ?? []).reduce((n, h) => n + (counts[h]?.need ?? 0), 0),
  );
  const workTotal = createMemo(() =>
    (hosts() ?? []).reduce((n, h) => n + (counts[h]?.work ?? 0), 0),
  );

  return (
    <main class="mx-auto max-w-[720px] p-4">
      <h1 class="mx-0 mt-1 mb-3 text-[15px] font-semibold text-[#d7dbe0]">
        pulam-web · every agent, every host
      </h1>

      <Show when={needTotal() > 0}>
        <div
          class="mb-3 flex animate-pulse items-center gap-2 rounded-lg border px-3 py-2 motion-reduce:animate-none"
          style={`color:${URGENCY.need.color};border-color:color-mix(in oklch, var(--color-alert) 42%, transparent);background:color-mix(in oklch, var(--color-alert) 14%, transparent)`}
        >
          <span>{URGENCY.need.glyph}</span>
          <span class="font-semibold">
            {needTotal()} agent{needTotal() === 1 ? "" : "s"} need you
          </span>
        </div>
      </Show>

      <Show
        when={!hosts.error}
        fallback={
          <div class="text-[#ff8d8d]">
            {(hosts.error as Error)?.message ?? "failed to load hosts"}
          </div>
        }
      >
        <Show
          when={hosts() !== undefined}
          fallback={<div class="text-[#6b7480]">loading hosts…</div>}
        >
          <Show
            when={(hosts() ?? []).length > 0}
            fallback={<div class="text-[#6b7480]">no hosts configured</div>}
          >
            <For each={hosts()}>
              {(host) => (
                <HostGroup
                  host={host}
                  filters={filters}
                  reportCounts={reportCounts}
                />
              )}
            </For>
            <footer class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[#1c2231] pt-2 text-[12px]">
              <span class="text-[#94a3b8]">
                showing <b class="text-[#c8d0de]">agents</b>
              </span>
              <FilterChip
                label="idle"
                active={filters.idle}
                onClick={() => toggle("idle")}
              />
              <FilterChip
                label="non-agent terminals"
                active={filters.nonagent}
                onClick={() => toggle("nonagent")}
              />
              <FilterChip
                label="sleeping"
                active={filters.sleeping}
                onClick={() => toggle("sleeping")}
              />
              <For
                each={
                  [
                    { urgency: "need", count: needTotal },
                    { urgency: "work", count: workTotal },
                  ] as const
                }
              >
                {(counter, i) => (
                  <span
                    classList={{ "ml-auto": i() === 0 }}
                    style={`color:${URGENCY[counter.urgency].color}`}
                  >
                    {URGENCY[counter.urgency].glyph} {counter.count()}{" "}
                    {URGENCY[counter.urgency].label}
                  </span>
                )}
              </For>
            </footer>
            <Legend />
          </Show>
        </Show>
      </Show>
    </main>
  );
}
