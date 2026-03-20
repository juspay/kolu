//! 1:1 wasm-bindgen bindings for ghostty-bridge.js.
//!
//! Each method here mirrors a method on the JS `GhosttyTerminal` class.
//! No extra logic — this file is purely the FFI layer.

use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/js/ghostty-bridge.js")]
extern "C" {
    /// JS class wrapping a ghostty-web Terminal instance.
    pub type GhosttyTerminal;

    /// Create a new GhosttyTerminal (JS constructor).
    #[wasm_bindgen(constructor)]
    pub fn new() -> GhosttyTerminal;

    /// Load ghostty-web WASM and initialize the library. Idempotent.
    #[wasm_bindgen(method, catch)]
    pub async fn init(this: &GhosttyTerminal) -> Result<JsValue, JsValue>;

    /// Mount the terminal into a DOM element. Starts rendering.
    #[wasm_bindgen(method)]
    pub fn open(this: &GhosttyTerminal, element: &web_sys::HtmlElement);

    /// Calculate cell pixel dimensions from the rendered canvas.
    #[wasm_bindgen(method, js_name = "measureCells")]
    pub fn measure_cells(this: &GhosttyTerminal);

    /// Write raw bytes (PTY output) to the terminal display.
    #[wasm_bindgen(method, js_name = "writeBytes")]
    pub fn write_bytes(this: &GhosttyTerminal, data: &js_sys::Uint8Array);

    /// Write a UTF-8 string to the terminal display.
    #[wasm_bindgen(method, js_name = "writeString")]
    pub fn write_string(this: &GhosttyTerminal, data: &str);

    /// Get the current font size.
    #[wasm_bindgen(method, js_name = "getFontSize")]
    pub fn get_font_size(this: &GhosttyTerminal) -> f64;

    /// Set the font size. Triggers re-measure and re-render.
    #[wasm_bindgen(method, js_name = "setFontSize")]
    pub fn set_font_size(this: &GhosttyTerminal, size: f64);

    /// Resize the terminal grid to the given dimensions.
    #[wasm_bindgen(method)]
    pub fn resize(this: &GhosttyTerminal, cols: u16, rows: u16);

    /// Tear down the terminal and free resources.
    #[wasm_bindgen(method)]
    pub fn dispose(this: &GhosttyTerminal);

    /// Register a callback for user keyboard input.
    #[wasm_bindgen(method, js_name = "onData")]
    pub fn on_data(this: &GhosttyTerminal, callback: &Closure<dyn FnMut(String)>);

    /// Register a callback for terminal-initiated resize events.
    #[wasm_bindgen(method, js_name = "onResize")]
    pub fn on_resize(this: &GhosttyTerminal, callback: &Closure<dyn FnMut(u16, u16)>);

    /// Calculate and apply cols/rows to fill the container element.
    /// Returns a JS object { cols, rows } or null.
    #[wasm_bindgen(method, js_name = "fitToContainer")]
    pub fn fit_to_container(this: &GhosttyTerminal) -> JsValue;
}
