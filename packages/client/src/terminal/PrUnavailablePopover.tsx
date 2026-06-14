/** Click-to-open recovery-instructions popover + button trigger for
 *  `PrResult.kind === "unavailable"`. Dispatch happens in two layers:
 *  `ProviderUnavailableContent` matches on `source.provider` (today only
 *  `"gh"`), delegating to a per-provider content component so bkt's future
 *  recovery UX doesn't need to fit a shared mold. Anchored positioning
 *  comes from `useAnchoredPopover`. */

import type { GhUnavailableCode } from "kolu-github/schemas";
import type { PrUnavailableSource } from "kolu-common/surface";
import { reasonForSource } from "kolu-common/surface";
import { type Component, createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { match } from "ts-pattern";
import CopyCommandButton from "../ui/CopyCommandButton";
import { WarningIcon } from "../ui/Icons";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";

const AUTH_COMMAND = "gh auth login -s repo,read:org";

export const ProviderUnavailableContent: Component<{
  source: PrUnavailableSource;
}> = (props) =>
  match(props.source)
    .with({ provider: "gh" }, ({ code }) => (
      <GhUnavailableContent code={code} />
    ))
    .exhaustive();

const GhUnavailableContent: Component<{ code: GhUnavailableCode }> = (
  props,
) => {
  return match(props.code)
    .with("not-authenticated", () => (
      <>
        <div class="font-medium text-fg">GitHub not authenticated</div>
        <p class="text-fg-2 leading-relaxed">
          Kolu reads PRs via <code class="font-mono">gh</code>. Run this once in
          any terminal:
        </p>
        <CopyCommandButton
          command={AUTH_COMMAND}
          testId="pr-unavailable-copy"
        />
        <p class="text-fg-3 leading-relaxed">
          Scopes <code class="font-mono">repo</code> and{" "}
          <code class="font-mono">read:org</code> cover private repos and
          org-owned PRs.
        </p>
      </>
    ))
    .with("not-installed", () => (
      <>
        <div class="font-medium text-fg">GitHub CLI not installed</div>
        <p class="text-fg-2 leading-relaxed">
          Kolu reads PRs via <code class="font-mono">gh</code>. Install it from{" "}
          <a
            href="https://cli.github.com"
            target="_blank"
            rel="noopener noreferrer"
            class="text-accent hover:underline"
          >
            cli.github.com
          </a>{" "}
          and relaunch kolu.
        </p>
        <p class="text-fg-3 leading-relaxed">
          Nix installs bundle <code class="font-mono">gh</code> automatically —
          if you see this, the wrapper isn't in use.
        </p>
      </>
    ))
    .with("timed-out", () => (
      <>
        <div class="font-medium text-fg">GitHub timed out</div>
        <p class="text-fg-2 leading-relaxed">
          <code class="font-mono">gh pr view</code> took longer than 5s. Kolu
          will retry on the next branch change or polling tick.
        </p>
      </>
    ))
    .with("unknown", () => (
      <>
        <div class="font-medium text-fg">GitHub lookup failed</div>
        <p class="text-fg-2 leading-relaxed">
          An unrecognized error from <code class="font-mono">gh</code>. Check
          kolu server logs for details; kolu will retry on the next branch
          change.
        </p>
      </>
    ))
    .exhaustive();
};

const PrUnavailablePopover: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: HTMLElement;
  source: PrUnavailableSource;
}> = (props) => {
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.triggerRef,
    open: () => props.open,
    onDismiss: () => props.onOpenChange(false),
    anchor: "bottom-start",
    panelMinWidth: 280,
  });

  const chrome = surface({ radius: "xl", portalled: true });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={panelRef}
          data-testid="pr-unavailable-popover"
          role="dialog"
          aria-label={reasonForSource(props.source)}
          class={`fixed z-50 ${chrome.class} p-3 w-[280px] space-y-2 text-xs`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          <ProviderUnavailableContent source={props.source} />
        </div>
      </Portal>
    </Show>
  );
};

/** ⚠ button + its popover, one component per render site. Owns its own
 *  open-state signal and trigger ref — canvas tile chrome and mobile
 *  pull-handle show the icon for the same terminal simultaneously and each
 *  must anchor their popover to their own trigger rather than share one. */
export const PrUnavailableButton: Component<{
  source: PrUnavailableSource;
  testId: string;
}> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [triggerEl, setTriggerEl] = createSignal<HTMLButtonElement>();
  const reason = () => reasonForSource(props.source);
  return (
    <>
      <button
        ref={setTriggerEl}
        type="button"
        data-testid={props.testId}
        class="flex items-center text-fg-3 shrink-0 cursor-pointer hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
        title={reason()}
        aria-label={reason()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <WarningIcon class="w-3 h-3" />
      </button>
      <PrUnavailablePopover
        open={open()}
        onOpenChange={setOpen}
        triggerRef={triggerEl()}
        source={props.source}
      />
    </>
  );
};

export default PrUnavailablePopover;
