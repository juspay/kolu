//! Low-level JS interop helpers.
//!
//! Pure JS/WASM utilities with no Leptos dependency.
//! Anything that touches web_sys directly but isn't a Leptos hook belongs here.

use wasm_bindgen::JsValue;

/// Wait one animation frame. Needed for the canvas to have dimensions after mount.
pub async fn wait_animation_frame() {
    wasm_bindgen_futures::JsFuture::from(js_sys::Promise::new(&mut |resolve, _| {
        web_sys::window()
            .unwrap()
            .request_animation_frame(&resolve)
            .unwrap();
    }))
    .await
    .unwrap();
}

/// Extract cols/rows from the JS object returned by `fitToContainer()`.
/// Falls back to defaults if the value is null/undefined.
pub fn extract_size(size: &JsValue) -> (u16, u16) {
    if size.is_null() || size.is_undefined() {
        return (kolu_common::DEFAULT_COLS, kolu_common::DEFAULT_ROWS);
    }
    let cols = js_sys::Reflect::get(size, &"cols".into())
        .ok()
        .and_then(|v| v.as_f64())
        .unwrap_or(kolu_common::DEFAULT_COLS as f64) as u16;
    let rows = js_sys::Reflect::get(size, &"rows".into())
        .ok()
        .and_then(|v| v.as_f64())
        .unwrap_or(kolu_common::DEFAULT_ROWS as f64) as u16;
    (cols, rows)
}

/// Read a value from localStorage.
pub fn local_storage_get(key: &str) -> Option<String> {
    web_sys::window()
        .unwrap()
        .local_storage()
        .ok()
        .flatten()
        .and_then(|s| s.get_item(key).ok().flatten())
}

/// Write a value to localStorage.
pub fn local_storage_set(key: &str, value: &str) {
    if let Ok(Some(storage)) = web_sys::window().unwrap().local_storage() {
        let _ = storage.set_item(key, value);
    }
}

/// Build a WebSocket URL for the terminal connection.
///
/// Trunk's dev proxy doesn't support WebSocket upgrades, so in dev mode
/// (port 5173) we connect directly to the backend (port 7681).
/// In production the server serves everything on one port.
pub fn build_ws_url(session_id: &str) -> String {
    let window = web_sys::window().unwrap();
    let location = window.location();
    let protocol = if location.protocol().unwrap() == "https:" {
        "wss:"
    } else {
        "ws:"
    };
    let hostname = location.hostname().unwrap();
    let port = location.port().unwrap();
    let host = if port == "5173" {
        format!("{}:7681", hostname)
    } else {
        location.host().unwrap()
    };
    format!("{}//{}/ws/{}", protocol, host, session_id)
}
