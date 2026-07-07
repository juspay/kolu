/** PadiInfoDialog — compact identity panel for the Padi rail chip. Padi is the
 *  per-host daemon that owns the live terminals and supervises kaval; this mirrors
 *  {@link KavalInfoDialog}'s shape on the shared {@link InfoDialogShell} — same rows
 *  in the same order where the concept applies to both (contract-version chip, build
 *  commit, socket, memory, uptime, the running-daemons list). Genuine per-daemon
 *  differences stay: kaval carries a currency/stale nudge + a restart affordance;
 *  padi's status is its `padiLink` (kolu-server's binding state), not a `daemonStatus`
 *  liveness. padi's contract version + build commit + socket ride the server-authored
 *  `daemonInventory` cell (the bound padi's honest `hello.surfaceVersion` / `.commit`),
 *  the padi twin of kaval's `system.version`.
 *
 *  ── HOST-SCOPING CLASSIFICATION TABLE (W4 "the switch") ──────────────────────────
 *  Every per-host-shaped field either RE-KEYS on `activeHost` (host-scoped) or is
 *  HOST-INDEPENDENT with a reason — no third category. `KavalInfoDialog.tsx` shares
 *  this table (its own fields are cross-referenced below).
 *
 *  | field                                          | classification                 |
 *  |-------------------------------------------------|---------------------------------|
 *  | `localDaemonStatus()` (kaval state/identity/…)   | host-scoped — `padiMap.useEntry(activeHost).collections.daemonStatus` |
 *  | `activeEntryConnected()` / `daemonChannelLive()` | host-scoped — reads `padiMap.entry(activeHost())` directly |
 *  | `activeEntryFailed()` / `isActiveHostLocal()`    | host-scoped — same as above (drives `canvasModeResolver`'s remote-provisioning ceiling) |
 *  | `boundHostKavals/Padis()`, `activePadi()`        | host-scoped — `padiMap.useEntry(activeHost).cells.hostInventory` |
 *  | `daemonTransportLive()` (`app.health().live`)    | host-INDEPENDENT by design — one physical browser↔kolu-server ws, regardless of which host tab is active |
 *  | `serverRssBytes()`, `serverStartedAt()`          | host-INDEPENDENT by design — kolu-server's own process has exactly one RSS/boot-time |
 *  | `clientHeapUsedBytes()`                          | host-INDEPENDENT by design — THIS browser tab's JS heap, not a daemon fact at all |
 *  | `padiLinkState()` (padi chip/dialog status)      | host-INDEPENDENT **today**, not by design — describes the LEGACY single-bind `padiSession`, hardcoded to the LOCAL default under always-map (`server/src/index.ts`); no per-host `padiLink` wire member exists yet (padi/server gap, out of this fix's scope) |
 *  | `activePadiSurfaceVersion()`, `boundPadiBuildCommit()`, `boundPadiConvergence()`, `daemonScanBoundHost()` | host-INDEPENDENT **today**, not by design — same `padiSession`-hardcoded-local gap |
 *  | `padiStartedAt()`                                | host-INDEPENDENT **today**, not by design — same gap (padi's own boot time has no per-host wire member) |
 *  | `padiMemoryDisplay()`, `kavalMemoryDisplay()` VALUE | host-INDEPENDENT **today**, not by design — koluSurface's `processMemory` folds the LOCAL padi/kaval pair (`server/src/memorySampler.ts`); padi DOES serve its own per-host `processMemory`, but kolu-server's fold isn't wired to the active host yet |
 *  | `padiMemoryDisplay()`, `kavalMemoryDisplay()` GATE  | host-scoped — floored on `daemonTransportLive()`/`daemonChannelLive()` (kaval's) |
 *
 *  The "host-independent today" rows are a real gap (padi/server must eventually serve
 *  per-host identity/memory/uptime through `padiMap`), not a permanent design choice —
 *  flagged in each hook's own module comment, out of this fix's file scope (client-only). */

import type {
  PadiConvergence,
  PadiLink,
  RunningPadi,
} from "kolu-common/surface";
import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { match, P } from "ts-pattern";
import { daemonTransportLive, formatUptime } from "../kaval/useDaemonStatus";
import { getClockNow } from "../time/clock";
import Commit from "../ui/Commit";
import InfoDialogShell, { DetailRow, VersionChip } from "../ui/InfoDialog";
import { formatMBCompact } from "../ui/memory";
import RunningDaemonsSection from "../ui/RunningDaemonsSection";
import {
  activePadiSurfaceVersion,
  boundPadiBuildCommit,
  boundPadiConvergence,
  daemonScanBoundHost,
  localScanPadis,
} from "../ui/useDaemonInventory";
import {
  activePadi,
  boundHostInventoryLive,
  boundHostPadis,
} from "../ui/useHostInventory";
import { padiMemoryDisplay } from "../ui/useMemoryUsage";
import { padiStartedAt } from "../ui/useProcessUptime";
import {
  PADI_LINK_PRESENTATION,
  type PadiPresence,
  padiDot,
  toPadiPresence,
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
        build DetailRow (off `daemonInventory.boundPadi`). The row shows only the gate
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
  link: PadiLink | undefined;
}> = (props) => {
  const clockNow = getClockNow();
  // The client's own honest presence sum (P4 — retires the "unknown"/"—" escape hatch):
  // `identity` is MANDATORY on the `connected` arm, so a render can never show a
  // synthesized dash/"unknown" beside a confirmed-connected padi. Floored on
  // `daemonTransportLive` exactly like the dot below — a dead/half-open ws, or a
  // `connected` link whose identity sample hasn't landed yet, folds to `warming`, never
  // a stale `connected` claim. See `padiPresentation.ts`'s `toPadiPresence` + its
  // `@ts-expect-error` pin in `padiPresentation.test.ts`.
  const presence = createMemo<PadiPresence>(() =>
    toPadiPresence(
      props.link,
      daemonTransportLive(),
      boundPadiBuildCommit(),
      activePadiSurfaceVersion(),
      boundPadiConvergence(),
    ),
  );
  const connected = ():
    | Extract<PadiPresence, { kind: "connected" }>
    | undefined => {
    const p = presence();
    return p.kind === "connected" ? p : undefined;
  };
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
          <span
            class={`inline-block h-2 w-2 rounded-full ${padiDot(props.link, daemonTransportLive())}`}
          />
          {/* The connection label is derived from `presence()` (P4): `connected` is
              reached ONLY once identity is confirmed (never a bare wire `"connected"`
              beside an unconfirmed dash); `warming`/`down` read the SAME honest
              "connecting…"/"disconnected" wording the rail dot's tone table already
              uses — never the retired ad hoc "unknown" string. */}
          <span class="text-xs font-medium text-fg">
            {match(presence())
              .with(
                { kind: "connected" },
                () => PADI_LINK_PRESENTATION.connected.label,
              )
              .with(
                { kind: "warming" },
                () => PADI_LINK_PRESENTATION.connecting.label,
              )
              .with(
                { kind: "down" },
                () => PADI_LINK_PRESENTATION.degraded.label,
              )
              .exhaustive()}
          </span>
          {/* Uptime, mirroring the Kaval dialog: `now − startedAt`, shown only for a
              CONFIRMED-connected padi with a known boot time — otherwise the retained
              age is stale/unknown, so show nothing (never a fake uptime). */}
          <Show when={connected() ? (padiStartedAt() ?? undefined) : undefined}>
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

      {/* Detail rows mirror the Kaval dialog's set + order: build commit, socket,
          memory. padi's build commit is the RUNNING padi's `hello.commit` off the
          active `daemonInventory` row (the padi twin of kaval's `system.version`
          identity); `<Commit>` renders it as the SAME navigable commit link the Kaval
          dialog uses, or an honest "—" when unknown (#1034). */}
      <div class="space-y-1">
        <DetailRow label="build commit">
          {/* Routed through `connected()` (P4): a confirmed-connected padi's build
              commit is present BY CONSTRUCTION (no `??`/ternary escape hatch to a
              synthesized dash beside a claimed-connected state); a
              non-connected/not-yet-identified/transport-dead padi passes `undefined`,
              which `<Commit>` renders as an honest "—". The BOUND padi's `hello.commit`
              works over ssh — no local active row under a remote binding — the padi
              twin of kaval's `system.version`. */}
          <Commit sha={connected()?.identity.buildCommit} />
        </DetailRow>
        <DetailRow label="socket">
          {/* Local bind → the padi's unix socket. Remote bind → the padi lives on the ssh
              host, so its socket is a path THERE (not locally meaningful); name the host
              instead of a misleading local "unavailable". */}
          <Show
            when={daemonScanBoundHost()}
            fallback={
              <span title={activePadi()?.socket}>
                {activePadi()?.socket ?? "unavailable"}
              </span>
            }
          >
            {(host) => <span>ssh · {host()}</span>}
          </Show>
        </DetailRow>
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

      {/* The BOUND host's running padis — active one badged — so a LEAKED second padi at
          another state-root (the padi twin of the orphaned-kaval leak) is diagnosable at a
          glance, plus, under a remote binding, a fenced scan of THIS machine. The section
          owns the heading, live-gate, and fences; the padi row is passed as `renderRow`. */}
      <RunningDaemonsSection
        noun="padi"
        testidPrefix="padi"
        boundHost={daemonScanBoundHost()}
        live={boundHostInventoryLive()}
        boundHostRows={boundHostPadis()}
        localScanRows={localScanPadis()}
        renderRow={(padi) => <RunningPadiRow padi={padi} />}
      />
    </InfoDialogShell>
  );
};

export default PadiInfoDialog;
