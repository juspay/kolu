//! Leptos component that mounts a ghostty-web terminal.
//!
//! Pure renderer — no WebSocket logic. The parent (`TerminalPane`) manages
//! the single WS connection and routes data to/from the active terminal.

use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

use leptos::prelude::*;
use leptos_use::{
  use_event_listener_with_options, use_resize_observer, use_window, UseEventListenerOptions,
};
use send_wrapper::SendWrapper;
use wasm_bindgen::prelude::*;

use crate::bridge;
use crate::terminal::GhosttyTerminal;

/// Shared registry of live ghostty terminal handles.
/// `TerminalPane` provides this context; each `TerminalView` registers into it.
pub type TerminalRegistry = RwSignal<HashMap<String, SendWrapper<Rc<GhosttyTerminal>>>>;

const MIN_FONT_SIZE: f64 = 8.0;
const MAX_FONT_SIZE: f64 = 32.0;
const FONT_SIZE_KEY: &str = "kolu-font-size";

/// Ghostty terminal renderer. No WebSocket — parent owns the connection.
#[component]
pub fn TerminalView(
  terminal_id: String,
  is_active: Signal<bool>,
  on_input: Callback<String>,
  on_terminal_resize: Callback<(u16, u16)>,
) -> impl IntoView {
  let container_ref = NodeRef::<leptos::html::Div>::new();
  let registry = use_context::<TerminalRegistry>().expect("TerminalRegistry context");

  // Shared terminal handle — None until async init completes.
  let term: Arc<std::sync::Mutex<Option<SendWrapper<Rc<GhosttyTerminal>>>>> =
    Arc::new(std::sync::Mutex::new(None));

  // --- Terminal init ---
  let term_for_init = Arc::clone(&term);
  let tid_for_init = terminal_id.clone();
  Effect::new(move |_| {
    let container = container_ref.get();
    if container.is_none() {
      return;
    }
    let container: web_sys::HtmlElement = container.unwrap().into();

    let term_cell = Arc::clone(&term_for_init);
    let tid = tid_for_init.clone();

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

      // Set initial font-size data attribute for e2e testability
      container
        .set_attribute("data-font-size", &t.get_font_size().to_string())
        .unwrap();

      let t = Rc::new(t);

      // Wire terminal keyboard input → parent callback
      let on_data = Closure::wrap(Box::new(move |data: String| {
        on_input.run(data);
      }) as Box<dyn FnMut(String)>);
      t.on_data(&on_data);
      on_data.forget();

      // Wire terminal resize events → parent callback
      let on_resize_cb = Closure::wrap(Box::new(move |cols: u16, rows: u16| {
        on_terminal_resize.run((cols, rows));
      }) as Box<dyn FnMut(u16, u16)>);
      t.on_resize(&on_resize_cb);
      on_resize_cb.forget();

      // Register in shared registry so parent can write WS data to us
      registry.update(|map| {
        map.insert(tid.clone(), SendWrapper::new(Rc::clone(&t)));
      });

      // Store local handle
      *term_cell.lock().unwrap() = Some(SendWrapper::new(t));
    });
  });

  // --- Fit to container when becoming active ---
  let term_for_active = Arc::clone(&term);
  Effect::new(move |prev: Option<bool>| {
    let active = is_active.get();
    // Only trigger on transition to active (not initial render)
    if active && prev == Some(false) {
      if let Some(t) = term_for_active.lock().unwrap().as_ref() {
        if let Some((cols, rows)) = bridge::extract_size(&t.fit_to_container()) {
          on_terminal_resize.run((cols, rows));
        }
      }
    }
    active
  });

  // --- ResizeObserver via leptos-use ---
  let term_for_resize = Arc::clone(&term);
  use_resize_observer(container_ref, move |_entries, _observer| {
    // Only send resize if this terminal is active
    if !is_active.get_untracked() {
      return;
    }
    if let Some(t) = term_for_resize.lock().unwrap().as_ref() {
      if let Some((cols, rows)) = bridge::extract_size(&t.fit_to_container()) {
        on_terminal_resize.run((cols, rows));
      }
    }
  });

  // --- Font zoom via leptos-use event listener ---
  let term_for_zoom = Arc::clone(&term);
  let _stop_zoom_listener = use_event_listener_with_options(
    use_window(),
    leptos::ev::keydown,
    move |e: web_sys::KeyboardEvent| {
      // Only handle zoom for active terminal
      if !is_active.get_untracked() {
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
          on_terminal_resize.run((cols, rows));
        }

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
  let tid_for_cleanup = terminal_id.clone();
  on_cleanup(move || {
    if let Some(t) = term_for_cleanup.lock().unwrap().take() {
      t.dispose();
    }
    registry.update(|map| {
      map.remove(&tid_for_cleanup);
    });
  });

  view! {
    <div node_ref=container_ref class="w-full h-full"></div>
  }
}
