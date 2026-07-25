/**
 * The forward row and its two controls.
 *
 * The Inspector no longer renders a "Forwarded Ports" GROUP — its ports section
 * merged the two, so a forwarded port is one row carrying its own door inline —
 * but it still uses the two BUTTONS from here (`ForwardCopyButton`,
 * `ForwardCancelButton`), which is the point of them being their own components:
 * what copy copies and what cancel cancels are decided once, wherever a door is
 * shown.
 *
 * `ForwardRows` itself is now the HOST DROPDOWN's list alone. It has no ports
 * context to merge into — it is a host's doors, listed as such — so it keeps the
 * fuller `host:remotePort → :localPort · origin` row.
 */

import type { KoluForward } from "kolu-common/surface";
import { type Component, For, Show, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { portUrl } from "./portUrl";
import { cancelForward } from "./useForwards";

/** The URL a forward answers on. Always built from `location.hostname` and the
 *  LOCAL port: the door is on the kolu server's machine, which is the machine
 *  that served this page, and it is the one name reachable by construction. */
export function forwardUrl(forward: KoluForward): string {
  return portUrl(window.location.hostname, forward.localPort);
}

/** What a row calls the far end — `pu-dev:5173`, or just `5173` when the far end
 *  is the kolu host itself (naming "local" there would be noise: every row in a
 *  local host's list would carry the same word). */
export function forwardLabel(forward: KoluForward): string {
  return forward.host.kind === "local"
    ? String(forward.remotePort)
    : `${forward.host.target}:${forward.remotePort}`;
}

export const ForwardCopyButton: Component<{ forward: KoluForward }> = (
  props,
) => {
  const [copied, setCopied] = createSignal(false);
  return (
    <button
      type="button"
      class="shrink-0 text-fg-3/70 hover:text-fg transition-colors cursor-pointer"
      data-testid="forward-copy"
      data-port={props.forward.remotePort}
      title={copied() ? "copied" : `copy ${forwardUrl(props.forward)}`}
      aria-label={`Copy the address of ${forwardLabel(props.forward)}`}
      onClick={() => {
        // The address is the whole point of a forward — it goes into a curl, a
        // config, another machine's browser — so every surface that renders a row
        // renders this. `navigator.clipboard` is unavailable over plain http on a
        // non-localhost origin, which is a shape kolu is genuinely deployed in, so
        // the failure is REPORTED rather than swallowed into a silent no-op.
        navigator.clipboard.writeText(forwardUrl(props.forward)).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          (err: Error) => toast.error(`Could not copy: ${err.message}`),
        );
      }}
    >
      {copied() ? "✓" : "⧉"}
    </button>
  );
};

export const ForwardCancelButton: Component<{ forward: KoluForward }> = (
  props,
) => (
  <button
    type="button"
    class="shrink-0 text-fg-3/70 hover:text-danger transition-colors cursor-pointer"
    data-testid="forward-cancel"
    data-port={props.forward.remotePort}
    title={`cancel the forward to ${forwardLabel(props.forward)}`}
    aria-label={`Cancel the forward to ${forwardLabel(props.forward)}`}
    onClick={() => {
      // No optimistic removal: the server's cell IS the list, and a row that
      // vanished before its door actually shut would be the exact lie the whole
      // design avoids. The row goes when the server says it is gone.
      cancelForward(props.forward.key).catch((err: Error) =>
        toast.error(`Could not cancel the forward: ${err.message}`),
      );
    }}
  >
    ⨯
  </button>
);

/** One row. */
export const ForwardRow: Component<{ forward: KoluForward }> = (props) => (
  <div
    class="flex items-baseline gap-1.5 text-[11px] leading-snug"
    data-testid="forward-row"
    data-port={props.forward.remotePort}
    data-origin={props.forward.origin}
  >
    <span class="shrink-0 text-fg-3/70" aria-hidden="true">
      ⇄
    </span>
    <a
      href={forwardUrl(props.forward)}
      target="_blank"
      rel="noopener noreferrer"
      class="min-w-0 truncate font-mono text-accent hover:underline"
      data-testid="forward-open"
      data-port={props.forward.remotePort}
    >
      {forwardLabel(props.forward)} → :{props.forward.localPort}
    </a>
    <span
      class="shrink-0 text-[10px] text-fg-3/60"
      title={
        props.forward.origin === "auto"
          ? "opened by clicking a port — closes itself when that port dies"
          : "opened by hand — stays until you cancel it"
      }
    >
      {props.forward.origin}
    </span>
    <span class="ml-auto shrink-0 flex items-baseline gap-1.5">
      <ForwardCopyButton forward={props.forward} />
      <ForwardCancelButton forward={props.forward} />
    </span>
  </div>
);

/** The rows for a list, or nothing at all when there are none. Rendering an
 *  empty "Forwarded Ports" heading would be a claim about a feature the user may
 *  never have used; absence is the honest empty state. */
export const ForwardRows: Component<{ forwards: readonly KoluForward[] }> = (
  props,
) => (
  <Show when={props.forwards.length > 0}>
    <div class="flex flex-col gap-1" data-testid="forward-rows">
      <For each={props.forwards}>
        {(forward) => <ForwardRow forward={forward} />}
      </For>
    </div>
  </Show>
);
