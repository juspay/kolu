/**
 * Thin JS bridge between Leptos/WASM and ghostty-web.
 *
 * This is the ONLY file that imports ghostty-web directly.
 * Rust/WASM calls into this via wasm-bindgen extern declarations.
 */
import { init, Terminal } from '/ghostty-web.js';

let initialized = false;

// Must match DEFAULT_COLS/DEFAULT_ROWS in common/src/lib.rs
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Wraps a ghostty-web Terminal with lifecycle management.
 * One instance per terminal pane in the UI.
 */
export class GhosttyTerminal {
    constructor() {
        this.term = null;
        this.container = null;
        this.cellWidth = 0;
        this.cellHeight = 0;
        // Track current grid size for accurate cell measurement after resize
        this.currentCols = DEFAULT_COLS;
        this.currentRows = DEFAULT_ROWS;
        this._onDataCb = null;
        this._onResizeCb = null;
    }

    /**
     * Load ghostty-web WASM and initialize the library.
     * Idempotent — safe to call multiple times.
     */
    async init() {
        if (!initialized) {
            await init();
            initialized = true;
        }
        this.term = new Terminal({ fontSize: 14 });
    }

    /**
     * Mount the terminal into a DOM element. Starts rendering.
     * @param {HTMLElement} element - Container element to render into
     */
    open(element) {
        this.container = element;
        this.term.open(element);
    }

    /**
     * Calculate cell pixel dimensions from the rendered canvas.
     * Must be called after open() + a frame delay so the canvas has size.
     * Used by fitToContainer() for cols/rows calculation.
     *
     * Derives cell size from current canvas size ÷ current grid dimensions.
     */
    measureCells() {
        const canvas = this.container?.querySelector('canvas');
        if (canvas && canvas.clientWidth > 0) {
            this.cellWidth = canvas.clientWidth / this.currentCols;
            this.cellHeight = canvas.clientHeight / this.currentRows;
        }
    }

    /**
     * Write raw bytes (PTY output) to the terminal display.
     * @param {Uint8Array} data - Binary PTY output
     */
    writeBytes(data) {
        this.term.write(data);
    }

    /**
     * Write a UTF-8 string to the terminal display.
     * @param {string} data - Text to display
     */
    writeString(data) {
        this.term.write(data);
    }

    /**
     * Resize the terminal grid to the given dimensions.
     * @param {number} cols - Number of columns
     * @param {number} rows - Number of rows
     */
    resize(cols, rows) {
        this.currentCols = cols;
        this.currentRows = rows;
        this.term.resize(cols, rows);
    }

    /**
     * Get the current font size.
     * @returns {number}
     */
    getFontSize() {
        return this.term.options.fontSize;
    }

    /**
     * Set the font size. Triggers ghostty-web's internal re-measure and re-render.
     * @param {number} size - New font size in pixels
     */
    setFontSize(size) {
        this.term.options.fontSize = size;
        // Cell dimensions changed — re-measure for fitToContainer math
        this.cellWidth = 0;
        this.cellHeight = 0;
    }

    /**
     * Tear down the terminal and free resources.
     * Call on component unmount or terminal close.
     */
    dispose() {
        if (this.term) {
            this.term.dispose();
            this.term = null;
        }
    }

    /**
     * Register a callback for user keyboard input.
     * Called with a string of the typed character(s).
     * @param {function(string): void} callback
     */
    onData(callback) {
        this._onDataCb = callback;
        this.term.onData((data) => callback(data));
    }

    /**
     * Register a callback for terminal-initiated resize events.
     * Called with (cols, rows) when the terminal requests a size change.
     * @param {function(number, number): void} callback
     */
    onResize(callback) {
        this._onResizeCb = callback;
        this.term.onResize(({ cols, rows }) => callback(cols, rows));
    }

    /**
     * Calculate and apply cols/rows to fill the container element.
     * Returns { cols, rows } or null if measurement isn't ready.
     * @returns {{ cols: number, rows: number } | null}
     */
    fitToContainer() {
        if (!this.cellWidth) this.measureCells();
        if (!this.container || !this.cellWidth) return null;
        const rect = this.container.getBoundingClientRect();
        const cols = Math.max(2, Math.floor(rect.width / this.cellWidth));
        const rows = Math.max(1, Math.floor(rect.height / this.cellHeight));
        this.resize(cols, rows);
        return { cols, rows };
    }
}
