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
 *  Order matters: iOS (incl. iPadOS in desktop mode) is detected first because
 *  an iPad reporting a Mac UA would otherwise fall through to `safari-desktop`.
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
  canPromptNatively: boolean;
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
    canPromptNatively: true,
  },
  "chromium-android": {
    title: "Install app",
    steps: ["Open the ⋮ menu.", "Tap Install app (or Add to Home screen)."],
    canPromptNatively: true,
  },
  "android-firefox": {
    title: "Add to Home screen",
    steps: ["Open the browser menu (⋮).", "Tap Install or Add to Home screen."],
    canPromptNatively: false,
  },
  ios: {
    title: "Add to Home Screen",
    steps: ["Tap the Share button.", "Choose Add to Home Screen.", "Tap Add."],
    canPromptNatively: false,
  },
  "safari-desktop": {
    title: "Add to Dock",
    steps: ["Open the File menu.", "Choose Add to Dock."],
    canPromptNatively: false,
  },
  "firefox-desktop": {
    title: "Install not supported",
    steps: [
      "Firefox on desktop has no built-in install.",
      "Open this app in Chrome or Edge to install it.",
    ],
    canPromptNatively: false,
  },
  other: {
    title: "Install app",
    steps: [
      "Look for an install or Add to Home Screen option in your browser menu.",
    ],
    canPromptNatively: false,
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

  const [canPrompt, setCanPrompt] = createSignal(false);

  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  onMount(() => {
    if (typeof window === "undefined") return;

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
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    onCleanup(() => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      deferredPrompt = null;
    });
  });

  const prompt = () => {
    if (deferredPrompt && installInstructions(platform).canPromptNatively) {
      const evt = deferredPrompt;
      deferredPrompt = null;
      // The browser allows replaying the event only once — drop `canPrompt`
      // immediately so a second click can't re-enter with a consumed event.
      setCanPrompt(false);
      evt.prompt().catch((err: unknown) => {
        console.warn("[pwa-install] native prompt failed:", err);
      });
      return;
    }
  };

  return {
    canPrompt,
    platform: () => platform,
    prompt,
  };
}
