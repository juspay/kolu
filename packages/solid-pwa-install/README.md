# @kolu/solid-pwa-install

One socket: **"install this web app."** A SolidJS adapter that hides
cross-browser PWA-install volatility behind a single reactive interface.

The volatility it owns is real and ugly. Chromium desktop and Android fire a
`beforeinstallprompt` event you must capture, defer, and replay on a user
gesture for a true one-click install. Every other engine has no JS prompt at
all: iOS/iPadOS wants Share → Add to Home Screen, macOS Safari wants
File → Add to Dock, Firefox Android hides install in a menu, and Firefox
desktop has nothing. A consumer that branched on `navigator.userAgent` itself
would carry that whole matrix forever — including the iPadOS-in-desktop-mode
disguise (a Mac UA on a touch screen). Here it plugs into one stable interface
and the detection lives behind the socket; the per-platform manual recipe has a
single owner — the pure `installInstructions` table the consumer renders inline.
See
[`docs/atlas/.../electricity.mdx`](../../docs/atlas/src/content/atlas/electricity.mdx)
for what counts as an electricity.

## Layers

- **Pure, fully unit-tested** — `detectInstallPlatform(...)` and
  `installInstructions(...)`. No DOM: every input is passed in, so the module
  imports safely under vitest's Node environment.
- **Browser-only** — `createPwaInstall()`, a small reactive controller that
  captures `beforeinstallprompt` off `window`, tracks `canPrompt`, and exposes a
  single `prompt()` that replays the native prompt on Chromium and is a no-op
  elsewhere (non-Chromium platforms have no JS prompt — render the inline
  `installInstructions` steps instead). Call it inside a Solid component/owner.
  Installed-state is deliberately out of scope: it has a single owner elsewhere
  (e.g. `@kolu/surface-app`'s `isInstalled`) that consumers read directly.

## Usage

```tsx
import { createPwaInstall, installInstructions } from "@kolu/solid-pwa-install";
import { useSurfaceApp } from "@kolu/surface-app/solid";

function InstallButton() {
  // Installed-state has a single owner — read it from there, not from `pwa`.
  const app = useSurfaceApp();
  const pwa = createPwaInstall();

  return (
    <Show when={!app.isInstalled()}>
      <Show
        when={pwa.canPrompt()}
        fallback={
          // No JS prompt on this platform — render the manual recipe inline.
          <p>{installInstructions(pwa.platform()).title}</p>
        }
      >
        <button onClick={pwa.prompt}>Install</button>
      </Show>
    </Show>
  );
}
```

`prompt()` triggers the real one-click install when `canPrompt()` is true (a
Chromium `beforeinstallprompt` was captured); on every other platform it is a
no-op, so render the per-platform `installInstructions(platform())` steps
yourself.

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
