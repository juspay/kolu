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
import RestartKavalButton from "./RestartKavalButton";
import { restartDaemon } from "./useDaemonRestart";
import {
  DAEMON_STATE_PRESENTATION,
  formatUptime,
  toneDot,
} from "./useDaemonStatus";
import Commit from "../ui/Commit";
import { CloseIcon } from "../ui/Icons";
import ModalDialog from "../ui/ModalDialog";
import { surface } from "../ui/Surface";

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
          from the command line too.{" "}
          <a
            href="https://kolu.dev/kaval/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Learn more&nbsp;↗
          </a>
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
                    class={`inline-block h-[7px] w-[7px] rounded-full ${toneDot[DAEMON_STATE_PRESENTATION[s().state].tone]}`}
                  />
                  <span class="text-fg">
                    {DAEMON_STATE_PRESENTATION[s().state].label}
                  </span>
                  <Show when={s().startedAt}>
                    {(t) => (
                      <span class="text-fg-3 tabular-nums">
                        · up {formatUptime(Date.now() - t())}
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

        {/* Restart — recycle the daemon to pick up a new build or recover a
            stopped one; confirms first (it's destructive), then the session is
            captured and offered for restore. `onConfirm` closes this dialog
            before restarting — the recycle empties the canvas and surfaces the
            restore card, and a modal kaval dialog left open would overlay it
            (the rail dialog is an info panel, not where you'd click Restore). */}
        <div class="mt-3">
          <RestartKavalButton
            status={props.status}
            tone="neutral"
            onConfirm={() => {
              props.onOpenChange(false);
              void restartDaemon();
            }}
          />
          <p class="mt-1.5 text-[11px] leading-relaxed text-fg-3">
            Picks up a new build or recovers a stopped daemon. Your terminals
            are captured first and offered for restore on the fresh daemon.
          </p>
        </div>

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
