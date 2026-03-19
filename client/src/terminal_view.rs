//! Leptos component that mounts a ghostty-web terminal and wires it
//! to the server via WebSocket.

use leptos::prelude::*;
use wasm_bindgen::prelude::*;
use web_sys::KeyboardEvent;

use crate::terminal::GhosttyTerminal;
use crate::ws::{self, WsStatus};

const MIN_FONT_SIZE: f64 = 8.0;
const MAX_FONT_SIZE: f64 = 32.0;
const FONT_SIZE_KEY: &str = "kolu-font-size";

/// Full-screen terminal pane. Initializes ghostty-web, connects a WebSocket
/// to the server PTY, and handles resize/zoom interactions.
#[component]
pub fn TerminalView(
    session_id: String,
    #[prop(into)]
    set_ws_status: WriteSignal<WsStatus>,
) -> impl IntoView {
    let container_ref = NodeRef::<leptos::html::Div>::new();
    let session_id_clone = session_id.clone();

    Effect::new(move |_| {
        let session_id = session_id_clone.clone();
        let container = container_ref.get();
        if container.is_none() {
            return;
        }
        let container: web_sys::HtmlElement = container.unwrap().into();

        set_ws_status.set(WsStatus::Connecting);

        wasm_bindgen_futures::spawn_local(
            init_terminal(session_id, container, set_ws_status),
        );
    });

    view! {
        <div node_ref=container_ref class="w-full h-full"></div>
    }
}

/// Initialize ghostty terminal, connect WS, and wire up resize/zoom observers.
async fn init_terminal(
    session_id: String,
    container: web_sys::HtmlElement,
    set_ws_status: WriteSignal<WsStatus>,
) {
    let term = GhosttyTerminal::new();
    let _ = term.init().await;
    term.open(&container);

    // Wait one animation frame for the canvas to lay out before measuring
    wait_animation_frame().await;

    restore_font_size(&term);

    let size = term.fit_to_container();
    let (cols, rows) = extract_size(&size);

    let term = std::rc::Rc::new(term);
    let ws = ws::connect(&session_id, &term, cols, rows, set_ws_status);

    observe_container_resize(&term, &ws, &container);
    observe_font_zoom(&term, &ws, &container);
}

/// Restore persisted font-size preference from localStorage.
fn restore_font_size(term: &GhosttyTerminal) {
    if let Ok(Some(storage)) = web_sys::window().unwrap().local_storage() {
        if let Ok(Some(saved)) = storage.get_item(FONT_SIZE_KEY) {
            if let Ok(size) = saved.parse::<f64>() {
                term.set_font_size(size.clamp(MIN_FONT_SIZE, MAX_FONT_SIZE));
            }
        }
    }
}

/// Wait one animation frame (needed for canvas to have dimensions after mount).
async fn wait_animation_frame() {
    wasm_bindgen_futures::JsFuture::from(js_sys::Promise::new(&mut |resolve, _| {
        web_sys::window()
            .unwrap()
            .request_animation_frame(&resolve)
            .unwrap();
    }))
    .await
    .unwrap();
}

/// Watch the container for size changes and refit the terminal grid.
fn observe_container_resize(
    term: &std::rc::Rc<GhosttyTerminal>,
    ws: &web_sys::WebSocket,
    container: &web_sys::HtmlElement,
) {
    let term = term.clone();
    let ws = ws.clone();
    let cb = Closure::wrap(Box::new(move |_entries: JsValue, _obs: JsValue| {
        let size = term.fit_to_container();
        let (cols, rows) = extract_size(&size);
        ws::send_resize(&ws, cols, rows);
    }) as Box<dyn FnMut(JsValue, JsValue)>);

    let observer = web_sys::ResizeObserver::new(cb.as_ref().unchecked_ref()).unwrap();
    observer.observe(container);
    cb.forget();
    std::mem::forget(observer);
}

/// Listen for Cmd/Ctrl+Plus/Minus to zoom terminal font size.
fn observe_font_zoom(
    term: &std::rc::Rc<GhosttyTerminal>,
    ws: &web_sys::WebSocket,
    container: &web_sys::HtmlElement,
) {
    // Set initial data attribute for e2e testability
    let font_size = term.get_font_size();
    container
        .set_attribute("data-font-size", &font_size.to_string())
        .unwrap();

    let term = term.clone();
    let ws = ws.clone();
    let container = container.clone();
    let on_keydown = Closure::wrap(Box::new(move |e: KeyboardEvent| {
        if !(e.meta_key() || e.ctrl_key()) {
            return;
        }
        let delta: f64 = match e.key().as_str() {
            "=" | "+" => 1.0,
            "-" => -1.0,
            _ => return,
        };
        e.prevent_default();

        let current = term.get_font_size();
        let next = (current + delta).clamp(MIN_FONT_SIZE, MAX_FONT_SIZE);
        if (next - current).abs() < f64::EPSILON {
            return;
        }

        term.set_font_size(next);
        let size = term.fit_to_container();
        let (cols, rows) = extract_size(&size);
        ws::send_resize(&ws, cols, rows);

        container
            .set_attribute("data-font-size", &next.to_string())
            .unwrap();

        if let Ok(Some(storage)) = web_sys::window().unwrap().local_storage() {
            let _ = storage.set_item(FONT_SIZE_KEY, &next.to_string());
        }
    }) as Box<dyn FnMut(KeyboardEvent)>);

    // Capture phase to intercept before ghostty-web's input handler
    let mut opts = web_sys::AddEventListenerOptions::new();
    opts.capture(true);
    web_sys::window()
        .unwrap()
        .add_event_listener_with_callback_and_add_event_listener_options(
            "keydown",
            on_keydown.as_ref().unchecked_ref(),
            &opts,
        )
        .unwrap();
    on_keydown.forget();
}

/// Extract cols/rows from the JS object returned by fitToContainer().
fn extract_size(size: &JsValue) -> (u16, u16) {
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
