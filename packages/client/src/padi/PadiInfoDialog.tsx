/** PadiInfoDialog — compact identity panel for the Padi rail chip. Padi is the
 *  per-host daemon that owns the live terminals and supervises kaval; this mirrors
 *  {@link KavalInfoDialog}'s shape on the shared {@link InfoDialogShell}, minus the
 *  bits padi doesn't surface to the client. `padiLink` (kolu-server's binding state),
 *  the folded RSS, and padi's honest uptime (`now − startedAt` off the server-authored
 *  `processStartedAt` cell — mirroring the Kaval dialog's uptime) reach the browser;
 *  padi's build commit still lives server-side (the control-core `hello`), so this
 *  omits the version chip and build row rather than plumbing a drishti-gated member. */

import type { PadiLink, RunningPadi } from "kolu-common/surface";
import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { match, P } from "ts-pattern";
import { daemonTransportLive, formatUptime } from "../kaval/useDaemonStatus";
import { getClockNow } from "../time/clock";
import InfoDialogShell, { DetailRow, VersionChip } from "../ui/InfoDialog";
import {
  activePadiSurfaceVersion,
  runningPadis,
} from "../ui/useDaemonInventory";
import { formatMBCompact } from "../ui/memory";
import { padiMemoryDisplay } from "../ui/useMemoryUsage";
import { padiStartedAt } from "../ui/useProcessUptime";
import { PADI_LINK_PRESENTATION, padiDot } from "./padiPresentation";

/** A "—" for an honestly-unknown value. */
const dash = "—";

/** One row in the "Running padi daemons" diagnostic list — a discovered padi with its
 *  state-root, gate pid, and served surface version, badged when kolu-server is bound
 *  to it (so a LEAKED second padi at another state-root is visible at a glance). */
const RunningPadiRow: Component<{ padi: RunningPadi }> = (props) => (
  <li class="rounded-lg border border-edge bg-surface-1 px-2.5 py-2">
    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-fg">
        {props.padi.stateRoot ?? props.padi.socket}
      </span>
      <Show when={props.padi.active}>
        <span class="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-1.5 text-[9px] font-medium leading-4 text-accent">
          in use by kolu
        </span>
      </Show>
    </div>
    <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-fg-3">
      <span>gate pid {props.padi.gatePid ?? dash}</span>
      <span>contract {props.padi.surfaceVersion ?? dash}</span>
    </div>
    <div
      class="mt-1 truncate font-mono text-[10px] text-fg-3"
      title={props.padi.socket}
    >
      {props.padi.socket}
    </div>
  </li>
);

export const PADI_LOGO_URL = new URL("../../../padi/logo.svg", import.meta.url)
  .href;

const PadiInfoDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link: PadiLink | undefined;
}> = (props) => {
  const clockNow = getClockNow();
  return (
    <InfoDialogShell
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="md"
      logoSrc={PADI_LOGO_URL}
      name="Padi"
      version={
        // The RUNNING padi's actual `padiSurface` version (off its control-core
        // `hello`), mirroring the Kaval dialog's "contract v5.0" chip. Honesty
        // (#1034): shown only when a live value is known — otherwise no chip, never
        // the binder's build constant fabricated as the running version.
        <Show when={activePadiSurfaceVersion()}>
          {(v) => <VersionChip>contract v{v()}</VersionChip>}
        </Show>
      }
      description="Per-host daemon that owns your terminals and supervises kaval."
    >
      <div class="rounded-lg border border-edge bg-surface-2 px-3 py-2.5">
        <div class="flex min-w-0 items-center gap-2">
          <span
            class={`inline-block h-2 w-2 rounded-full ${padiDot(props.link, daemonTransportLive())}`}
          />
          {/* The connection label floors on the same transport liveness as the dot:
              over a dead/half-open ws the retained `padiLink` is stale, so read
              "unknown" rather than a frozen definite state. */}
          <Show
            when={daemonTransportLive() && props.link}
            fallback={
              <span class="text-xs font-medium text-fg-3">unknown</span>
            }
          >
            {(link) => (
              <span class="text-xs font-medium text-fg">
                {PADI_LINK_PRESENTATION[link()].label}
              </span>
            )}
          </Show>
          {/* Uptime, mirroring the Kaval dialog: `now − startedAt`, shown only over a
              LIVE link to a CONNECTED padi with a known boot time — otherwise the
              retained age is stale/unknown, so show nothing (never a fake uptime). */}
          <Show
            when={
              daemonTransportLive() &&
              props.link === "connected" &&
              padiStartedAt()
            }
          >
            {(t) => (
              <span class="truncate text-[11px] tabular-nums text-fg-3">
                up {formatUptime(clockNow() - t())}
              </span>
            )}
          </Show>
        </div>
      </div>

      <div class="space-y-1">
        <DetailRow label="memory">
          {/* Same {@link padiMemoryDisplay} source the identity-rail chip reads (the
              3-process `processMemory` cell — padi measures its own RSS), so the dialog
              and the rail tooltip can't drift: `ok` → the RSS figure; `error` → an
              honest poll-failure marker; `null` (stale link) → unavailable. */}
          <span data-testid="padi-dialog-memory">
            {match(padiMemoryDisplay())
              .with({ kind: "ok" }, (m) => formatMBCompact(m.rssBytes))
              .with({ kind: "error" }, () => "poll failed")
              .with(P.nullish, () => "unavailable")
              .exhaustive()}
          </span>
        </DetailRow>
      </div>

      {/* Every running padi on this host, active one badged — so a LEAKED second padi
          at another state-root (the padi twin of the orphaned-kaval leak) is
          diagnosable at a glance. Honesty (#1034): an honest empty line when none is
          discovered, never a fake. */}
      <div class="space-y-2">
        <h3 class="text-xs font-medium text-fg">Running padi daemons</h3>
        <Show
          when={runningPadis().length > 0}
          fallback={
            <p class="text-[11px] leading-relaxed text-fg-3">
              No running padi daemons discovered.
            </p>
          }
        >
          <ul class="space-y-1.5">
            <For each={runningPadis()}>
              {(padi) => <RunningPadiRow padi={padi} />}
            </For>
          </ul>
        </Show>
      </div>
    </InfoDialogShell>
  );
};

export default PadiInfoDialog;
