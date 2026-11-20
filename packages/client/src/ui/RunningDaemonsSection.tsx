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
  /** The bound-host scan liveness as a discriminated cause. */
  scan: DaemonScan;
  /** The bound host's discovered daemon rows. */
  boundHostRows: readonly T[];
  /** THIS machine's discovered daemon rows (shown only under a remote binding). */
  localScanRows: readonly T[];
  /** Whether the local scan is a LIVE reading. */
  localScanLive: boolean;
  /** The per-daemon row renderer — each dialog passes its own. */
  renderRow: (row: T) => JSX.Element;
}): JSX.Element {
  const capitalizedNoun = (): string =>
    props.noun.charAt(0).toUpperCase() + props.noun.slice(1);
  return (
    <>
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
