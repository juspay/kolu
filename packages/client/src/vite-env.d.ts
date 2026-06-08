/// <reference types="@kolu/surface-app/client" />

// The build commit is now stamped by surface-app's Vite plugin as
// `__SURFACE_APP_COMMIT__` (declared by the `/client` reference above), one
// source of truth shared with the server cell. `__KOLU_COMMIT__` is retired.
declare const __XTERM_VERSION__: string;

// Badging API (Chrome/Edge PWAs) — not yet in TypeScript's lib.dom.
interface Navigator {
  setAppBadge(count?: number): Promise<void>;
  clearAppBadge(): Promise<void>;
}
