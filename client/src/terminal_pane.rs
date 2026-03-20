//! Container component that manages terminal view lifecycle and the single
//! WebSocket connection.
//!
//! Keeps all created TerminalViews mounted (hidden via CSS) to preserve
//! ghostty state. Only the active terminal has a WebSocket connection —
//! switching terminals closes the old WS and opens a new one.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use leptos::prelude::*;
use send_wrapper::SendWrapper;
use wasm_bindgen::prelude::*;

use kolu_common::TerminalId;

use crate::bridge;
use crate::terminal::GhosttyTerminal;
use crate::terminal_view::{TerminalRegistry, TerminalView};
use crate::ws::WsStatus;

/// Open a WebSocket to the given terminal and wire up message routing.
///
/// Returns the connected `WebSocket`. Incoming PTY data is routed to the
/// ghostty handle; status changes update `set_ws_status`.
fn open_ws(
  tid: &str,
  term_handle: &Rc<GhosttyTerminal>,
  set_ws_status: WriteSignal<WsStatus>,
) -> web_sys::WebSocket {
  let url = bridge::build_ws_url(tid);
  set_ws_status.set(WsStatus::Connecting);

  let ws = web_sys::WebSocket::new(&url).unwrap();
  ws.set_binary_type(web_sys::BinaryType::Arraybuffer);

  // onmessage: route incoming data to ghostty
  let term_for_msg = Rc::clone(term_handle);
  let onmessage = Closure::wrap(Box::new(move |e: web_sys::MessageEvent| {
    let data = e.data();
    if let Some(ab) = data.dyn_ref::<js_sys::ArrayBuffer>() {
      let array = js_sys::Uint8Array::new(ab);
      term_for_msg.write_bytes(&array);
    } else if let Some(text) = data.as_string() {
      term_for_msg.write_string(&text);
    }
  }) as Box<dyn FnMut(web_sys::MessageEvent)>);
  ws.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));
  onmessage.forget();

  // onopen: send initial resize so server knows our grid dimensions
  let term_for_open = Rc::clone(term_handle);
  let ws_for_open = ws.clone();
  let onopen = Closure::wrap(Box::new(move |_: JsValue| {
    set_ws_status.set(WsStatus::Open);
    if let Some((cols, rows)) = bridge::extract_size(&term_for_open.fit_to_container()) {
      let _ = ws_for_open.send_with_str(&bridge::resize_msg(cols, rows));
    }
  }) as Box<dyn FnMut(JsValue)>);
  ws.set_onopen(Some(onopen.as_ref().unchecked_ref()));
  onopen.forget();

  // onclose
  let onclose = Closure::wrap(Box::new(move |_: JsValue| {
    set_ws_status.set(WsStatus::Closed);
  }) as Box<dyn FnMut(JsValue)>);
  ws.set_onclose(Some(onclose.as_ref().unchecked_ref()));
  onclose.forget();

  ws
}

/// Renders all terminals, showing only the active one.
/// Owns the single WebSocket connection to the active terminal's PTY.
#[component]
pub fn TerminalPane(
  active_id: ReadSignal<Option<TerminalId>>,
  terminals: ReadSignal<Vec<kolu_common::Terminal>>,
  set_ws_status: WriteSignal<WsStatus>,
) -> impl IntoView {
  // Terminal handle registry — TerminalViews register here after init
  let registry: TerminalRegistry = RwSignal::new(HashMap::new());
  provide_context(registry);

  // Current WS connection (shared between effect and callbacks)
  let ws_ref: SendWrapper<Rc<RefCell<Option<web_sys::WebSocket>>>> =
    SendWrapper::new(Rc::new(RefCell::new(None)));

  // Track which terminals have been connected before (for \x1bc reset)
  let connected_before: SendWrapper<Rc<RefCell<HashSet<String>>>> =
    SendWrapper::new(Rc::new(RefCell::new(HashSet::new())));

  // Track last connected terminal to avoid unnecessary reconnects
  let last_connected: SendWrapper<Rc<RefCell<Option<String>>>> =
    SendWrapper::new(Rc::new(RefCell::new(None)));

  // --- Effect: manage single WS based on active_id + registry ---
  let ws_ref_for_effect = ws_ref.clone();
  let connected_before_for_effect = connected_before.clone();
  let last_connected_for_effect = last_connected.clone();
  Effect::new(move |_| {
    let active = active_id.get();
    let reg = registry.get();

    let Some(tid) = active.as_ref() else {
      // No active terminal — close WS if open
      if let Some(ws) = ws_ref_for_effect.borrow_mut().take() {
        let _ = ws.close();
      }
      *last_connected_for_effect.borrow_mut() = None;
      set_ws_status.set(WsStatus::Closed);
      return;
    };

    // Already connected to this terminal
    if last_connected_for_effect.borrow().as_ref() == Some(tid) {
      return;
    }

    // Handle not ready yet (async ghostty init still running)
    let Some(term_handle) = reg.get(tid) else {
      return; // Effect re-runs when registry updates
    };

    // Close old WS
    if let Some(ws) = ws_ref_for_effect.borrow_mut().take() {
      let _ = ws.close();
    }

    // Reset ghostty if this terminal was connected before
    // (prevents duplicate content from scrollback replay)
    if connected_before_for_effect.borrow().contains(tid.as_str()) {
      let reset = js_sys::Uint8Array::from(&b"\x1bc"[..]);
      term_handle.write_bytes(&reset);
    }
    connected_before_for_effect.borrow_mut().insert(tid.clone());

    // Fit to container (now visible)
    term_handle.fit_to_container();

    let ws = open_ws(tid, term_handle, set_ws_status);
    *ws_ref_for_effect.borrow_mut() = Some(ws);
    *last_connected_for_effect.borrow_mut() = Some(tid.clone());
  });

  // --- Shared callbacks for TerminalView input/resize ---
  let ws_for_input = ws_ref.clone();
  let on_input = Callback::new(move |data: String| {
    if let Some(ws) = ws_for_input.borrow().as_ref() {
      let _ = ws.send_with_str(&data);
    }
  });

  let ws_for_resize = ws_ref.clone();
  let on_resize = Callback::new(move |(cols, rows): (u16, u16)| {
    if let Some(ws) = ws_for_resize.borrow().as_ref() {
      let _ = ws.send_with_str(&bridge::resize_msg(cols, rows));
    }
  });

  // --- Cleanup: close WS on unmount ---
  let ws_for_cleanup = ws_ref.clone();
  on_cleanup(move || {
    if let Some(ws) = ws_for_cleanup.borrow_mut().take() {
      let _ = ws.close();
    }
  });

  view! {
    <For
      each=move || terminals.get()
      key=|t| t.id.clone()
      let:terminal
    >
      {
        let tid = terminal.id.clone();
        let tid2 = tid.clone();
        let is_active = Signal::derive(move || {
          active_id.get().as_deref() == Some(tid.as_str())
        });
        view! {
          <div
            class="w-full h-full border border-slate-600 rounded overflow-hidden"
            style:display=move || {
              if is_active.get() { "" } else { "none" }
            }
          >
            <TerminalView
              terminal_id=tid2
              is_active=is_active
              on_input=on_input
              on_terminal_resize=on_resize
            />
          </div>
        }
      }
    </For>
    {move || {
      if active_id.get().is_none() {
        Some(view! {
          <div class="flex items-center justify-center h-full text-slate-500">
            "No terminal selected. Click '+ new' to create one."
          </div>
        })
      } else {
        None
      }
    }}
  }
}
