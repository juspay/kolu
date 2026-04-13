declare const __KOLU_COMMIT__: string;

// Badging API (Chrome/Edge PWAs) — not yet in TypeScript's lib.dom.
interface Navigator {
  setAppBadge(count?: number): Promise<void>;
  clearAppBadge(): Promise<void>;
}
