import { type Accessor, createSignal, onCleanup, onMount } from "solid-js";

export type InstallPlatform =
  | "chromium-desktop"
  | "chromium-android"
  | "android-firefox"
  | "ios"
  | "safari-desktop"
  | "firefox-desktop"
  | "other";

/** No DOM access — all inputs passed in.
 *
 *  An iPad in "Request Desktop Website" mode sends a macOS Safari UA with no
 *  "iPad" token; the tell is a touch screen on a "Mac" — Macs report
 *  `maxTouchPoints === 0`, iPads report > 1. */
export function detectInstallPlatform(opts: {
  ua: string;
  maxTouchPoints: number;
  vendor?: string;
}): InstallPlatform {
  const ua = opts.ua ?? "";
  const isFirefox = /\bFirefox\//i.test(ua) || /\bFxiOS\//i.test(ua);
  const isAndroid = /\bAndroid\b/i.test(ua);

  const hasIosToken = /\b(iPhone|iPad|iPod)\b/i.test(ua);
  const isMacUa = /\bMacintosh\b/i.test(ua) || /\bMac OS X\b/i.test(ua);
  const isIpadDesktopMode = isMacUa && opts.maxTouchPoints > 1;
  if (hasIosToken || isIpadDesktopMode) return "ios";

  if (isAndroid) {
    if (isFirefox) return "android-firefox";
    if (/\b(Chrome|CriOS|EdgA|SamsungBrowser)\//i.test(ua)) {
      return "chromium-android";
    }
    return "other";
  }

  if (isFirefox) return "firefox-desktop";

  const isSafari =
    /\bSafari\//i.test(ua) &&
    !/\b(Chrome|Chromium|CriOS|Edg|EdgA|OPR|SamsungBrowser)\//i.test(ua);
  if (isMacUa && (isSafari || /Apple/i.test(opts.vendor ?? ""))) {
    return "safari-desktop";
  }

  if (/\b(Chrome|Chromium|Edg|OPR)\//i.test(ua)) return "chromium-desktop";

  return "other";
}

interface InstallInstructions {
  title: string;
  steps: string[];
}

const INSTRUCTIONS: Record<InstallPlatform, InstallInstructions> = {
  "chromium-desktop": {
    title: "Install app",
    // The ⋮-menu path works on plain http too (unlike the address-bar install
    // icon / one-click prompt, which need a secure context).
    steps: [
      "Open the ⋮ menu → Save and share → Create shortcut…",
      'Tick "Open as window", then Create.',
      "On HTTPS you can also click the install icon in the address bar.",
    ],
  },
  "chromium-android": {
    title: "Install app",
    steps: ["Open the ⋮ menu.", "Tap Install app (or Add to Home screen)."],
  },
  "android-firefox": {
    title: "Add to Home screen",
    steps: ["Open the browser menu (⋮).", "Tap Install or Add to Home screen."],
  },
  ios: {
    title: "Add to Home Screen",
    steps: ["Tap the Share button.", "Choose Add to Home Screen.", "Tap Add."],
  },
  "safari-desktop": {
    title: "Add to Dock",
    steps: ["Open the File menu.", "Choose Add to Dock."],
  },
  "firefox-desktop": {
    title: "Install not supported",
    steps: [
      "Firefox on desktop has no built-in install.",
      "Open this app in Chrome or Edge to install it.",
    ],
  },
  other: {
    title: "Install app",
    steps: [
      "Look for an install or Add to Home Screen option in your browser menu.",
    ],
  },
};

export function installInstructions(
  platform: InstallPlatform,
): InstallInstructions {
  return INSTRUCTIONS[platform];
}

export interface PwaInstall {
  canPrompt: Accessor<boolean>;
  platform: Accessor<InstallPlatform>;
  /** Native one-click prompt on Chromium; a no-op otherwise — non-Chromium
   *  platforms have no JS prompt, so the consumer renders the per-platform
   *  `installInstructions` manual steps inline instead. */
  prompt: () => void;
}

/** The Chromium `beforeinstallprompt` event — not in the standard lib.dom
 *  typings, so the slice we use is declared locally. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Browser-only (touches window). Call inside a Solid component/owner so
 *  `onMount`/`onCleanup` register against it. */
export function createPwaInstall(): PwaInstall {
  const platform: InstallPlatform =
    typeof navigator === "undefined"
      ? "other"
      : detectInstallPlatform({
          ua: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints,
          vendor: navigator.vendor,
        });

  const [deferredPrompt, setDeferredPrompt] =
    createSignal<BeforeInstallPromptEvent | null>(null);

  onMount(() => {
    if (typeof window === "undefined") return;

    const onBeforeInstallPrompt = (e: Event) => {
      // `preventDefault` on `beforeinstallprompt` suppresses Chromium's
      // mini-infobar.
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => setDeferredPrompt(null);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    onCleanup(() => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      setDeferredPrompt(null);
    });
  });

  const prompt = () => {
    const evt = deferredPrompt();
    if (!evt) return;
    // Chromium allows a captured event to be replayed only once.
    setDeferredPrompt(null);
    evt.prompt().catch((err: unknown) => {
      console.warn("[pwa-install] native prompt failed:", err);
    });
  };

  return {
    canPrompt: () => deferredPrompt() !== null,
    platform: () => platform,
    prompt,
  };
}
