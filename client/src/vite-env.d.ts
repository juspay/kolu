declare const __KOLU_COMMIT__: string;

// Badging API (Chrome/Edge PWAs) — not yet in TypeScript's lib.dom.
interface Navigator {
  setAppBadge(count?: number): Promise<void>;
  clearAppBadge(): Promise<void>;
}

// VirtualKeyboard API (Chrome 94+) — not yet in TypeScript's lib.dom.
interface VirtualKeyboard extends EventTarget {
  readonly boundingRect: DOMRect;
  overlaysContent: boolean;
  show(): void;
  hide(): void;
}

interface Navigator {
  readonly virtualKeyboard?: VirtualKeyboard;
}
