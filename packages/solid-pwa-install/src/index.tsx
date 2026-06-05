/** `@kolu/solid-pwa-install` — a SolidJS adapter over the
 *  `@khmyznikov/pwa-install` web component. One socket: **"install this web
 *  app."**
 *
 *  The volatility it hides is cross-browser PWA-install fragmentation. Chromium
 *  desktop/Android fire a real `beforeinstallprompt` event you can capture and
 *  replay on a click; every other engine has no JS prompt at all — iOS wants
 *  Share→Add to Home Screen, macOS Safari wants File→Add to Dock, Firefox
 *  Android hides install in a menu, Firefox desktop has nothing. A consumer
 *  that branched on `navigator.userAgent` itself would carry all of that
 *  forever; here it plugs into one stable interface (`PwaInstall`) and the
 *  detection + the instruction-dialog delegation live behind it.
 *
 *  Two layers:
 *  - PURE, fully unit-tested: `detectInstallPlatform` / `installInstructions`.
 *    No DOM — every input is passed in, so the module is import-safe under
 *    vitest's Node environment.
 *  - BROWSER-ONLY: `createPwaInstall` touches `window` / `customElements` and
 *    must run inside a Solid owner. */

import { type Accessor, createSignal, onCleanup, onMount } from "solid-js";

export type InstallPlatform =
  | "chromium-desktop" // Chrome/Edge/Brave desktop — real beforeinstallprompt
  | "chromium-android" // Chrome/Edge Android
  | "android-firefox" // Firefox Android — menu install, no event
  | "ios" // any iOS/iPadOS browser — Share→Add to Home Screen
  | "safari-desktop" // macOS Safari — File→Add to Dock
  | "firefox-desktop" // no native install yet
  | "other";

/** PURE, fully unit-tested. No DOM access — all inputs passed in.
 *
 *  Order matters: iOS (incl. iPadOS in desktop mode) is detected first because
 *  an iPad reporting a Mac UA would otherwise fall through to `safari-desktop`.
 *  An iPad in "Request Desktop Website" mode sends a macOS Safari UA with no
 *  "iPad" token; the tell is a touch screen on a "Mac" — Macs report
 *  `maxTouchPoints === 0`, iPads report > 1. */
export function detectInstallPlatform(opts: {
  ua: string; // navigator.userAgent
  maxTouchPoints: number; // navigator.maxTouchPoints
  vendor?: string; // navigator.vendor
}): InstallPlatform {
  const ua = opts.ua ?? "";
  const isFirefox = /\bFirefox\//i.test(ua) || /\bFxiOS\//i.test(ua);
  const isAndroid = /\bAndroid\b/i.test(ua);

  // iOS / iPadOS — every browser on iOS is Safari/WebKit underneath and gets
  // the same Share→Add to Home Screen flow. Catch the explicit device tokens
  // first, then the iPadOS-desktop-mode disguise (Mac UA + a touch screen).
  const hasIosToken = /\b(iPhone|iPad|iPod)\b/i.test(ua);
  const isMacUa = /\bMacintosh\b/i.test(ua) || /\bMac OS X\b/i.test(ua);
  const isIpadDesktopMode = isMacUa && opts.maxTouchPoints > 1;
  if (hasIosToken || isIpadDesktopMode) return "ios";

  // Android
  if (isAndroid) {
    if (isFirefox) return "android-firefox";
    // Chrome, Edge, Brave, Samsung Internet, etc. — all Chromium, all fire
    // beforeinstallprompt.
    if (/\b(Chrome|CriOS|EdgA|SamsungBrowser)\//i.test(ua)) {
      return "chromium-android";
    }
    return "other";
  }

  // Desktop Firefox — no native install yet.
  if (isFirefox) return "firefox-desktop";

  // Desktop Safari — vendor "Apple Computer, Inc." and a Safari UA without any
  // Chromium token. File→Add to Dock (macOS Sonoma+).
  const isSafari =
    /\bSafari\//i.test(ua) &&
    !/\b(Chrome|Chromium|CriOS|Edg|EdgA|OPR|SamsungBrowser)\//i.test(ua);
  if (isMacUa && (isSafari || /Apple/i.test(opts.vendor ?? ""))) {
    return "safari-desktop";
  }

  // Desktop Chromium — Chrome, Edge, Brave, Opera, etc.
  if (/\b(Chrome|Chromium|Edg|OPR)\//i.test(ua)) return "chromium-desktop";

  return "other";
}

/** PURE, unit-tested. Human instruction lines for platforms with no JS prompt.
 *  `canPromptNatively` is true only for the two Chromium platforms that fire
 *  `beforeinstallprompt`; for everyone else the steps are the manual recipe. */
export function installInstructions(platform: InstallPlatform): {
  title: string;
  steps: string[];
  canPromptNatively: boolean;
} {
  switch (platform) {
    case "chromium-desktop":
      return {
        title: "Install app",
        steps: [
          "Click Install when prompted.",
          "Or use the install icon in the address bar.",
        ],
        canPromptNatively: true,
      };
    case "chromium-android":
      return {
        title: "Install app",
        steps: [
          "Tap Install when prompted.",
          "Or open the browser menu and choose Install app.",
        ],
        canPromptNatively: true,
      };
    case "android-firefox":
      return {
        title: "Add to Home screen",
        steps: [
          "Open the browser menu (⋮).",
          "Tap Install or Add to Home screen.",
        ],
        canPromptNatively: false,
      };
    case "ios":
      return {
        title: "Add to Home Screen",
        steps: [
          "Tap the Share button.",
          "Choose Add to Home Screen.",
          "Tap Add.",
        ],
        canPromptNatively: false,
      };
    case "safari-desktop":
      return {
        title: "Add to Dock",
        steps: ["Open the File menu.", "Choose Add to Dock."],
        canPromptNatively: false,
      };
    case "firefox-desktop":
      return {
        title: "Install not supported",
        steps: [
          "Firefox on desktop has no built-in install.",
          "Open this app in Chrome or Edge to install it.",
        ],
        canPromptNatively: false,
      };
    default:
      return {
        title: "Install app",
        steps: [
          "Look for an install or Add to Home Screen option in your browser menu.",
        ],
        canPromptNatively: false,
      };
  }
}

export interface PwaInstall {
  canPrompt: Accessor<boolean>; // a real one-click install is available now
  installed: Accessor<boolean>; // running standalone / already installed
  platform: Accessor<InstallPlatform>;
  /** Native prompt on Chromium; otherwise opens the @khmyznikov dialog. */
  prompt: () => void;
}

/** Minimal shape of the `@khmyznikov/pwa-install` custom element we touch. */
interface PwaInstallElement extends HTMLElement {
  isUnderStandaloneMode?: boolean;
  isInstallAvailable?: boolean;
  showDialog?: (forced?: boolean) => void;
}

/** The Chromium `beforeinstallprompt` event — not in the standard lib.dom
 *  typings, so the slice we use is declared locally. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function readInstalled(el: PwaInstallElement | null): boolean {
  if (typeof window === "undefined") return false;
  const mm = (q: string) => {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const standalone =
    mm("(display-mode: standalone)") ||
    mm("(display-mode: minimal-ui)") ||
    mm("(display-mode: fullscreen)") ||
    // iOS Safari's non-standard flag for home-screen apps.
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return standalone || el?.isUnderStandaloneMode === true;
}

/** Browser-only (touches window/customElements). Call inside a Solid
 *  component/owner so `onMount`/`onCleanup` register against it. */
export function createPwaInstall(opts?: {
  manifestUrl?: string;
  icon?: string;
  name?: string;
  description?: string;
}): PwaInstall {
  const platform: InstallPlatform =
    typeof navigator === "undefined"
      ? "other"
      : detectInstallPlatform({
          ua: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints,
          vendor: navigator.vendor,
        });

  const [canPrompt, setCanPrompt] = createSignal(false);
  const [installed, setInstalled] = createSignal(false);

  let element: PwaInstallElement | null = null;
  // Stashed Chromium event — replayable once on a user gesture.
  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  onMount(() => {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;

    // Side-effect import: registers the <pwa-install> custom element. Done
    // inside onMount so the module stays import-safe in a non-browser test.
    void import("@khmyznikov/pwa-install");

    const el = document.createElement("pwa-install") as PwaInstallElement;
    if (opts?.manifestUrl) el.setAttribute("manifest-url", opts.manifestUrl);
    if (opts?.icon) el.setAttribute("icon", opts.icon);
    if (opts?.name) el.setAttribute("name", opts.name);
    if (opts?.description) {
      el.setAttribute("install-description", opts.description);
    }
    document.body.appendChild(el);
    element = el;

    const refreshInstalled = () => setInstalled(readInstalled(element));
    const refreshAvailable = () => {
      // The component's own read, when present, is the most reliable signal of
      // a replayable native prompt.
      if (element?.isInstallAvailable === true) setCanPrompt(true);
    };
    refreshInstalled();
    refreshAvailable();

    const onBeforeInstallPrompt = (e: Event) => {
      // Keep the browser's mini-infobar from auto-showing so the host owns the
      // moment — and stash the event so a click can replay it.
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      setCanPrompt(true);
    };

    const onAppInstalled = () => {
      deferredPrompt = null;
      setCanPrompt(false);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    // Keep `installed` reactive to display-mode flips (e.g. the user launches
    // the installed app, or a window is detached to standalone).
    const standaloneMq = window.matchMedia("(display-mode: standalone)");
    standaloneMq.addEventListener("change", refreshInstalled);

    // The component announces availability via its own event too.
    const onAvailable = () => setCanPrompt(true);
    el.addEventListener("pwa-install-available-event", onAvailable);

    onCleanup(() => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      standaloneMq.removeEventListener("change", refreshInstalled);
      el.removeEventListener("pwa-install-available-event", onAvailable);
      el.remove();
      element = null;
      deferredPrompt = null;
    });
  });

  const prompt = () => {
    // A captured Chromium event is the one true one-click path: replay it.
    if (
      deferredPrompt &&
      (platform === "chromium-desktop" || platform === "chromium-android")
    ) {
      const evt = deferredPrompt;
      deferredPrompt = null;
      void evt.prompt().finally(() => {
        // The browser allows replaying the event only once.
        setCanPrompt(false);
        void evt.userChoice
          .then((choice) => {
            if (choice.outcome === "accepted") setInstalled(true);
          })
          .catch(() => {});
      });
      return;
    }
    // Everyone else: let the component decide native vs instruction screens.
    element?.showDialog?.(true);
  };

  return {
    canPrompt,
    installed,
    platform: () => platform,
    prompt,
  };
}
