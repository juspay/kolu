/** HostSelectorStrip — the multi-host selector, the visible face of the keyed padi
 *  host map (W4 "the switch").
 *
 *  GATED on the server-authored `hostMapGate` cell: the strip renders ONLY when
 *  `KOLU_PADI_HOST` seeded more than the local default (`isMultiHost()` at boot). The
 *  client NEVER reads env — the cell is the sole cue, and the gate is purely
 *  presentational: with it closed (the single-host default) nothing renders, so the
 *  canvas is pixel-identical to before. There is no dual code path.
 *
 *  Open, it is a compact chip row — one chip per pool member, each reading, at a glance:
 *    · the host label (LOCAL_HOST shows as "local");
 *    · a connection dot colored from the map's `EntryStatus` FACT — green ONLY for
 *      `connected` (which `connectSurfaceMap` floors on real transport liveness, so a
 *      green-over-a-dead-link dot is unrenderable, the same discipline `<HostStatusPip>`
 *      enforces for a surface's `health()`; a map entry's equivalent fact is its
 *      `EntryStatus`, not a `SurfaceHealth`, so we color from that);
 *    · an urgency badge — the host's `awaiting` count (its FIRST client consumer), hidden
 *      when zero;
 *    · the active host highlighted; a click switches the canvas (a synchronous signal
 *      write — `useEntry(activeHost)` re-keys, no reload);
 *    · a remove ✕ for GUEST hosts (never LOCAL_HOST) → `client.hosts.remove` (an
 *      UnremovableHostError surfaces LOUD via toast, never a silent no-op).
 *  A trailing "+ add" opens an inline input → `client.hosts.add`. */

import { type HostKey, HostKeySchema, LOCAL_HOST } from "kolu-common/hostKey";
import { type Component, createSignal, For, Show } from "solid-js";
import { toast } from "solid-sonner";
import { dotClass, hostGateOpen, statusTitle } from "./hostChipTone";
import { activeHost, app, client, padiMap, setActiveHost } from "./wire";

const HostChip: Component<{ host: HostKey }> = (props) => {
  // The PURE lens per chip (the host is fixed for this chip's lifetime — the `<For>`
  // gives each chip its own reactive owner, disposed when the host leaves the pool).
  const state = () => padiMap.entry(props.host).state();
  const urgency = padiMap.entry(props.host).cells.urgency.use({
    onError: (err: Error) =>
      toast.error(`Host ${props.host} urgency error: ${err.message}`),
  });
  const awaiting = () => urgency.value()?.awaiting ?? 0;
  const isActive = () => activeHost() === props.host;
  const isLocal = () => props.host === LOCAL_HOST;
  const label = () => (isLocal() ? "local" : String(props.host));

  // A non-interactive CONTAINER holding two real buttons — the SELECT button (the chip
  // body) and, for a guest, a sibling REMOVE button. Two buttons (not a clickable div
  // with a nested button) keeps it keyboard-reachable + valid a11y with no static-element
  // interaction handlers.
  return (
    <div
      class="group flex items-stretch rounded-lg border text-xs overflow-hidden transition-colors"
      classList={{
        "border-accent/60": isActive(),
        "border-edge": !isActive(),
      }}
      data-testid="host-chip"
      data-host={props.host}
      data-active={isActive() ? "" : undefined}
    >
      <button
        type="button"
        class="pointer-events-auto flex items-center gap-1.5 h-7 pl-2 pr-1.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        classList={{
          "bg-surface-3 text-fg": isActive(),
          "bg-surface-2/70 text-fg-2 hover:bg-surface-2 hover:text-fg":
            !isActive(),
        }}
        data-testid="host-select"
        aria-pressed={isActive()}
        onClick={() => setActiveHost(props.host)}
        title={`${label()} — ${statusTitle(state())}`}
      >
        <span
          class={`inline-block h-2 w-2 rounded-full shrink-0 ${dotClass(state())}`}
          aria-hidden="true"
        />
        <span class="truncate max-w-[10rem] font-medium">{label()}</span>
        {/* Urgency badge — the host's awaiting count, hidden at zero. */}
        <Show when={awaiting() > 0}>
          <span
            class="shrink-0 min-w-4 px-1 h-4 inline-flex items-center justify-center rounded-full bg-amber-500/90 text-[10px] font-semibold text-black/80 tabular-nums"
            title={`${awaiting()} awaiting your input`}
          >
            {awaiting()}
          </span>
        </Show>
      </button>
      {/* Remove — guest hosts only. The local default is unremovable (the server
       *  rejects it LOUD; we also hide the affordance so it never invites the error). */}
      <Show when={!isLocal()}>
        <button
          type="button"
          class="pointer-events-auto shrink-0 px-1.5 inline-flex items-center justify-center text-fg-3 hover:text-red-400 hover:bg-surface-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none transition-opacity"
          data-testid="host-remove"
          aria-label={`Remove host ${label()}`}
          title={`Remove ${label()}`}
          onClick={() => {
            client.hosts
              .remove({ host: props.host })
              .catch((err: Error) =>
                toast.error(`Couldn't remove ${label()}: ${err.message}`),
              );
          }}
        >
          ✕
        </button>
      </Show>
    </div>
  );
};

const HostSelectorStrip: Component = () => {
  const gate = app.cells.hostMapGate.use({
    onError: (err: Error) =>
      toast.error(`Host gate subscription error: ${err.message}`),
  });
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  const submitAdd = (): void => {
    const raw = draft().trim();
    if (raw === "") return;
    // Validate BEFORE constructing the call: HostKeySchema's reserved-name refine throws
    // SYNCHRONOUSLY, so a bare `.add({ host: HostKeySchema.parse(raw) })` would throw before
    // `.then/.catch` are attached and fail with NO toast (a reserved name like "keys"). A
    // safeParse routes the rejection through the same error surface as a server-side reject.
    const parsed = HostKeySchema.safeParse(raw);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "invalid host key";
      toast.error(`Couldn't add ${raw}: ${message}`);
      return;
    }
    client.hosts
      .add({ host: parsed.data })
      .then(() => {
        setDraft("");
        setAdding(false);
      })
      .catch((err: Error) =>
        toast.error(`Couldn't add ${raw}: ${err.message}`),
      );
  };

  // The ENTIRE render is gated by `hostGateOpen(gate.value())` — the SINGLE predicate
  // that decides whether any strip/chip exists at all. Keep it the SOLE gate path: the
  // gate-closed done-criterion pin (`HostSelectorStrip.test.ts`) proves "closed ⇒ zero
  // multi-host UI" by pinning THIS predicate, so a second gate path (a CSS hide, an early
  // return, another `when` condition) would silently void that pin. Closed ⇒ the `<Show>`
  // mounts nothing (absent from the DOM, not hidden) ⇒ pixel-identical single-host canvas.
  return (
    <Show when={hostGateOpen(gate.value())}>
      <div
        class="pointer-events-auto flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar"
        data-testid="host-selector-strip"
      >
        <For each={padiMap.entries.use().keys()}>
          {(host) => <HostChip host={host} />}
        </For>

        {/* Add a host at runtime — an inline input toggled from a "+" affordance. */}
        <Show
          when={adding()}
          fallback={
            <button
              type="button"
              class="pointer-events-auto shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-lg border border-dashed border-edge text-fg-3 hover:text-fg hover:border-accent/60 transition-colors"
              data-testid="host-add-open"
              aria-label="Add a host"
              title="Add a host (ssh target)"
              onClick={() => setAdding(true)}
            >
              +
            </button>
          }
        >
          <input
            type="text"
            class="pointer-events-auto shrink-0 h-7 w-40 px-2 rounded-lg border border-accent/60 bg-surface-2 text-xs text-fg placeholder:text-fg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            data-testid="host-add-input"
            placeholder="ssh host, e.g. srid@zest"
            autofocus
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAdd();
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={() => {
              // Close on blur without adding — Enter is the only commit path.
              if (draft().trim() === "") setAdding(false);
            }}
          />
        </Show>
      </div>
    </Show>
  );
};

export default HostSelectorStrip;
