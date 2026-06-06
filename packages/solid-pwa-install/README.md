# @kolu/solid-pwa-install

One socket: **"install this web app."** A SolidJS adapter over the
[`@khmyznikov/pwa-install`](https://github.com/khmyznikov/pwa-install) web
component that hides cross-browser PWA-install volatility behind a single
reactive interface.

The volatility it owns is real and ugly. Chromium desktop and Android fire a
`beforeinstallprompt` event you must capture, defer, and replay on a user
gesture for a true one-click install. Every other engine has no JS prompt at
all: iOS/iPadOS wants Share → Add to Home Screen, macOS Safari wants
File → Add to Dock, Firefox Android hides install in a menu, and Firefox
desktop has nothing. A consumer that branched on `navigator.userAgent` itself
would carry that whole matrix forever — including the iPadOS-in-desktop-mode
disguise (a Mac UA on a touch screen). Here it plugs into one stable interface
and the detection + instruction-dialog delegation live behind the socket. See
[`docs/atlas/.../electricity.mdx`](../../docs/atlas/src/content/atlas/electricity.mdx)
for what counts as an electricity.

## Layers

- **Pure, fully unit-tested** — `detectInstallPlatform(...)` and
  `installInstructions(...)`. No DOM: every input is passed in, so the module
  imports safely under vitest's Node environment.
- **Browser-only** — `createPwaInstall(...)`, a small reactive controller that
  registers the `<pwa-install>` element, captures `beforeinstallprompt`, tracks
  `canPrompt`, and exposes a single `prompt()` that does the native prompt on
  Chromium and opens the component's instruction dialog elsewhere. Call it
  inside a Solid component/owner. Installed-state is deliberately out of scope:
  it has a single owner elsewhere (e.g. `@kolu/surface-app`'s `isInstalled`)
  that consumers read directly.

## Usage

```tsx
import { createPwaInstall } from "@kolu/solid-pwa-install";
import { useSurfaceApp } from "@kolu/surface-app/solid";

function InstallButton() {
  // Installed-state has a single owner — read it from there, not from `pwa`.
  const app = useSurfaceApp();
  const pwa = createPwaInstall({
    manifestUrl: "/manifest.webmanifest",
    name: "kolu",
  });

  return (
    <Show when={!app.isInstalled()}>
      <button onClick={pwa.prompt}>
        {pwa.canPrompt() ? "Install" : "How to install"}
      </button>
    </Show>
  );
}
```

`prompt()` always works: a real one-click install when `canPrompt()` is true
(Chromium event captured), otherwise the component decides between native and
human-readable instruction screens for the detected `platform()`.

## Public API

| Export | Kind | What it does |
|--------|------|--------------|
| `detectInstallPlatform({ ua, maxTouchPoints, vendor })` | pure | Classifies the browser into an `InstallPlatform`. |
| `installInstructions(platform)` | pure | `{ title, steps[], canPromptNatively }` for that platform. |
| `createPwaInstall(opts?)` | browser | Reactive `{ canPrompt, platform, prompt }`. |

## Testing

`pnpm --filter @kolu/solid-pwa-install test:unit` — covers
`detectInstallPlatform` across the shipping UA matrix (Chrome/Edge/Brave
desktop, Chrome/Edge/Firefox Android, iPhone/iPad Safari, iPadOS desktop-mode,
macOS Safari, unknown ⇒ `other`) and `installInstructions`' per-platform
`canPromptNatively`.
