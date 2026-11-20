import type { PadiConvergence, RunningPadi } from "kolu-common/surface";
import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { match, P } from "ts-pattern";
import { formatLifetime } from "../kaval/daemonPresentation";
import { daemonTransportLive, formatUptime } from "../kaval/useDaemonStatus";
import { getClockNow } from "../time/clock";
import Commit from "../ui/Commit";
import { docUrl } from "../ui/DocLink";
import { OpenIcon } from "../ui/Icons";
import InfoDialogShell, { DetailRow, VersionChip } from "../ui/InfoDialog";
import { formatMiB } from "@kolu/byte-units";
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

const dash = "—";

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

const CONVERGENCE_PRESENTATION: Record<
  PadiConvergence["kind"],
  { title: string; tone: "warn" | "down" }
> = {
  "adopted-stale": {
    title: "Build mismatch — riding the resident daemon",
    tone: "warn",
  },
  "skew-refused": { title: "Contract skew — refused", tone: "down" },
  unconverged: { title: "Could not converge the remote padi", tone: "down" },
  "cross-supervisor": {
    title: "Another supervisor owns this host",
    tone: "down",
  },
  "link-failed": { title: "Remote host gave up", tone: "down" },
};

function buildIdLabel(
  build: { kind: "known"; id: string } | { kind: "off-nix" },
): string {
  return build.kind === "known" ? build.id : "(off-nix)";
}

const ConvergenceBanner: Component<{ conv: PadiConvergence }> = (props) => {
  const p = (): { title: string; tone: "warn" | "down" } =>
    CONVERGENCE_PRESENTATION[props.conv.kind];
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
      <Show
        when={
          props.conv.kind === "adopted-stale" ||
          props.conv.kind === "skew-refused"
            ? props.conv
            : false
        }
      >
        {(conv) => {
          const c = conv();
          return (
            <div class="mt-0.5 font-mono text-[10px] text-fg-3">
              {c.kind === "adopted-stale" ? (
                <>
                  running {buildIdLabel(c.running.build)} · expected{" "}
                  {buildIdLabel(c.expected.build)}
                </>
              ) : (
                <>
                  running contract {c.running.contractVersion} · expected{" "}
                  {c.expected.contractVersion}
                </>
              )}
            </div>
          );
        }}
      </Show>
      <Show when={props.conv.kind === "cross-supervisor" ? props.conv : false}>
        {(conv) => (
          <div class="mt-0.5 font-mono text-[10px] text-fg-3">
            drained {instanceKeyLabel(conv().drained)} · observed{" "}
            {instanceKeyLabel(conv().observed)}
          </div>
        )}
      </Show>
      <div class="mt-0.5 text-fg-3">{props.conv.detail}</div>
    </div>
  );
};

function instanceKeyLabel(
  k: { kind: "instance"; key: string | number } | { kind: "pre-instance" },
): string {
  return k.kind === "instance" ? String(k.key) : "pre-instance";
}

const PadiInfoDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presence: PadiPresence;
  triggerRef: () => HTMLElement | undefined;
  hostLabel: string;
  startedAt: number | null;
}> = (props) => {
  const clockNow = getClockNow();
  const presentation = createMemo(() =>
    padiPresencePresentation(props.presence),
  );
  const connected = ():
    | Extract<PadiPresence, { kind: "connected" }>
    | undefined => {
    const p = props.presence;
    return p.kind === "connected" ? p : undefined;
  };
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
        <Show when={connected()?.identity.surfaceVersion}>
          {(v) => <VersionChip>contract v{v()}</VersionChip>}
        </Show>
      }
      description="Per-host daemon that owns your terminals and supervises kaval."
    >
      <div class="space-y-2 rounded-lg border border-edge bg-surface-2 px-3 py-2.5">
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
            class={`inline-block h-2 w-2 rounded-full ${presentation().dot}`}
          />
          <span class={`text-xs font-medium ${presentation().textClass}`}>
            {presentation().label}
          </span>
          <Show when={connected() ? (props.startedAt ?? undefined) : undefined}>
            {(t) => (
              <span class="truncate text-[11px] tabular-nums text-fg-3">
                up {formatUptime(clockNow() - t())}
              </span>
            )}
          </Show>
        </div>
        <Show when={boundPadiConvergence()}>
          {(conv) => <ConvergenceBanner conv={conv()} />}
        </Show>
      </div>

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
              .with({ kind: "ok" }, (m) => formatMiB(m.rssBytes, 0))
              .with({ kind: "error" }, () => "poll failed")
              .with(P.nullish, () => "unavailable")
              .exhaustive()}
          </span>
        </DetailRow>
        <DetailRow label="lifetime">
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

      <div class="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface-2 px-3 py-2.5">
        <div class="min-w-0">
          <h3 class="text-xs font-medium text-fg">Padi docs</h3>
          <p class="mt-0.5 text-[11px] leading-relaxed text-fg-3">
            How padi owns your workspace and how padi-tui drives it.
          </p>
        </div>
        <a
          href={docUrl("padi")}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-edge bg-surface-1 px-2.5 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-surface-3/60 hover:text-fg"
        >
          Docs
          <OpenIcon class="h-3.5 w-3.5" />
        </a>
      </div>
    </InfoDialogShell>
  );
};

export default PadiInfoDialog;
