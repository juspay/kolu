//! Terminal pane: renders all terminals, shows only the active one via CSS.
//!
//! Each terminal gets its own container div, GhosttyTerminal instance, and
//! WebSocket connection. Switching is pure CSS visibility toggle — no
//! destroy/recreate, no scrollback replay, instant.

use std::rc::Rc;
use std::sync::Arc;

use codee::string::FromToStringCodec;
use leptos::prelude::*;
use leptos_use::{
  use_event_listener_with_options, use_resize_observer, use_websocket_with_options, use_window,
  UseEventListenerOptions, UseWebSocketOptions,
};
use send_wrapper::SendWrapper;
use wasm_bindgen::prelude::*;

use kolu_common::TerminalId;

use crate::bridge;
use crate::terminal::GhosttyTerminal;

fn resize_msg(cols: u16, rows: u16) -> String {
  serde_json::to_string(&kolu_common::WsClientMessage::Resize { cols, rows }).unwrap()
}

const MIN_FONT_SIZE: f64 = 8.0;
const MAX_FONT_SIZE: f64 = 32.0;
const FONT_SIZE_KEY: &str = "kolu-font-size";

/// Renders all known terminals, only the active one visible.
#[component]
pub fn TerminalPane(
  terminal_ids: Memo<Vec<TerminalId>>,
  active_id: ReadSignal<Option<TerminalId>>,
) -> impl IntoView {
  view! {
      <div class="w-full h-full relative overflow-hidden">
          <For
              each=move || terminal_ids.get()
              key=|id| id.clone()
              let:id
          >
              {
                  let id_clone = id.clone();
                  view! {
                      <TerminalInstance id=id_clone active_id=active_id />
                  }
              }
          </For>
      </div>
  }
}

/// A single terminal instance: container + ghostty-web + WebSocket.
/// Hidden via CSS when not active. Stays alive for instant switching.
#[component]
fn TerminalInstance(id: TerminalId, active_id: ReadSignal<Option<TerminalId>>) -> impl IntoView {
  let container_ref = NodeRef::<leptos::html::Div>::new();
  let id_for_visibility = id.clone();

  let term: Arc<std::sync::Mutex<Option<SendWrapper<Rc<GhosttyTerminal>>>>> =
    Arc::new(std::sync::Mutex::new(None));

  // --- WebSocket ---
  let ws_url = bridge::build_ws_url(&id);

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

  // Send initial resize when WS connects
  let ready_state = ws.ready_state;
  let term_for_open = Arc::clone(&term);
  let ws_send_for_open = ws.send.clone();
  Effect::new(move |_| {
    let state = ready_state.get();
    if state == leptos_use::core::ConnectionReadyState::Open {
      if let Some(t) = term_for_open.lock().unwrap().as_ref() {
        if let Some((cols, rows)) = bridge::extract_size(&t.fit_to_container()) {
          ws_send_for_open(&resize_msg(cols, rows));
        }
      }
    }
  });

  let ws_send = ws.send.clone();
  let ws_open = ws.open.clone();
  let ws_send_for_resize = ws_send.clone();
  let ws_send_for_zoom = ws_send.clone();

  // --- Terminal init ---
  let term_for_init = Arc::clone(&term);
  Effect::new(move |_| {
    let container = container_ref.get();
    if container.is_none() {
      return;
    }
    let container: web_sys::HtmlElement = container.unwrap().into();

    let term_cell = Arc::clone(&term_for_init);
    let ws_open = ws_open.clone();
    let ws_send = ws_send.clone();

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

      t.fit_to_container();

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

      *term_cell.lock().unwrap() = Some(SendWrapper::new(t));

      ws_open();
    });
  });

  // --- ResizeObserver ---
  let term_for_resize = Arc::clone(&term);
  use_resize_observer(container_ref, move |_entries, _observer| {
    if let Some(t) = term_for_resize.lock().unwrap().as_ref() {
      if let Some((cols, rows)) = bridge::extract_size(&t.fit_to_container()) {
        ws_send_for_resize(&resize_msg(cols, rows));
      }
    }
  });

  // --- Font zoom ---
  let term_for_zoom = Arc::clone(&term);
  let id_for_zoom = id.clone();
  let _stop_zoom_listener = use_event_listener_with_options(
    use_window(),
    leptos::ev::keydown,
    move |e: web_sys::KeyboardEvent| {
      // Only handle zoom for the active terminal
      if active_id.get_untracked().as_deref() != Some(id_for_zoom.as_str()) {
        return;
      }
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
        if let Some((cols, rows)) = bridge::extract_size(&t.fit_to_container()) {
          ws_send_for_zoom(&resize_msg(cols, rows));
        }
        if let Some(container) = container_ref.get() {
          let el: web_sys::HtmlElement = container.into();
          let _ = el.set_attribute("data-font-size", &next.to_string());
        }
        bridge::local_storage_set(FONT_SIZE_KEY, &next.to_string());
      }
    },
    UseEventListenerOptions::default().capture(true),
  );

  // --- Fit on becoming visible ---
  let term_for_fit = Arc::clone(&term);
  let ws_send_for_fit = ws.send.clone();
  Effect::new(move |prev: Option<bool>| {
    let is_active = active_id.get().as_deref() == Some(id_for_visibility.as_str());
    let was_active = prev.unwrap_or(false);
    if is_active && !was_active {
      // Just became visible — wait one frame for layout, then re-measure
      // and refit. Cells may have been 0 when terminal opened while invisible.
      let term = Arc::clone(&term_for_fit);
      let ws_send = ws_send_for_fit.clone();
      wasm_bindgen_futures::spawn_local(async move {
        bridge::wait_animation_frame().await;
        if let Some(t) = term.lock().unwrap().as_ref() {
          t.measure_cells();
          if let Some((cols, rows)) = bridge::extract_size(&t.fit_to_container()) {
            ws_send(&resize_msg(cols, rows));
          }
        }
      });
    }
    is_active
  });

  // --- Cleanup ---
  let term_for_cleanup = Arc::clone(&term);
  let ws_close = ws.close.clone();
  on_cleanup(move || {
    if let Some(t) = term_for_cleanup.lock().unwrap().take() {
      t.dispose();
    }
    ws_close();
  });

  view! {
      <div
          node_ref=container_ref
          class=move || {
              let active = active_id.get().as_deref() == Some(id.as_str());
              if active {
                  "w-full h-full min-w-0 min-h-0 overflow-hidden"
              } else {
                  "w-full h-full hidden"
              }
          }
      />
  }
}
