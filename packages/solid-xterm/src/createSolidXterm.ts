/**
 * `createSolidXterm` — the SolidJS-native primitive for xterm.js.
 *
 * Takes the place of `new XTerm(opts)` in a SolidJS component.
 * Owns construction, addon attachment, reactive theme + fontSize
 * sync, WebGL lifecycle policy, and the scroll-lock state machine
 * as integrated submodules. Consumers interact with one handle
 * (`SolidXtermHandle`); the internal axes stay internal.
 *
 * Shape rationale: this is the "one socket per coherent concept"
 * factory the package's name promises. Earlier iterations of
 * `@kolu/solid-xterm` shipped `createXtermWebgl`,
 * `attachXtermStyleSync`, and `createScrollLock` as three loose
 * public exports — partial wiring the consumer had to integrate by
 * hand with `new XTerm(...)`, the addon constructors, the term.open
 * call, the scroll-lock attach, and the WebGL load policy. That
 * surface read as "three xterm-adjacent helpers," not as "a
 * SolidJS adapter for xterm." Those helpers now live under
 * `./internal/` and the consumer imports only `createSolidXterm`.
 *
 * Reactive ownership: call `createSolidXterm(opts)` synchronously
 * in your component body (it registers signals + scroll-lock's
 * createEffect under the current owner). Call `handle.mount(el)`
 * later — typically from `onMount` after `document.fonts.load(...)`
 * — to attach to a DOM container; the mount-time work (XTerm
 * construction, addon loading, style-sync effects, WebGL policy
 * effect, scroll-lock onScroll handler) registers under whatever
 * owner is active at the `mount()` call site, so wrap in
 * `runWithOwner(componentOwner, () => handle.mount(el))` if you
 * cross an `await`.
 */

import {
  ClipboardAddon,
  type IClipboardProvider,
} from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ITerminalOptions, ITheme } from "@xterm/xterm";
import { Terminal as XTerm } from "@xterm/xterm";
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { createScrollLock } from "./internal/scrollLock";
import { attachXtermStyleSync } from "./internal/styleSync";
import {
  type CreateXtermWebglOptions,
  createXtermWebgl,
} from "./internal/webgl";

/** Standard addon set. Each defaults to *on*; pass `false` to opt
 *  out. `clipboard` is opt-in (requires the consumer's provider).
 *  Custom addons not covered here can be attached inside `onTerm`
 *  via `term.loadAddon(...)`. */
export interface SolidXtermAddonOptions {
  /** FitAddon. Default: true. Disable when you measure manually. */
  fit?: boolean;
  /** WebLinksAddon (auto-linkify URLs). Default: true. */
  webLinks?: boolean;
  /** SearchAddon. Default: true. The instance is exposed at
   *  `handle.addons.search` for callers wiring a SearchBar. */
  search?: boolean;
  /** ImageAddon (sixel + iTerm2 + kitty image protocols). Default: true. */
  image?: boolean;
  /** Unicode11Addon, plus `term.unicode.activeVersion = "11"` after
   *  load. Default: true. */
  unicode11?: boolean;
  /** SerializeAddon. Default: true. The instance is exposed at
   *  `handle.addons.serialize` for buffer-export consumers. */
  serialize?: boolean;
  /** ClipboardAddon with the consumer's provider. Opt-in; omit to
   *  skip the addon entirely. */
  clipboard?: { provider: IClipboardProvider };
}

/** WebGL policy + observation hooks. Omit the whole field to
 *  disable WebGL entirely (terminal stays on xterm's DOM renderer). */
export interface SolidXtermWebglOptions extends CreateXtermWebglOptions {
  /** Reactive predicate. When true, WebGL is loaded; when false,
   *  unloaded. Typical wiring: `() => preferences().renderer === "webgl"
   *  || (preferences().renderer === "auto" && tileIsFocusedAndVisible())`. */
  enabled: Accessor<boolean>;
}

export interface SolidXtermOptions
  extends Omit<ITerminalOptions, "theme" | "fontSize"> {
  /** Reactive theme — pushed into `term.options.theme` on every
   *  change after mount. Initial value at mount time goes through
   *  the XTerm constructor. */
  theme: Accessor<ITheme>;
  /** Reactive font size in CSS pixels. Same defer-to-constructor
   *  semantics as `theme` for the initial value. */
  fontSize: Accessor<number>;
  /** Standard addon set; see `SolidXtermAddonOptions` for defaults. */
  addons?: SolidXtermAddonOptions;
  /** WebGL lifecycle. Omit to keep the terminal on the DOM renderer. */
  webgl?: SolidXtermWebglOptions;
  /** Scroll-lock policy: when the accessor returns false, scroll-
   *  lock is disabled (writes pass through, scroll events ignored).
   *  Omit for always-on scroll-lock; pass `() => false` to disable. */
  scrollLock?: Accessor<boolean | undefined>;
  /** Called once after the XTerm is constructed, all addons are
   *  attached, `term.open(container)` has run, and the integrated
   *  scroll-lock + style-sync + WebGL effects are wired. Use this
   *  to register link providers, custom key handlers, PTY stream
   *  consumers, or anything else that needs the live XTerm + the
   *  framework-supplied addon refs. */
  onTerm?: (term: XTerm) => void;
}

export interface SolidXtermHandle {
  /** Reactive accessor for the live XTerm. Null before `mount()`
   *  runs and after the owner disposes. */
  term: Accessor<XTerm | null>;
  /** Open the terminal in `container`. Attaches addons, opens the
   *  xterm DOM, wires scroll-lock + style-sync + WebGL effects,
   *  then invokes `onTerm`. Idempotent on the same handle — but
   *  the typical pattern is one handle per component instance.
   *  See module docstring on reactive ownership. */
  mount: (container: HTMLElement) => void;
  /** RAF-debounced fit. Safe to call from `ResizeObserver` or any
   *  rapid-fire trigger — multiple calls within one animation
   *  frame coalesce. No-op when FitAddon was disabled via
   *  `addons.fit: false` or when `term()` is null. */
  fit: () => void;
  /** Addon refs, all reactive (null before mount). */
  addons: {
    fit: Accessor<FitAddon | null>;
    search: Accessor<SearchAddon | null>;
    serialize: Accessor<SerializeAddon | null>;
  };
  /** Scroll-lock-aware write. Buffers data when the user has
   *  scrolled up; passes through otherwise. Use this instead of
   *  `term.write(data)` for PTY output. No-op when `term()` is null. */
  write: (data: string) => void;
  /** Scroll-lock state + commands. Same surface `createScrollLock`
   *  used to expose — now namespaced. */
  scrollLock: {
    locked: Accessor<boolean>;
    hasNewOutput: Accessor<boolean>;
    /** Flush buffered data and scroll the term to the bottom. */
    toBottom: () => void;
    /** Clear scroll-lock state, flushing any buffered data first.
     *  Use on stream retry to avoid double-paint. */
    reset: () => void;
  };
  /** WebGL state + commands. Empty `enabled`/`atlas`/`clear` when
   *  `webgl` option is omitted (always returns null/false). */
  webgl: {
    /** Reactive: true while a WebGL context is attached. */
    enabled: Accessor<boolean>;
    /** Diagnostic probe: current atlas dimensions, null when not
     *  attached. */
    atlas: () => { w: number; h: number } | null;
    /** Clear the WebGL texture atlas — fixes font-rendering
     *  corruption after some style changes (xterm #239). */
    clearTextureAtlas: () => void;
  };
}

export function createSolidXterm(opts: SolidXtermOptions): SolidXtermHandle {
  const [term, setTerm] = createSignal<XTerm | null>(null);
  const [fitAddon, setFitAddon] = createSignal<FitAddon | null>(null);
  const [searchAddon, setSearchAddon] = createSignal<SearchAddon | null>(null);
  const [serializeAddon, setSerializeAddon] =
    createSignal<SerializeAddon | null>(null);

  const scrollLock = createScrollLock(opts.scrollLock ?? (() => true));
  const webglLifecycle = createXtermWebgl(() => term(), opts.webgl ?? {});

  let fitRaf = 0;
  function debouncedFit(): void {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => fitAddon()?.fit());
  }

  function mount(container: HTMLElement): void {
    const {
      theme,
      fontSize,
      addons: addonOpts = {},
      webgl: webglOpts,
      scrollLock: _scrollLockOpt,
      onTerm,
      ...termOptions
    } = opts;

    const t = new XTerm({
      ...termOptions,
      theme: theme(),
      fontSize: fontSize(),
    });

    if (addonOpts.fit !== false) {
      const fit = new FitAddon();
      t.loadAddon(fit);
      setFitAddon(fit);
    }
    if (addonOpts.webLinks !== false) t.loadAddon(new WebLinksAddon());
    if (addonOpts.search !== false) {
      const search = new SearchAddon();
      t.loadAddon(search);
      setSearchAddon(search);
    }
    if (addonOpts.clipboard) {
      t.loadAddon(new ClipboardAddon(undefined, addonOpts.clipboard.provider));
    }
    if (addonOpts.unicode11 !== false) {
      t.loadAddon(new Unicode11Addon());
      t.unicode.activeVersion = "11";
    }
    if (addonOpts.image !== false) t.loadAddon(new ImageAddon());
    if (addonOpts.serialize !== false) {
      const serialize = new SerializeAddon();
      t.loadAddon(serialize);
      setSerializeAddon(serialize);
    }

    t.open(container);
    setTerm(t);

    scrollLock.attachToTerminal(t);

    attachXtermStyleSync(() => term(), {
      theme: opts.theme,
      fontSize: opts.fontSize,
      onThemeChange: () => webglLifecycle.clearTextureAtlas(),
      onFontSizeChange: () => {
        webglLifecycle.clearTextureAtlas();
        debouncedFit();
      },
    });

    if (webglOpts) {
      // Reactive policy: load/unload WebGL as the predicate flips.
      // `defer: true` because the consumer's predicate may already
      // be true at mount and we want the first effect to run after
      // setTerm above settles — `webglLifecycle.load` reads `term()`
      // and otherwise no-ops.
      createEffect(
        on(
          webglOpts.enabled,
          (enabled) => {
            if (enabled) webglLifecycle.load();
            else webglLifecycle.unload();
          },
          { defer: false },
        ),
      );
    }

    onTerm?.(t);

    onCleanup(() => {
      cancelAnimationFrame(fitRaf);
      webglLifecycle.unload();
      t.dispose();
      setTerm(null);
      setFitAddon(null);
      setSearchAddon(null);
      setSerializeAddon(null);
    });
  }

  return {
    term,
    mount,
    fit: debouncedFit,
    addons: {
      fit: fitAddon,
      search: searchAddon,
      serialize: serializeAddon,
    },
    write: (data) => {
      const t = term();
      if (t) scrollLock.writeData(t, data);
    },
    scrollLock: {
      locked: scrollLock.isLocked,
      hasNewOutput: scrollLock.hasNewOutput,
      toBottom: () => {
        const t = term();
        if (t) scrollLock.scrollToBottom(t);
      },
      reset: scrollLock.reset,
    },
    webgl: {
      enabled: webglLifecycle.has,
      atlas: webglLifecycle.atlas,
      clearTextureAtlas: webglLifecycle.clearTextureAtlas,
    },
  };
}
