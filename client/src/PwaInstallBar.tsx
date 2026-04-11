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
import { CloseIcon } from "./Icons";

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
      {/* Overt browser-level notification: accent background, taller than
       *  the Header, larger text. The animated arrow next to the Install
       *  button leads the eye directly to the CTA. */}
      <div
        data-testid="pwa-install-bar"
        class="flex items-center gap-3 min-h-12 shrink-0 px-4 sm:px-6 py-2 bg-accent text-surface-0 border-b-2 border-black/30 text-sm font-semibold shadow-lg"
      >
        <span class="flex-1 min-w-0">
          <span class="uppercase tracking-wide text-xs font-bold opacity-80">
            Install Kolu
          </span>
          <span class="block truncate">
            <Show when={installEvent()} fallback={INSTRUCTIONS[browser]}>
              Unlock native keyboard shortcuts (⌘T, ⌃Tab, …) and a dedicated
              app window.
            </Show>
          </span>
        </span>
        <Show when={installEvent()}>
          <span
            class="shrink-0 text-lg animate-pulse hidden sm:inline"
            aria-hidden="true"
          >
            →
          </span>
          <button
            data-testid="pwa-install-button"
            class="shrink-0 px-4 py-1.5 rounded-md bg-surface-0 text-accent font-bold text-sm hover:brightness-110 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-0/50 ring-1 ring-black/20"
            onClick={() => void handleInstall()}
          >
            Install app
          </button>
        </Show>
        <button
          data-testid="pwa-install-dismiss"
          aria-label="Dismiss install prompt"
          class="shrink-0 p-1.5 text-surface-0/70 hover:text-surface-0 hover:bg-black/15 rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-0/50"
          onClick={() => setDismissed(true)}
        >
          <CloseIcon />
        </button>
      </div>
    </Show>
  );
};

export default PwaInstallBar;
