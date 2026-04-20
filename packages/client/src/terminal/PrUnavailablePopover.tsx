/** Recovery-instructions popover for `PrResult.kind === "unavailable"`.
 *
 *  Click the ⚠ on a terminal's title bar; this panel explains *why* the PR
 *  lookup is broken and (when actionable) gives a copy-paste command to fix
 *  it. Content dispatched per-`code` via `match(...).exhaustive()` so new
 *  PrUnavailableCode variants force a compile-time edit here.
 *
 *  The inner dispatch is exported as `PrUnavailableContent` so the right-panel
 *  inspector can render the same recovery UI inline (no click required — the
 *  inspector has the real estate for it).
 *
 *  Portal + click-outside + Escape mirror `settings/SettingsPopover.tsx`'s
 *  pattern — there is no Corvu Popover in the repo, and the settings panel is
 *  the canonical reference for anchored floating UI. */

import { type Component, Show, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { makeEventListener } from "@solid-primitives/event-listener";
import { match } from "ts-pattern";
import type { PrUnavailableCode } from "kolu-common";

const AUTH_COMMAND = "gh auth login -s repo,read:org";

/** Dispatches per-`code` recovery content — heading, prose, optional copy
 *  button. Shared between the popover (click-to-open, terminal title bar) and
 *  the inspector (always-visible, right panel). */
export const PrUnavailableContent: Component<{
  code: PrUnavailableCode;
}> = (props) => {
  const [copied, setCopied] = createSignal(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Browsers block clipboard writes outside secure contexts / without a
      // user gesture — falling through silently is acceptable here because
      // the command string is still visible and selectable in the panel.
    }
  };

  return match(props.code)
    .with("not-authenticated", () => (
      <>
        <div class="font-medium text-fg">GitHub not authenticated</div>
        <p class="text-fg-2 leading-relaxed">
          Kolu reads PRs via <code class="font-mono">gh</code>. Run this once in
          any terminal:
        </p>
        <CopyCommand
          command={AUTH_COMMAND}
          copied={copied()}
          onCopy={() => copy(AUTH_COMMAND)}
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
  code: PrUnavailableCode;
  reason: string;
}> = (props) => {
  let panelRef: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal({ top: 0, left: 0 });

  const updatePos = () => {
    if (!props.triggerRef) return;
    const rect = props.triggerRef.getBoundingClientRect();
    // Anchor below the trigger, aligned to its left edge, with viewport clamp
    // so narrow tiles near the right edge don't clip the panel.
    const panelWidth = 280;
    const left = Math.min(rect.left, window.innerWidth - panelWidth - 8);
    setPos({ top: rect.bottom + 4, left: Math.max(8, left) });
  };

  makeEventListener(document, "mousedown", (e) => {
    if (
      props.open &&
      panelRef &&
      !panelRef.contains(e.target as Node) &&
      !props.triggerRef?.contains(e.target as Node)
    ) {
      props.onOpenChange(false);
    }
  });

  makeEventListener(document, "keydown", (e) => {
    if (props.open && e.key === "Escape") props.onOpenChange(false);
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={(el) => {
            panelRef = el;
            updatePos();
          }}
          data-testid="pr-unavailable-popover"
          role="dialog"
          aria-label={props.reason}
          class="fixed z-50 bg-surface-1 border border-edge rounded-xl shadow-2xl shadow-black/50 p-3 w-[280px] space-y-2 text-xs"
          style={{
            top: `${pos().top}px`,
            left: `${pos().left}px`,
            "background-color": "var(--color-surface-1)",
          }}
        >
          <PrUnavailableContent code={props.code} />
        </div>
      </Portal>
    </Show>
  );
};

const CopyCommand: Component<{
  command: string;
  copied: boolean;
  onCopy: () => void;
}> = (props) => (
  <button
    type="button"
    onClick={props.onCopy}
    class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 font-mono text-[11px] text-fg cursor-pointer transition-colors"
    data-testid="pr-unavailable-copy"
  >
    <span class="truncate">{props.command}</span>
    <span class="shrink-0 text-fg-3 text-[10px]">
      {props.copied ? "copied" : "copy"}
    </span>
  </button>
);

export default PrUnavailablePopover;
