//! Leptos component that mounts a ghostty-web terminal and wires it
//! to the server via WebSocket.

use std::rc::Rc;
use std::sync::Arc;

use leptos::prelude::*;
use leptos_use::{
    use_event_listener_with_options, use_resize_observer, use_websocket_with_options,
    use_window, UseEventListenerOptions, UseWebSocketOptions,
};
use codee::string::FromToStringCodec;
use send_wrapper::SendWrapper;
use wasm_bindgen::prelude::*;

use crate::bridge;
use crate::terminal::GhosttyTerminal;
use crate::ws::WsStatus;

/// Serialize a Resize message for sending over WS.
fn resize_msg(cols: u16, rows: u16) -> String {
    serde_json::to_string(&kolu_common::WsClientMessage::Resize { cols, rows }).unwrap()
}

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

    // Shared terminal handle — None until async init completes.
    // SendWrapper is needed because JS objects aren't Send+Sync,
    // but leptos-use callbacks require it (single-threaded WASM, so safe).
    let term: Arc<std::sync::Mutex<Option<SendWrapper<Rc<GhosttyTerminal>>>>> =
        Arc::new(std::sync::Mutex::new(None));

    // --- WebSocket via leptos-use ---
    let ws_url = bridge::build_ws_url(&session_id);

    let term_for_bytes = Arc::clone(&term);
    let term_for_text = Arc::clone(&term);

    let ws = use_websocket_with_options::<String, String, FromToStringCodec, _, _>(
        &ws_url,
        UseWebSocketOptions::default()
            .immediate(false)
            .on_message_raw_bytes(Arc::new(move |bytes: &[u8]| {
                if let Some(t) = term_for_bytes.lock().unwrap().as_ref() {
                    let array = js_sys::Uint8Array::from(bytes);
                    t.write_bytes(&array);
                }
            }))
            .on_message_raw(move |text: &str| {
                if let Some(t) = term_for_text.lock().unwrap().as_ref() {
                    t.write_string(text);
                }
            }),
    );

    // Map WS ready_state to our WsStatus
    let ready_state = ws.ready_state;
    Effect::new(move |_| {
        set_ws_status.set(WsStatus::from(ready_state.get()));
    });

    // Clone send/open for use in closures below
    let ws_send = ws.send.clone();
    let ws_open = ws.open.clone();

    // --- Terminal init (async, then open WS) ---
    let term_for_init = Arc::clone(&term);
    let ws_send_for_init = ws_send.clone();
    Effect::new(move |_| {
        let container = container_ref.get();
        if container.is_none() {
            return;
        }
        let container: web_sys::HtmlElement = container.unwrap().into();

        let term_cell = Arc::clone(&term_for_init);
        let ws_open = ws_open.clone();
        let ws_send = ws_send_for_init.clone();

        wasm_bindgen_futures::spawn_local(async move {
            let t = GhosttyTerminal::new();
            let _ = t.init().await;
            t.open(&container);

            bridge::wait_animation_frame().await;

            // Restore persisted font size
            if let Some(saved) = bridge::local_storage_get(FONT_SIZE_KEY) {
                if let Ok(size) = saved.parse::<f64>() {
                    t.set_font_size(size.clamp(MIN_FONT_SIZE, MAX_FONT_SIZE));
                }
            }

            let size = t.fit_to_container();
            let (cols, rows) = bridge::extract_size(&size);

            // Set initial font-size data attribute for e2e testability
            container
                .set_attribute("data-font-size", &t.get_font_size().to_string())
                .unwrap();

            let t = Rc::new(t);

            // Wire terminal keyboard input → WS
            let ws_send_for_data = ws_send.clone();
            let on_data = Closure::wrap(Box::new(move |data: String| {
                ws_send_for_data(&data);
            }) as Box<dyn FnMut(String)>);
            t.on_data(&on_data);
            on_data.forget();

            // Wire terminal resize events → WS
            let ws_send_for_resize = ws_send.clone();
            let on_resize = Closure::wrap(Box::new(move |cols: u16, rows: u16| {
                ws_send_for_resize(&resize_msg(cols, rows));
            }) as Box<dyn FnMut(u16, u16)>);
            t.on_resize(&on_resize);
            on_resize.forget();

            // Store terminal handle so WS callbacks and observers can use it
            *term_cell.lock().unwrap() = Some(SendWrapper::new(t));

            // Open WS connection — now that terminal is ready to receive
            ws_open();

            // Send initial resize so server knows our dimensions
            ws_send(&resize_msg(cols, rows));
        });
    });

    // --- ResizeObserver via leptos-use ---
    let term_for_resize = Arc::clone(&term);
    let ws_send_for_resize = ws_send.clone();
    use_resize_observer(container_ref, move |_entries, _observer| {
        if let Some(t) = term_for_resize.lock().unwrap().as_ref() {
            let size = t.fit_to_container();
            let (cols, rows) = bridge::extract_size(&size);
            ws_send_for_resize(&resize_msg(cols, rows));
        }
    });

    // --- Font zoom via leptos-use event listener ---
    let term_for_zoom = Arc::clone(&term);
    let ws_send_for_zoom = ws_send.clone();
    // Return value is the cleanup fn (auto-called on unmount by leptos-use)
    let _stop_zoom_listener = use_event_listener_with_options(
        use_window(),
        leptos::ev::keydown,
        move |e: web_sys::KeyboardEvent| {
            if !(e.meta_key() || e.ctrl_key()) {
                return;
            }
            let delta: f64 = match e.key().as_str() {
                "=" | "+" => 1.0,
                "-" => -1.0,
                _ => return,
            };
            e.prevent_default();
            e.stop_propagation();

            if let Some(t) = term_for_zoom.lock().unwrap().as_ref() {
                let current = t.get_font_size();
                let next = (current + delta).clamp(MIN_FONT_SIZE, MAX_FONT_SIZE);
                if (next - current).abs() < f64::EPSILON {
                    return;
                }

                t.set_font_size(next);
                let size = t.fit_to_container();
                let (cols, rows) = bridge::extract_size(&size);
                ws_send_for_zoom(&resize_msg(cols, rows));

                // Update data attribute for e2e tests
                if let Some(container) = container_ref.get() {
                    let el: web_sys::HtmlElement = container.into();
                    let _ = el.set_attribute("data-font-size", &next.to_string());
                }

                bridge::local_storage_set(FONT_SIZE_KEY, &next.to_string());
            }
        },
        // Capture phase to intercept before ghostty-web's input handler
        UseEventListenerOptions::default().capture(true),
    );

    // --- Cleanup on unmount ---
    let term_for_cleanup = Arc::clone(&term);
    let ws_close = ws.close.clone();
    on_cleanup(move || {
        if let Some(t) = term_for_cleanup.lock().unwrap().take() {
            t.dispose();
        }
        ws_close();
    });

    view! {
        <div node_ref=container_ref class="w-full h-full"></div>
    }
}
