/**
 * KavalInfoDialog — what the **kaval** rail column opens on click.
 *
 * kaval (the PTY daemon) owns your shells in its own process; kolu-server is its
 * client (B2 — the door). This dialog surfaces what that means: the daemon's
 * live state + identity, and — the discoverable bit — how to reach the very same
 * terminals from your shell with `kaval-tui`, which dials kaval's socket with no
 * flag needed.
 */

import Dialog from "@corvu/dialog";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { DaemonStatus } from "kolu-common/surface";
import { restartKaval, updatePending } from "./useDaemonStatus";
import Commit from "./ui/Commit";
import { CloseIcon } from "./ui/Icons";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";

const STATE_LABEL: Record<DaemonStatus["state"], string> = {
  connecting: "starting…",
  connected: "running",
  restarting: "recycling…",
  degraded: "stopped (session preserved)",
  dead: "not running",
};

const STATE_DOT: Record<DaemonStatus["state"], string> = {
  connecting: "bg-warning animate-pulse",
  connected: "bg-ok",
  restarting: "bg-warning animate-pulse",
  degraded: "bg-danger",
  dead: "bg-danger",
};

function uptime(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const Cmd: Component<{ children: string; note: string }> = (props) => (
  <div class="flex items-baseline justify-between gap-3 py-1">
    <code class="font-mono text-xs text-fg whitespace-nowrap">
      {props.children}
    </code>
    <span class="text-[11px] text-fg-3 text-right">{props.note}</span>
  </div>
);

const KavalInfoDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: DaemonStatus | undefined;
}> = (props) => {
  const chrome = surface({ portalled: true });
  // Why a restart is offered (and the copy explaining it), or undefined when the
  // daemon is healthy/current or already recycling. Update-pending (a build
  // behind) and down (dead/degraded) both route the user here.
  const restartReason = (): string | undefined => {
    const s = props.status;
    if (!s) return undefined;
    if (updatePending(s))
      return "kaval is a build behind the server. Restarting recycles it to the current build — a brief terminal recycle with your session restored. Optional.";
    if (s.state === "dead" || s.state === "degraded")
      return "Restart kaval to bring it back — your saved session is offered for restore once it’s healthy.";
    return undefined;
  };
  return (
    <ModalDialog open={props.open} onOpenChange={props.onOpenChange} size="md">
      <Dialog.Content
        class={`${chrome.class} relative p-5`}
        style={chrome.style}
      >
        {/* Close — the rail has no visible affordance otherwise; Escape +
            backdrop also dismiss via ModalDialog. */}
        <button
          type="button"
          onClick={() => props.onOpenChange(false)}
          class="absolute right-3 top-3 rounded p-1 text-fg-3 transition-colors hover:bg-surface-3/60 hover:text-fg"
          aria-label="Close"
        >
          <CloseIcon class="h-4 w-4" />
        </button>

        <Dialog.Label class="text-sm font-semibold text-fg flex items-center gap-2">
          <span class="font-mono text-accent">kaval</span>
          <span class="text-fg-3 font-normal">— the terminal daemon</span>
        </Dialog.Label>
        <p class="mt-1.5 text-xs leading-relaxed text-fg-2">
          kaval is the process that owns your shells. kolu talks to it over a
          local socket, so your terminals outlive the page and can be reached
          from the command line too.
        </p>

        {/* Live status */}
        <div class="mt-4 rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-xs">
          <Show
            when={props.status}
            fallback={<span class="text-fg-3">status unavailable</span>}
          >
            {(s) => (
              <div class="space-y-1.5">
                <div class="flex items-center gap-2">
                  <span
                    class={`inline-block h-[7px] w-[7px] rounded-full ${STATE_DOT[s().state]}`}
                  />
                  <span class="text-fg">{STATE_LABEL[s().state]}</span>
                  <Show when={s().startedAt}>
                    {(t) => (
                      <span class="text-fg-3 tabular-nums">
                        · up {uptime(t())}
                      </span>
                    )}
                  </Show>
                </div>
                <Show when={s().identity}>
                  {(id) => (
                    <div class="flex items-center gap-2 text-fg-3">
                      <span>build</span>
                      <Commit sha={id().navigableCommit} />
                      <span class="font-mono text-[11px] truncate">
                        {id().staleKey.slice(0, 12)}
                      </span>
                    </div>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>

        {/* Restart — the supervised recycle (B3). The rail's amber update nudge
            and the degraded canvas both route here; the copy explains why/what,
            and it's one click (the session is captured before the recycle). */}
        <Show when={restartReason()}>
          {(reason) => (
            <div class="mt-4 rounded-lg border border-edge bg-surface-2 px-3 py-2.5">
              <p class="text-xs leading-relaxed text-fg-2">{reason()}</p>
              <button
                type="button"
                onClick={() => {
                  props.onOpenChange(false);
                  void restartKaval();
                }}
                class="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface-1 transition-colors hover:bg-accent/90"
              >
                Restart kaval
              </button>
            </div>
          )}
        </Show>

        {/* kaval-tui */}
        <div class="mt-4">
          <h3 class="text-[11px] uppercase tracking-wide text-fg-3">
            Attach from your shell
          </h3>
          <p class="mt-1 text-xs leading-relaxed text-fg-2">
            <code class="font-mono text-fg">kaval-tui</code> reaches these same
            terminals — no <code class="font-mono">--socket</code> flag needed.
          </p>
          <div class="mt-2 rounded-lg border border-edge bg-surface-2 px-3 py-2 divide-y divide-edge/60">
            <Cmd note="every live terminal — id · pid · cwd">
              kaval-tui list
            </Cmd>
            <Cmd note="take one over (raw passthrough; ~. detaches)">
              kaval-tui attach &lt;id&gt;
            </Cmd>
            <Cmd note="dump its scrollback to stdout">
              kaval-tui snapshot &lt;id&gt;
            </Cmd>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-fg-3">
            Not installed?{" "}
            <code class="font-mono text-fg-2">
              nix run github:juspay/kolu#kaval-tui -- list
            </code>{" "}
            — or it ships with the home-manager module.
          </p>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default KavalInfoDialog;
