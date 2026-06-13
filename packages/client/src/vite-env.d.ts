/// <reference types="@kolu/surface-app/client" />

// The build commit rides the no-store shell as `window.__SURFACE_APP_COMMIT__`
// (injected by surface-app's Vite plugin; the Window augmentation comes from
// the `/client` reference above) — read via `shellCommit()` from
// `@kolu/surface-app/lifecycle`, one source of truth shared with the server
// cell. Never a bundler define inside a hashed asset (kolu#1319).
declare const __XTERM_VERSION__: string;

// Badging API (Chrome/Edge PWAs) — not yet in TypeScript's lib.dom.
interface Navigator {
  setAppBadge(count?: number): Promise<void>;
  clearAppBadge(): Promise<void>;
}
