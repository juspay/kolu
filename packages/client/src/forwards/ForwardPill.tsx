import { toError } from "@kolu/surface/run-stream";
import { hostAuthority } from "@kolu/url-shape";
import { Effect } from "effect";
import type { KoluForward } from "kolu-common/surface";
import { type Component, createSignal, onCleanup, Show } from "solid-js";
import { toast } from "solid-sonner";
import { runAction } from "../runAction";
import { writeTextToClipboard } from "@kolu/solid-logtail";
import { FORWARD_PILL, originTooltip, originWord } from "./forwardTone";
import { portUrl } from "./portUrl";
import { cancelForward } from "./useForwards";

export function pasteableAddress(forward: KoluForward): string {
  return hostAuthority(window.location.hostname, forward.localPort);
}

export function forwardUrl(forward: KoluForward): string {
  return portUrl(window.location.hostname, forward.localPort);
}

export function forwardLabel(forward: KoluForward): string {
  return forward.host.kind === "local"
    ? String(forward.remotePort)
    : `${forward.host.target}:${forward.remotePort}`;
}

export const ForwardCopyButton: Component<{ forward: KoluForward }> = (
  props,
) => {
  const [copied, setCopied] = createSignal(false);
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
      runAction(
        "cancel forward",
        cancelForward(props.forward.key).pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              toast.error(
                `Could not cancel the forward: ${toError(err).message}`,
              );
            }),
          ),
        ),
      );
    }}
  >
    ⨯
  </button>
);

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

export const ForwardControls: Component<{ forward: KoluForward }> = (props) => (
  <span class="flex items-baseline gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/fwd:opacity-100 motion-reduce:transition-none">
    <ForwardCopyButton forward={props.forward} />
    <ForwardCancelButton forward={props.forward} />
  </span>
);
