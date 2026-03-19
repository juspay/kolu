//! Leptos component that mounts a ghostty-web terminal and wires it
//! to the server via WebSocket.

use leptos::prelude::*;
use wasm_bindgen::prelude::*;
use web_sys::{BinaryType, MessageEvent, WebSocket};

use kolu_common::WsClientMessage;

use crate::terminal::GhosttyTerminal;

/// WebSocket connection status, exposed as a signal for the UI.
#[derive(Clone, Copy, PartialEq)]
pub enum WsStatus {
    Connecting,
    Open,
    Closed,
}

impl WsStatus {
    pub fn label(self) -> &'static str {
        match self {
            WsStatus::Connecting => "connecting",
            WsStatus::Open => "connected",
            WsStatus::Closed => "disconnected",
        }
    }

    pub fn css_color(self) -> &'static str {
        match self {
            WsStatus::Connecting => "text-yellow-400",
            WsStatus::Open => "text-green-400",
            WsStatus::Closed => "text-red-400",
        }
    }
}

#[component]
pub fn TerminalView(
    session_id: String,
    /// Signal to report WS connection status back to parent.
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

        wasm_bindgen_futures::spawn_local(async move {
            let term = GhosttyTerminal::new();
            let _ = term.init().await;
            term.open(&container);

            // Wait one animation frame for the canvas to render before measuring
            wasm_bindgen_futures::JsFuture::from(js_sys::Promise::new(&mut |resolve, _| {
                web_sys::window()
                    .unwrap()
                    .request_animation_frame(&resolve)
                    .unwrap();
            }))
            .await
            .unwrap();

            // Fit terminal to container and get initial dimensions
            let size = term.fit_to_container();
            let (cols, rows) = extract_size(&size);

            // Build WebSocket URL from current page location
            let ws_url = build_ws_url(&session_id);
            let ws = WebSocket::new(&ws_url).unwrap();
            ws.set_binary_type(BinaryType::Arraybuffer);

            // On WS open: send initial resize so server knows our dimensions
            let ws_for_open = ws.clone();
            let onopen = Closure::wrap(Box::new(move |_: JsValue| {
                set_ws_status.set(WsStatus::Open);
                send_resize(&ws_for_open, cols, rows);
            }) as Box<dyn FnMut(JsValue)>);
            ws.set_onopen(Some(onopen.as_ref().unchecked_ref()));
            onopen.forget();

            // On WS close
            let onclose = Closure::wrap(Box::new(move |_: JsValue| {
                set_ws_status.set(WsStatus::Closed);
            }) as Box<dyn FnMut(JsValue)>);
            ws.set_onclose(Some(onclose.as_ref().unchecked_ref()));
            onclose.forget();

            // On WS message: write PTY output to terminal
            let term = std::rc::Rc::new(term);
            let term_for_msg = term.clone();
            let onmessage = Closure::wrap(Box::new(move |e: MessageEvent| {
                if let Ok(buf) = e.data().dyn_into::<js_sys::ArrayBuffer>() {
                    let array = js_sys::Uint8Array::new(&buf);
                    term_for_msg.write_bytes(&array);
                } else if let Some(text) = e.data().as_string() {
                    // Could be a JSON lifecycle message (Exit) or raw text
                    term_for_msg.write_string(&text);
                }
            }) as Box<dyn FnMut(MessageEvent)>);
            ws.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));
            onmessage.forget();

            // Terminal keyboard input → WS (guard against closed socket)
            let ws_for_data = ws.clone();
            let on_data_cb = Closure::wrap(Box::new(move |data: String| {
                if ws_for_data.ready_state() == WebSocket::OPEN {
                    let _ = ws_for_data.send_with_str(&data);
                }
            }) as Box<dyn FnMut(String)>);
            term.on_data(&on_data_cb);
            on_data_cb.forget();

            // Terminal resize events → WS (guard against closed socket)
            let ws_for_resize = ws.clone();
            let on_resize_cb = Closure::wrap(Box::new(move |cols: u16, rows: u16| {
                send_resize(&ws_for_resize, cols, rows);
            }) as Box<dyn FnMut(u16, u16)>);
            term.on_resize(&on_resize_cb);
            on_resize_cb.forget();

            // ResizeObserver: refit terminal when container size changes
            let term_for_resize = term.clone();
            let ws_for_observer = ws.clone();
            let on_observe = Closure::wrap(Box::new(move |_entries: JsValue, _observer: JsValue| {
                let size = term_for_resize.fit_to_container();
                let (cols, rows) = extract_size(&size);
                send_resize(&ws_for_observer, cols, rows);
            }) as Box<dyn FnMut(JsValue, JsValue)>);
            let observer = web_sys::ResizeObserver::new(on_observe.as_ref().unchecked_ref()).unwrap();
            observer.observe(&container);
            on_observe.forget();
            // Keep observer alive for the lifetime of the component
            std::mem::forget(observer);

            // TODO: cleanup on unmount (dispose terminal, close WS, disconnect observer)
        });
    });

    view! {
        <div node_ref=container_ref class="w-full h-full"></div>
    }
}

/// Send a Resize message over WebSocket if the connection is open.
fn send_resize(ws: &WebSocket, cols: u16, rows: u16) {
    if ws.ready_state() == WebSocket::OPEN {
        let msg = serde_json::to_string(&WsClientMessage::Resize { cols, rows }).unwrap();
        let _ = ws.send_with_str(&msg);
    }
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

/// Build a WebSocket URL for the terminal connection.
/// Trunk's proxy doesn't support WebSocket upgrades, so in dev mode
/// (port 5173) we connect directly to the backend (port 7681).
/// In prod, server serves everything on one port.
fn build_ws_url(session_id: &str) -> String {
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
        // Dev mode: Trunk serves on 5173, bypass its proxy for WS
        format!("{}:7681", hostname)
    } else {
        location.host().unwrap()
    };
    format!("{}//{}/ws/{}", protocol, host, session_id)
}
