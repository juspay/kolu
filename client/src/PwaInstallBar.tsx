/**
 * Top bar nudging browser users to install Kolu as a PWA.
 *
 * Visible when:
 *  - Not already running as an installed PWA (display-mode != standalone), AND
 *  - User hasn't dismissed the bar this session.
 *
 * Dismissal is intentionally session-only — the bar reappears on each page
 * load. If Chrome's `beforeinstallprompt` fires, we stash it and render a
 * one-click Install button; otherwise we show browser-specific instructions.
 *
 * We deliberately do NOT call `event.preventDefault()` — on desktop it has no
 * effect anyway, and on mobile letting the browser's own mini-infobar also
 * show is acceptable (users can take either path).
 */

import {
  type Component,
  Show,
  createSignal,
  onMount,
  onCleanup,
} from "solid-js";
import { toast } from "solid-sonner";

/**
 * Subset of Chromium's non-standard BeforeInstallPromptEvent we actually use.
 * Not in lib.dom.d.ts yet.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Module-scope capture of `beforeinstallprompt`. The event can fire before
 * SolidJS hydrates and mounts this component, so we listen from module-load
 * time and stash the event. The component reads it on mount.
 */
let earlyInstallEvent: BeforeInstallPromptEvent | null = null;
const earlyListeners = new Set<(e: BeforeInstallPromptEvent) => void>();
window.addEventListener("beforeinstallprompt", (e) => {
  const evt = e as unknown as BeforeInstallPromptEvent;
  earlyInstallEvent = evt;
  for (const fn of earlyListeners) fn(evt);
});

type BrowserHint =
  | "ios-safari"
  | "macos-safari"
  | "firefox-desktop"
  | "firefox-android"
  | "other";

/** Per-browser manual install instructions. Pure lookup table — exhaustive via Record. */
const INSTRUCTIONS: Record<BrowserHint, string> = {
  "ios-safari": "Tap the Share button, then 'Add to Home Screen'.",
  "macos-safari": "Choose File → Add to Dock from the menu bar.",
  "firefox-desktop":
    "Firefox doesn't support installing web apps. For the full experience, open Kolu in Chrome or Edge.",
  "firefox-android": "Open the menu (⋮) and tap 'Install'.",
  other: "Look for 'Install app' in your browser menu.",
};

/** UA-based browser identification. Feature detection can't answer "which menu", so sniff. */
function detectBrowser(ua: string): BrowserHint {
  // iOS Safari (and all iOS browsers — they use the same Share → Add to Home Screen flow).
  if (/iPad|iPhone|iPod/.test(ua)) return "ios-safari";
  // Android Firefox must be checked before desktop Firefox.
  if (/Android.*Firefox/.test(ua)) return "firefox-android";
  if (/Firefox/.test(ua)) return "firefox-desktop";
  // macOS Safari: contains "Safari" but not "Chrome"/"Chromium".
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium/.test(ua))
    return "macos-safari";
  return "other";
}

const isPWA = window.matchMedia("(display-mode: standalone)").matches;

const PwaInstallBar: Component = () => {
  const [dismissed, setDismissed] = createSignal(false);
  const [installEvent, setInstallEvent] =
    createSignal<BeforeInstallPromptEvent | null>(earlyInstallEvent);
  const [installed, setInstalled] = createSignal(false);

  // Subscribe to late-firing beforeinstallprompt events (the early listener
  // runs at module load; this covers events that fire after mount).
  const lateListener = (evt: BeforeInstallPromptEvent) => setInstallEvent(evt);
  earlyListeners.add(lateListener);
  onCleanup(() => earlyListeners.delete(lateListener));

  // If the user installs mid-session (via our button or the browser's own UI),
  // hide the bar immediately.
  const onAppInstalled = () => setInstalled(true);
  onMount(() => window.addEventListener("appinstalled", onAppInstalled));
  onCleanup(() => window.removeEventListener("appinstalled", onAppInstalled));

  const browser = detectBrowser(navigator.userAgent);

  const handleInstall = async () => {
    const evt = installEvent();
    if (!evt) return;
    try {
      await evt.prompt();
    } catch (err) {
      toast.error(
        `Install failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      // A prompt can only be used once; drop the reference regardless of outcome.
      setInstallEvent(null);
    }
  };

  return (
    <Show when={!isPWA && !installed() && !dismissed()}>
      {/* TUI status-line aesthetic: monospace, fixed dark palette, terminal
       *  green accent. Intentionally uses hard-coded hex colors (not the
       *  app's CSS vars) because the bar is *not* part of the app — it's
       *  meta-chrome above it. This also sidesteps any theme-resolution
       *  oddities across browsers. */}
      <div
        data-testid="pwa-install-bar"
        class="flex items-center gap-2 min-h-10 shrink-0 px-4 sm:px-6 py-1.5 bg-[#0a0a0f] text-[#e5e5e7] border-b border-[#32d583]/30 font-mono text-xs"
        style={{ "box-shadow": "0 1px 0 0 rgba(50, 213, 131, 0.12)" }}
      >
        <span class="text-[#32d583] shrink-0 select-none" aria-hidden="true">
          ▶
        </span>
        <span class="flex-1 min-w-0 truncate">
          <span class="text-[#32d583] font-semibold">kolu</span>
          <span class="text-[#6b7280]"> // </span>
          <Show
            when={installEvent()}
            fallback={
              <span class="text-[#e5e5e7]">{INSTRUCTIONS[browser]}</span>
            }
          >
            <span class="text-[#e5e5e7]">install as native app for </span>
            <span class="text-[#32d583]">⌘T</span>
            <span class="text-[#6b7280]">, </span>
            <span class="text-[#32d583]">⌃Tab</span>
            <span class="text-[#e5e5e7]"> and friends</span>
          </Show>
        </span>
        <Show when={installEvent()}>
          <button
            data-testid="pwa-install-button"
            class="shrink-0 px-2.5 py-0.5 bg-[#32d583] text-[#0a0a0f] font-bold uppercase tracking-wider text-[11px] hover:bg-[#5ce69f] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#32d583]"
            onClick={() => void handleInstall()}
          >
            [install]
          </button>
        </Show>
        <button
          data-testid="pwa-install-dismiss"
          aria-label="Dismiss install prompt"
          class="shrink-0 px-1 text-[#6b7280] hover:text-[#e5e5e7] transition-colors cursor-pointer focus-visible:outline-none focus-visible:text-[#e5e5e7]"
          onClick={() => setDismissed(true)}
        >
          [×]
        </button>
      </div>
    </Show>
  );
};

export default PwaInstallBar;
