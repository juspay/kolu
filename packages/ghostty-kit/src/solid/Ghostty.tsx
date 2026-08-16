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
import { lineText, resolveColor } from "../styled.ts";
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
  scrollLines: (n: number) => void;
  onRender: (cb: () => void) => { dispose: () => void };
  _core: {
    _renderService: {
      refreshRows: (s: number, e: number, sync?: boolean) => void;
      _renderDebouncer: { _animationFrame?: number };
    };
  };
  buffer: {
    active: {
      length: number;
      viewportY: number;
      baseY: number;
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
  onTap?: (clientX: number, clientY: number, ev: MouseEvent) => boolean;
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
  /** Lines the paint is shifted up from the live bottom. 0 = pinned. */
  let viewOffset = 0;
  const renderListeners = new Set<() => void>();
  let touchLastY = 0;
  let touchCarry = 0;

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
    // Engine grid is what the glyphs occupy. `grid()` is the published
    // pane size — using it here while the constructor is still 80×24
    // stretches the canvas and shifts every click (zoomed L/R #1400).
    const cols = engine.cols;
    const rows = engine.rows;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(cols * w * dpr));
    canvas.height = Math.max(1, Math.floor(rows * h * dpr));
    canvas.style.width = `${cols * w}px`;
    canvas.style.height = `${rows * h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = own.theme.background ?? "#000";
    ctx.fillRect(0, 0, cols * w, rows * h);
    ctx.textBaseline = "top";
    const baseFont = `${own.fontSize}px ${own.fontFamily}`;
    const defaultBg = own.theme.background ?? "#000";
    const { lines } = viewportWindow(rows);
    for (let y = 0; y < rows; y++) {
      const line = lines[y];
      if (!line) continue;
      let col = 0;
      for (const run of line.runs) {
        let fg = resolveColor(run.style.fg, own.theme, "fg");
        let bg = resolveColor(run.style.bg, own.theme, "bg");
        if (run.style.inverse) {
          const swap = fg;
          fg = bg;
          bg = swap;
        }
        const weight = run.style.bold ? "700 " : "";
        const italic = run.style.italic ? "italic " : "";
        ctx.font = `${italic}${weight}${baseFont}`;
        ctx.globalAlpha = run.style.faint ? 0.5 : 1;
        for (const ch of run.text) {
          const glyphCols = engine.cellWidth(ch.codePointAt(0) ?? 0);
          if (glyphCols > 0 && bg !== defaultBg) {
            ctx.fillStyle = bg;
            ctx.fillRect(col * w, y * h, glyphCols * w, h);
          }
          ctx.fillStyle = fg;
          ctx.fillText(ch, col * w, y * h);
          if (run.style.underline && glyphCols > 0) {
            ctx.fillRect(col * w, y * h + h - 1, glyphCols * w, 1);
          }
          if (glyphCols > 0) col += glyphCols;
        }
      }
    }
    ctx.globalAlpha = 1;
    if (viewOffset === 0) {
      const cur = engine.cursor();
      ctx.fillStyle = own.theme.cursor ?? own.theme.foreground ?? "#fff";
      ctx.fillRect(cur.x * w, cur.y * h, Math.max(1, Math.floor(w * 0.15)), h);
    }
    for (const cb of renderListeners) cb();
  }

  function schedulePaint(): void {
    const rd = handle?.terminal._core._renderService._renderDebouncer;
    // e2e parks rAF and cancels `_animationFrame`; drop the stale handle.
    if (rd && rd._animationFrame === undefined) raf = 0;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (rd) rd._animationFrame = undefined;
      paint();
    });
    if (rd) rd._animationFrame = raf;
  }

  function visualStyled() {
    return engine?.styledLines({ kind: "full" }) ?? [];
  }

  /** The painted / hit-tested window. Clamps `viewOffset` to the live tail. */
  function viewportWindow(rows: number) {
    const all = visualStyled();
    const maxOff = Math.max(0, all.length - rows);
    if (viewOffset > maxOff) viewOffset = maxOff;
    const start = Math.max(0, all.length - rows - viewOffset);
    return { all, lines: all.slice(start, start + rows), start, maxOff };
  }

  function applyFit(): TerminalGrid | null {
    // No engine, no grid — a pre-boot ResizeObserver must not publish a
    // size the constructor (80×24) has not been resized to, or attach
    // opens at the measured size and writes into the invented one.
    if (!mount || !engine) return grid();
    // A `hidden` / 0×0 tile must not resize the engine — that reflow
    // evicts the live screen (compact switch, maximized cover).
    if (!own.visible) return grid();
    const { w, h } = cellSize();
    if (mount.clientWidth < w * 2 || mount.clientHeight < h) return grid();
    const cols = Math.max(2, Math.floor(mount.clientWidth / w));
    const rows = Math.max(1, Math.floor(mount.clientHeight / h));
    if (cols <= 0 || rows <= 0) return null;
    const next = { cols, rows };
    const prev = grid();
    // Always tell the engine: `resize` no-ops when already there, and
    // grid() can otherwise claim a size the constructor never took.
    engine.resize(cols, rows, w, h);
    if (prev && sameGrid(prev, next)) return prev;
    setGrid(next);
    schedulePaint();
    return next;
  }

  /** display:none → visible and Corvu's first expanded frame often land
   *  size AFTER the calling effect. Retry across two animation frames
   *  so a split can publish a grid (and open attach) without a resize. */
  function scheduleFit(): void {
    applyFit();
    if (grid() || !own.visible || !engine) return;
    requestAnimationFrame(() => {
      applyFit();
      if (grid() || !own.visible || !engine) return;
      requestAnimationFrame(() => applyFit());
    });
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
      const rawBottom = lock.scrollToBottom.bind(lock);
      lock.scrollToBottom = (_term?: unknown) => {
        viewOffset = 0;
        schedulePaint();
        return rawBottom(_term);
      };
      const rawTab = lock.handleTabVisible.bind(lock);
      lock.handleTabVisible = () => {
        // #1272: a lock taken while hidden must rejoin the live bottom
        // on tab return — unlocking the latch alone leaves viewOffset.
        viewOffset = 0;
        schedulePaint();
        rawTab();
      };
      const keyHandlers: Array<(e: KeyboardEvent) => boolean> = [];
      const resultListeners = new Set<
        (e: { resultIndex: number; resultCount: number }) => void
      >();
      const visualLines = () => visualStyled().map(lineText);
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
          viewOffset = 0;
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
        scrollLines: (n) => {
          const ls = visualLines();
          const maxOff = Math.max(0, ls.length - eng.rows);
          // xterm: negative n scrolls the viewport toward older rows.
          viewOffset = Math.max(0, Math.min(maxOff, viewOffset - n));
          schedulePaint();
        },
        onRender: (cb) => {
          renderListeners.add(cb);
          return { dispose: () => renderListeners.delete(cb) };
        },
        _core: {
          _renderService: {
            refreshRows: (_s, _e, sync) => {
              if (sync) paint();
              else schedulePaint();
            },
            _renderDebouncer: {},
          },
        },
        buffer: {
          get active() {
            const ls = visualLines();
            const baseY = Math.max(0, ls.length - eng.rows);
            return {
              get length() {
                return ls.length;
              },
              get viewportY() {
                return Math.max(0, baseY - viewOffset);
              },
              get baseY() {
                return baseY;
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
        // Always parse into the engine. Lock only freezes the painted
        // window (viewOffset) — dropping bytes made buffer reads and
        // Starship-like prompts vanish while the user was scrolled up.
        const before = visualStyled();
        const rows = eng.rows;
        const start = Math.max(0, before.length - rows - viewOffset);
        const needle = lineText(before[start] ?? { runs: [] });
        eng.write(data);
        onParsed?.();
        const after = visualStyled();
        const grew = Math.max(0, after.length - before.length);
        if (own.scrollLockEnabled() && lock.isLocked()) {
          if (grew > 0) viewOffset += grew;
          else if (needle.length > 0) {
            // Scrollback cap: length did not grow, oldest rows fell off.
            // Re-pin the frozen window to the same first visible line.
            const found = after.findIndex((l) => lineText(l) === needle);
            if (found >= 0) {
              viewOffset = Math.max(0, after.length - rows - found);
            }
          }
          lock.buffer(data);
        } else {
          // Unlocked (including #1272 programmatic scroll) pins to the
          // live bottom so new output is what the user sees.
          viewOffset = 0;
        }
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
          recover: () => {
            // Go through the live refreshRows so e2e can wrap it.
            handle?.terminal._core._renderService.refreshRows(0, 0, true);
          },
          noteData: () => {},
          probes: {
            msSinceLastPaint: () => 0,
            renderDebouncerPending: () => false,
            isPaused: () => false,
            synchronizedOutput: () => false,
          },
        },
      };
      scheduleFit();
      own.onReady(handle);
      schedulePaint();
    }
  }

  onMount(() => {
    const ro = new ResizeObserver(() => scheduleFit());
    ro.observe(mount);
    onCleanup(() => ro.disconnect());
  });

  onMount(() => {
    // Swipe tests (and real fingers) land on the tile wrapper, not only the canvas.
    const el = mount;
    const onStart = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (!t) return;
      touchLastY = t.clientY;
      touchCarry = 0;
      if (own.scrollLockEnabled()) lock.armUserScrollIntent("touch");
    };
    const onMove = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (!t || !engine) return;
      touchCarry += t.clientY - touchLastY;
      touchLastY = t.clientY;
      const cellH = cellSize().h;
      const cells = Math.trunc(touchCarry / cellH);
      if (cells === 0) return;
      touchCarry -= cells * cellH;
      ev.preventDefault();
      const maxOff = Math.max(0, visualStyled().length - engine.rows);
      viewOffset = Math.max(0, Math.min(maxOff, viewOffset + cells));
      if (own.scrollLockEnabled()) {
        if (cells > 0) lock.lock(0, 1);
        else if (viewOffset === 0) lock.unlock();
      }
      schedulePaint();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    onCleanup(() => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    });
  });

  createEffect(() => {
    own.theme;
    own.fontSize;
    own.fontFamily;
    schedulePaint();
  });

  createEffect(() => {
    if (own.visible) scheduleFit();
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

  function onInput(): void {
    const t = textarea.value;
    if (t.length === 0) return;
    own.onData(t);
    textarea.value = "";
  }

  function cellAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const cols = engine?.cols ?? 80;
    const rows = engine?.rows ?? 24;
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
    const rows = engine.rows;
    const { lines } = viewportWindow(rows);
    const y0 = Math.min(from.y, to.y);
    const y1 = Math.max(from.y, to.y);
    const x0 = Math.min(from.x, to.x);
    const x1 = Math.max(from.x, to.x);
    const parts: string[] = [];
    for (let y = y0; y <= y1; y++) {
      const line = lineText(lines[y] ?? { runs: [] });
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
    if (engine) {
      const maxOff = Math.max(0, visualStyled().length - engine.rows);
      if (ev.deltaY < 0) viewOffset = Math.min(maxOff, viewOffset + 3);
      else viewOffset = Math.max(0, viewOffset - 3);
    }
    if (!own.scrollLockEnabled()) {
      schedulePaint();
      return;
    }
    lock.armUserScrollIntent("wheel");
    if (ev.deltaY < 0) lock.lock(0, 1);
    else if (ev.deltaY > 0 && viewOffset === 0) {
      lock.unlock();
    }
    schedulePaint();
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
        <canvas
          ref={canvas}
          data-terminal-screen
          onMouseDown={onSelDown}
          onMouseMove={onSelMove}
          onMouseUp={onSelUp}
          onClick={(e) => {
            const handled = own.onTap?.(e.clientX, e.clientY, e) === true;
            if (!handled) textarea.focus();
          }}
        />
        <textarea
          ref={textarea}
          data-terminal-input
          aria-label="Terminal"
          autocomplete="off"
          spellcheck={false}
          onKeyDown={onKeyDown}
          onInput={onInput}
          style={{
            position: "absolute",
            left: "0",
            top: "0",
            width: "1px",
            height: "1px",
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
