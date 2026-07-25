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
import { FORWARD_PILL, originTooltip, originWord } from "./forwardTone";
import { ServingTerminalLink } from "./ServingTerminalLink";
import { portUrl } from "./portUrl";
import { cancelForward } from "./useForwards";

/** The URL a forward answers on. Always built from `location.hostname` and the
 *  LOCAL port: the door is on the kolu server's machine, which is the machine
 *  that served this page, and it is the one name reachable by construction. */
export function forwardUrl(forward: KoluForward): string {
  return portUrl(window.location.hostname, forward.localPort);
}

/** The address a user can paste — the machine serving this page, and the port
 *  the door answers on. This is the one fact on the row worth spending width on:
 *  the old row showed a mapping twice and a copyable address never. */
export function pasteableAddress(forward: KoluForward): string {
  return `${window.location.hostname}:${forward.localPort}`;
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
      class="shrink-0 rounded p-1 text-fg-3/70 transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer motion-reduce:transition-none"
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
    class="shrink-0 rounded p-1 text-fg-3/70 transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer motion-reduce:transition-none"
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

/** One row. `serving`, when supplied, NAMES the terminal serving this port and
 *  makes that name the way back to it — the answer to "what IS this?", which a
 *  row of numbers otherwise leaves hanging. Absent when nothing serves it (a ⌘K
 *  forward, or a server that has died): the row says nothing rather than
 *  inventing a name, because a door you cannot cancel is worse than one with no
 *  link. */
export const ForwardRow: Component<{
  forward: KoluForward;
  serving?: { name: string; jump: () => void };
}> = (props) => (
  <div
    class="group/fwd flex items-center gap-1.5 rounded px-1 py-0.5 -mx-1 text-[11px] leading-snug transition-colors hover:bg-surface-2/60 motion-reduce:transition-none"
    data-testid="forward-row"
    data-port={props.forward.remotePort}
    data-origin={props.forward.origin}
  >
    {/* The REMOTE port, plainly. The hostname is the dropdown's own title, so
     *  repeating it on every row was the loudest thing in a panel about one
     *  host. The number does NOT carry the jump: it did in the previous cut and
     *  the underline marking it was reported as invisible. */}
    <span class="shrink-0 font-mono tabular-nums text-fg">
      {props.forward.remotePort}
    </span>
    {/* …and WHAT is behind it, which is both the answer and the link. */}
    <Show when={props.serving}>
      {(s) => <ServingTerminalLink name={s().name} onJump={s().jump} />}
    </Show>
    {/* ONE pill carrying the address you can actually paste. The old row spent
     *  its width encoding the mapping twice (a `⇄` and a `→`) and still never
     *  showed a copyable address. */}
    <a
      href={forwardUrl(props.forward)}
      target="_blank"
      rel="noopener noreferrer"
      class={`min-w-0 truncate ${FORWARD_PILL} hover:underline`}
      data-testid="forward-open"
      data-port={props.forward.remotePort}
      title={forwardUrl(props.forward)}
    >
      ⇄ {pasteableAddress(props.forward)}
    </a>
    <span
      class="shrink-0 text-[10px] text-fg-3/60"
      title={originTooltip(props.forward.origin)}
    >
      {originWord(props.forward.origin)}
    </span>
    <span class="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/fwd:opacity-100 motion-reduce:transition-none">
      <ForwardCopyButton forward={props.forward} />
      <ForwardCancelButton forward={props.forward} />
    </span>
  </div>
);

/** The rows for a list, or nothing at all when there are none. Rendering an
 *  empty "Forwarded Ports" heading would be a claim about a feature the user may
 *  never have used; absence is the honest empty state. */
export const ForwardRows: Component<{
  forwards: readonly KoluForward[];
  /** Which terminal serves a given forward, and how to reach it. The lookup
   *  lives with the caller because only it holds that host's terminals. */
  servingFor?: (
    forward: KoluForward,
  ) => { name: string; jump: () => void } | undefined;
}> = (props) => (
  <Show when={props.forwards.length > 0}>
    <div class="flex flex-col gap-1" data-testid="forward-rows">
      <For each={props.forwards}>
        {(forward) => (
          <ForwardRow forward={forward} serving={props.servingFor?.(forward)} />
        )}
      </For>
    </div>
  </Show>
);
