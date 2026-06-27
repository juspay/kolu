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
import { isCleanRef } from "@kolu/surface-app";
import type { DaemonStatus } from "kolu-common/surface";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import Commit, { REPO_URL } from "../ui/Commit";
import { CloseIcon } from "../ui/Icons";
import ModalDialog from "../ui/ModalDialog";
import { surface } from "../ui/Surface";
import { expectedKaval } from "./KavalUpdateBadge";
import { kavalStale } from "./kavalCurrency";
import RestartKavalButton from "./RestartKavalButton";
import { restartDaemon } from "./useDaemonRestart";
import {
  DAEMON_STATE_PRESENTATION,
  daemonTransportLive,
  formatUptime,
  kavalDot,
} from "./useDaemonStatus";

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
  // The build the server WOULD spawn — the `expected` operand of the currency
  // nudge (the `reported` operand is `props.status.identity`), read through the
  // shared `expectedKaval` accessor so the surface path is named once; it drives
  // the running-vs-expected commit links + the "what changed in kaval" history link.
  //
  // Derive the nudge predicate from the `props.status` the dialog already holds
  // (the same `kavalStale` the rail uses), rather than `kavalUpdatePending()`
  // re-reading the global daemon-status singleton. Gating the banner and its
  // fallback on one memo means the gate, the displayed `running`, and the copy
  // all read one snapshot — no mid-restart disagreement between the prop and the
  // singleton.
  const pending = (): boolean =>
    kavalStale(
      expectedKaval()?.staleKey,
      props.status?.identity?.staleKey,
      props.status?.state,
    );
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
                  {/* Dot + uptime floored on transport liveness, same as the rail
                      (kavalDot): a dead/half-open link can't refresh the daemon
                      state, so the dot reads grey "unknown" and the uptime is
                      withheld rather than shown stale off a value the channel can
                      no longer confirm. */}
                  <span
                    class={`inline-block h-[7px] w-[7px] rounded-full ${kavalDot(s().state, daemonTransportLive())}`}
                  />
                  <span class="text-fg">
                    {DAEMON_STATE_PRESENTATION[s().state].label}
                  </span>
                  <Show when={daemonTransportLive() && s().startedAt}>
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
                {/* Where this kaval listens — the unix socket `kaval-tui`
                    auto-discovers; a server fact surfaced on the status. */}
                <Show when={s().socketPath}>
                  {(sock) => (
                    <div class="flex items-center gap-2 text-fg-3">
                      <span>socket</span>
                      <span
                        class="font-mono text-[11px] truncate"
                        title={sock()}
                      >
                        {sock()}
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
          {/* B3.4: when the running daemon is a build behind what the server
              would spawn, surface the running-vs-expected detail right above the
              restart that picks it up (the read-site nudge's call-to-action). */}
          <Show when={pending()}>
            <div class="mb-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 leading-relaxed">
              <p class="text-xs font-medium text-warning">
                ⬆ A newer kaval is available
              </p>
              {/* The two builds' git COMMITS (clickable), not the closure
                  staleKeys — those are nix content hashes, not GitHub-navigable. */}
              <p class="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-fg-3">
                <span>running</span>
                <Commit sha={props.status?.identity?.navigableCommit} />
                <span>· expected</span>
                <Commit sha={expectedKaval()?.navigableCommit} />
              </p>
              {/* GitHub can't path-filter a compare DIFF, but it CAN a commit
                  HISTORY (commits/<ref>/<path>) — so link kaval's history at the
                  expected build. Guarded like the commit links (a clean ref only). */}
              <Show when={isCleanRef(expectedKaval()?.navigableCommit)}>
                <a
                  href={`${REPO_URL}/commits/${expectedKaval()?.navigableCommit}/packages/kaval`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mt-1 inline-block text-[11px] text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  What changed in kaval&nbsp;↗
                </a>
              </Show>
              <p class="mt-1 text-[11px] text-fg-3">
                Restart to pick it up — your terminals are captured first and
                offered for restore on the fresh daemon.
              </p>
            </div>
          </Show>
          <RestartKavalButton
            status={props.status}
            tone="neutral"
            onConfirm={() => {
              props.onOpenChange(false);
              void restartDaemon();
            }}
          />
          <Show when={!pending()}>
            <p class="mt-1.5 text-[11px] leading-relaxed text-fg-3">
              Picks up a new build or recovers a stopped daemon. Your terminals
              are captured first and offered for restore on the fresh daemon.
            </p>
          </Show>
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
            <Cmd note="every live terminal — prints a short id">
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
            <code class="font-mono text-fg-2">&lt;id&gt;</code> is the short id
            from <code class="font-mono text-fg-2">list</code> — or any unique
            prefix of the full one.
          </p>
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
