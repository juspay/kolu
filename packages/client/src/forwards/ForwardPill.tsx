/**
 * How an open door READS, and what you can DO with it — in one place, because
 * two surfaces show the same door.
 *
 * The Inspector's ports list and the host tab's dropdown both render a forward:
 * the address it answers on, why it is still open, and the copy/cancel pair. The
 * previous cut factored out three of the five pieces (the pill's class, the
 * origin words, the two buttons) and then reassembled them TWICE, disagreeing on
 * the result — one surface showed `⇄ :61003` with the origin in the tooltip, the
 * other showed `⇄ host:61003` with the origin in a sibling span. The rule this
 * branch states so firmly for COLOUR (one meaning, one declaration, so it
 * survives someone restyling one of them) is exactly as true of the pill's text
 * and its tooltip.
 *
 * The address helpers live here rather than beside the rows for the same reason:
 * what a door is CALLED and what a click on it copies are one fact.
 */

import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { KoluForward } from "kolu-common/surface";
import { type Component, createSignal, onCleanup, Show } from "solid-js";
import { toast } from "solid-sonner";
import { runAction } from "../runAction";
import { writeTextToClipboard } from "../ui/clipboard";
import { FORWARD_PILL, originTooltip, originWord } from "./forwardTone";
import { portAuthority, portUrl } from "./portUrl";
import { cancelForward } from "./useForwards";

/** The address a user can paste — the machine serving this page, and the port
 *  the door answers on. Built through `portAuthority`, so an IPv6-served kolu
 *  shows the same bracketed spelling the copy button writes. */
export function pasteableAddress(forward: KoluForward): string {
  return portAuthority(window.location.hostname, forward.localPort);
}

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
  // The flash timer is tracked so a rapid re-click resets it instead of stacking
  // timers, and a mid-flash unmount cancels it rather than firing setCopied on a
  // disposed owner — the same discipline CopyCommandButton keeps.
  let flash: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(flash));
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
        // renders this. It goes through `writeTextToClipboard` because
        // `navigator.clipboard` is a SECURE-CONTEXT-only API and kolu is
        // genuinely deployed on plain http (a LAN address, a machine hostname, a
        // Tailscale IP): there the property is `undefined`, so reading
        // `.writeText` off it throws synchronously — before any handler is
        // attached — and the copy fails with no toast at all. The helper owns
        // that case, falling through to the execCommand path that survives it.
        runAction(
          "copy forward URL",
          writeTextToClipboard(forwardUrl(props.forward)).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                setCopied(true);
                clearTimeout(flash);
                flash = setTimeout(() => setCopied(false), 1200);
              }),
            ),
            Effect.catch((err) =>
              Effect.sync(() => {
                toast.error(`Could not copy: ${toError(err).message}`);
              }),
            ),
          ),
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
      runAction(
        "cancel forward",
        cancelForward(props.forward.key).pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              toast.error(`Could not cancel the forward: ${toError(err).message}`);
            }),
          ),
        ),
      );
    }}
  >
    ⨯
  </button>
);

/** The door, as a teal pill: the address it answers on, and — in the tooltip —
 *  why it is still open. A bare `⇄` answered no question (forwarded WHERE?), so
 *  the pill always carries the address, which is also the thing worth pasting.
 *  Teal, never the connection green: one colour per meaning.
 *
 *  `link` is the only difference the two surfaces genuinely have — a ports row
 *  already carries its own open affordance beside the pill, so a second link on
 *  the same row would be two ways to do one thing. */
export const ForwardPill: Component<{
  forward: KoluForward;
  link?: boolean;
  /** The row's own port, for the test hooks that address a row by number. */
  testid?: string;
}> = (props) => {
  const text = () => `⇄ ${pasteableAddress(props.forward)}`;
  const title = () =>
    `${forwardUrl(props.forward)} · ${originWord(props.forward.origin)} — ${originTooltip(props.forward.origin)}`;
  return (
    <Show
      when={props.link}
      fallback={
        <span
          class={`min-w-0 shrink truncate text-[10px] tabular-nums ${FORWARD_PILL}`}
          data-testid={props.testid}
          data-port={props.forward.remotePort}
          title={title()}
        >
          {text()}
        </span>
      }
    >
      <a
        href={forwardUrl(props.forward)}
        target="_blank"
        rel="noopener noreferrer"
        class={`min-w-0 truncate ${FORWARD_PILL} hover:underline`}
        data-testid={props.testid}
        data-port={props.forward.remotePort}
        title={title()}
      >
        {text()}
      </a>
    </Show>
  );
};

/** Copy and cancel, revealed together. They belong to the DOOR, so every surface
 *  that shows one shows both — quiet until the row is hovered or something in it
 *  is focused, always reachable by keyboard, never shouting on a list the user
 *  is only reading. */
export const ForwardControls: Component<{ forward: KoluForward }> = (props) => (
  <span class="flex items-baseline gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/fwd:opacity-100 motion-reduce:transition-none">
    <ForwardCopyButton forward={props.forward} />
    <ForwardCancelButton forward={props.forward} />
  </span>
);
