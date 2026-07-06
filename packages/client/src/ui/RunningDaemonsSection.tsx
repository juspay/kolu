/** The "Running daemons" diagnostic section shared by the Kaval and Padi info dialogs
 *  — ONE structure for one user-level concept: the bound host's daemon list (a
 *  host-labelled heading + a live-gate with an honest "unavailable" fallback + an empty
 *  fallback) followed, under a remote binding, by a fenced local-machine scan. The two
 *  dialogs differ only in the noun ('kaval'/'padi'), the testid prefix, and the per-row
 *  renderer, so those are the props; every shared sentence and the live-gate logic live
 *  here once instead of in two lockstep copies.
 *
 *  `renderRow` stays a prop (not a branch inside the section) so the two row strategies
 *  — {@link RunningKavalRow}/{@link RunningPadiRow} — stay uncomplected. */

import type { JSX } from "solid-js";
import { For, Show } from "solid-js";

export default function RunningDaemonsSection<T>(props: {
  /** The daemon noun, lower-case: 'kaval' | 'padi'. Drives every derived label. */
  noun: string;
  /** Testid stem: `${testidPrefix}-bound-host-daemons` / `-local-scan-daemons`. */
  testidPrefix: string;
  /** The ssh host kolu-server's padi is bound to, or null for a LOCAL binding. */
  boundHost: string | null;
  /** Whether the bound-host reading is LIVE — a non-live reading reads "unavailable",
   *  never a silent zero (honesty #1034). */
  live: boolean;
  /** The bound host's discovered daemon rows. */
  boundHostRows: readonly T[];
  /** THIS machine's discovered daemon rows (shown only under a remote binding). */
  localScanRows: readonly T[];
  /** The per-daemon row renderer — each dialog passes its own. */
  renderRow: (row: T) => JSX.Element;
}): JSX.Element {
  const capitalizedNoun = (): string =>
    props.noun.charAt(0).toUpperCase() + props.noun.slice(1);
  return (
    <>
      {/* The BOUND host's running daemons — the ACTIVE set that serves your terminals.
          Given the ACCENT treatment (border + a `● bound` heading marker + a badge) so it
          reads unmistakably as the one in use, tying together the three signals of the same
          fact: the dialog's `socket ssh·<host>`, this `daemons on <host>` heading, and each
          row's `in use by kolu` badge. Rides padiSurface's `hostInventory` member (padi
          scans its own host), so it works identically local and remote. */}
      <div
        class="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-2.5"
        data-testid={`${props.testidPrefix}-bound-host-daemons`}
      >
        <h3 class="flex items-center gap-1.5 text-xs font-medium text-fg">
          <span class="text-accent" aria-hidden="true">
            ●
          </span>
          <Show
            when={props.boundHost}
            fallback={<>Running {props.noun} daemons</>}
          >
            {(host) => (
              <>
                {capitalizedNoun()} daemons on {host()}
              </>
            )}
          </Show>
          <span class="ml-auto shrink-0 rounded-full border border-accent/40 bg-accent/10 px-1.5 text-[9px] font-medium leading-4 text-accent">
            bound · serving your terminals
          </span>
        </h3>
        {/* Honest degradation (#1034): only a LIVE reading is trusted to say "none".
            Otherwise — bind warming, ssh link dropped, or a padi too old to serve
            `hostInventory` — the seeded EMPTY default must read "unavailable", never a
            silent zero masquerade. */}
        <Show
          when={props.live}
          fallback={
            <p class="text-[11px] leading-relaxed text-fg-3">
              Daemon scan unavailable — padi is connecting, or the connected
              padi is too old to report it.
            </p>
          }
        >
          <Show
            when={props.boundHostRows.length > 0}
            fallback={
              <p class="text-[11px] leading-relaxed text-fg-3">
                No running {props.noun} daemons discovered.
              </p>
            }
          >
            <ul class="space-y-1.5">
              <For each={props.boundHostRows}>
                {(row) => props.renderRow(row)}
              </For>
            </ul>
          </Show>
        </Show>
      </div>

      {/* Bound remotely: a SEPARATE, DEMOTED scan of THIS machine — the machine kolu-server
          runs on is NOT the bound host, so a leak here would otherwise be invisible. Dimmed
          (dashed border + muted) and explicitly labelled a diagnostic so it can't be
          mistaken for the accent-badged list above that serves your terminals. Absent under
          a local binding (the list above already IS this machine). */}
      <Show when={props.boundHost}>
        {(host) => (
          <div
            class="space-y-2 rounded-lg border border-dashed border-edge/60 bg-surface-2/30 p-2.5 opacity-80"
            data-testid={`${props.testidPrefix}-local-scan-daemons`}
          >
            <h3 class="text-xs font-medium text-fg-3">
              Diagnostic only — not your terminals
            </h3>
            <p class="text-[11px] leading-relaxed text-fg-3">
              These are {props.noun} daemons discovered on THIS machine (a leak
              diagnostic). kolu-server is bound to padi on{" "}
              <span class="text-fg-2">{host()}</span> over ssh — the list above,
              badged <span class="text-accent">bound</span>, is the one serving
              your terminals.
            </p>
            <Show
              when={props.localScanRows.length > 0}
              fallback={
                <p class="text-[11px] leading-relaxed text-fg-3">
                  No running {props.noun} daemons discovered on this machine.
                </p>
              }
            >
              <ul class="space-y-1.5">
                <For each={props.localScanRows}>
                  {(row) => props.renderRow(row)}
                </For>
              </ul>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}
