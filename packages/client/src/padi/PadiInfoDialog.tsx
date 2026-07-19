/** PadiInfoDialog — compact identity panel for a host-chip Padi mark. Padi is
 *  the per-host daemon that owns the live terminals and supervises kaval; this
 *  mirrors {@link KavalInfoDialog}'s shape on the shared {@link InfoDialogShell}
 *  — same rows in the same order where the concept applies to both
 *  (contract-version chip, build commit, socket, memory, uptime, the
 *  running-daemons list). Genuine per-daemon differences stay: kaval carries a
 *  currency/stale nudge + a restart affordance; padi's status is its `padiLink`
 *  (kolu-server's binding state), not a `daemonStatus` liveness. padi's
 *  contract version + build commit ride its OWN per-host `identity` cell (W4
 *  "the switch" — the clicked host's honest `surfaceVersion`/`commit`, the padi
 *  twin of kaval's `system.version`); the socket detail row still reads the
 *  bound-host scan (`useHostInventory`'s `activePadi()`).
 *
 *  ── HOST-SCOPING CLASSIFICATION TABLE (W4 "the switch") ──────────────────────────
 *  Every per-host-shaped field either RE-KEYS on `activeHost` (host-scoped) or is
 *  HOST-INDEPENDENT with a reason — no third category. `KavalInfoDialog.tsx` shares
 *  this table (its own fields are cross-referenced below).
 *
 *  | field                                          | classification                 |
 *  |-------------------------------------------------|---------------------------------|
 *  | `localDaemonStatus()` (kaval state/identity/…)   | host-scoped, RETAINED per host (W9) — `activeScope().wire.daemonStatus` (windowed onto the active host) |
 *  | `activeEntryConnected()` / `daemonChannelLive()` | host-scoped — reads `padiMap.entry(activeHost())` directly |
 *  | `activeEntryState()` / `isActiveHostLocal()`     | host-scoped — same as above (the typed entry discriminant `canvasModeResolver` keys on: host-down cause + remote-provisioning ceiling) |
 *  | `boundHostKavals/Padis()`, `activePadi()`        | host-scoped — `padiMap.useEntry(activeHost).cells.hostInventory` |
 *  | `daemonTransportLive()` (`app.health().live`)    | host-INDEPENDENT by design — one physical browser↔kolu-server ws, regardless of which host tab is active |
 *  | `serverRssBytes()`, `serverStartedAt()`          | host-INDEPENDENT by design — kolu-server's own process has exactly one RSS/boot-time |
 *  | `clientHeapUsedBytes()`                          | host-INDEPENDENT by design — THIS browser tab's JS heap, not a daemon fact at all |
 *  | `padiLinkState()` (padi chip/dialog status)      | host-INDEPENDENT **today**, not by design — describes the LEGACY single-bind `padiSession`, hardcoded to the LOCAL default under always-map (`server/src/index.ts`); no per-host `padiLink` wire member exists yet (padi/server gap, out of this fix's scope) |
 *  | `boundPadiConvergence()`, `daemonScanBoundHost()`  | host-INDEPENDENT **today**, not by design — same `padiSession`-hardcoded-local gap |
 *  | `props.presence` (build commit, surfaceVersion, …) | host-scoped (W4 "the switch") — `toPadiPresence(padi.link(), padi.live(), identity.value(), …)` folded AT THE CALL SITE off the clicked host's `padiMap.entry(host).cells.identity` (padi's own per-host hello twin); the dialog reads facts ONLY off its `connected` arm |
 *  | `props.startedAt`                                  | host-scoped (W4 "the switch") — same `identity` cell, reprojected by the clicked host chip via `padiMap.entry(host).clock.toLocal` (padi's boot epoch is on padi's OWN clock) |
 *  | `padiMemoryDisplay()`, `kavalMemoryDisplay()` VALUE | host-scoped (W4 "the switch") — `padiMap.useEntry(activeHost).cells.processMemory` (padi's OWN per-host RSS pair), not koluSurface's host-independent fold any more |
 *  | `padiMemoryDisplay()`, `kavalMemoryDisplay()` GATE  | host-scoped — BOTH floored on `daemonChannelLive()` (ws ∧ the active entry, #1793); kaval additionally gates on the daemon state being `connected` |
 *
 *  The remaining "host-independent today" rows (`padiLinkState()`, `boundPadiConvergence()`,
 *  `daemonScanBoundHost()`) are a real gap (padi/server must eventually serve a per-host
 *  `padiLink`/convergence through `padiMap`), not a permanent design choice — flagged in
 *  each hook's own module comment, out of this fix's file scope (client-only). */

import type { PadiConvergence, RunningPadi } from "kolu-common/surface";
import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { match, P } from "ts-pattern";
import { formatLifetime } from "../kaval/daemonPresentation";
import { daemonTransportLive, formatUptime } from "../kaval/useDaemonStatus";
import { getClockNow } from "../time/clock";
import Commit from "../ui/Commit";
import InfoDialogShell, { DetailRow, VersionChip } from "../ui/InfoDialog";
import { formatMBCompact } from "../ui/memory";
import RunningDaemonsSection from "../ui/RunningDaemonsSection";
import {
  boundPadiConvergence,
  daemonScanBoundHost,
  localScanPadis,
} from "../ui/useDaemonInventory";
import {
  activePadi,
  boundHostInventoryLive,
  boundHostPadis,
  boundHostScan,
} from "../ui/useHostInventory";
import { padiMemoryDisplay } from "../ui/useMemoryUsage";
import {
  type PadiPresence,
  padiPresencePresentation,
} from "./padiPresentation";

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
    {/* padi's contract version + build commit are NOT per-row: padi cannot probe a
        foreign padi, so they belong to the one bound padi and ride the header chip +
        build DetailRow (off its own per-host `identity` cell). The row shows only the gate
        pid — the terminal count kaval owns, padi does not. */}
    <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-fg-3">
      <span>gate pid {props.padi.gatePid ?? dash}</span>
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

/** How each standing convergence anomaly reads in the dialog banner. `adopted-stale` is
 *  degraded-but-WORKING (a warning tone — the canvas is live on the resident build); the
 *  rest are canvas-dead (a danger tone). */
const CONVERGENCE_PRESENTATION: Record<
  PadiConvergence["state"],
  { title: string; tone: "warn" | "down" }
> = {
  "adopted-stale": {
    title: "Build mismatch — riding the resident daemon",
    tone: "warn",
  },
  "skew-refused": { title: "Contract skew — refused", tone: "down" },
  unconverged: { title: "Could not converge the remote padi", tone: "down" },
  "link-failed": { title: "Remote link failed", tone: "down" },
};

/** A STANDING degraded-bind banner — so a convergence anomaly the (remote) binder hit is a
 *  VISIBLE state in the dialog, never swallowed into server logs (the whole point of the
 *  dialog). Shows running-vs-expected build for the build-mismatch case, and the reason. */
const ConvergenceBanner: Component<{ conv: PadiConvergence }> = (props) => {
  const p = (): { title: string; tone: "warn" | "down" } =>
    CONVERGENCE_PRESENTATION[props.conv.state];
  return (
    <div
      classList={{
        "rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed": true,
        "border-warning/40 bg-warning/10 text-warning": p().tone === "warn",
        "border-danger/40 bg-danger/15 text-danger": p().tone === "down",
      }}
      role="status"
    >
      <div class="font-medium">{p().title}</div>
      <Show when={props.conv.state === "adopted-stale"}>
        <div class="mt-0.5 font-mono text-[10px] text-fg-3">
          {/* `|| "—"`, not `??`: a pre-field survivor's build folds to "" (not null), and an
              honest "—" beats a blank per #1034. */}
          running {props.conv.runningBuild || "—"} · expected{" "}
          {props.conv.expectedBuild || "—"}
        </div>
      </Show>
      <div class="mt-0.5 text-fg-3">{props.conv.detail}</div>
    </div>
  );
};

const PadiInfoDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** THIS host's padi presence — the dialog's SOLE link/identity input. There is no raw
   *  `link`/`identity` prop: a connected-era fact (surfaceVersion, build commit, lifetime)
   *  can only be read off `presence`'s `connected` arm, folded at the CALL SITE on this
   *  host's liveness. "render a fact while not live" is a type error (#1793). */
  presence: PadiPresence;
  triggerRef: () => HTMLElement | undefined;
  /** Host this panel describes — shown under the title so the anchor is obvious. */
  hostLabel: string;
  /** THIS host's padi boot time after reprojecting onto the browser clock. Gated behind
   *  `connected()` below, so a stale boot time never paints an uptime over a dead link. */
  startedAt: number | null;
}> = (props) => {
  const clockNow = getClockNow();
  // The presence's dot + word + text tone, as ONE value from ONE match — a single memo
  // read at the dot span, the label span, and its text-tone class, so the three facets
  // can't drift.
  const presentation = createMemo(() =>
    padiPresencePresentation(props.presence),
  );
  const connected = ():
    | Extract<PadiPresence, { kind: "connected" }>
    | undefined => {
    const p = props.presence;
    return p.kind === "connected" ? p : undefined;
  };
  // The bound padi's socket, FLOORED on the bound-host scan liveness (#1793): a dead ssh
  // link / drain window freezes the re-served inventory cell stale, so an unfloored
  // `activePadi()?.socket` would leak a socket path over a channel that can no longer
  // confirm it — the same class the presence fold closes for the fact rows, in the scan
  // source Padi's socket row happens to read from.
  const boundSocket = (): string | undefined =>
    boundHostInventoryLive() ? activePadi()?.socket : undefined;
  return (
    <InfoDialogShell
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="md"
      logoSrc={PADI_LOGO_URL}
      name="Padi"
      contextLabel={props.hostLabel}
      triggerRef={props.triggerRef}
      version={
        // The RUNNING padi's actual `padiSurface` version (off its control-core
        // `hello`), mirroring the Kaval dialog's "contract v5.0" chip. Honesty
        // (#1034): shown only when CONNECTED with known identity — never the binder's
        // build constant fabricated as the running version, and never shown beside a
        // "connecting…"/"disconnected" label.
        <Show when={connected()?.identity.surfaceVersion}>
          {(v) => <VersionChip>contract v{v()}</VersionChip>}
        </Show>
      }
      description="Per-host daemon that owns your terminals and supervises kaval."
    >
      <div class="space-y-2 rounded-lg border border-edge bg-surface-2 px-3 py-2.5">
        {/* Bound-host identity: name the REMOTE host prominently (remote bind only) so the
            whole panel reads "this is that machine". Local bind → no line (unchanged). */}
        <Show when={daemonScanBoundHost()}>
          {(host) => (
            <div class="flex min-w-0 items-center gap-1.5 text-[11px]">
              <span class="text-fg-3">bound to</span>
              <span class="truncate rounded bg-surface-1 px-1.5 py-0.5 font-mono font-medium text-fg">
                ssh · {host()}
              </span>
            </div>
          )}
        </Show>
        <div class="flex min-w-0 items-center gap-2">
          {/* Dot + word + text tone projected from `presence` (the ONE
              {@link padiPresencePresentation}) — no raw `link`/`live` at the render site.
              `unknown` (dead channel / no value) reads grey + "unknown"; `connected` is
              reached ONLY once identity is confirmed (never a bare wire `"connected"`
              beside an unconfirmed dash). */}
          <span
            class={`inline-block h-2 w-2 rounded-full ${presentation().dot}`}
          />
          <span class={`text-xs font-medium ${presentation().textClass}`}>
            {presentation().label}
          </span>
          {/* Uptime, mirroring the Kaval dialog: `now − startedAt`, shown only for a
              CONFIRMED-connected padi with a known boot time — otherwise the retained
              age is stale/unknown, so show nothing (never a fake uptime).
              `props.startedAt` is ALREADY reprojected onto the browser's clock by the
              clicked host chip (padi's raw boot epoch is on padi's OWN clock) — never
              subtract a raw remote epoch from `clockNow()` directly. */}
          <Show when={connected() ? (props.startedAt ?? undefined) : undefined}>
            {(t) => (
              <span class="truncate text-[11px] tabular-nums text-fg-3">
                up {formatUptime(clockNow() - t())}
              </span>
            )}
          </Show>
        </div>
        {/* A STANDING convergence anomaly (adopted-stale build / contract skew / drain- or
            link-failure) — surfaced as a visible banner so the user SEES a degraded bind,
            not just server logs. `adopted-stale` sits atop a live (connected) canvas. */}
        <Show when={boundPadiConvergence()}>
          {(conv) => <ConvergenceBanner conv={conv()} />}
        </Show>
      </div>

      {/* Detail rows match master: build commit, socket, memory. The opener
          switches to this host first, so these active-host readouts describe
          the same host as the clicked chip. */}
      <div class="space-y-1">
        <DetailRow label="build commit">
          <Commit sha={connected()?.identity.buildCommit ?? undefined} />
        </DetailRow>
        <DetailRow label="socket">
          <Show
            when={daemonScanBoundHost()}
            fallback={
              <span title={boundSocket()}>
                {boundSocket() ?? "unavailable"}
              </span>
            }
          >
            {(host) => <span>ssh · {host()}</span>}
          </Show>
        </DetailRow>
        <DetailRow label="memory">
          <span data-testid="padi-dialog-memory">
            {match(padiMemoryDisplay())
              .with({ kind: "ok" }, (m) => formatMBCompact(m.rssBytes))
              .with({ kind: "error" }, () => "poll failed")
              .with(P.nullish, () => "unavailable")
              .exhaustive()}
          </span>
        </DetailRow>
        <DetailRow label="lifetime">
          {/* padi's lifetime policy — `forever` for a durable production padi;
              `bound to run pid N` under a test/smoke run. Routed through
              `connected()` (P4): a non-connected or pre-field survivor padi reads
              an honest "—". */}
          <span data-testid="padi-dialog-lifetime">
            {formatLifetime(connected()?.identity.lifetime)}
          </span>
        </DetailRow>
      </div>

      <RunningDaemonsSection
        noun="padi"
        testidPrefix="padi"
        boundHost={daemonScanBoundHost()}
        scan={boundHostScan()}
        boundHostRows={boundHostPadis()}
        localScanRows={localScanPadis()}
        localScanLive={daemonTransportLive()}
        renderRow={(padi) => <RunningPadiRow padi={padi} />}
      />
    </InfoDialogShell>
  );
};

export default PadiInfoDialog;
