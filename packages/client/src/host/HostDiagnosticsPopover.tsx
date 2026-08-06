/** Per-host diagnostics popover — the detail that used to crowd every chip.
 *
 *  Opened by clicking the host tab's connection status pip. Shows connection
 *  state (with the real error + reconnect when unreachable), terminal +
 *  awaiting counts, the padi·kaval dual-daemon pair, and remove-with-confirm
 *  for guest hosts.
 *
 *  #1962 will supply provisioning copy progress; until then we show only the
 *  honest state label — no fake progress bar (remote-hosts.mdx).
 */

import { unenrolledStreamCall } from "@kolu/surface/client";
import { createReactiveSubscription } from "@kolu/surface/solid";
import { useSurfaceApp } from "@kolu/surface-app/solid";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { KoluBuildInfo, TerminalId } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import CopyDiagnosticsButton from "../CopyDiagnosticsButton";
import { hostMarks } from "../attention/attentionMarks";
import { activePadiTerminal } from "@kolu/padi/surface";
import type { KoluForward } from "kolu-common/surface";
import { ForwardRows } from "../forwards/ForwardRows";
import { servingLink } from "../forwards/terminalServingPort";
import { selectFleetTerminal } from "../palette/fleetActions";
import { containingTileOf } from "../terminal/terminalTree";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { forwardsForHost } from "../forwards/useForwards";
import { formatTimeAgo } from "../terminal/staleness";
import { tailOf } from "../kaval/connectCanvasView";
import { failedEpisode } from "../kaval/useDaemonStatus";
import {
  LOG_TAIL_LINE,
  LOG_TAIL_SURFACE,
  NO_LOG_LINES,
} from "../ui/logTailChrome";
import { surface } from "../ui/Surface";
import { type AnchorSide, useAnchoredPopover } from "../ui/useAnchoredPopover";
import { useServerIdentity } from "../useServerIdentity";
import {
  activeHost,
  interpretClientError,
  padiMap,
  setActiveHost,
} from "../wire";
import { runAction } from "../runAction";
import { HostDualDaemonSlot } from "./HostDaemonChips";
import { hostGlance, hostLabel } from "./hostChipTone";
import { useHostKavalChain } from "./useHostKaval";
import { reconnectHost } from "./reconnectHost";
import { removeHost } from "./removeHost";

/** How many trailing lines of a failed episode this popover shows — the last few, not the
 *  whole post-mortem the host-down card renders: this is a popover anchored to a status pip. */
const POPOVER_TAIL_LINES = 4;

const popoverChrome = surface({
  radius: "lg",
  shadow: "light",
  portalled: true,
});

const PopoverRow: Component<{
  label: string;
  danger?: boolean;
  children: string | number;
}> = (props) => (
  <div class="flex items-center justify-between gap-4 py-0.5 text-[11px]">
    <span
      classList={{
        "text-danger": props.danger,
        "text-fg-3": !props.danger,
      }}
    >
      {props.label}
    </span>
    <span
      class="min-w-0 truncate font-medium tabular-nums"
      classList={{
        "text-danger": props.danger,
        "text-fg": !props.danger,
      }}
    >
      {props.children}
    </span>
  </div>
);

/** Nested portals owned by marks inside this panel (Padi/Kaval info dialogs).
 *  Clicks there must not count as outside-dismiss — they live outside the
 *  panel DOM but are opened from it. */
function isOwnedNestedPortal(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest?.('[data-testid="info-popover"]') != null;
}

export const HostDiagnosticsPopover: Component<{
  host: HostKey;
  triggerRef: () => HTMLElement | undefined;
  open: () => boolean;
  onDismiss: () => void;
  anchor?: AnchorSide;
}> = (props) => {
  const state = () => padiMap.entry(props.host).state();
  // #2101 N4 — the header pip and the `state` row read the whole chain.
  const kaval = useHostKavalChain(props.host);
  const glance = () => hostGlance(state(), kaval());
  const marks = hostMarks(encodeHostKey(props.host));
  const isLocal = () => props.host.kind === "local";
  const store = useTerminalStore();
  const forwards = () => forwardsForHost(props.host);
  const [confirmRemove, setConfirmRemove] = createSignal(false);
  // Local: machine hostname when known (same as the tab label); remotes: target.
  const { hostname } = useServerIdentity();
  // The same server-build source the Diagnostic Info dialog copies from, so both
  // entry points to `CopyDiagnosticsButton` produce the identical block — without
  // it this one printed `server commit: unknown`.
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const label = () =>
    isLocal() ? (hostname() ?? hostLabel(props.host)) : hostLabel(props.host);

  // Lightweight keys stream only while the panel is open (`null` input tears
  // it down). Floors to undefined until the first frame lands — never a fake 0.
  // Errors surface via interpretClientError (toast) AND the subscription's
  // `.error()` so the row can paint distinctly from "pending / no data".
  const terminalKeys = createReactiveSubscription<HostKey, TerminalId[]>(
    () => (props.open() ? props.host : null),
    (host) =>
      unenrolledStreamCall(
        padiMap.entry(host).collections.terminals.unenrolledKeys,
        undefined,
        // Scoped by HOST: the same member name is opened once per host, and a
        // liveness table that could not tell them apart would name the wrong
        // one as parked (kolu#2101 J2). The `<key>[<id>]` spelling is the
        // framework's own (`client.health()`), reused rather than reinvented.
        { label: `terminals.keys[${encodeHostKey(host)}] (popover)` },
      ),
    {
      onError: (err) =>
        interpretClientError(
          { kind: "scopedSub", label: "Terminal list error" },
          err,
          { key: props.host },
        ),
    },
  );
  const keys = createMemo(() =>
    props.open() && state().kind === "connected" ? (terminalKeys() ?? []) : [],
  );
  // Collection opened at component top level (Solid rule) with empty keys when
  // closed / not connected — so we never hold a live inventory for a closed panel.
  const terminals = padiMap
    .entry(props.host)
    .collections.terminals.use({ keys });

  /** Every terminal on this host with a live arm, by id.
   *
   *  A MEMO, because `ForwardRows` asks its lookup once per row: rebuilt inside
   *  that lookup it re-read every terminal on the host for every row rendered.
   *  It is held UNFILTERED — splits included — and that matters: a dev server
   *  almost always runs in a split, so a source that dropped splits (the fleet
   *  index does, deliberately) would find nothing in the common case. */
  const arms = createMemo(
    () =>
      new Map(
        keys().flatMap((id) => {
          const arm = activePadiTerminal(terminals.byKey(id)?.());
          return arm === undefined ? [] : [[id, arm] as const];
        }),
      ),
  );

  /** WHICH terminal serves a forwarded port, and how to reach it — the answer to
   *  "what IS this?", which a row of numbers otherwise leaves hanging. The rule
   *  itself is `servingLink`, shared with the Inspector; what is local to this
   *  component is the SOURCE of the terminals (a foreign host's collection) and
   *  the act of getting there (a host switch, then an activate). */
  const servingFor = (forward: KoluForward) =>
    servingLink({
      port: forward.remotePort,
      candidates: (() => {
        const map = arms();
        // Containing tile via terminalTree — a nested split's port still links
        // the root; an orphan falls back to itself (painted top-level).
        return [...map].map(([id, arm]) => {
          const tile = containingTileOf(id, (x) => {
            const a = map.get(x);
            if (a === undefined) return undefined;
            return a.parentId ?? null;
          });
          return {
            id,
            parentId: tile === id ? null : tile,
            ports: arm.ports,
          };
        });
      })(),
      // The join returns the TILE, and the tile is what the row names — a
      // split's own name would point at a pane the user cannot see as a thing.
      armOf: (id) => {
        const tile = arms().get(id);
        return tile === undefined
          ? undefined
          : { git: tile.git ?? null, cwd: tile.cwd };
      },
      activate: (id) => {
        // Switch host first when the row is foreign, then activate — the same
        // sequencing the palette uses, so a forward row and a palette row behave
        // identically rather than by coincidence.
        selectFleetTerminal(
          props.host,
          id,
          activeHost(),
          setActiveHost,
          store.activate,
        );
        props.onDismiss();
      },
    });

  const terminalCount = (): string => {
    if (!props.open()) return "—";
    if (terminalKeys.error()) return "error";
    const v = terminalKeys();
    return v === undefined ? "—" : String(v.length);
  };

  const lastActivity = (): string => {
    if (!props.open() || state().kind !== "connected") return "—";
    if (terminalKeys.error()) return "error";
    const idList = terminalKeys();
    if (idList === undefined || idList.length === 0) return "—";
    let max = 0;
    for (const id of idList) {
      const meta = terminals.byKey(id)?.();
      const at = meta?.lastActivityAt;
      if (typeof at === "number" && at > max) max = at;
    }
    return max > 0 ? formatTimeAgo(max) : "—";
  };

  // Reset the two-step remove arm whenever the panel closes.
  createEffect(() => {
    if (!props.open()) setConfirmRemove(false);
  });

  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: props.triggerRef,
    open: props.open,
    onDismiss: props.onDismiss,
    anchor: props.anchor ?? "bottom-start",
    panelMinWidth: 280,
    isInside: isOwnedNestedPortal,
  });

  // The failed episode, through the ONE shared reader (`failedEpisode`) — the popover is the
  // only failure surface you can reach for a host WITHOUT switching to it (the host-down card
  // only ever renders for the active host), so the reason must not arrive here without its
  // evidence. It cannot: the two are one record on the failed arm.
  const failure = createMemo(() => failedEpisode(state()));
  // A MEMO because both the `Show` guard and the `For` read it: called twice per render it
  // folded the entry twice and handed `For` a fresh array each time, so the tail's rows tore
  // down and rebuilt on every unrelated repaint (the same `Show`+`For` pairing ConnectCanvas
  // already memoizes). TOTAL — a non-failed entry yields the shared {@link NO_LOG_LINES}, not
  // `undefined`. Nothing here can tell the two apart (`length > 0` and `<For>` both read an
  // empty array exactly as they read an absent one), and `failure()` already answers "is
  // this entry failed", so an `| undefined` would be a distinction with no reader. That is
  // NOT the canvas card's absence distinction, which IS observable and stays: this popover
  // renders only the failure record's own `evidence`, which is never missing.
  const failureLog = createMemo(() => {
    const episode = failure();
    return episode === undefined
      ? NO_LOG_LINES
      : tailOf(episode.log, POPOVER_TAIL_LINES);
  });

  return (
    <Show when={props.open()}>
      <Portal>
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Host diagnostics — ${label()}`}
          data-testid="host-diagnostics-popover"
          data-host={encodeHostKey(props.host)}
          class={`fixed z-50 w-[min(18rem,calc(100vw-1rem))] p-3 ${popoverChrome.class}`}
          style={{ ...panelStyle(), ...popoverChrome.style }}
        >
          <div class="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-fg">
            <span
              class={`inline-block h-2 w-2 shrink-0 rounded-full ${glance().detailDot}`}
              aria-hidden="true"
            />
            <span class="truncate">{label()}</span>
          </div>

          <PopoverRow label="state" danger={glance().down}>
            {glance().short}
          </PopoverRow>

          <Show when={failure()?.reason}>
            {(reason) => (
              <p
                class="mt-0.5 break-words font-mono text-[10px] leading-4 text-danger/90"
                data-testid="host-diagnostics-error"
                title={reason()}
              >
                {reason()}
              </p>
            )}
          </Show>

          <Show when={failureLog().length > 0}>
            <div
              data-testid="host-diagnostics-log"
              class={`mt-1 max-h-20 overflow-y-auto px-1.5 py-1 text-[10px] leading-4 ${LOG_TAIL_SURFACE}`}
            >
              <For each={failureLog()}>
                {(entry) => <div class={LOG_TAIL_LINE}>{entry.line}</div>}
              </For>
            </div>
          </Show>

          {/* #1962 drop-in: when progress facts exist, render them here.
           *  Until then: state label only — no zero-width fake bar. */}
          <div
            data-testid="host-provision-progress"
            data-ready="false"
            class="hidden"
            aria-hidden="true"
          />

          <Show when={state().kind === "failed"}>
            <button
              type="button"
              data-testid="host-diagnostics-reconnect"
              class="mt-1.5 flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-[11px] text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
              onClick={() =>
                runAction("reconnect host", reconnectHost(props.host))
              }
            >
              <span class="text-fg-3">retry now</span>
              <span aria-hidden="true">↻</span>
            </button>
          </Show>

          <div class="my-2 border-t border-edge/60" />

          <PopoverRow label="terminals" danger={Boolean(terminalKeys.error())}>
            {terminalCount()}
          </PopoverRow>
          <PopoverRow label="awaiting you">{marks.asking()}</PopoverRow>

          <div class="my-2 border-t border-edge/60" />

          <div class="flex items-center justify-between gap-3 py-0.5 text-[11px]">
            <span class="text-fg-3">padi · kaval</span>
            <HostDualDaemonSlot host={props.host} />
          </div>

          <PopoverRow
            label="last activity"
            danger={Boolean(terminalKeys.error())}
          >
            {lastActivity()}
          </PopoverRow>

          {/* Forwarded ports — the doors kolu holds open to THIS host. Their
              natural home: a forward is host-scoped (a listener here, pointed at
              a port there), so the host popover shows all of them while the
              Inspector shows the same rows narrowed to the active terminal's
              host. Absent entirely when there are none. */}
          <Show when={forwards().length > 0}>
            <div class="my-2 border-t border-edge/60" />
            <div class="py-0.5 text-[10px] uppercase tracking-wide text-fg-3">
              forwarded ports ·{" "}
              <span class="tabular-nums">{forwards().length}</span>
            </div>
            <ForwardRows forwards={forwards()} servingFor={servingFor} />
          </Show>

          <Show when={!isLocal()}>
            <div class="my-2 border-t border-edge/60" />
            <Show
              when={confirmRemove()}
              fallback={
                // Same row geometry as PopoverRow (label column left) — no extra
                // horizontal padding that would shift past "state" / "terminals".
                <button
                  type="button"
                  data-testid="host-diagnostics-remove"
                  class="flex w-full items-center justify-between gap-4 py-0.5 text-left text-[11px] text-danger transition-colors hover:text-danger/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
                  onClick={() => setConfirmRemove(true)}
                >
                  <span>remove host…</span>
                  <span aria-hidden="true" />
                </button>
              }
            >
              <div class="flex items-center justify-between gap-2 py-0.5">
                <button
                  type="button"
                  data-testid="host-diagnostics-remove-confirm"
                  class="rounded-md bg-danger/15 px-2 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
                  onClick={() => {
                    runAction("remove host", removeHost(props.host));
                    props.onDismiss();
                  }}
                >
                  confirm remove
                </button>
                <button
                  type="button"
                  data-testid="host-diagnostics-remove-cancel"
                  class="rounded-md px-2 py-1 text-[11px] text-fg-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
                  onClick={() => setConfirmRemove(false)}
                >
                  cancel
                </button>
              </div>
            </Show>
          </Show>

          {/* The tab-wide diagnostic snapshot, reachable from the host you are
              looking at (kolu#2101 J2). The same builder the Diagnostic Info
              dialog copies — a per-host ENTRY POINT, not a per-host snapshot:
              a parked subscription is a fact about the whole wire, and a block
              that showed only this host's would hide the one that matters. */}
          <div class="my-2 border-t border-edge/60" />
          <CopyDiagnosticsButton
            serverBuild={pwa.server()}
            class="flex w-full items-center justify-between gap-4 py-0.5 text-left text-[11px] text-fg-3 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
          >
            copy diagnostics
          </CopyDiagnosticsButton>

          <span class="sr-only">{glance().title}</span>
        </div>
      </Portal>
    </Show>
  );
};
