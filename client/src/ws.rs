//! WebSocket connection management for terminal I/O.
//!
//! Owns the WS lifecycle: connect, send/receive, status tracking.
//! Terminal-specific wiring (ghostty callbacks) lives in terminal_view.

use std::rc::Rc;

use leptos::prelude::*;
use wasm_bindgen::prelude::*;
use web_sys::{BinaryType, MessageEvent, WebSocket};

use kolu_common::WsClientMessage;

use crate::terminal::GhosttyTerminal;

/// WebSocket connection status, exposed as a signal for the UI header.
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

/// Connect a WebSocket to the given terminal, wiring up all callbacks.
///
/// Returns the WebSocket so the caller can use it for resize/zoom events.
pub fn connect(
    session_id: &str,
    term: &Rc<GhosttyTerminal>,
    initial_cols: u16,
    initial_rows: u16,
    set_ws_status: WriteSignal<WsStatus>,
) -> WebSocket {
    let ws_url = build_url(session_id);
    let ws = WebSocket::new(&ws_url).unwrap();
    ws.set_binary_type(BinaryType::Arraybuffer);

    // On open: report status + send initial terminal dimensions
    let ws_for_open = ws.clone();
    let on_open = Closure::wrap(Box::new(move |_: JsValue| {
        set_ws_status.set(WsStatus::Open);
        send_resize(&ws_for_open, initial_cols, initial_rows);
    }) as Box<dyn FnMut(JsValue)>);
    ws.set_onopen(Some(on_open.as_ref().unchecked_ref()));
    on_open.forget();

    // On close: report disconnected
    let on_close = Closure::wrap(Box::new(move |_: JsValue| {
        set_ws_status.set(WsStatus::Closed);
    }) as Box<dyn FnMut(JsValue)>);
    ws.set_onclose(Some(on_close.as_ref().unchecked_ref()));
    on_close.forget();

    // On message: route PTY output to terminal display
    let term_for_msg = term.clone();
    let on_message = Closure::wrap(Box::new(move |e: MessageEvent| {
        if let Ok(buf) = e.data().dyn_into::<js_sys::ArrayBuffer>() {
            let array = js_sys::Uint8Array::new(&buf);
            term_for_msg.write_bytes(&array);
        } else if let Some(text) = e.data().as_string() {
            term_for_msg.write_string(&text);
        }
    }) as Box<dyn FnMut(MessageEvent)>);
    ws.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
    on_message.forget();

    // Terminal keyboard input → WS
    let ws_for_data = ws.clone();
    let on_data = Closure::wrap(Box::new(move |data: String| {
        if ws_for_data.ready_state() == WebSocket::OPEN {
            let _ = ws_for_data.send_with_str(&data);
        }
    }) as Box<dyn FnMut(String)>);
    term.on_data(&on_data);
    on_data.forget();

    // Terminal resize events → WS
    let ws_for_resize = ws.clone();
    let on_resize = Closure::wrap(Box::new(move |cols: u16, rows: u16| {
        send_resize(&ws_for_resize, cols, rows);
    }) as Box<dyn FnMut(u16, u16)>);
    term.on_resize(&on_resize);
    on_resize.forget();

    ws
}

/// Send a Resize message over WebSocket if the connection is open.
pub fn send_resize(ws: &WebSocket, cols: u16, rows: u16) {
    if ws.ready_state() == WebSocket::OPEN {
        let msg = serde_json::to_string(&WsClientMessage::Resize { cols, rows }).unwrap();
        let _ = ws.send_with_str(&msg);
    }
}

/// Build a WebSocket URL for the terminal connection.
///
/// Trunk's dev proxy doesn't support WebSocket upgrades, so in dev mode
/// (port 5173) we connect directly to the backend (port 7681).
/// In production the server serves everything on one port.
fn build_url(session_id: &str) -> String {
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
