/** PadiInfoDialog — compact identity panel for the Padi rail chip. Padi is the
 *  per-host daemon that owns the live terminals and supervises kaval; this mirrors
 *  {@link KavalInfoDialog}'s shape on the shared {@link InfoDialogShell}, minus the
 *  bits padi doesn't surface to the client. Only `padiLink` (kolu-server's binding
 *  state) and the folded RSS reach the browser today — padi's build commit / uptime
 *  live server-side (the control-core `hello`), so this omits the version chip and
 *  build/uptime rows rather than plumbing a new drishti-gated surface member. */

import type { PadiLink } from "kolu-common/surface";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import { match, P } from "ts-pattern";
import { daemonTransportLive } from "../kaval/useDaemonStatus";
import InfoDialogShell, { DetailRow } from "../ui/InfoDialog";
import { formatMBCompact } from "../ui/memory";
import { padiMemoryDisplay } from "../ui/useMemoryUsage";
import { PADI_LINK_PRESENTATION, padiDot } from "./padiPresentation";

export const PADI_LOGO_URL = new URL("../../../padi/logo.svg", import.meta.url)
  .href;

const PadiInfoDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link: PadiLink | undefined;
}> = (props) => (
  <InfoDialogShell
    open={props.open}
    onOpenChange={props.onOpenChange}
    size="sm"
    logoSrc={PADI_LOGO_URL}
    name="Padi"
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
          fallback={<span class="text-xs font-medium text-fg-3">unknown</span>}
        >
          {(link) => (
            <span class="text-xs font-medium text-fg">
              {PADI_LINK_PRESENTATION[link()].label}
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
  </InfoDialogShell>
);

export default PadiInfoDialog;
