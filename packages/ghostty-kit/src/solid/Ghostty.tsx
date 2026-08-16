/** `<Ghostty>` — canvas tile over the official libghostty-vt engine. */

import {
  type Accessor,
  type Component,
  createEffect,
  createSignal,
  getOwner,
  onCleanup,
  onMount,
  runWithOwner,
  splitProps,
  type JSX,
} from "solid-js";
import { createEngine, type Engine } from "../engine.ts";
import { preloadGhostty } from "../load.browser.ts";
import { sameGrid, type TerminalGrid } from "./grid.ts";
import { createOnceMeasured } from "./onceMeasured.ts";
import { createScrollLock, type ScrollLock } from "./scrollLock.ts";

export interface TerminalTheme {
  foreground?: string;
  background?: string;
  cursor?: string;
  selectionBackground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface GhosttyHandle {
  engine: Engine;
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  scrollLock: ScrollLock;
  write: (data: string, onParsed?: () => void) => void;
  clearPendingOutput: () => void;
  refit: () => void;
  grid: Accessor<TerminalGrid | null>;
  onceMeasured: (fn: (grid: TerminalGrid) => void) => void;
  search: (query: string, dir: "next" | "prev") => boolean;
  getSelectionText: () => string;
  selectAll: () => void;
  formatHtml: () => string;
  formatVt: () => string;
  /** xterm-shaped shim so e2e `__xterm` / SearchBar / attach policy keep compiling. */
  terminal: XtermShim;
  addons: {
    search: SearchAddonShim;
    serialize: {
      serialize: (opts?: unknown) => string;
      serializeAsHTML: (opts?: unknown) => string;
    };
    fit: { fit: () => void; proposeDimensions: () => TerminalGrid | undefined };
  };
  webgl: {
    hasWebgl: () => boolean;
    textureAtlasSize: () => { w: number; h: number } | null;
    clearTextureAtlas: () => void;
    loseContext: () => void;
  };
  recovery: {
    recover: () => void;
    noteData: () => void;
    probes: {
      msSinceLastPaint: () => number | null;
      renderDebouncerPending: () => boolean;
      isPaused: () => boolean;
      synchronizedOutput: () => boolean;
    };
  };
}

export interface XtermShim {
  cols: number;
  rows: number;
  focus: () => void;
  blur: () => void;
  reset: () => void;
  write: (data: string, cb?: () => void) => void;
  getSelection: () => string;
  textarea: HTMLTextAreaElement | undefined;
  options: { theme?: TerminalTheme; fontSize?: number };
  registerLinkProvider: (p: { dispose?: () => void }) => {
    dispose: () => void;
  };
  loadAddon: (a: { dispose?: () => void }) => void;
  attachCustomKeyEventHandler: (fn: (e: KeyboardEvent) => boolean) => void;
  onResize: (cb: (e: { cols: number; rows: number }) => void) => {
    dispose: () => void;
  };
  buffer: {
    active: {
      length: number;
      viewportY: number;
      getLine: (
        i: number,
      ) =>
        | { translateToString: (trim?: boolean) => string; isWrapped: boolean }
        | undefined;
    };
  };
}

export interface SearchAddonShim {
  findNext: (q: string, _opts?: unknown) => boolean;
  findPrevious: (q: string, _opts?: unknown) => boolean;
  clearDecorations: () => void;
  clearActiveDecoration: () => void;
  activate: () => void;
  dispose: () => void;
  onDidChangeResults: (
    cb: (e: { resultIndex: number; resultCount: number }) => void,
  ) => {
    dispose: () => void;
  };
}

interface OwnProps {
  theme: TerminalTheme;
  fontSize: number;
  visible: boolean;
  scrollLockEnabled: Accessor<boolean>;
  fullRate: Accessor<boolean>;
  fontFamily: string;
  scrollback?: number;
  onData: (data: string) => void;
  onReady: (handle: GhosttyHandle) => void;
  onTap?: (clientX: number, clientY: number) => boolean;
}

const OWN_KEYS = [
  "theme",
  "fontSize",
  "visible",
  "scrollLockEnabled",
  "fullRate",
  "fontFamily",
  "scrollback",
  "onData",
  "onReady",
  "onTap",
] as const;

export const Ghostty: Component<
  OwnProps & Omit<JSX.HTMLAttributes<HTMLDivElement>, "onReady">
> = (props) => {
  const [own, rest] = splitProps(props, OWN_KEYS);
  let mount!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let textarea!: HTMLTextAreaElement;
  const [grid, setGrid] = createSignal<TerminalGrid | null>(null);
  const onceMeasured = createOnceMeasured(grid);
  const lock = createScrollLock();
  let engine: Engine | undefined;
  let handle: GhosttyHandle | undefined;
  let searchIdx = -1;
  let raf = 0;
  let selText = "";
  let selAnchor: { x: number; y: number } | null = null;

  function cellSize(): { w: number; h: number } {
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) throw new Error("@kolu/ghostty-kit: no 2d context");
    probe.font = `${own.fontSize}px ${own.fontFamily}`;
    const m = probe.measureText("M");
    const w = Math.max(1, Math.ceil(m.width));
    const h = Math.max(1, Math.ceil(own.fontSize * 1.25));
    return { w, h };
  }

  function paint(): void {
    if (!engine) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = cellSize();
    const g = grid();
    const cols = g?.cols ?? engine.cols;
    const rows = g?.rows ?? engine.rows;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(cols * w * dpr));
    canvas.height = Math.max(1, Math.floor(rows * h * dpr));
    canvas.style.width = `${cols * w}px`;
    canvas.style.height = `${rows * h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = own.theme.background ?? "#000";
    ctx.fillRect(0, 0, cols * w, rows * h);
    ctx.font = `${own.fontSize}px ${own.fontFamily}`;
    ctx.textBaseline = "top";
    ctx.fillStyle = own.theme.foreground ?? "#ddd";
    const text = engine.getScreenText({ kind: "viewport" });
    const lines = text.length === 0 ? [] : text.split("\n");
    for (let y = 0; y < rows; y++) {
      const line = lines[y] ?? "";
      ctx.fillText(line, 0, y * h);
    }
    const cur = engine.cursor();
    ctx.fillStyle = own.theme.cursor ?? own.theme.foreground ?? "#fff";
    ctx.fillRect(cur.x * w, cur.y * h, Math.max(1, Math.floor(w * 0.15)), h);
  }

  function schedulePaint(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  }

  function applyFit(): TerminalGrid | null {
    if (!mount) return null;
    const { w, h } = cellSize();
    const cols = Math.max(2, Math.floor(mount.clientWidth / w));
    const rows = Math.max(1, Math.floor(mount.clientHeight / h));
    if (cols <= 0 || rows <= 0) return null;
    const next = { cols, rows };
    const prev = grid();
    if (prev && sameGrid(prev, next)) return prev;
    engine?.resize(cols, rows, w, h);
    setGrid(next);
    schedulePaint();
    return next;
  }

  onMount(() => {
    const owner = getOwner();
    if (!owner) {
      throw new Error(
        "@kolu/ghostty-kit: <Ghostty> mounted without a Solid owner",
      );
    }
    let cancelled = false;
    void preloadGhostty()
      .then(() => {
        runWithOwner(owner, () => {
          if (cancelled) return;
          const eng = createEngine({
            cols: 80,
            rows: 24,
            scrollback: own.scrollback,
          });
          if (cancelled) {
            eng.free();
            return;
          }
          engine = eng;
          bootEngine(eng);
        });
      })
      .catch((err: unknown) => {
        queueMicrotask(() => {
          throw err instanceof Error
            ? err
            : new Error(
                `@kolu/ghostty-kit: wasm preload failed: ${String(err)}`,
              );
        });
      });
    onCleanup(() => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      engine?.free();
      engine = undefined;
    });
  });

  function bootEngine(eng: Engine): void {
    {
      const keyHandlers: Array<(e: KeyboardEvent) => boolean> = [];
      const resultListeners = new Set<
        (e: { resultIndex: number; resultCount: number }) => void
      >();
      const visualLines = () =>
        eng.formatPlain({ unwrap: false, trim: true }).split("\n");
      const shim: XtermShim = {
        get cols() {
          return eng.cols;
        },
        get rows() {
          return eng.rows;
        },
        focus: () => textarea.focus(),
        blur: () => textarea.blur(),
        reset: () => {
          eng.write("\x1bc");
          schedulePaint();
        },
        write: (data, cb) => {
          eng.write(data);
          schedulePaint();
          cb?.();
        },
        getSelection: () => selText,
        get textarea() {
          return textarea;
        },
        options: { theme: own.theme, fontSize: own.fontSize },
        registerLinkProvider: () => ({ dispose: () => {} }),
        loadAddon: () => {},
        attachCustomKeyEventHandler: (fn) => {
          keyHandlers.push(fn);
        },
        onResize: () => ({ dispose: () => {} }),
        buffer: {
          get active() {
            const ls = visualLines();
            return {
              get length() {
                return ls.length;
              },
              get viewportY() {
                return Math.max(0, ls.length - eng.rows);
              },
              getLine: (i: number) => {
                const t = ls[i];
                if (t === undefined) return undefined;
                return { translateToString: () => t, isWrapped: false };
              },
            };
          },
        },
      };
      const searchAddon: SearchAddonShim = {
        findNext: (q) => {
          const ok = handle?.search(q, "next") ?? false;
          for (const cb of resultListeners) {
            cb({ resultIndex: searchIdx, resultCount: ok ? 1 : 0 });
          }
          return ok;
        },
        findPrevious: (q) => {
          const ok = handle?.search(q, "prev") ?? false;
          for (const cb of resultListeners) {
            cb({ resultIndex: searchIdx, resultCount: ok ? 1 : 0 });
          }
          return ok;
        },
        clearDecorations: () => {
          searchIdx = -1;
        },
        clearActiveDecoration: () => {},
        activate: () => {},
        dispose: () => {},
        onDidChangeResults: (cb) => {
          resultListeners.add(cb);
          return { dispose: () => resultListeners.delete(cb) };
        },
      };
      const write = (data: string, onParsed?: () => void) => {
        if (own.scrollLockEnabled() && lock.isLocked()) {
          lock.buffer(data);
          onParsed?.();
          return;
        }
        eng.write(data);
        onParsed?.();
        schedulePaint();
      };
      handle = {
        engine: eng,
        container: mount,
        canvas,
        scrollLock: lock,
        write,
        clearPendingOutput: () => lock.clearPending(),
        refit: () => applyFit(),
        grid,
        onceMeasured,
        search: (query, dir) => {
          const hay = eng.formatPlain();
          if (!query) return false;
          const q = query.toLowerCase();
          const hayL = hay.toLowerCase();
          if (dir === "next") {
            const from = searchIdx + 1;
            let i = hayL.indexOf(q, from);
            if (i < 0) i = hayL.indexOf(q);
            if (i < 0) return false;
            searchIdx = i;
            return true;
          }
          const from = searchIdx < 0 ? hayL.length : searchIdx;
          let i = hayL.lastIndexOf(q, from - 1);
          if (i < 0) i = hayL.lastIndexOf(q);
          if (i < 0) return false;
          searchIdx = i;
          return true;
        },
        getSelectionText: () =>
          selText.length > 0 ? selText : eng.formatPlain(),
        selectAll: () => {
          /* canvas has no DOM selection; copy uses formatPlain */
        },
        formatHtml: () => eng.formatHtml(),
        formatVt: () => eng.formatVt(),
        terminal: shim,
        addons: {
          search: searchAddon,
          serialize: {
            serialize: () => eng.formatVt(),
            serializeAsHTML: () => eng.formatHtml(),
          },
          fit: {
            fit: () => applyFit(),
            proposeDimensions: () => applyFit() ?? undefined,
          },
        },
        webgl: {
          hasWebgl: () => false,
          textureAtlasSize: () => null,
          clearTextureAtlas: () => {},
          loseContext: () => {},
        },
        recovery: {
          recover: () => schedulePaint(),
          noteData: () => {},
          probes: {
            msSinceLastPaint: () => 0,
            renderDebouncerPending: () => false,
            isPaused: () => false,
            synchronizedOutput: () => false,
          },
        },
      };
      applyFit();
      own.onReady(handle);
      schedulePaint();
    }
  }

  onMount(() => {
    const ro = new ResizeObserver(() => applyFit());
    ro.observe(mount);
    onCleanup(() => ro.disconnect());
  });

  createEffect(() => {
    own.theme;
    own.fontSize;
    own.fontFamily;
    schedulePaint();
  });

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) {
      // Chords the app claims (search, zoom) stay with the document.
      return;
    }
    ev.preventDefault();
    if (ev.key === "Enter") own.onData("\r");
    else if (ev.key === "Backspace") own.onData("\x7f");
    else if (ev.key === "Tab") own.onData("\t");
    else if (ev.key === "Escape") own.onData("\x1b");
    else if (ev.key.length === 1) own.onData(ev.key);
    else if (ev.key === "ArrowUp") own.onData("\x1b[A");
    else if (ev.key === "ArrowDown") own.onData("\x1b[B");
    else if (ev.key === "ArrowRight") own.onData("\x1b[C");
    else if (ev.key === "ArrowLeft") own.onData("\x1b[D");
  }

  function cellAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const cols = grid()?.cols ?? engine?.cols ?? 80;
    const rows = grid()?.rows ?? engine?.rows ?? 24;
    const x = Math.max(
      0,
      Math.min(
        cols - 1,
        Math.floor(((clientX - rect.left) / rect.width) * cols),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        rows - 1,
        Math.floor(((clientY - rect.top) / rect.height) * rows),
      ),
    );
    return { x, y };
  }

  function captureSelection(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    if (!engine) {
      selText = "";
      return;
    }
    const lines = engine.getScreenText({ kind: "viewport" }).split("\n");
    const y0 = Math.min(from.y, to.y);
    const y1 = Math.max(from.y, to.y);
    const x0 = Math.min(from.x, to.x);
    const x1 = Math.max(from.x, to.x);
    const parts: string[] = [];
    for (let y = y0; y <= y1; y++) {
      const line = lines[y] ?? "";
      parts.push(line.slice(x0, x1 + 1));
    }
    selText = parts.join("\n");
  }

  function onSelDown(ev: MouseEvent): void {
    if (ev.shiftKey || ev.button !== 0) return;
    selAnchor = cellAt(ev.clientX, ev.clientY);
    captureSelection(selAnchor, selAnchor);
  }

  function onSelMove(ev: MouseEvent): void {
    if (!selAnchor || (ev.buttons & 1) === 0) return;
    captureSelection(selAnchor, cellAt(ev.clientX, ev.clientY));
  }

  function onSelUp(ev: MouseEvent): void {
    if (!selAnchor) return;
    captureSelection(selAnchor, cellAt(ev.clientX, ev.clientY));
    selAnchor = null;
  }

  function onWheel(ev: WheelEvent): void {
    // Shift+wheel is the canvas pan modifier — let it bubble.
    if (ev.shiftKey) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (!own.scrollLockEnabled()) return;
    lock.armUserScrollIntent("wheel");
    if (ev.deltaY < 0) lock.lock(0, 1);
    else if (ev.deltaY > 0) {
      const flushed = lock.unlock();
      if (engine) {
        for (const chunk of flushed) engine.write(chunk);
        schedulePaint();
      }
    }
  }

  return (
    <div
      {...rest}
      ref={mount}
      data-terminal-engine="ghostty"
      onWheel={onWheel}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        outline: "none",
        position: "relative",
        "background-color": own.theme.background ?? "#000",
      }}
    >
      {/* Child of the data-focused/data-visible wrapper — e2e locates
          `[data-focused] [data-terminal-screen]` as a descendant. */}
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <canvas ref={canvas} data-terminal-screen />
        <textarea
          ref={textarea}
          data-terminal-input
          aria-label="Terminal"
          onMouseDown={onSelDown}
          onMouseMove={onSelMove}
          onMouseUp={onSelUp}
          autocomplete="off"
          spellcheck={false}
          onKeyDown={onKeyDown}
          onClick={(e) => {
            textarea.focus();
            own.onTap?.(e.clientX, e.clientY);
          }}
          style={{
            position: "absolute",
            inset: "0",
            opacity: "0",
            resize: "none",
            border: "none",
            padding: "0",
            margin: "0",
            overflow: "hidden",
            "caret-color": "transparent",
          }}
        />
      </div>
    </div>
  );
};
