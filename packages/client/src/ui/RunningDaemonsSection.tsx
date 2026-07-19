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
import { type DaemonScan, scanUnavailableText } from "../host/daemonScan";

export default function RunningDaemonsSection<T>(props: {
  /** The daemon noun, lower-case: 'kaval' | 'padi'. Drives every derived label. */
  noun: string;
  /** Testid stem: `${testidPrefix}-bound-host-daemons` / `-local-scan-daemons`. */
  testidPrefix: string;
  /** The ssh host kolu-server's padi is bound to, or null for a LOCAL binding. */
  boundHost: string | null;
  /** The bound-host scan liveness as a DISCRIMINATED CAUSE (#1793): `live` → render the
   *  rows; every other arm reads its own honest "unavailable" reason (never a silent zero,
   *  #1034; never a guessed "connecting" over a hard host failure). */
  scan: DaemonScan;
  /** The bound host's discovered daemon rows. */
  boundHostRows: readonly T[];
  /** THIS machine's discovered daemon rows (shown only under a remote binding). */
  localScanRows: readonly T[];
  /** Whether the local scan is a LIVE reading (#1793): the local scan rides the
   *  `daemonInventory` cell over the browser↔kolu-server ws, which RETAINS its rows across a
   *  transport drop. A non-live reading reads "unavailable", never the retained sockets/PIDs
   *  as current, and never a silent zero (#1034). */
  localScanLive: boolean;
  /** The per-daemon row renderer — each dialog passes its own. */
  renderRow: (row: T) => JSX.Element;
}): JSX.Element {
  const capitalizedNoun = (): string =>
    props.noun.charAt(0).toUpperCase() + props.noun.slice(1);
  return (
    <>
      {/* The BOUND host's running daemons — active one badged — so a LEAKED daemon is
          diagnosable at a glance, on the machine you're ACTUALLY using. Rides padiSurface's
          `hostInventory` member (padi scans its own host), so it works identically local
          and remote. */}
      <div
        class="space-y-2"
        data-testid={`${props.testidPrefix}-bound-host-daemons`}
      >
        <h3 class="text-xs font-medium text-fg">
          <Show
            when={props.boundHost}
            fallback={`Running ${props.noun} daemons`}
          >
            {(host) => (
              <>
                {capitalizedNoun()} daemons on {host()}
              </>
            )}
          </Show>
        </h3>
        {/* Honest degradation (#1034 + #1793): only a `live` scan is trusted to say "none".
            Otherwise — bind (re)connecting, a live padi that hasn't reported a scan, or a
            hard host `failed(cause)` — the fallback names the REAL cause off the
            discriminated {@link DaemonScan} (never a silent zero, never a guessed cause). */}
        {props.scan.kind === "live" ? (
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
        ) : (
          <p class="text-[11px] leading-relaxed text-fg-3">
            {scanUnavailableText(props.scan)}
          </p>
        )}
      </div>

      {/* Bound remotely: a SEPARATE scan of THIS machine — the machine kolu-server runs
          on is NOT the bound host, so a leak here would otherwise be invisible. Fenced
          off so the two hosts' truths can't read as one. Absent under a local binding
          (the list above already IS this machine). */}
      <Show when={props.boundHost}>
        {(host) => (
          <div
            class="space-y-2 rounded-lg border border-edge bg-surface-2/50 p-2.5"
            data-testid={`${props.testidPrefix}-local-scan-daemons`}
          >
            <h3 class="text-xs font-medium text-fg">
              Local daemons — this machine, not the bound host
            </h3>
            <p class="text-[11px] leading-relaxed text-fg-3">
              kolu-server is bound to padi on{" "}
              <span class="text-fg-2">{host()}</span> over ssh — the list above
              is that host's. These are daemons discovered on THIS machine (a
              leak diagnostic), not the bound host's.
            </p>
            {/* Honest degradation (#1034 + #1793): only a LIVE transport is trusted to say
                "none" for the local scan. A dead ws freezes the retained rows, so read
                "unavailable" rather than exposing stale sockets/PIDs as current. */}
            <Show
              when={props.localScanLive}
              fallback={
                <p class="text-[11px] leading-relaxed text-fg-3">
                  Local scan unavailable — the connection to kolu-server
                  dropped.
                </p>
              }
            >
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
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}
