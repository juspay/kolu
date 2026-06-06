/** `@kolu/solid-pwa-install` — a SolidJS adapter for cross-browser PWA install.
 *  One socket: **"install this web app."**
 *
 *  The volatility it hides is cross-browser PWA-install fragmentation. Chromium
 *  desktop/Android fire a real `beforeinstallprompt` event you can capture and
 *  replay on a click; every other engine has no JS prompt at all — iOS wants
 *  Share→Add to Home Screen, macOS Safari wants File→Add to Dock, Firefox
 *  Android hides install in a menu, Firefox desktop has nothing. A consumer
 *  that branched on `navigator.userAgent` itself would carry all of that
 *  forever; here it plugs into one stable interface (`PwaInstall`) and the
 *  detection lives behind it. The per-platform manual recipe has a single owner:
 *  the pure `installInstructions` table, which the consumer renders inline.
 *  Installed-state is intentionally *not* part of this socket: it has a single
 *  owner elsewhere (e.g. `@kolu/surface-app`'s `isInstalled`) that consumers
 *  read directly.
 *
 *  Two layers:
 *  - PURE, fully unit-tested: `detectInstallPlatform` / `installInstructions`.
 *    No DOM — every input is passed in, so the module is import-safe under
 *    vitest's Node environment.
 *  - BROWSER-ONLY: `createPwaInstall` touches `window` and must run inside a
 *    Solid owner. */

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
interface InstallInstructions {
  title: string;
  steps: string[];
  canPromptNatively: boolean;
}

// A `Record` over the closed union (not a `switch` with `default`): adding a
// new `InstallPlatform` becomes a compile error here, forcing a deliberate
// platform-specific recipe instead of silently falling into generic steps.
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
  canPrompt: Accessor<boolean>; // a real one-click install is available now
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

  // Stashed Chromium event — replayable once on a user gesture.
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

    // Once installed, a stashed prompt is spent and no longer offerable.
    const onAppInstalled = () => {
      deferredPrompt = null;
      setCanPrompt(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    // NOTE: `canPrompt` is set exclusively from `onBeforeInstallPrompt` above —
    // a captured `beforeinstallprompt` is the only true one-click signal. The
    // manual platforms (iOS Share→Add to Home Screen, Firefox Android menu,
    // Safari File→Add to Dock) have no JS prompt and stay `canPrompt() === false`.

    onCleanup(() => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      deferredPrompt = null;
    });
  });

  const prompt = () => {
    // A captured Chromium event is the one true one-click path: replay it.
    // The platform→native-capable mapping has one home — the INSTRUCTIONS
    // table's `canPromptNatively` — so adding a Chromium platform only updates
    // that record, not a second inline list here.
    if (deferredPrompt && installInstructions(platform).canPromptNatively) {
      const evt = deferredPrompt;
      deferredPrompt = null;
      // The browser allows replaying the event only once — drop `canPrompt`
      // immediately so a second click can't re-enter with a consumed event.
      setCanPrompt(false);
      evt.prompt().catch((err: unknown) => {
        // A consumed/invalid prompt event rejects here. Log it instead of
        // swallowing — an unhandled rejection otherwise surfaces in the browser
        // console with no context, and a silently-failed prompt would look like
        // a dead button. (The `appinstalled` event, not this promise, is what
        // clears state once the user accepts.)
        console.warn("[pwa-install] native prompt failed:", err);
      });
      return;
    }
    // No captured event: nothing to replay. Non-Chromium platforms have no JS
    // prompt, so the consumer renders the per-platform `installInstructions`
    // manual steps inline — `prompt()` is a no-op here.
  };

  return {
    canPrompt,
    platform: () => platform,
    prompt,
  };
}
