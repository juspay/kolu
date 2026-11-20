/// <reference types="vite/client" />
/// <reference types="@kolu/surface-app/client" />

declare const __XTERM_VERSION__: string;

// Badging API (Chrome/Edge PWAs) — not yet in TypeScript's lib.dom.
interface Navigator {
  setAppBadge(count?: number): Promise<void>;
  clearAppBadge(): Promise<void>;
}
