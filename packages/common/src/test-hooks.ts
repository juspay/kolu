/**
 * Test-only hooks installed on `window` by the client at app startup and
 * read by Cucumber e2e step definitions. Plus the Badging API surface
 * the alert tests stub out. Declared here in `kolu-common` so both sides
 * (client setter, test reader) type-check against the same shape —
 * without this, `(window as any).__koluFoo` and `(navigator as any)`
 * casts proliferate at every call site (the noExplicitAny migration
 * in #710 / #721).
 *
 * Usage: `import "kolu-common/test-hooks"` for side-effect (loads the
 * `Window` / `Navigator` augmentations). They're module-scoped — TS
 * only sees these properties in files that transitively import this
 * module.
 */

export {};

declare global {
  interface Window {
    /** Triggers the activity-alert codepath. Set by `App.tsx` from
     *  `useTerminalAlerts.simulateAlert` so e2e tests can fire alerts
     *  without driving the underlying server-pushed event. */
    __koluSimulateAlert?: (opts?: { target?: "active" | "inactive" }) => void;

    /** Stash for `setAppBadge` / `clearAppBadge` calls captured by the
     *  alert e2e suite's `I stub the Badging API` step. Test-only. */
    __badgeCalls?: Array<
      { method: "set"; count?: number } | { method: "clear" }
    >;

    /** Reads the live xterm buffer for the `idx`-th element matching `sel`,
     *  installed once per scenario by the e2e harness in `hooks.ts` via
     *  `page.addInitScript`. Returns the joined visible-buffer text, or
     *  `""` if the selector matches nothing or the element has no
     *  `__xterm` attached. Used by the shared `support/buffer.ts` helpers. */
    __readXtermBuffer?: (sel: string, idx: number) => string;

    /** Stash of stringified `WebSocket.send` payloads captured by
     *  `Given I intercept oRPC sendInput calls`. The interceptor monkey-
     *  patches `WebSocket.prototype.send` once per scenario; subsequent
     *  steps `evaluate` and read this array. */
    __wsSent?: string[];
  }

  /** Structural subset of `xterm.Terminal` that e2e steps read off the
   *  `__xterm` DOM attachment below — kept narrow on purpose so adding
   *  this augmentation here doesn't pull `@xterm/xterm` into
   *  `kolu-common`'s dependency surface. `Terminal.tsx` assigns the full
   *  `XTerm` instance, which is structurally assignable to this shape. */
  interface KoluXtermProbe {
    cols: number;
    rows: number;
    buffer: {
      active: {
        length: number;
        baseY: number;
        viewportY: number;
        getLine(
          i: number,
        ): { translateToString(trim: boolean): string } | undefined;
      };
    };
    selectAll(): void;
  }

  /** xterm's per-container reference. `Terminal.tsx` attaches the xterm
   *  instance to the canvas tile's wrapping `<div>` so e2e tests can
   *  reach the terminal API without going through the SolidJS reactivity
   *  layer. `__xterm` is `undefined` until the component's `onMount`
   *  body runs and is cleared on cleanup (#591 leak fix). */
  interface HTMLDivElement {
    __xterm?: KoluXtermProbe;
  }

  /** Badging API (Chrome/Edge PWAs) — not yet in TypeScript's lib.dom.
   *  Used in production by `useTerminalAlerts.ts`; the e2e suite
   *  reassigns these stubs in `I stub the Badging API`. */
  interface Navigator {
    setAppBadge(count?: number): Promise<void>;
    clearAppBadge(): Promise<void>;
  }
}
